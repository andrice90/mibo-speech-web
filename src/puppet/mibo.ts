/**
 * The shared puppet module. mibo-puppet.js is the same hand-drawn Mibo the
 * original app and its browser lab use; in the browser it draws straight to
 * a real 2D canvas.
 */
import './mibo-puppet.js';

export type Viseme = { v: string; d: number; i?: number; hold?: boolean };

/** One step of a puppet script. `visemes` + `clock` let real audio drive the mouth. */
export type Segment = {
  say?: string; visemes?: Viseme[]; clock?: () => number;
  model?: string; hold?: number; watch?: boolean; watchAll?: boolean; watchHolds?: boolean;
  mood?: string; act?: string; wait?: number; caption?: string; call?: () => void;
};

export type Particle = { kind: string; x: number; y: number; ttl: number; max: number; rot: number; color: string };

export interface Puppet {
  P: Record<string, number>;
  mood: string;
  mouthKey: string | null;
  particles: Particle[];
  t: number;
  watch: number;
  energy: number;
  busy: boolean;
  onCaption: ((text: string, i: number) => void) | null;
  setMood(m: string): void;
  hold(v: string | null, watch?: boolean): void;
  act(name: string): void;
  play(script: Segment[], onDone?: () => void): void;
  stop(): void;
  poke(x: number, y: number): boolean;
  point(x: number, y: number): void;
  update(dt: number): void;
}

type DrawOpts = { style?: string; outline?: number; brows?: boolean; mouthScale?: number; seed?: number; boil?: number; bleed?: number };

interface MiboModule {
  STYLE: { style: string; motionFps: number; mouthFps: number; boilFps: number; boil: number; bleed: number; paper: number; frame: number };
  MOUTH_KEYS: string[];
  VISEMES: Record<string, Record<string, number>>;
  mouthOf(v: string): Record<string, number>;
  drawMibo(ctx: CanvasRenderingContext2D, P: Record<string, number>, opts: DrawOpts): void;
  drawFx(ctx: CanvasRenderingContext2D, P: Record<string, number>, t: number, accent: string, opts: DrawOpts): void;
  drawParticles(ctx: CanvasRenderingContext2D, parts: Particle[], opts: DrawOpts): void;
  drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number, grain: number): void;
  Puppet: new () => Puppet;
}

export const getMibo = (): MiboModule => (globalThis as unknown as { Mibo: MiboModule }).Mibo;
export const newPuppet = (): Puppet => new (getMibo().Puppet)();

/** Captions: the puppet reports the line it is saying and the character it has reached. */
export function listenCaptions(p: Puppet, f: ((text: string, i: number) => void) | null) {
  p.onCaption = f;
}
