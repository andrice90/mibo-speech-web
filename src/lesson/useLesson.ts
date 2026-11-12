import { useCallback, useEffect, useRef, useState } from 'react';

import type { Puppet, Segment } from '../puppet/mibo';
import { judgeTry, type TryVerdict } from '../voice/judge';
import { enableMic, listen, micPermission, type Listening } from '../voice/listen';
import { outputLatency, playClip, stopAudio, type Clip } from '../voice/player';
import { judgeWord, type Templates } from '../voice/wordcheck';
import { bundled, preloadClips } from './clips';
import { clipsFor, MAX_ATTEMPTS, MAX_PICKS, VARIANTS, type Exercise, type LineId, type Pick, type Step } from './content';
import { logResult } from './results';

export type Nav = 'fwd' | 'back';
/**
 * `asking`: the browser is showing its microphone pop-up and waiting for an answer.
 * `stuck`: Mibo's voice for this lesson could not be loaded (offline before it was ever played).
 */
export type Phase = 'idle' | 'loading' | 'asking' | 'stuck' | 'talking' | 'listening' | 'picking' | 'thinking' | 'done';
export type LessonUi = {
  phase: Phase; step: number; ex: Exercise | null; stars: number;
  pick: Pick | null;       // the picture game on screen
  picked: { i: number; ok: boolean } | null;   // the picture tapped (or shown as the answer)
  mic: boolean;            // listening with the microphone (else the arrows stand in)
  level: number;           // live mic level 0..1 while listening
  heard: string;           // what the check made of the last try, in a few words, for the grown-up
};

class Stopped extends Error {}

