import { useCallback, useEffect, useRef, useState } from 'react';

import type { Puppet, Segment } from '../puppet/mibo';
import { judgeTry, type TryVerdict, type Verdict } from '../voice/judge';
import { judgeWord } from '../voice/wordcheck';
import { enableMic, listen, type Listening } from '../voice/listen';
import { prepareStt, startStt } from '../voice/stt';
import { matchTranscript } from '../voice/stt-match';
import { bufferOf, playClip, stopAudio, type Clip } from '../voice/player';
import { writeReply, type Heard as HeardSound, type Reply as ReplyText, type Turn, type Where } from '../ai/reply';
import { speak } from '../ai/tts';
import { bundled, preloadClips } from './clips';
import { nameClip } from './name';
import { logResult } from './results';
import { clipsFor, firstStepAfterGreeting, MAX_ATTEMPTS, MAX_PICKS, VARIANTS, type Exercise, type LineId, type Pick, type Step } from './content';

export type Nav = 'fwd' | 'back';
export type Phase = 'idle' | 'loading' | 'talking' | 'listening' | 'picking' | 'thinking' | 'done';
export type LessonUi = {
  phase: Phase; step: number; ex: Exercise | null; stars: number;
  live: Where | '';         // where Mibo's last reply was written: on this device, in the cloud, or a bundled line
  pick: Pick | null;       // the picture game on screen
  picked: { i: number; ok: boolean } | null;   // the picture tapped (or shown as the answer)
  mic: boolean;            // listening with the microphone (else the arrows stand in)
  level: number;           // live mic level 0..1 while listening
  heard: Verdict | null;   // the last try's on-device check, for the grown-up's eyes only
};

class Stopped extends Error {}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Runs a lesson (its steps from src/lesson/content.ts) on a puppet.
 *
 * Each try: Mibo shows the sound, says "your turn", and listens. The on-device
 * check (src/voice/judge.ts) decides: the right sound gets praise and a star;
 * a different sound gets a gentle live reply that knows what it heard, then
 * Mibo shows it again (up to 2 re-models, then moves on smiling).
 *
 * The live reply is hybrid (src/ai/reply.ts): written on the device where the
 * browser has a model, in the cloud otherwise, and spoken by the cloud voice.
 * Every finished word goes into the on-device practice log for the parent notes.
 *
 * A picture game: Mibo asks, the child taps one of two pictures. The right
 * one gets praise, a star and the answer; the other gets "let's listen
 * again" and the question once more, then Mibo shows the answer.
 *
 * The grown-up's arrows are always there in case the check gets it wrong:
 * while Mibo listens, ▶ means "they did it" and ◀ means "show it again";
 * at any other moment they jump to the next or previous step.
 */
