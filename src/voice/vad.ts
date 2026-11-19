/**
 * Is the child talking? The level check behind listen.ts, kept free of the
 * browser so it can be tested on made-up signals (test/vad.test.ts).
 *
 * The first version compared the whole signal's loudness with a fixed bar
 * (-50 dBFS) and a room floor that started at -55 dB. That missed children:
 * - a small child is quieter than a grown-up, and the grown-up holds the
 *   device, while the browser's auto-gain is off on purpose, so a soft try
 *   sits below -50 dBFS on many laptops and phones;
 * - a held "Sssss" or a soft /θ/ has almost no low-frequency energy, so in a
 *   room with a fan or traffic hum it barely moves the whole-signal level;
 * - hum, handling rumble and a microphone's DC offset raise the floor and
 *   hide both.
 * So the level is read in two bands, each against its own floor: the voice
 * band (above ~120 Hz: no hum, no DC) and the hiss band (above ~3 kHz), and
 * either one rising far enough above its floor counts as speech. The floors
 * start from what the microphone heard while Mibo was talking (his pauses
 * are as quiet as the room gets then), fall fast and rise slowly.
 *
 * Every number is in VAD below, so it can be tuned in one place.
 */

export const VAD = {
  /** High-pass for the voice band, Hz: drops hum, rumble and DC offset. */
  voiceHz: 120,
  /** High-pass for the hiss band, Hz (two stages): where /s/, /ʃ/ and /θ/ live. */
  hissHz: 3000,
  /** dB above the room's floor that counts as speech, voice band. */
  margin: 10,
  /** dB above its floor that counts as speech, hiss band. */
  hissMargin: 9,
  /** Nothing quieter than this counts, however quiet the room (dBFS). The old bar was -50. */
  minDb: -68,
  /** The same for the hiss band, which is quieter in every room (dBFS). */
  minHissDb: -76,
  /** Speech has to last this long to start a try, so a tap on the screen does not (ms). */
  onsetMs: 60,
  /** How fast a floor follows a room that got louder, dB per second (half that while speaking). */
  floorRiseDbPerS: 2,
  /** Share of the gap a floor closes per block when the room is quieter than it. */
  floorFall: 0.3,
  /** A floor never rises above this, so a loud room still leaves room for a voice (dBFS). */
  maxFloorDb: -30,
  /** Floor used when nothing was heard before listening started (dBFS). */
  startFloorDb: -60,
  /** dB above the floor that fills the level meter. */
  meterDb: 30,
  /** Right after Mibo stops, his echo is still dying away: for this long, a block that is quieter
   *  than the one before by `echoDropDb` or more is his echo, not the child (s). */
  echoS: 0.4,
  echoDropDb: 4,
};
export type VadConfig = typeof VAD;

/** RBJ high-pass biquad, Q = 0.707. */
class HighPass {
  private b0: number; private b1: number; private b2: number; private a1: number; private a2: number;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(hz: number, sr: number) {
    const w = 2 * Math.PI * Math.min(hz, sr * 0.45) / sr, cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    this.b0 = (1 + cos) / 2 / a0; this.b1 = -(1 + cos) / a0; this.b2 = this.b0;
    this.a1 = -2 * cos / a0; this.a2 = (1 - alpha) / a0;
  }
  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** A copy of `x` with everything below `hz` taken out (hum, rumble, DC offset). */
export function highPass(x: Float32Array, sr: number, hz: number): Float32Array {
  const f = new HighPass(hz, sr), out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = f.next(x[i]);
  return out;
}

const dbOf = (sumSq: number, n: number) => 10 * Math.log10(sumSq / Math.max(1, n) + 1e-12);
/** Below this a block is digital silence, not a room (dBFS). */
const DEAD_DB = -100;

export type Block = {
  /** 0..1 for the level meter. */
  meter: number;
  /** This block is louder than the room by enough, in either band. */
  speaking: boolean;
  voiceDb: number;
  hissDb: number;
};

/** Reads one block of samples at a time (any size). Feed every block, before and after listening starts. */
export class VoiceActivity {
  private voice: HighPass;
  private hiss: [HighPass, HighPass];
  private floorV = NaN;
  private floorH = NaN;
  /** quietest blocks heard before listening started */
  private preV = Infinity;
  private preH = Infinity;
  readonly cfg: VadConfig;
  peakV = -120;
  peakH = -120;
  /** the microphone sent nothing but exact zeros so far (a dead input) */
  allZero = true;

  private sr: number;

  constructor(sr: number, cfg: Partial<VadConfig> = {}) {
    this.sr = sr;
    this.cfg = { ...VAD, ...cfg };
    this.voice = new HighPass(this.cfg.voiceHz, sr);
    this.hiss = [new HighPass(this.cfg.hissHz, sr), new HighPass(this.cfg.hissHz, sr)];
  }

  get floors() { return { voice: this.floorV, hiss: this.floorH }; }

  private levels(ch: Float32Array): [number, number] {
    let sv = 0, sh = 0;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      if (x !== 0) this.allZero = false;
      const v = this.voice.next(x), h = this.hiss[1].next(this.hiss[0].next(x));
      sv += v * v; sh += h * h;
    }
    return [dbOf(sv, ch.length), dbOf(sh, ch.length)];
  }

  /** Before listening starts (Mibo is talking): only learns how quiet the room gets. */
  learn(ch: Float32Array): number {
    const [v, h] = this.levels(ch);
    // blocks of exact silence (a microphone still waking up) say nothing about the room
    if (v > DEAD_DB) this.preV = Math.min(this.preV, v);
    if (h > DEAD_DB) this.preH = Math.min(this.preH, h);
    return v;
  }

