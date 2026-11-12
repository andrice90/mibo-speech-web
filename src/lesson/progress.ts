/**
 * Where each lesson was left off, kept on this device only: the step, the
 * stars, and the optional first name with Mibo's name clips (saved audio,
 * so resuming never sends the name anywhere again).
 */
import { readJson, writeJson } from '../lib/store';
import type { Viseme } from '../voice/analyze';

/** `uri` is `idb:<key>`: the WAV sits in this browser's IndexedDB. */
export type SavedClip = { uri: string; text: string; visemes: Viseme[]; seconds: number };
export type Progress = {
  step: number; stars: number; at: number;
  name?: string; nameLines?: Record<'hi' | 'got' | 'tricky' | 'bye', SavedClip>;
};
type Store = Record<string, Progress>;

const KEY = 'mibo-progress-v1';
const read = () => readJson<Store>(KEY, {});

export const loadProgress = (lesson: string): Progress | null => read()[lesson] ?? null;

export function saveProgress(lesson: string, p: Partial<Progress>) {
  const s = read();
  s[lesson] = { ...{ step: 0, stars: 0 }, ...s[lesson], ...p, at: Date.now() } as Progress;
  writeJson(KEY, s);
}

/** Clears a lesson's place (finished, or started over). */
export function clearProgress(lesson: string) {
  const s = read();
  delete s[lesson];
  writeJson(KEY, s);
}
