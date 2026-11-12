/**
 * Mibo's notes for the grown-up: what the practice log means. Which sounds
 * and words are going well, where the child struggled, and what to focus on
 * next.
 *
 * This is the on-device half of the hybrid split. The log is a record of a
 * child's speech practice, so it is read by the model inside the device
 * (`ONLY_ON_DEVICE`): nothing about the child's performance leaves it. On a
 * device with no built-in model the grown-up may choose, each time, to let
 * the cloud write the notes instead (`PREFER_ON_DEVICE`, which then falls
 * back to the cloud), after being told exactly what would be sent.
 *
 * The notes end with lesson ideas. Those short topics, not the log, are
 * what the cloud lesson planner sees (src/ai/plan.ts).
 */
import { getGenerativeModel, InferenceMode, InferenceSource, Schema, type GenerativeModel } from 'firebase/ai';

import type { Summary } from '../lesson/results';
import { DEVICE_TEXT } from './device';
import { firebaseReady, miboAI, MODELS, withTimeout } from './firebase';

export type Notes = {
  headline: string; goingWell: string[]; trickySpots: string[]; focusNext: string[]; tip: string; lessonIdeas: string[];
  where: 'device' | 'cloud'; at: number;
};

const SOUND_WORDS: Record<string, string> = {
  s: 'the s sound ("snake sound")', th: 'the th sound ("tongue sound")', sh: 'the sh sound ("quiet sound")',
  z: 'the z sound ("buzzy bee sound")', rhyme: 'rhyming pairs', twisty: 'long multi-syllable words', custom: 'whole words from a made lesson',
};

const SYSTEM = `You are helping a parent understand how their young child's playful speech practice with Mibo (a cartoon practice buddy app) is going. You get counts from the practice log. Write short, warm, plain-English notes for the parent.

Rules:
- This is educational practice, not an assessment. Never diagnose, never use words like disorder, delay, lisp, impairment, therapy or treatment, and never predict outcomes.
- Be specific: name the sounds and words from the data. Do not invent data that is not there.
- "firstTry" means the child got it on the first go. "neededAnotherGo" means it took more than one go after Mibo showed it again. "notYet" means Mibo moved on kindly without a pass.
- "mibosEarsHeard" is what the app's simple on-device listening heard instead; treat it as a hint, not a fact.
- With little data, say so gently and suggest playing a bit more.
- headline: one sentence on how practice is going overall, max 20 words.
- goingWell: 1 to 3 short points (max 16 words each).
- trickySpots: 0 to 3 short points on where the child struggled: the sounds or words that took more goes (max 16 words each). Plain and kind, never as a fault.
- focusNext: 1 to 3 short points on what to focus on next and why it follows from the data (max 18 words each).
- tip: one practical, playful thing for the parent to try at home this week (max 30 words).
- lessonIdeas: 2 or 3 short topics for a new practice lesson that fit focusNext, each max 6 words, like "sh words at the beach" or "long animal words".
Return JSON only.`;

const SCHEMA = Schema.object({
  properties: {
    headline: Schema.string(),
    goingWell: Schema.array({ items: Schema.string() }),
    trickySpots: Schema.array({ items: Schema.string() }),
    focusNext: Schema.array({ items: Schema.string() }),
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
  const goingWell = list(r.goingWell, 3, 160), focusNext = list(r.focusNext, 3, 180);
  if (!goingWell.length && !focusNext.length) return null;
  return { headline, goingWell, trickySpots: list(r.trickySpots, 3, 160), focusNext, tip, lessonIdeas: list(r.lessonIdeas, 3, 60) };
}

/**
 * Everything the model sees: counts and words, kept small enough for the
 * on-device models on every platform. No dates, no audio, no name.
 */
export function promptData(s: Summary) {
  const said = s.sounds.reduce((n, x) => n + x.words, 0), first = s.sounds.reduce((n, x) => n + x.firstTry, 0);
  return {
    daysPractised: s.days,
    lessonsPlayed: s.lessons.slice(-8),
    wordsPractised: said,
    gotFirstTry: first,
    bySound: s.sounds.map(x => ({ practising: SOUND_WORDS[x.sound] ?? x.sound, goes: x.words, firstTry: x.firstTry, neededAnotherGo: x.neededHelp, notYet: x.notYet })),
    wordsThatTookMoreThanOneGo: s.words.filter(w => w.notYet > 0 || w.firstTry < w.times).slice(-20).map(w => ({
      word: w.target, timesPractised: w.times, firstTry: w.firstTry, notYet: w.notYet,
      ...(w.heard.length ? { mibosEarsHeard: w.heard } : {}),
    })),
    wordsGotFirstTryEveryTime: s.words.filter(w => w.notYet === 0 && w.firstTry === w.times).slice(-20).map(w => w.target),
    listeningGames: s.games,
  };
}

const models: Partial<Record<'device' | 'either', GenerativeModel>> = {};
function notesModel(allowCloud: boolean): GenerativeModel {
  const key = allowCloud ? 'either' : 'device';
  models[key] ??= getGenerativeModel(miboAI(), {
    mode: allowCloud ? InferenceMode.PREFER_ON_DEVICE : InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: DEVICE_TEXT, promptOptions: { responseConstraint: SCHEMA } },
    inCloudParams: { model: MODELS.small, generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA } },
  });
  return models[key]!;
}

/**
 * Writes the notes. Without `allowCloud` the call never touches the network:
 * if the model still has to download (a large one-time fetch), `onDownload`
 * reports progress (0..1) and the call waits for it. Must be started from a tap.
 */
export async function writeNotes(s: Summary, allowCloud: boolean, onDownload?: (fraction: number) => void): Promise<Notes> {
  if (!firebaseReady) throw new Error("Mibo's notes need the Firebase setup (see the README).");
  const model = notesModel(allowCloud);
  if (!allowCloud) await model.initializeDeviceModel(onDownload);
  const prompt = `${SYSTEM}\n\nPractice log:\n${JSON.stringify(promptData(s))}`;
  // on the device the first call may sit behind the model download, so it gets a long leash
  const result = await withTimeout(model.generateContent(prompt), allowCloud ? 90_000 : 30 * 60_000, 'notes');
  const notes = checkNotes(JSON.parse(result.response.text() || '{}'));
  if (!notes) throw new Error('Mibo could not write the notes this time. Try again.');
  // report what actually ran, not what was asked for
  const ran = result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'device' : 'cloud';
  return { ...notes, where: ran, at: Date.now() };
}