  /** Whether levels like these count as speech against the floors as they are now. */
  isSpeech(v: number, h: number): boolean {
    const c = this.cfg;
    return (v > this.floorV + c.margin && v > c.minDb) || (h > this.floorH + c.hissMargin && h > c.minHissDb);
  }

  /** While listening: one block's verdict. */
  step(ch: Float32Array): Block {
    const c = this.cfg, dt = ch.length / this.sr;
    const [v, h] = this.levels(ch);
    if (Number.isNaN(this.floorV)) {
      // start from the quietest moment so far (Mibo's pauses, or this first block), never louder than the cap
      const init = (pre: number, now: number) => Math.min(c.maxFloorDb, Number.isFinite(pre) ? Math.min(pre, now) : now);
      this.floorV = init(this.preV, v);
      this.floorH = init(this.preH, h);
    }
    const speaking = this.isSpeech(v, h);
    const rise = c.floorRiseDbPerS * dt * (speaking ? 0.5 : 1);
    const follow = (floor: number, lvl: number) =>
      lvl < floor ? floor + (lvl - floor) * c.floorFall : Math.min(floor + rise, c.maxFloorDb, lvl);
    const meter = Math.max(0, Math.min(1, Math.max(v - this.floorV, h - this.floorH) / c.meterDb));
    this.floorV = follow(this.floorV, v);
    this.floorH = follow(this.floorH, h);
    this.peakV = Math.max(this.peakV, v);
    this.peakH = Math.max(this.peakH, h);
    return { meter, speaking, voiceDb: v, hissDb: h };
  }
}

export type TryState = 'waiting' | 'heard' | 'nothing';

/**
 * One listening window: waits for the child to start, then for a real
 * pause, so several goes ("seal... seal!") land in one window. Ends after
 * `pause` s of quiet once the child has spoken, after `maxTry` s of trying,
 * or after `maxWait` s with no speech. Times count from `arm` (Mibo has
 * stopped talking); blocks before it only teach the floor.
 */
export class TryWatch {
  readonly vad: VoiceActivity;
  private t = 0;
  private armedAt = -1;
  /** levels of the blocks since arming, kept until the child starts */
  private history: { t0: number; t1: number; v: number; h: number; echo: boolean }[] = [];
  private inEcho = true;
  private prevV = Infinity;
  /** when the child started, seconds since the first block (-1: not yet) */
  startAt = -1;
  private quietSince = -1;
  state: TryState = 'waiting';

  private sr: number;
  private opts: { maxWait: number; maxTry: number; pause: number };

  constructor(sr: number, opts: { maxWait: number; maxTry: number; pause: number }, cfg: Partial<VadConfig> = {}) {
    this.sr = sr;
    this.opts = opts;
    this.vad = new VoiceActivity(sr, cfg);
  }

  get armedTime() { return this.armedAt; }

  /** Feed one block. `armed`: Mibo has finished talking. Returns the meter level (0 before arming). */
  push(ch: Float32Array, armed: boolean): number {
    if (this.state !== 'waiting') return 0;
    const t0 = this.t;
    this.t += ch.length / this.sr;
    if (!armed && this.armedAt < 0) { this.prevV = this.vad.learn(ch); return 0; }
    if (this.armedAt < 0) this.armedAt = t0;
    const b = this.vad.step(ch);
    const c = this.vad.cfg, onset = c.onsetMs / 1000 - 1e-9;
    // Mibo's echo fades block by block; the first block that does not fade ends the echo
    if (this.inEcho && (t0 - this.armedAt >= c.echoS || b.voiceDb > this.prevV - c.echoDropDb)) this.inEcho = false;
    const echo = this.inEcho;
    this.prevV = b.voiceDb;
    if (echo) b.speaking = false;
    if (this.startAt < 0) {
      // Not started yet: look again at every block since arming against the floor as it is now. Right
      // after Mibo stops, the floor still holds his echo, so a child who jumps in at once only stands out
      // once the room has gone quiet and the floor has come down.
      this.history.push({ t0, t1: this.t, v: b.voiceDb, h: b.hissDb, echo });
      let from = -1, lastLoud = -1;
      for (const k of this.history) {
        if (!k.echo && this.vad.isSpeech(k.v, k.h)) {
          if (from < 0) from = k.t0;
          lastLoud = k.t1;
          if (this.startAt < 0 && k.t1 - from >= onset) this.startAt = from;
        } else from = -1;
      }
      if (this.startAt >= 0) {
        this.history.length = 0;
        this.quietSince = b.speaking ? -1 : lastLoud;
      }
    } else if (b.speaking) {
      this.quietSince = -1;
    } else if (this.quietSince < 0) {
      this.quietSince = t0;
    }
    const { maxWait, maxTry, pause } = this.opts;
    if (this.startAt >= 0 && ((this.quietSince >= 0 && this.t - this.quietSince > pause) || this.t - this.armedAt > maxTry)) this.state = 'heard';
    else if (this.startAt < 0 && this.t - this.armedAt > maxWait) this.state = 'nothing';
    return b.meter;
  }

  /** Numbers only, for tuning in the browser console. */
  summary(): string {
    const f = this.vad.floors, r = (x: number) => (Number.isFinite(x) ? Math.round(x) : '-');
    return `floor ${r(f.voice)}/${r(f.hiss)} dB, peak ${r(this.vad.peakV)}/${r(this.vad.peakH)} dB (voice/hiss), ` +
      (this.startAt >= 0 ? `speech at +${(this.startAt - Math.max(0, this.armedAt)).toFixed(2)}s` : 'no speech') +
      (this.vad.allZero ? ', INPUT SILENT' : '');
  }
}
