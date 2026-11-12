/**
 * The practice log: one line per word or picture game the child finished.
 * It holds lesson facts only (the word, how many goes it took, what Mibo's
 * on-device listening heard) — never audio, never the child's name — and it
 * stays in this browser. It is written in the kid zone by plain code (no
 * model) and read in the grown-up zone, where the on-device model turns it
 * into Mibo's notes (src/ai/report.ts).
 */
import { readJson, writeJson } from '../lib/store';
import type { Sound } from './content';

export type TryResult = {
  at: number;
  lesson: string;                 // lesson title, e.g. "Lesson 1" or a made lesson's title
  kind: 'say' | 'pick';
  target: string;                 // the word, sound or rhyming pair
  sound: Sound;
  attempts: number;               // goes it took (1 = first try)
  ok: boolean;                    // finished with a pass
  by: 'ears' | 'grownup' | 'tap'; // who decided: Mibo's listening, the grown-up's arrow, or the child's tap
  heard?: string[];               // sounds Mibo's ears heard instead, when they could name one
};

const KEY = 'mibo-results-v1';
const MAX = 400;

export const allResults = () => readJson<TryResult[]>(KEY, []);
export const logResult = (r: TryResult) => { writeJson(KEY, [...allResults(), r].slice(-MAX)); };
export const clearResults = () => { writeJson(KEY, []); };

export type SoundStat = { sound: Sound; words: number; firstTry: number; neededHelp: number; notYet: number };
export type WordStat = { target: string; sound: Sound; times: number; firstTry: number; notYet: number; heard: string[] };
export type Summary = {
  total: number; days: number; lessons: string[];
  sounds: SoundStat[]; words: WordStat[];
  games: { played: number; firstTry: number };
};

/** Plain counts for the report screen and the model's prompt. */
export function summarise(rs: TryResult[] = allResults()): Summary {
  const say = rs.filter(r => r.kind === 'say'), picks = rs.filter(r => r.kind === 'pick');
  const sounds = new Map<Sound, SoundStat>(), words = new Map<string, WordStat>();
  for (const r of say) {
    const s = sounds.get(r.sound) ?? { sound: r.sound, words: 0, firstTry: 0, neededHelp: 0, notYet: 0 };
    s.words++;
    if (!r.ok) s.notYet++; else if (r.attempts === 1) s.firstTry++; else s.neededHelp++;
    sounds.set(r.sound, s);
    const w = words.get(r.target) ?? { target: r.target, sound: r.sound, times: 0, firstTry: 0, notYet: 0, heard: [] };
    w.times++;
    if (r.ok && r.attempts === 1) w.firstTry++;
    if (!r.ok) w.notYet++;
    for (const h of r.heard ?? []) if (!w.heard.includes(h)) w.heard.push(h);
    words.set(r.target, w);
  }
  return {
    total: rs.length,
    days: new Set(rs.map(r => new Date(r.at).toDateString())).size,
    lessons: [...new Set(rs.map(r => r.lesson))],
    sounds: [...sounds.values()],
    words: [...words.values()],
    games: { played: picks.length, firstTry: picks.filter(p => p.ok && p.attempts === 1).length },
  };
}

/**
 * Single words that took more than one go or were not got yet, most
 * troublesome first: candidates to bring back in the next lesson. Plain
 * counting, no model.
 */
export function wordsToBringBack(s: Summary, max = 3): string[] {
  return s.words
    .filter(w => /^[a-z][a-z'-]*$/.test(w.target) && (w.notYet > 0 || w.firstTry < w.times))
    .sort((a, b) => (b.notYet * 2 + (b.times - b.firstTry)) - (a.notYet * 2 + (a.times - a.firstTry)))
    .slice(0, max).map(w => w.target);
}
