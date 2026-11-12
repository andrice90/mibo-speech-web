/**
 * Mibo's voice for new lines: Gemini text-to-speech (voice Leda) in the
 * cloud, through Firebase AI Logic. Speech needs a large model, so this is
 * the cloud half of the hybrid split. It is only used in the grown-up zone,
 * when a lesson is made: the text is a lesson line the grown-up approved,
 * never anything the child said, and the kid zone only plays the saved audio.
 *
 * The audio comes back as raw PCM. It is trimmed and analysed here in the
 * browser, and the forced aligner (voice/lipsync.ts) works out Mibo's mouth
 * shapes, exactly as for the bundled clips.
 */
import { getGenerativeModel, ResponseModality, type GenerativeModel } from 'firebase/ai';

import { pcm16ToFloat, pcmToWav, trimEdges, type Viseme } from '../voice/analyze';
import { firebaseReady, miboAI, MODELS, withTimeout } from './firebase';

export const VOICE = 'Leda';

// The delivery note Mibo's bundled clips were made with, in the layout Gemini TTS expects.
const PROFILE = '[Audio Profile: Mibo, a warm, playful cartoon teacher for 4 to 7 year olds]';
const NOTES = 'Speak clearly, a little slowly, smiling. When the text shows a stretched sound such as ' +
  "'Sssss' or 'Thhhh', make that actual mouth sound and hold it for about two seconds. Never say the letter name.";

export type Speech = { wav: Uint8Array; samples: Float32Array; sr: number; visemes: Viseme[]; seconds: number };

let model: GenerativeModel | null = null;
function ttsModel(): GenerativeModel {
  model ??= getGenerativeModel(miboAI(), {
    model: MODELS.tts,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } }, languageCode: 'en-US' },
    },
  });
  return model;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A few lines at a time: a made lesson needs about ten.
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>(res => waiting.push(res));
  active++;
  try { return await run(); } finally { active--; waiting.shift()?.(); }
}

async function synth(prompt: string): Promise<{ pcm: Uint8Array; sr: number }> {
  const result = await withTimeout(ttsModel().generateContent(prompt), 60_000, 'voice');
  const part = result.response.inlineDataParts()?.[0]?.inlineData;
  if (!part?.data) throw new Error('no audio in the reply');
  let pcm = fromBase64(part.data);
  const sr = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1]) || 24000;
  if (pcm[0] === 0x52 && pcm[1] === 0x49 && pcm[2] === 0x46 && pcm[3] === 0x46) pcm = pcm.subarray(44);  // already WAV
  return { pcm: pcm.subarray(0, pcm.length - (pcm.length % 2)), sr };
}

/**
 * Speaks one line in Mibo's voice. `note` adds a delivery direction for this
 * line only. Retries twice (the TTS model now and then answers with text
 * instead of audio) and waits out rate limits. Throws when the voice cannot be made.
 */
export async function speak(text: string, opts: { note?: string; trim?: boolean } = {}): Promise<Speech> {
  if (!firebaseReady) throw new Error('Firebase is not configured');
  const prompt = `${PROFILE}\n[Director's Notes: ${NOTES}${opts.note ? ` ${opts.note}` : ''}]\n${text}`;
  return slot(async () => {
    let last: unknown;
    for (let attempt = 0, waits = 0; attempt < 3;) {
      try {
        const got = await synth(prompt);
        const pcm = opts.trim === false ? got.pcm : trimEdges(got.pcm, got.sr);
        const samples = pcm16ToFloat(pcm);
        // the aligner brings the pronouncing dictionary with it (4 MB), so it loads only when a voice line is made
        const { mouthTrack } = await import('../voice/lipsync');
        return { wav: pcmToWav(pcm, got.sr), samples, sr: got.sr, visemes: mouthTrack(text, samples, got.sr), seconds: samples.length / got.sr };
      } catch (e) {
        last = e;
        const status = (e as { customErrorData?: { status?: number } }).customErrorData?.status;
        if (status === 401 || status === 403) break;   // App Check or API setup: retrying will not help
        // the free tier allows only so many voice lines a minute: wait and ask again (a lesson is made once, nobody is mid-lesson)
        if (status === 429 && waits++ < 5) { await new Promise(r => setTimeout(r, 20_000)); continue; }
        attempt++;
      }
    }
    throw last instanceof Error ? last : new Error('voice failed');
  });
}
