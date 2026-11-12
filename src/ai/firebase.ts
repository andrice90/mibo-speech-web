/**
 * The one place the app talks to Firebase. Every model call in this app goes
 * through Firebase AI Logic (`firebase/ai`): Gemini Nano on the device where
 * the browser has it, Gemini in the cloud otherwise. There is no other model
 * API and no server of our own.
 *
 * Models are only ever used from the grown-up zone (src/lib/zone.ts). The kid
 * zone plays lessons with no AI calls at all, and `miboAI()` refuses to hand
 * out a model while the app is in it.
 *
 * App Check is required by AI Logic. The hosted app uses reCAPTCHA
 * Enterprise; on localhost or a test device, a debug token stands in.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

import { inParentZone } from '../lib/zone';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** False until the Firebase web config is in `.env.local`: the app then runs on Mibo's bundled lines only. */
export const firebaseReady = !!(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let ai: AI | null = null;

export function miboAI(): AI {
  if (!inParentZone()) throw new Error('AI is only used in the grown-up zone');
  if (ai) return ai;
  if (!firebaseReady) throw new Error('Firebase is not configured');
  app = initializeApp(config);
  const debug = env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY as string | undefined;
  if (debug) {
    // "true" makes the SDK print a new token to the console, to register under App Check > Manage debug tokens
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = debug === 'true' ? true : debug;
  }
  if (siteKey || debug) {
    initializeAppCheck(app, {
      provider: siteKey
        ? new ReCaptchaEnterpriseProvider(siteKey)
        // debug-only setup: the SDK swaps in the debug token and never asks this provider
        : new CustomProvider({ getToken: () => Promise.reject(new Error('App Check: no reCAPTCHA site key set')) }),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    console.warn('[firebase] App Check is not set up: cloud calls will be refused. See .env.example.');
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return ai;
}

/** Cloud models, all on the Gemini Developer API's no-cost tier. */
export const MODELS = {
  /** Writes the parent notes when the device has no built-in model and the grown-up agrees. */
  small: 'gemini-3.5-flash-lite',
  /** Writes new lesson plans. */
  plan: 'gemini-3.8-flash',
  /** Mibo's voice. */
  tts: 'gemini-3.1-flash-tts-preview',
} as const;

export const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

/** A sentence for the grown-up when a cloud call fails; setup problems are named, everything else gets `fallback`. */
export function cloudError(e: unknown, fallback: string): string {
  const status = (e as { customErrorData?: { status?: number } }).customErrorData?.status;
  const msg = (e as Error)?.message ?? '';
  if (status === 401 || status === 403 || /App Check|appCheck/.test(msg)) {
    return 'Firebase refused this device (App Check). If you are testing, register the debug token printed in the browser console, then try again.';
  }
  if (status === 429) return 'The free limit for the cloud has been reached for now. Wait a few minutes and try again.';
  if ((status && status >= 500) || /high demand|overloaded|timed out/i.test(msg)) return 'Gemini is very busy right now and did not answer after several tries. Wait a minute and try again.';
  if (/^(Mibo could not|Making lessons needs|Mibo\'s notes need|This device is out of space)/.test(msg)) return msg;
  return fallback;
}

export const statusOf = (e: unknown) => (e as { customErrorData?: { status?: number } }).customErrorData?.status;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

const busyListeners = new Set<() => void>();
/** Tells a waiting screen each time a cloud call had to be tried again. Returns the unsubscribe. */
export function onCloudBusy(f: () => void): () => void {
  busyListeners.add(f);
  return () => { busyListeners.delete(f); };
}

/**
 * Runs a cloud call, trying again when the service is busy (5xx, "high
 * demand", a timeout) or rate-limited (429), with growing pauses. `run`
 * gets the attempt number so a caller can switch model between tries.
 * Setup failures (401/403) are not retried.
 */
export async function withRetry<T>(what: string, run: (attempt: number) => Promise<T>, waits = [2000, 5000, 10000, 20000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt);
    } catch (e) {
      const status = statusOf(e);
      if (status === 401 || status === 403 || attempt >= waits.length) throw e;
      console.warn(`[${what}] try ${attempt + 1} failed, trying again:`, (e as Error).message.slice(0, 160));
      busyListeners.forEach(f => f());
      await pause(status === 429 ? Math.max(20000, waits[attempt]) : waits[attempt]);
    }
  }
}