const SOUND_SAID: Record<string, string> = { s: 'an “s” sound', th: 'a “th” sound', sh: 'a “sh” sound', z: 'a “z” sound', stop: 'a short “t” sound' };
/** The check's verdict in a few words for the grown-up, who can overrule it with the arrows. */
function describe(v: (TryVerdict & { word?: string }) | undefined, ex: Exercise): string {
  if (!v) return '';
  if (v.match === true) return v.heard !== 'none' ? `Mibo heard ${SOUND_SAID[v.heard] ?? v.heard} ✓` : 'Mibo heard it ✓';
  if (v.match === null) return 'Mibo was not sure, so it counts';
  if (v.word && v.word !== ex.target) return `Mibo thought it sounded more like “${v.word}”. Tap ▶ if it was right.`;
  if (v.heard !== 'none') return `Mibo heard ${SOUND_SAID[v.heard] ?? v.heard}. Tap ▶ if it was right.`;
  return 'Mibo could not hear the sound clearly. Tap ▶ if it was right.';
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Runs a lesson (its steps from src/lesson/content.ts) on a puppet. This is
 * the kid zone: it makes no AI calls. Every line is audio already on the
 * device, and each try is checked by signal processing in the browser
 * (voice/judge.ts for the s / th / sh / z sounds, voice/wordcheck.ts for
 * whole words). The samples are dropped as soon as the check has run.
 *
 * Each try: Mibo shows the sound, says "your turn", and listens. The right
 * sound gets a cheer and a star; anything else gets a gentle line, then Mibo
 * shows it again (up to 2 re-models, then moves on smiling). A made lesson
 * brings a cheer of its own for each word, written and voiced when the
 * grown-up made it.
 *
 * A picture game: Mibo asks, the child taps one of two pictures.
 *
 * The grown-up's arrows are always there in case the check gets it wrong:
 * while Mibo listens, ▶ means "they did it" and ◀ means "show it again";
 * at any other moment they jump to the next or previous step.
 *
 * Every finished word and game goes into the practice log on this device
 * (lesson/results.ts), which the grown-up zone reads.
 */
export function useLesson(puppet: Puppet, opts: {
  steps: Step[]; listen: boolean; from?: number; stars?: number;
  /** The lesson's name in the practice log. */
  title: string;
  /** Voice for `dyn_*` clip ids (a made lesson's saved audio); bundled ids fall through. */
  dynClips?: Record<string, Clip>;
  /** A made lesson's word templates, for the whole-word check. */
  templates?: Templates;
  onProgress?: (step: number, stars: number) => void; onDone?: () => void;
}) {
  const { steps } = opts;
  const [ui, setUi] = useState<LessonUi>({
    phase: 'idle', step: opts.from ?? 0, ex: null, stars: opts.stars ?? 0, pick: null, picked: null, mic: false, level: 0, heard: '',
  });
  const stars = useRef(opts.stars ?? 0);
  const hooks = useRef(opts);
  useEffect(() => { hooks.current = opts; });
  const run = useRef(0);
  const step = useRef(0);
  const navWait = useRef<((n: Nav) => void) | null>(null);   // set while a try is waiting on the child
  const tapWait = useRef<((i: number) => void) | null>(null); // set while a picture game is waiting on a tap
  const mic = useRef<Listening | null>(null);
  const turn = useRef<Record<string, number>>({});             // rotation through line variants

  const set = (u: Partial<LessonUi>) => setUi(prev => ({ ...prev, ...u }));
  const next = (key: string, n: number) => { const i = turn.current[key] ?? 0; turn.current[key] = i + 1; return i % n; };
  const pick = (g: keyof typeof VARIANTS): LineId => VARIANTS[g][next(g, VARIANTS[g].length)];
  /** What Mibo says after a try: the word's own cheer if the lesson has one, else the next bundled line. */
  const after = (ok: boolean, ex: Exercise): Clip => {
    const own = ok ? hooks.current.dynClips?.[`dyn_praise_${ex.target}`] : undefined;
    return own ?? bundled(`fb_${ok ? 'got' : 'tricky'}_${next(ok ? 'fbGot' : 'fbTricky', 3) + 1}`);
  };

  const runFrom = useCallback(async (from: number) => {
    const id = ++run.current;
    navWait.current = null;
    tapWait.current = null;
    mic.current?.stop(); mic.current = null;
    stopAudio(); puppet.stop();
    const alive = () => { if (run.current !== id) throw new Stopped(); };
    const play = async (c: string | Clip, extra?: Partial<Segment>) => {
      alive();
      const clip = typeof c === 'string' ? (hooks.current.dynClips?.[c] ?? bundled(c)) : c;
      await playClip(puppet, clip, extra);
      alive();
    };

    /**
     * Mibo says `prompt` ("your turn") and then waits for the child's go: the
     * mic's verdict or the grown-up's arrow, whichever comes first. The mic
     * starts recording with the prompt, so a child who jumps in is caught,
     * but only what comes after Mibo stops talking is judged.
     */
    const waitTry = async (ex: Exercise, useMic: boolean, prompt: string | null): Promise<{ nav?: Nav; verdict?: TryVerdict & { word?: string } }> => {
      const nav = new Promise<Nav>(res => { navWait.current = res; });
      let last = 0;
      const l = useMic
        ? listen({ armed: false, onLevel: v => { const now = Date.now(); if (now - last > 90) { last = now; set({ level: v }); } } })
        : null;
      mic.current = l;
      const quit = (r: { nav?: Nav; verdict?: TryVerdict & { word?: string } }) => { l?.stop(); mic.current = null; navWait.current = null; set({ level: 0 }); return r; };
      if (prompt) {
        set({ phase: 'talking' });
        const early = await Promise.race([nav.then(n => ({ nav: n })), play(prompt).then(() => null)]);
        if (early) { stopAudio(); return quit(early); }
      }
      // let the speaker and the room finish with Mibo's voice, or his own last word is heard as the child's
      await sleep(120 + outputLatency() * 1000);
      l?.arm();
      puppet.setMood('listening');
      set({ phase: 'listening' });
      if (!l) return quit({ nav: await nav });
      const got = await Promise.race([nav.then(n => ({ nav: n })), l.done.then(h => ({ h }))]);
      if ('nav' in got) return quit(got);
      quit({});
      const h = got.h;
      if (!h.speech) return {};
      let verdict: TryVerdict & { word?: string };
      if (ex.sound === 'twisty' || ex.check === 'template') {
        // whole-word check: the said word must be closest to the target word's template
        const w = judgeWord(h.samples, h.sr, ex.target, hooks.current.templates);
        console.log(`[hear-word] ${ex.target}: ${w.match ? 'PASS' : w.match === false ? 'other word' : '?'} best=${w.best ?? '-'} ` +
          (w.dists ? Object.entries(w.dists).map(([k, d]) => `${k}:${d}`).join(' ') : ''));
        verdict = { heard: 'none', match: w.match, speech: true, words: [], word: w.best };
      } else if (ex.sound === 'rhyme' || ex.sound === 'custom') {
        // a rhyme cannot be heard by the check, and a made word with no template has nothing to match: any words count
        verdict = { heard: 'none', match: true, speech: true, words: [] };
      } else {
        verdict = judgeTry(h.samples, h.sr, ex.sound, ex.kind);
      }
      // numbers only, for tuning against real sessions (the browser console; never audio or words)
      console.log(`[hear] ${ex.target}: ${verdict.match ? 'PASS' : 'no'} ` + verdict.words.map(w =>
        `${w.heard}${w.match ? '✓' : ''}(${w.feats ? `${w.feats.ms}ms ${w.feats.centroid}Hz flat${w.feats.flatness} ${w.feats.relDb}dB` : '-'})`).join(' '));
      return { verdict };   // the samples go out of scope here: nothing is kept
    };

    const tryExercise = async (ex: Exercise, useMic: boolean) => {
      set({ ex, heard: '' });
      const heardList: string[] = [];   // other sounds Mibo's ears named across this word's goes
      for (let attempt = 1; attempt <= MAX_ATTEMPTS;) {
        set({ phase: 'talking' });
        puppet.setMood('neutral');
        if (attempt === 1) await play(ex.cue ?? pick('watch'));
        await play(ex.model, { watchAll: true });
        let result: { nav?: Nav; verdict?: TryVerdict & { word?: string } } = {};
        for (let nudges = 0; ; nudges++) {
          // first "your turn" (or the nudge after a silence) plays while the mic is already recording
          const prompt = nudges === 0 ? (attempt === 1 ? ex.prompt : pick('yourTurn')) : nudges === 1 ? pick('yourTurn') : null;
          result = await waitTry(ex, useMic && nudges < 2, prompt);
          alive();
          if (result.nav || result.verdict) break;
        }
        if (result.nav === 'back') continue;            // grown-up: show it again (no "tricky" feedback)

        const v = result.verdict;
        const ok = result.nav === 'fwd' || !v || v.match !== false;
        set({ heard: result.nav ? '' : describe(v, ex) });
        if (v && v.heard !== 'none' && v.heard !== ex.sound && !heardList.includes(v.heard)) heardList.push(v.heard);
        const last = ok || attempt === MAX_ATTEMPTS;
        // logged before Mibo answers, so skipping ahead during his line never loses the result
        if (last) logResult({
          at: Date.now(), lesson: hooks.current.title, kind: 'say', target: ex.target, sound: ex.sound, attempts: attempt, ok,
          by: result.nav ? 'grownup' : 'ears', ...(heardList.length ? { heard: heardList } : {}),
        });
        set({ phase: 'thinking' });
        puppet.setMood('thinking');
        await play(pick(ok ? 'yay' : 'hmm'));
        set({ phase: 'talking' });
        puppet.setMood(ok ? 'happy' : 'gentle');
        if (ok) { puppet.act('hop'); stars.current++; set({ stars: stars.current }); hooks.current.onProgress?.(step.current, stars.current); }
        await play(after(ok, ex));
        if (last) return;
        attempt++;
      }
    };

    const pickGame = async (p: Pick) => {
      set({ ex: null, pick: p, picked: null });
      for (let attempt = 1; attempt <= MAX_PICKS;) {
        const nav = new Promise<Nav>(res => { navWait.current = res; });
        const tap = new Promise<number>(res => { tapWait.current = res; });
        const answer = Promise.race([nav.then(n => ({ nav: n })), tap.then(i => ({ i }))]);
        set({ phase: 'picking', picked: null });
        puppet.setMood('neutral');
        // a tap (or an arrow) while Mibo is still asking answers at once
        const early = await Promise.race([answer, play(p.ask).then(() => null)]);
        if (early) stopAudio(); else puppet.setMood('listening');
        const got = early ?? await answer;
        navWait.current = null; tapWait.current = null;
        alive();
        if ('nav' in got && got.nav === 'back') continue;   // grown-up: ask it again
        const i = 'i' in got ? got.i : p.right;
        const ok = i === p.right;
        if (ok || attempt === MAX_PICKS) logResult({
          at: Date.now(), lesson: hooks.current.title, kind: 'pick', target: p.word?.word ?? p.choices[p.right].word, sound: p.sound,
          attempts: attempt, ok, by: 'i' in got ? 'tap' : 'grownup',
        });
        set({ phase: 'thinking', picked: { i, ok } });
        puppet.setMood('thinking');
        await play(pick(ok ? 'yay' : 'hmm'));
        if (ok) {
          puppet.setMood('happy'); puppet.act('hop');
          stars.current++; set({ stars: stars.current }); hooks.current.onProgress?.(step.current, stars.current);
        }
        if (ok || attempt === MAX_PICKS) {
          // the answer, said and shown (after a second miss Mibo just shows it, smiling)
          set({ phase: 'talking', picked: { i: p.right, ok: true } });
          if (!ok) puppet.setMood('gentle');
          await play(p.answer);
          return;
        }
        set({ phase: 'talking' });
        puppet.setMood('gentle');
        await play('again');
        attempt++;
      }
    };

    try {
      if (from === 0) { stars.current = 0; setUi(p => ({ ...p, stars: 0 })); }
      step.current = from;
      set({ phase: 'loading', step: from, ex: null, pick: null, picked: null });
      const made = Object.values(hooks.current.dynClips ?? {}).map(c => c.source).filter((s): s is string => typeof s === 'string');
      const loaded = await preloadClips(clipsFor(steps), made);
      alive();
      // without his voice the lesson would race through in silence: stop and say so instead
      if (!loaded) { set({ phase: 'stuck' }); return; }
      if (opts.listen && (await micPermission()) === 'prompt') set({ phase: 'asking' });
      const useMic = opts.listen && await enableMic();
      alive();
      set({ phase: 'talking', mic: useMic });
      for (let i = from; i < steps.length; i++) {
        const s = steps[i];
        step.current = i;
        set({ step: i, ex: null, pick: null, picked: null });
        hooks.current.onProgress?.(i, stars.current);
        if (s.kind === 'line') {
          if (s.mood) puppet.setMood(s.mood);
          if (s.act) puppet.act(s.act);
          await play(s.clip);
        } else if (s.kind === 'model') {
          await play(s.clip, { watchAll: true });
        } else if (s.kind === 'try') {
          await tryExercise(s.ex, useMic);
        } else if (s.kind === 'pick') {
          await pickGame(s.pick);
        } else {
          puppet.setMood('happy');
          puppet.act('celebrate');
          await play(s.clip);
        }
      }
      puppet.setMood('happy');
      set({ phase: 'done', ex: null, pick: null, picked: null });
      hooks.current.onDone?.();
    } catch (e) {
      if (!(e instanceof Stopped)) throw e;
    }
  }, [puppet, opts.listen, steps]);

  const start = useCallback(() => runFrom(0), [runFrom]);
  /** Start (or start again) where the lesson is. */
  const resume = useCallback(() => runFrom(Math.max(step.current, hooks.current.from ?? 0)), [runFrom]);

  /** The grown-up's arrows. */
  const nav = useCallback((n: Nav) => {
    const waiting = navWait.current;
    if (waiting) { navWait.current = null; waiting(n); return; }
    const to = n === 'fwd' ? step.current + 1 : Math.max(0, step.current - 1);
    if (to >= steps.length) { runFrom(steps.length - 1); return; }
    runFrom(to);
  }, [runFrom, steps]);

  /** The child taps a picture in a game (ignored unless Mibo is waiting for one). */
  const choose = useCallback((i: number) => {
    const waiting = tapWait.current;
    if (waiting) { tapWait.current = null; waiting(i); }
  }, []);

  const stop = useCallback(() => {
    run.current++;
    navWait.current = null;
    tapWait.current = null;
    mic.current?.stop(); mic.current = null;
    stopAudio();
    puppet.stop();
    puppet.setMood('neutral');
    setUi(p => ({ ...p, phase: 'idle', ex: null, pick: null, picked: null }));
  }, [puppet]);

  useEffect(() => () => { run.current++; mic.current?.stop(); stopAudio(); puppet.stop(); }, [puppet]);

  return { ui, start, resume, stop, nav, choose, total: steps.length };
}
