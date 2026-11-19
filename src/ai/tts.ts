/**
 * Mibo's voice for new lines: Gemini text-to-speech (voice Leda) in the
 * cloud, through Firebase AI Logic. Speech needs a large model, so this is
 * the cloud half of the hybrid split. It is only used in the grown-up zone,
 * when a lesson is made: the text is a lesson line the grown-up approved,
 * never anything the child said, and the kid zone only plays the saved audio.
 *
 * The audio comes back as a WAV file (raw PCM from older models). It is trimmed and analysed here in the
 * browser, and the forced aligner (voice/lipsync.ts) works out Mibo's mouth
 * shapes, exactly as for the bundled clips.
 */
import { getGenerativeModel, ResponseModality, type GenerativeModel } from 'firebase/ai';

import { pcm16ToFloat, pcmToWav, trimEdges, wavToPcm, type Viseme } from '../voice/analyze';
import { firebaseReady, miboAI, MODELS, withRetry, withTimeout } from './firebase';

export const VOICE = 'Leda';

// How Mibo sounds. The 3.8 TTS models read the text strictly as a script, so the old
// "[Audio Profile] [Director's Notes]" lines would be spoken aloud: the delivery goes in
// the part's speech metadata instead, and the text is only what Mibo says.
const STYLE = 'Mibo, a warm, playful cartoon teacher for 4 to 7 year olds. Clear, a little slow, smiling. ' +
  "When the line has a stretched sound such as 'Sssss' or 'Thhhh', make that actual mouth sound and hold it " +
  'for about two seconds. Never say the letter name.';

export type Speech = { wav: Uint8Array; samples: Float32Array; sr: number; visemes: Viseme[]; seconds: number };

const models: Record<string, GenerativeModel> = {};
function ttsModel(name: string): GenerativeModel {
  models[name] ??= getGenerativeModel(miboAI(), {
    model: name,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } }, languageCode: 'en-US' },
    },
  });
  return models[name];
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

async function synth(model: string, text: string, style: string): Promise<{ pcm: Uint8Array; sr: number }> {
  const request = [{ type: 'text' as const, text, speechMetadata: { style } }];
  const result = await withTimeout(ttsModel(model).generateContent(request), 60_000, 'voice');
  const part = result.response.inlineDataParts()?.[0]?.inlineData;
  if (!part?.data) throw new Error('no audio in the reply');
  const bytes = fromBase64(part.data);
  // the 3.8 models answer with a WAV file; the older ones (and audio/l16) with bare PCM at the rate in the mime type
  const wav = wavToPcm(bytes);
  if (wav) {
    if (wav.channels !== 1) throw new Error(`voice came back with ${wav.channels} channels`);
    return { pcm: wav.pcm, sr: wav.sr };
  }
  const sr = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1]) || 24000;
  return { pcm: bytes.subarray(0, bytes.length - (bytes.length % 2)), sr };
}

/**
 * Speaks one line in Mibo's voice. `note` adds a delivery direction for this
 * line only. Tries again when the model is busy, rate-limited, or answers
 * with text instead of audio (it does now and then). Throws when the voice
 * cannot be made.
 */
export async function speak(text: string, opts: { note?: string; trim?: boolean } = {}): Promise<Speech> {
  if (!firebaseReady) throw new Error('Firebase is not configured');
  const style = opts.note ? `${STYLE} ${opts.note}` : STYLE;
  // the no-cost tier is often busy: later tries go to the other 3.8 voice model (same voice, Leda)
  const order = [MODELS.tts, MODELS.tts, MODELS.ttsBusy, MODELS.tts, MODELS.ttsBusy];
  return slot(() => withRetry('voice', async attempt => {
    const got = await synth(order[attempt % order.length], text, style);
    const pcm = opts.trim === false ? got.pcm : trimEdges(got.pcm, got.sr);
    const samples = pcm16ToFloat(pcm);
    // the aligner brings the pronouncing dictionary with it (4 MB), so it loads only when a voice line is made
    const { mouthTrack } = await import('../voice/lipsync');
    return { wav: pcmToWav(pcm, got.sr), samples, sr: got.sr, visemes: mouthTrack(text, samples, got.sr), seconds: samples.length / got.sr };
  }));
}
