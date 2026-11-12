/**
 * Mibo's latest notes, kept on this device, and how much practice has
 * happened since they were written. Plain storage and counting: the notes
 * themselves are written in src/ai/report.ts.
 */
import type { Notes } from '../ai/report';
import { readJson, writeJson } from '../lib/store';
import { allResults } from './results';

const KEY = 'mibo-notes-v2';

export const loadNotes = () => readJson<Notes | null>(KEY, null);
export const saveNotes = (n: Notes | null) => { writeJson(KEY, n); };

/** Words and games practised since the notes were last written (all of them, if there are no notes yet). */
export function practiceSinceNotes(notes: Notes | null = loadNotes()): number {
  const since = notes?.at ?? 0;
  return allResults().filter(r => r.at > since).length;
}
