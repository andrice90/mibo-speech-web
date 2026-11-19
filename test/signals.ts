/** Made-up test signals: rooms, a child's voice, a hiss, Mibo talking. All seeded, so every run is the same. */
import { highPass } from '../src/voice/vad.ts';

export const SR = 48000;

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (s: number) => Math.round(s * SR);

/** Scales `x` in place to an RMS level in dBFS. */
export function atDb(x: Float32Array, db: number): Float32Array {
  let e = 0;
  for (const v of x) e += v * v;
  const k = 10 ** (db / 20) / Math.sqrt(e / x.length || 1e-24);
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

export function white(s: number, db: number, seed = 1): Float32Array {
  const r = rng(seed), x = new Float32Array(n(s));
  for (let i = 0; i < x.length; i++) x[i] = r() + r() + r() - 1.5;
  return atDb(x, db);
}

/** Low rumble: a fan, traffic, a car (noise through two low-pass stages near 150 Hz, 12 dB per octave above). */
export function rumble(s: number, db: number, seed = 2): Float32Array {
  const r = rng(seed), x = new Float32Array(n(s));
  let y = 0, z = 0;
  for (let i = 0; i < x.length; i++) { y = 0.98 * y + (r() - 0.5); z = 0.98 * z + y; x[i] = z; }
  return atDb(x, db);
}

/** A voiced vowel: harmonics of `f0` falling 6 dB per octave, shaped by two formants, with a little vibrato. */
export function vowel(s: number, db: number, f0 = 320, formants: [number, number] = [1000, 3000]): Float32Array {
  const x = new Float32Array(n(s));
  const amp: number[] = [];
  for (let k = 1; k * f0 < 6000; k++) {
    const f = k * f0;
    amp.push(formants.reduce((a, fm) => a + 1 / (1 + ((f - fm) / 250) ** 2), 0.05) / k);
  }
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, f = f0 * (1 + 0.01 * Math.sin(2 * Math.PI * 5 * t));
    ph += 2 * Math.PI * f / SR;
    let v = 0;
    for (let k = 0; k < amp.length; k++) v += amp[k] * Math.sin((k + 1) * ph);
    // soft on and off, like a real vowel
    const edge = Math.min(1, t / 0.02, (s - t) / 0.02);
    x[i] = v * edge;
  }
  return atDb(x, db);
}

/** An /s/-like hiss: noise above ~5 kHz. */
export function hiss(s: number, db: number, seed = 3): Float32Array {
  return atDb(highPass(highPass(white(s, -20, seed), SR, 5000), SR, 5000), db);
}

/** Mibo saying a line through the speaker: loud adult voice in bursts, with short gaps. */
export function mibo(s: number, db = -22): Float32Array {
  const x = vowel(s, db, 210, [800, 1800]);
  for (let i = 0; i < x.length; i++) if (Math.floor(i / n(0.25)) % 2 === 1) x[i] *= 0.02;
  return x;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** a + b, as long as the longer one. */
export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

export const silence = (s: number) => new Float32Array(n(s));
export const offset = (x: Float32Array, dc: number) => x.map(v => v + dc);
