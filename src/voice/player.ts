/**
 * Mibo's voice in the browser: Web Audio plays each clip and the puppet's
 * mouth reads the clip's viseme track against the audio clock, so lips and
 * sound stay together even if playback starts late.
 */
import { getAudio } from '../lib/store';
import type { Puppet, Segment } from '../puppet/mibo';
import type { Viseme } from './analyze';

/**
 * `source` is a URL (bundled clips), `idb:<key>` (voice made for this family,
 * kept in IndexedDB) or an already-decoded buffer (a live line).
 */
export type Clip = { source: string | AudioBuffer; text: string; visemes: Viseme[]; seconds: number };

let ctx: AudioContext | null = null;
export function audio(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });
  }
  return ctx;
}

/** Browsers only let a page make sound after a tap: call this from any tap or key press. */
export function unlockAudio() {
  const c = audio();
  if (c.state !== 'running') void c.resume().catch(() => {});
}

const buffers = new Map<string, Promise<AudioBuffer>>();

async function bytes(source: string): Promise<ArrayBuffer> {
  if (source.startsWith('idb:')) {
    const wav = await getAudio(source.slice(4));
    if (!wav) throw new Error('saved clip is gone');
    return wav.slice().buffer;
  }
  const r = await fetch(source);
  if (!r.ok) throw new Error(`clip ${r.status}`);
  return r.arrayBuffer();
}

function load(source: string | AudioBuffer): Promise<AudioBuffer> {
  if (typeof source !== 'string') return Promise.resolve(source);
  let p = buffers.get(source);
  if (!p) {
    p = bytes(source).then(b => audio().decodeAudioData(b));
    p.catch(() => buffers.delete(source));
    buffers.set(source, p);
  }
  return p;
}

/** Fetch and decode clips ahead of time. Resolves false if any of them could not be loaded. */
export async function preload(sources: string[]): Promise<boolean> {
  const got = await Promise.all(sources.map(s => load(s).then(() => true, () => false)));
  return got.every(Boolean);
}

/** Lets go of decoded audio (tens of MB after a few lessons). The browser's own cache keeps the files. */
export function clearClips() {
  buffers.clear();
}

/** How long sound takes to leave the speaker after the audio clock says it played (large on Bluetooth). */
export function outputLatency(): number {
  const c = audio();
  return Math.min(0.5, Math.max(0, (c.outputLatency || 0) + (c.baseLatency || 0)));
}

/** A live line arrives as samples: no file, no decode. */
export function bufferOf(samples: Float32Array, sr: number): AudioBuffer {
  const b = audio().createBuffer(1, Math.max(1, samples.length), sr);
  b.getChannelData(0).set(samples);
  return b;
}

let current: { src: AudioBufferSourceNode; finish: () => void } | null = null;

/**
 * Plays one clip and has Mibo speak it. Resolves when the audio ends (or is
 * stopped). A clip that cannot be loaded is skipped, never fatal.
 */
export async function playClip(puppet: Puppet, clip: Clip, extra: Partial<Segment> = {}): Promise<void> {
  const c = audio();
  let buf: AudioBuffer;
  try {
    buf = await load(clip.source);
  } catch (e) {
    console.warn('[audio] clip skipped:', clip.text, (e as Error).message);
    return;
  }
  if (c.state !== 'running') await Promise.race([c.resume().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
  stopAudio();
  return new Promise(resolve => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    const t0 = c.currentTime + 0.03, late = outputLatency();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      src.onended = null;
      if (current?.src === src) current = null;
      resolve();
    };
    src.onended = finish;
    // if the browser never starts the audio (no tap yet), move on rather than hang
    const timer = setTimeout(finish, (buf.duration + 1.5) * 1000);
    current = { src, finish };
    puppet.play([{ say: clip.text, visemes: clip.visemes, clock: () => Math.max(0, c.currentTime - t0 - late), ...extra }]);
    src.start(t0);
  });
}

export function stopAudio() {
  const cur = current;
  if (!cur) return;
  current = null;
  try { cur.src.stop(); } catch { /* not started */ }
  cur.finish();
}
