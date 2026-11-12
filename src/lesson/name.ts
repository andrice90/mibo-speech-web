/**
 * The child's optional first name and Mibo's four lines that use it. The
 * name goes to the cloud voice model once, to make these clips, and never to
 * the model that writes Mibo's replies or the parent notes. The clips are
 * saved in this browser, so the name is never sent again.
 */
import { speak } from '../ai/tts';
import { deleteAudio, putAudio, readJson, writeJson } from '../lib/store';
import type { Clip } from '../voice/player';
import { NAME_RE } from './name-rule';
import type { SavedClip } from './progress';

export type NameLine = 'hi' | 'got' | 'tricky' | 'bye';
type Lines = Record<NameLine, SavedClip>;
let current: { name: string; lines: Lines } | null = null;

type Saved = { name: string; lines: Lines; at: number };
const KEY = 'mibo-names-v1';
const readSaved = () => readJson<Saved[]>(KEY, []);

const LINES = (n: string): Record<NameLine, string> => ({
  hi: `Hi ${n}! I'm Mibo.`,
  got: `Yes, ${n}! You did it!`,
  tricky: `Good try, ${n}!`,
  bye: `Great job, ${n}!`,
});

/** Names learned on this device, most recent first. */
export const learnedNames = (): string[] => readSaved().sort((a, b) => b.at - a.at).map(x => x.name);

/** Use a learned name for this lesson: no network, its clips are already here. */
export function pickLearnedName(name: string): boolean {
  const hit = readSaved().find(x => x.name === name);
  if (!hit) return false;
  current = { name: hit.name, lines: hit.lines };
  writeJson(KEY, readSaved().map(x => (x.name === name ? { ...x, at: Date.now() } : x)));
  return true;
}

/** Forget a learned name and delete its clips from this device. */
export function forgetLearnedName(name: string) {
  const list = readSaved();
  const hit = list.find(x => x.name === name);
  if (hit) for (const l of Object.values(hit.lines)) void deleteAudio(l.uri.replace(/^idb:/, ''));
  writeJson(KEY, list.filter(x => x.name !== name));
  if (current?.name === name) current = null;
}

export const validName = (s: string) => NAME_RE.test(s.trim().replace(/\s+/g, ' '));
export const childName = () => current?.name ?? null;
export const savedName = () => current;
export const forgetName = () => { current = null; };

export function nameClip(k: NameLine): Clip | null {
  const c = current?.lines[k];
  return c ? { source: c.uri, text: c.text, visemes: c.visemes, seconds: c.seconds } : null;
}

/** Brings back a saved name with its clips. */
export function restoreName(name?: string, lines?: Lines): boolean {
  current = name && lines ? { name, lines } : null;
  return !!current;
}

/** Makes the four name lines with the cloud voice. Resolves false if anything fails: the lesson just stays generic. */
export async function makeNameLines(raw: string): Promise<boolean> {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!validName(name)) return false;
  try {
    const texts = LINES(name), lines = {} as Lines, stamp = Date.now();
    await Promise.all((Object.keys(texts) as NameLine[]).map(async k => {
      const s = await speak(texts[k], { note: 'Say the name warmly and clearly, like greeting a friend.' });
      const key = `name-${stamp}-${k}`;
      await putAudio(key, s.wav);
      lines[k] = { uri: `idb:${key}`, text: texts[k], visemes: s.visemes, seconds: s.seconds };
    }));
    current = { name, lines };
    writeJson(KEY, [...readSaved().filter(x => x.name !== name), { name, lines, at: Date.now() }]);
    return true;
  } catch {
    console.warn('[name] voice lines failed');   // never log the name itself
    return false;
  }
}
