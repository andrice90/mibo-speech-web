/**
 * Mibo's next line after each try, written by hybrid inference.
 *
 * `PREFER_ON_DEVICE`: where the browser has Gemini Nano the line is written
 * on the device (instant, free, and nothing about the try leaves it);
 * elsewhere the same prompt goes to a small Gemini model in the cloud. Only
 * lesson state goes in either way (the target, how the try went, the attempt
 * number): never audio, never a name. Any failure, slow answer or line that
 * breaks the rules falls back to a bundled line, so the lesson never stalls
 * or says something unchecked.
 */
import { getGenerativeModel, InferenceMode, InferenceSource, Schema, type GenerativeModel } from 'firebase/ai';

import type { Sound } from '../lesson/content';
import { DEVICE_TEXT } from './device';
import { firebaseReady, miboAI, MODELS, withTimeout } from './firebase';

export type Mark = 'got' | 'tricky';
export type Heard = 's' | 'th' | 'sh' | 'z' | 'stop';
export type Turn = {
  sound: Sound;           // the lesson's target sound, or rhyming
  target: string;         // the word or sound attempted, e.g. "sun", "the snake sound" or "cat, hat"
  mark: Mark;             // how the try went
  attempt: number;        // 1-based
  willRetry: boolean;     // the app will model the word again after this line
  heard?: Heard;          // what the on-device check heard, when it heard something else
  avoid?: string[];       // Mibo's last few lines, so the next one says it differently
};
export type Where = 'device' | 'cloud' | 'bundled';
export type Reply = { say: string; mood: 'happy' | 'gentle' | 'surprised'; where: Where; ms?: number };

const SOUND_NAME: Record<Sound, string> = {
  s: '/s/ (snake sound)',
  th: '/th/ as in thumb (tongue sound)',
  sh: '/sh/ as in shoe (the quiet sound)',
  z: '/z/ as in zoo (the buzzy bee sound)',
  rhyme: 'rhyming words: the child says two words that rhyme',
  twisty: 'a long twisty word, said slowly chunk by chunk and then whole',
  custom: 'practising a new word from a lesson the grown-up made',
};

const SOUND_TIP: Record<Sound, string> = {
  s: 'teeth together, smile, and blow a long snake hiss',
  th: 'tongue peeks out between the teeth and blows gently',
  sh: 'lips push out round like a kiss, teeth close, and blow a long quiet sound',
  z: 'teeth together, smile, and switch the voice on so it buzzes like a bee',
  rhyme: 'listen to the ends of the two words: they sound the same',
  twisty: 'break the word into little chunks, say each chunk slowly, then put them together',
  custom: 'say the word slowly and clearly, then say it whole',
};

const HEARD: Record<Heard, string> = {
  s: 'a hissy s sound', th: 'the tongue poking out (a th sound)', sh: 'a shushy sh sound', z: 'a buzzy z sound',
  stop: 'a quick t sound instead of a long hiss',
};

// A different angle each time keeps Mibo from saying "great snake sound!" over and over.
const ANGLES = [
  'Name the word they said and cheer for it.',
  'Praise what their mouth did (teeth, tongue, lips or blowing).',
  'Be silly and playful, like a cartoon friend.',
  'Compare it to something fun (a sleepy snake, a buzzing bee, a bicycle tyre, a kettle).',
  'Keep it very short and bouncy, three or four words.',
  'Say how proud Mibo is, warmly.',
];

const SYSTEM = `You write ONE short line for Mibo, a friendly cartoon speech-practice buddy for children aged 4-7. A grown-up is sitting with the child.

Rules:
- Max 14 words. Simple words a 4 year old knows. Warm, playful, specific. Full natural sentences ("your tongue", not "tongue").
- Never say the child got it wrong, never "no", "wrong", "bad", "fail" or "incorrect". Praise effort.
- If the try was tricky, give ONE tiny tip (from mouthTip), then encourage. Do not ask a question.
- If the try sounded right, celebrate it and name what they did ("your teeth stayed together!").
- Do not write the sound stretched out (no "Sssss", "Shhhh", "Zzzzz" or "Thhhh"): the app plays that clip itself.
- Never mention doctors, therapy, diagnosis, or anything about the child's body beyond the mouth tip.
- Do not ask for names or personal details. Do not say "your turn": the app says that.
- Do not start with "Ooh", "Wow" or "Yay": Mibo has just said one of those. Don't always use the sound's nickname ("snake sound", "quiet sound").
- Never repeat or closely copy any line in "alreadySaid".
Return JSON: {"say": string, "mood": "happy" | "gentle" | "surprised"}`;