export function useLesson(puppet: Puppet, opts: {
  steps: Step[]; listen: boolean; from?: number; stars?: number;
  /** The lesson's name in the practice log (lesson/results.ts). */
  title: string;
  /** Voice for `dyn_*` clip ids (a grown-up-made lesson's saved files); bundled ids fall through. */
  dynClips?: Record<string, Clip>;
  /** Combined greeting played once at a fresh start, on this screen's puppet, right before the first step (the name line, when there is one). */
  introClip?: Clip | null;
  onProgress?: (step: number, stars: number) => void; onDone?: () => void;
}) {
  const { steps } = opts;
  const [ui, setUi] = useState<LessonUi>({
    phase: 'idle', step: opts.from ?? 0, ex: null, stars: opts.stars ?? 0, live: '', pick: null, picked: null, mic: false, level: 0, heard: null,
  });
  const stars = useRef(opts.stars ?? 0);
  const hooks = useRef(opts);
  useEffect(() => { hooks.current = opts; });
  const run = useRef(0);
  const step = useRef(0);
  const navWait = useRef<((n: Nav) => void) | null>(null);   // set while a try is waiting on the child
  const tapWait = useRef<((i: number) => void) | null>(null); // set while a picture game is waiting on a tap
  const mic = useRef<Listening | null>(null);
  const turn = useRef<Record<string, number>>({});             // rotation through VARIANTS
  const said = useRef<string[]>([]);                            // Mibo's recent live lines

  const set = (u: Partial<LessonUi>) => setUi(prev => ({ ...prev, ...u }));
  const pick = (g: keyof typeof VARIANTS): LineId => {
    const list = VARIANTS[g], n = turn.current[g] ?? 0;
    turn.current[g] = n + 1;
    return list[n % list.length];
  };
  /** Mibo's quick reaction; once the child's name lines exist they join the rotation. */
  const react = (ok: boolean): LineId | Clip => {
    const g = ok ? 'yay' : 'hmm', named = nameClip(ok ? 'got' : 'tricky');
    const n = turn.current[g] ?? 0;
    turn.current[g] = n + 1;
    const list: (LineId | Clip)[] = [...VARIANTS[g], ...(named ? [named] : [])];
    return list[n % list.length];
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
    const waitTry = async (ex: Exercise, useMic: boolean, prompt: string | null): Promise<{ nav?: Nav; verdict?: Verdict }> => {
      const nav = new Promise<Nav>(res => { navWait.current = res; });
      let last = 0;
      // speech-to-text tries (made lessons): the recogniser, not the recorder, is the ear
      const stt = ex.check === 'stt' && opts.listen ? startStt(ex.target) : null;
      const l = useMic && !stt
        ? listen({ armed: false, onLevel: v => { const now = Date.now(); if (now - last > 90) { last = now; set({ level: v }); } } })
        : null;
      mic.current = l;
      const quit = (r: { nav?: Nav; verdict?: Verdict }) => { stt?.stop(); l?.stop(); mic.current = null; navWait.current = null; set({ level: 0 }); return r; };
      if (prompt) {
        set({ phase: 'talking' });
        const early = await Promise.race([nav.then(n => ({ nav: n })), play(prompt).then(() => null)]);
        if (early) { stopAudio(); return quit(early); }
      }
      await sleep(120);   // let the room swallow the last of Mibo's voice
      l?.arm();
      puppet.setMood('listening');
      set({ phase: 'listening' });
      if (stt) {
        stt.start();
        const got = await Promise.race([nav.then(n => ({ nav: n })), stt.done.then(t => ({ t }))]);
        if ('nav' in got) return quit(got);
        quit({});
        const alts = got.t;
        if (!alts?.length) return {};   // nothing heard: the nudge loop asks again
        const match = matchTranscript(alts, ex.target);
        console.log(`[stt] ${ex.target}: ${match ? 'PASS' : 'no'} heard="${alts[0]}"`);
        const verdict: TryVerdict = { heard: 'none', match, speech: true, words: [] };
        return { verdict };
      }
      if (!l) return quit({ nav: await nav });
      const got = await Promise.race([nav.then(n => ({ nav: n })), l.done.then(h => ({ h }))]);
      if ('nav' in got) return quit(got);
      quit({});
      const h = got.h;
      if (!h.speech) return {};
      // rhyme: the check cannot hear one, so any words count. Twisty words get
      // their own check (wordcheck.ts): the said word must match the target.
      let verdict: TryVerdict;
      if (ex.check === 'stt') {
        // no on-device recogniser in this browser: never gate the word on the hiss check
        verdict = { heard: 'none', match: true, speech: true, words: [] };
      } else if (ex.sound === 'rhyme' || ex.sound === 'custom') {
        verdict = { heard: 'none', match: true, speech: true, words: [] };
      } else if (ex.sound === 'twisty') {
        const w = judgeWord(h.samples, h.sr, ex.target);
        console.log(`[hear-word] ${ex.target}: ${w.match ? 'PASS' : w.match === false ? 'wrong word' : '?'} best=${w.best ?? '-'} ` +
          (w.dists ? Object.entries(w.dists).map(([k, d]) => `${k.slice(0, 4)}:${d}`).join(' ') : ''));
        verdict = { heard: 'none', match: w.match, speech: true, words: [] };
      } else {
        verdict = judgeTry(h.samples, h.sr, ex.sound, ex.kind);
      }
      // numbers only, for tuning against real sessions (the browser console; never audio or words)
      console.log(`[hear] ${ex.target}: ${verdict.match ? 'PASS' : 'no'} ` + verdict.words.map(w =>
        `${w.heard}${w.match ? '✓' : ''}(${w.feats ? `${w.feats.ms}ms ${w.feats.centroid}Hz flat${w.feats.flatness} ${w.feats.relDb}dB` : '-'})`).join(' '));
      return { verdict };   // the samples go out of scope here: nothing is kept
    };

    const tryExercise = async (ex: Exercise, useMic: boolean) => {
      set({ ex, heard: null });
      const heardList: string[] = [];   // other sounds Mibo's ears named across this word's goes
      for (let attempt = 1; attempt <= MAX_ATTEMPTS;) {
        set({ phase: 'talking' });
        puppet.setMood('neutral');
        if (attempt === 1) await play(ex.cue ?? pick('watch'));
        await play(ex.model, { watchAll: true });
        // Both likely replies are written while the child has a go (on the device this costs nothing),
        // and the likelier one, the praise, is given its voice ahead of time.
        const turn = (mark: 'got' | 'tricky', heard?: string): Turn => ({
          sound: ex.sound, target: ex.target, mark, attempt, willRetry: mark === 'tricky' && attempt < MAX_ATTEMPTS,
          heard: heard as HeardSound | undefined, avoid: said.current,
        });
        const write = (mark: 'got' | 'tricky', heard?: string) => { const t = turn(mark, heard); return writeReply(t).then(r => ({ t, r })); };
        // (a rhyme pair passes on any words, so its tricky reply is only asked for if it is ever needed)
        const texts = { got: write('got'), tricky: ex.sound === 'rhyme' ? null : write('tricky') };
        const gotVoice = texts.got.then(x => voiceReply(x.t, x.r));
        let result: { nav?: Nav; verdict?: Verdict } = {};
        for (let nudges = 0; ; nudges++) {
          // first "your turn" (or the nudge after a silence) plays while the mic is already recording
          const prompt = nudges === 0 ? (attempt === 1 ? ex.prompt : pick('yourTurn')) : nudges === 1 ? pick('yourTurn') : null;
          result = await waitTry(ex, useMic && nudges < 2, prompt);
          alive();
          if (result.nav || result.verdict) break;
        }
        if (result.nav === 'back') continue;            // grown-up: show it again (no "tricky" feedback)

        const v = result.verdict;
        set({ heard: v ?? null });
        const ok = result.nav === 'fwd' || !v || v.match !== false;
        set({ phase: 'thinking' });
        puppet.setMood('thinking');
        // a mismatch the check can name gets a reply that knows what it heard
        const heardElse = !ok && v && v.heard !== 'none' && v.heard !== ex.sound ? v.heard : undefined;
        const tricky = () => (heardElse
          ? Promise.race([write('tricky', heardElse), sleep(2500).then(() => texts.tricky ?? write('tricky'))])
          : texts.tricky ?? write('tricky')).then(x => voiceReply(x.t, x.r));
        if (v && v.heard !== 'none' && v.heard !== ex.sound && !heardList.includes(v.heard)) heardList.push(v.heard);
        const [reply] = await Promise.all([ok ? gotVoice : tricky(), play(react(ok))]);
        alive();
        set({ phase: 'talking', live: reply.where });
        puppet.setMood(reply.mood);
        if (ok) { puppet.act('hop'); stars.current++; set({ stars: stars.current }); hooks.current.onProgress?.(step.current, stars.current); }
        for (const c of reply.clips) await play(c);
        said.current = [...said.current, ...reply.clips.map(c => c.text)].slice(-4);
        if (ok || attempt === MAX_ATTEMPTS) {
          logResult({
            at: Date.now(), lesson: hooks.current.title, kind: 'say', target: ex.target, sound: ex.sound, attempts: attempt, ok,
            by: result.nav ? 'grownup' : 'ears', ...(heardList.length ? { heard: heardList } : {}),
          });
          return;
        }
        attempt++;
      }
    };

    const pickGame = async (p: Pick) => {
      set({ ex: null, pick: p, picked: null, heard: null });
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
        set({ phase: 'thinking', picked: { i, ok } });
        puppet.setMood('thinking');
        await play(react(ok));
        if (ok) {
          puppet.setMood('happy'); puppet.act('hop');
          stars.current++; set({ stars: stars.current }); hooks.current.onProgress?.(step.current, stars.current);
        }
        if (ok || attempt === MAX_PICKS) {
          logResult({
            at: Date.now(), lesson: hooks.current.title, kind: 'pick', target: p.word?.word ?? p.choices[p.right].word, sound: p.sound,
            attempts: attempt, ok, by: 'i' in got ? 'tap' : 'grownup',
          });
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
      set({ phase: 'loading', step: from, ex: null, pick: null, picked: null, heard: null });
      await preloadClips(clipsFor(steps));
      const useMic = opts.listen && await enableMic();
      // made lessons check whole words with on-device speech recognition, where the browser has it
      if (useMic && steps.some(s => s.kind === 'try' && s.ex.check === 'stt')) await prepareStt();
      alive();
      set({ phase: 'talking', mic: useMic });
      // one greeting only: named children hear "Hi {name}!" and skip the first
      // line's "Hi friend!"; anonymous children start at that first line
      let first = from;
      if (from === 0 && hooks.current.introClip) {
        puppet.setMood('happy');
        puppet.act('wave');
        await play(hooks.current.introClip);
        first = firstStepAfterGreeting(steps, true);
      }
      for (let i = first; i < steps.length; i++) {
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
          const bye = nameClip('bye');      // "Great job, {name}!"
          if (bye) await play(bye);
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
  // Start (or start again) where the lesson is: after a hot reload during
  // development the screen's start effect runs again, and this must not jump
  // back to the step the lesson was opened at.
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

type Reply = { clips: Clip[]; mood: string; where: Where };

/**
 * Gives a written reply its voice (cloud TTS). If the line is already a
 * bundled fallback, or the voice is slow, resting or fails, the matching
 * bundled clip plays instead: the lesson never waits on the network.
 */
async function voiceReply(t: Turn, r: ReplyText): Promise<Reply> {
  const fallback = (): Reply => ({
    clips: [bundled(`fb_${t.mark}_${((t.attempt - 1) % 3) + 1}`)], mood: t.mark === 'got' ? 'happy' : 'gentle', where: 'bundled',
  });
  if (r.where === 'bundled') return fallback();
  try {
    const s = await Promise.race([speak(r.say), sleep(9000).then(() => { throw new Error('voice was slow'); })]);
    return { clips: [{ source: bufferOf(s.samples, s.sr), text: r.say, visemes: s.visemes, seconds: s.seconds }], mood: r.mood, where: r.where };
  } catch (e) {
    console.warn('[reply] bundled voice:', (e as Error).message);
    return fallback();
  }
}
