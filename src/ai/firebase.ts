/**
 * The one place the app talks to Firebase. Every model call in this app goes
 * through Firebase AI Logic (`firebase/ai`): Gemini Nano on the device where
 * the browser has it, Gemini in the cloud otherwise. There is no other model
 * API and no server of our own.
 *
 * App Check is required by AI Logic. The hosted app uses reCAPTCHA
 * Enterprise; on localhost or a test device, a debug token stands in.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

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
  /** Fallback for Mibo's short reply and the parent notes when the device has no built-in model. */
  small: 'gemini-3.5-flash-lite',
  /** Writes new lesson plans. */
  plan: 'gemini-3.8-flash',
  /** Mibo's voice. */
  tts: 'gemini-3.1-flash-tts-preview',
} as const;

export const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
