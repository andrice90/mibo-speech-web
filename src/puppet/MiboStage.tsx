import { useEffect, useRef } from 'react';

import { getMibo, type Puppet } from './mibo';

const LOOK = { style: 'sketch', outline: 13, brows: true, mouthScale: 1.15 };
const ACCENT = '#2c7a5c';

type Snap = { P: Record<string, number>; parts: Puppet['particles']; t: number; watch: number };

/**
 * Draws a Puppet the way the lab's hand-drawn stage does: the body is held at
 * STYLE.motionFps, the mouth swaps shapes at STYLE.mouthFps (each drawing is
 * the shape targeted longest in its window), and lines boil at STYLE.boilFps.
 */
export function MiboStage({ puppet }: { puppet: Puppet }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ s: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const box = frameRef.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const Mibo = getMibo(), S = Mibo.STYLE;
    let W = 0, H = 0, dpr = 1;
    let raf = 0, last = performance.now();
    let acc = 1, mouthAcc = 1, boilAcc = 0, boilFrame = 0, dirty = true;
    let mouthTime: Record<string, number> = {};
    let pose: Snap | null = null, mouth: Record<string, number> | null = null;

    const resize = () => {
      const r = box.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = Math.round(r.width); H = Math.round(r.height);
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const holdMouth = () => {
      let top: string | null = null;
      for (const k in mouthTime) if (!top || mouthTime[k] > mouthTime[top]) top = k;
      mouthTime = {};
      const src = top ? Mibo.mouthOf(top) : puppet.P, m: Record<string, number> = {};
      for (const k of Mibo.MOUTH_KEYS) m[k] = src[k];
      return m;
    };
    const holdPose = (): Snap => ({
      P: { ...puppet.P }, parts: puppet.particles.map(p => ({ ...p })), t: puppet.t, watch: puppet.watch,
    });

    const render = (snap: Snap, seed: number) => {
      const P = snap.P;
      const sc = Math.min(W / S.frame, H / (S.frame - 50)) * P.camZoom;
      cam.current = { s: sc, ox: W / 2 - P.camX * sc, oy: H / 2 - P.camY * sc };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      Mibo.drawPaper(ctx, W, H, S.paper);
      ctx.save();
      ctx.translate(cam.current.ox, cam.current.oy);
      ctx.scale(sc, sc);
      const o = { ...LOOK, seed, boil: S.boil, bleed: S.bleed };
      Mibo.drawMibo(ctx, P, o);
      Mibo.drawFx(ctx, P, snap.t, ACCENT, o);
      Mibo.drawParticles(ctx, snap.parts, o);
      ctx.restore();
      if (snap.watch > 0.02) {
        // soft spotlight on the mouth during "watch me"
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${0.16 * snap.watch})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
    };

    let warned = false;
    const frame = (now: number) => {
      // reschedule first: one bad frame must never kill the loop and blank Mibo
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!W || !H) return;
      try {
        puppet.update(dt);
        const k = puppet.mouthKey;
        if (k) mouthTime[k] = (mouthTime[k] || 0) + dt * (k === 'gap' ? 0.4 : 1);
        acc += dt; mouthAcc += dt; boilAcc += dt;
        if (boilAcc >= 1 / S.boilFps) { boilAcc %= 1 / S.boilFps; boilFrame = (boilFrame + 1) % 3; dirty = true; }
        if (acc >= 1 / S.motionFps || !pose) { acc %= 1 / S.motionFps; pose = holdPose(); dirty = true; }
        if (mouthAcc >= 1 / S.mouthFps || !mouth) { mouthAcc %= 1 / S.mouthFps; mouth = holdMouth(); dirty = true; }
        if (dirty) {
          render({ ...pose, P: { ...pose.P, ...mouth } }, boilFrame);
          dirty = false;
        }
      } catch (e) {
        if (!warned) { warned = true; console.warn('[mibo] frame skipped:', (e as Error).message); }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [puppet]);

  const poke = (e: React.PointerEvent) => {
    const r = frameRef.current!.getBoundingClientRect(), { s, ox, oy } = cam.current;
    puppet.poke((e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s);
  };

  return (
    <div ref={frameRef} className="stage-frame" onPointerDown={poke}>
      <canvas ref={canvasRef} />
    </div>
  );
}