const SCHEMA = Schema.object({
  properties: { say: Schema.string(), mood: Schema.enumString({ enum: ['happy', 'gentle', 'surprised'] }) },
});

const BLOCK = /\b(wrong|bad|fail|failed|incorrect|no|doctor|therap\w*|diagnos\w*|disorder|lisp|stupid|dumb)\b/i;

const FALLBACK: Record<Mark, string[]> = {
  got: ['Yes! You did it! Super sound!', 'Wow! That was amazing!', 'Hooray! You got it!'],
  tricky: ["Ooh, so close! Let's try again.", 'Good trying! One more time.', "Nice and slow. Let's try again!"],
};

export function fallbackReply(t: Turn): Reply {
  const list = FALLBACK[t.mark];
  return { say: list[(t.attempt - 1) % list.length], mood: t.mark === 'got' ? 'happy' : 'gentle', where: 'bundled' };
}

/** Checks a model line against the rules above; returns the cleaned line or null. */
export function checkLine(raw: unknown): string | null {
  const say = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!say || say.split(' ').length > 18 || BLOCK.test(say) || /(s{3,}|h{3,}|z{3,})/i.test(say)) return null;
  return say;
}

let model: GenerativeModel | null = null;
function replyModel(): GenerativeModel {
  model ??= getGenerativeModel(miboAI(), {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: { createOptions: DEVICE_TEXT, promptOptions: { responseConstraint: SCHEMA } },
    inCloudParams: {
      model: MODELS.small,
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 200 },
    },
  });
  return model;
}

/**
 * Starts the on-device model's download if the browser offers one. Must be
 * called from a tap (Chrome requires a user gesture). Until the model is
 * there, `PREFER_ON_DEVICE` simply uses the cloud.
 */
export function warmDeviceModel(onProgress?: (fraction: number) => void): Promise<void> {
  if (!firebaseReady) return Promise.resolve();
  return replyModel().initializeDeviceModel(onProgress).catch(() => {});
}

export async function writeReply(t: Turn, timeoutMs = 6000): Promise<Reply> {
  if (!firebaseReady) return fallbackReply(t);
  const input = JSON.stringify({
    targetSound: SOUND_NAME[t.sound],
    mouthTip: SOUND_TIP[t.sound],
    attempted: t.target,
    howItWent: t.mark === 'got' ? 'sounded right' : 'still tricky',
    attemptNumber: t.attempt,
    ...(t.heard ? { mibosEarsHeard: HEARD[t.heard] } : {}),
    angle: ANGLES[Math.floor(Math.random() * ANGLES.length)],
    alreadySaid: t.avoid ?? [],
    nextStep: t.willRetry ? 'Mibo will show it again' : t.mark === 'got' ? 'move on to the next one' : 'move on, keep it happy',
  });
  const t0 = Date.now();
  try {
    const result = await withTimeout(replyModel().generateContent(`${SYSTEM}\n\nThis try:\n${input}`), timeoutMs, 'reply');
    const out = JSON.parse(result.response.text());
    const say = checkLine(out.say);
    if (!say) throw new Error(`rejected line: ${out.say}`);
    const mood = ['happy', 'gentle', 'surprised'].includes(out.mood) ? out.mood : t.mark === 'got' ? 'happy' : 'gentle';
    const where: Where = result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'device' : 'cloud';
    console.log(`[reply] ${where} ${Date.now() - t0}ms "${say}"`);
    return { say, mood, where, ms: Date.now() - t0 };
  } catch (e) {
    console.warn('[reply] bundled line:', (e as Error).message);
    return fallbackReply(t);
  }
}
