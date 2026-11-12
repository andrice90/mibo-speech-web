/**
 * Speech-to-text for one try in a grown-up-made lesson: the recogniser's
 * words, never the audio.
 *
 * Only on-device recognition is used (Chrome's `processLocally`). The usual
 * Web Speech API sends audio to a server, which this app never does with a
 * child's voice; where on-device recognition is missing, `startStt` returns
 * null and the lesson falls back to "any clear try counts", with the
 * grown-up's arrows deciding.
 */
type Rec = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean; processLocally?: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecCtor = (new () => Rec) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

const Ctor = (): RecCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
const LOCAL = { langs: ['en-US'], processLocally: true };

let local = false;
let checking: Promise<boolean> | null = null;

/** Finds out whether this browser can recognise speech on the device (and asks it to fetch the language pack if it can). */
export function prepareStt(): Promise<boolean> {
  checking ??= (async () => {
    const C = Ctor();
    if (!C?.available) return false;
    const state = await C.available(LOCAL);
    if (state === 'downloadable' || state === 'downloading') void C.install?.(LOCAL).then(ok => { local = !!ok; }, () => {});
    local = state === 'available';
    return local;
  })().catch(() => false);
  return checking;
}

export const sttAvailable = () => local;

export type SttSession = {
  start: () => void;
  /** Resolves with transcript alternatives, or null when nothing was heard. */
  done: Promise<string[] | null>;
  stop: () => void;
};

/** A recognition session for one try. Call `start()` when Mibo stops talking. */
export function startStt(_target: string): SttSession | null {
  const C = Ctor();
  if (!C || !local) return null;
  let rec: Rec;
  try { rec = new C(); } catch { return null; }
  let resolve: (v: string[] | null) => void = () => {};
  const done = new Promise<string[] | null>(res => { resolve = res; });
  let heard: string[] = [], settled = false, timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (v: string[] | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rec.onresult = rec.onerror = rec.onend = null;
    resolve(v && v.length ? v : null);
  };
  rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
  rec.processLocally = true;   // the audio stays on this device
  rec.onresult = e => {
    const last = e.results[e.results.length - 1];
    if (!last?.isFinal) return;
    heard = Array.from(last).map(a => a.transcript).filter(Boolean);
    if (heard.length) settle(heard);
  };
  rec.onerror = () => settle(heard.length ? heard : null);
  rec.onend = () => settle(heard.length ? heard : null);
  return {
    done,
    start: () => {
      if (settled) return;
      timer = setTimeout(() => { try { rec.stop(); } catch { /* ignore */ } settle(heard.length ? heard : null); }, 9000);
      try { rec.start(); } catch { settle(null); }
    },
    stop: () => { try { rec.abort(); } catch { /* ignore */ } settle(null); },
  };
}
