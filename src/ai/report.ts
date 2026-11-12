/**
 * The parent notes: a plain-English read of how practice is going, written
 * from the practice log (lesson/results.ts).
 *
 * This is the on-device half of the app. The log is a record of a child's
 * speech practice, so by default it is read only by the model inside the
 * browser (`ONLY_ON_DEVICE`): nothing about the child's performance leaves
 * the device. On a device with no built-in model the grown-up may choose,
 * each time, to have the cloud write the notes instead (`ONLY_IN_CLOUD`),
 * after being told exactly what would be sent: words and counts, never
 * audio, never the name.
 *
 * The notes end with lesson ideas. A grown-up can tap one to make a new
 * lesson — that short topic is the only thing the cloud lesson planner sees.
 */
import { getGenerativeModel, InferenceMode, InferenceSource, Schema, type GenerativeModel } from 'firebase/ai';

import type { Summary } from '../lesson/results';
import { DEVICE_TEXT } from './device';
import { firebaseReady, miboAI, MODELS, withTimeout } from './firebase';

export type Notes = {
  headline: string; goingWell: string[]; practiseNext: string[]; tip: string; lessonIdeas: string[];
  where: 'device' | 'cloud'; at: number;
};

const SOUND_WORDS: Record<string, string> = {
  s: 'the s sound ("snake sound")', th: 'the th sound ("tongue sound")', sh: 'the sh sound ("quiet sound")',
  z: 'the z sound ("buzzy bee sound")', rhyme: 'rhyming pairs', twisty: 'long multi-syllable words', custom: 'words from a made lesson',
};

const SYSTEM = `You are helping a parent understand how their young child's playful speech practice with Mibo (a cartoon practice buddy app) is going. You get counts from the practice log. Write short, warm, plain-English notes for the parent.

Rules:
- This is educational practice, not an assessment. Never diagnose, never use words like disorder, delay, lisp, impairment, therapy or treatment, and never predict outcomes.
- Be specific: name the sounds and words from the data. Do not invent data that is not there.
- "firstTry" means the child got it on the first go. "neededHelp" means it took another go after Mibo showed it again. "notYet" means Mibo moved on kindly.
- "mibosEarsHeard" is what the app's simple on-device listening heard instead; treat it as a hint, not a fact.
- With little data, say so gently and suggest playing a bit more.
- headline: one sentence, max 20 words.
- goingWell: 1 to 3 short points (max 16 words each).
- practiseNext: 1 to 3 short points naming sounds or words worth more play (max 16 words each). Phrase them as fun things to try, never as problems.
- tip: one practical, playful tip for the parent to try at home this week (max 30 words).
- lessonIdeas: 2 or 3 short topics for a new practice lesson, each max 6 words, like "sh words at the beach" or "long animal words". They must fit practiseNext.
Return JSON only.`;

const SCHEMA = Schema.object({
  properties: {
    headline: Schema.string(),
    goingWell: Schema.array({ items: Schema.string() }),
    practiseNext: Schema.array({ items: Schema.string() }),
    tip: Schema.string(),
    lessonIdeas: Schema.array({ items: Schema.string() }),
  },
});

const BLOCK = /\b(diagnos\w*|disorder\w*|delay\w*|impair\w*|lisp\w*|therap\w*|treatment|patholog\w*|deficit|abnormal\w*|stupid|dumb)\b/i;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).map(x => clean(x, max)).filter(x => x && !BLOCK.test(x)).slice(0, n);

/** The model's JSON, checked: nothing that reads like a diagnosis gets through. */
export function checkNotes(raw: unknown): Omit<Notes, 'where' | 'at'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const headline = clean(r.headline, 200), tip = clean(r.tip, 300);
  if (!headline || BLOCK.test(headline) || BLOCK.test(tip)) return null;
  const goingWell = list(r.goingWell, 3, 160), practiseNext = list(r.practiseNext, 3, 160);
  if (!goingWell.length && !practiseNext.length) return null;
  return { headline, goingWell, practiseNext, tip, lessonIdeas: list(r.lessonIdeas, 3, 60) };
}

/** The counts the model sees. No dates, no lesson timing, no name: a few dozen words and numbers. */
export function promptData(s: Summary) {
  return {
    daysPractised: s.days,
    lessonsPlayed: s.lessons,
    bySound: s.sounds.map(x => ({ practising: SOUND_WORDS[x.sound] ?? x.sound, goes: x.words, firstTry: x.firstTry, neededHelp: x.neededHelp, notYet: x.notYet })),
    byWord: s.words.slice(-40).map(w => ({
      word: w.target, timesPractised: w.times, firstTry: w.firstTry, notYet: w.notYet,
      ...(w.heard.length ? { mibosEarsHeard: w.heard } : {}),
    })),
    listeningGames: s.games,
  };
}

const models: Partial<Record<'device' | 'cloud', GenerativeModel>> = {};
function notesModel(where: 'device' | 'cloud'): GenerativeModel {
  models[where] ??= getGenerativeModel(miboAI(), {
    mode: where === 'device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD,
    onDeviceParams: { createOptions: DEVICE_TEXT, promptOptions: { responseConstraint: SCHEMA } },
    inCloudParams: { model: MODELS.small, generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA } },
  });
  return models[where]!;
}

/**
 * Writes the notes. `where: 'device'` never touches the network: if the
 * model still has to download, `onDownload` reports progress (0..1) and the
 * call waits for it. Must be started from a tap.
 */
export async function writeNotes(s: Summary, where: 'device' | 'cloud', onDownload?: (fraction: number) => void): Promise<Notes> {
  if (!firebaseReady) throw new Error('Mibo\'s notes need the Firebase setup (see the README).');
  const model = notesModel(where);
  if (where === 'device') await model.initializeDeviceModel(onDownload);
  const prompt = `${SYSTEM}\n\nPractice log:\n${JSON.stringify(promptData(s))}`;
  const result = await withTimeout(model.generateContent(prompt), where === 'device' ? 120000 : 30000, 'notes');
  const notes = checkNotes(JSON.parse(result.response.text() || '{}'));
  if (!notes) throw new Error('Mibo could not write the notes this time. Try again.');
  // report what actually ran, not what was asked for
  const ran = result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'device' : 'cloud';
  return { ...notes, where: ran, at: Date.now() };
}
