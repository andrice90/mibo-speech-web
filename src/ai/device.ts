/**
 * The on-device model (Gemini Nano through Chrome's Prompt API), as Firebase
 * AI Logic's hybrid inference uses it. This module only reports whether the
 * browser has it and warms it up; the prompts themselves go through
 * `getGenerativeModel(ai, { mode: InferenceMode.… })` in reply.ts and report.ts.
 */
import type { LanguageModelCreateOptions } from 'firebase/ai';

export type DeviceAi = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** Text in, text out, English: the same options every on-device call in this app uses. */
export const DEVICE_TEXT: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

type LanguageModelApi = { availability(o?: object): Promise<DeviceAi> };

export async function deviceAiStatus(): Promise<DeviceAi> {
  const LM = (globalThis as unknown as { LanguageModel?: LanguageModelApi }).LanguageModel;
  if (!LM?.availability) return 'unavailable';
  try {
    return await LM.availability(DEVICE_TEXT);
  } catch {
    return 'unavailable';
  }
}

export const DEVICE_LABEL: Record<DeviceAi, string> = {
  available: 'On-device AI is ready',
  downloadable: 'On-device AI can be downloaded',
  downloading: 'On-device AI is downloading…',
  unavailable: 'No on-device AI in this browser',
};
