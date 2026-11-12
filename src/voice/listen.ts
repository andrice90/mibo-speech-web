/**
 * Listens for one try on this device's microphone.
 *
 * The samples are held in memory only for the on-device check (judge.ts /
 * wordcheck.ts) and then dropped: nothing is saved and nothing is sent
 * anywhere. The browser's noise suppression and echo cancelling are switched
 * off because they scrub exactly the hiss the check listens for.
 *
 * Recording starts while Mibo is still saying "your turn" (so a child who
 * jumps in is caught), but nothing before `arm()` counts: that is Mibo's own
 * voice. After it, the level meter waits for the child to speak and then for
 * a real pause, so several goes ("seal... seal!") land in one window.
 */
import { audio } from './player';

export type Heard = { samples: Float32Array; sr: number; speech: boolean };
/** `arm()`: Mibo has finished talking; only what comes after counts. */
export type Listening = { done: Promise<Heard>; stop: () => void; arm: () => void };

let stream: MediaStream | null = null;
let input: MediaStreamAudioSourceNode | null = null;
let worklet: Promise<boolean> | null = null;
let micReady: Promise<boolean> | null = null;

export const canListen = () => !!navigator.mediaDevices?.getUserMedia;

export type MicState = 'granted' | 'prompt' | 'denied' | 'unknown';
/** Whether the browser has already been told it may use the microphone ("unknown" where it will not say). */
export async function micPermission(): Promise<MicState> {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return p.state as MicState;
  } catch {
    return 'unknown';
  }
}

/**
 * Asks the browser for the microphone now, so its permission pop-up appears
 * while the grown-up is looking for it, then lets go again. Nothing is
 * recorded. Resolves true if the microphone may be used.
 */
export async function askForMic(): Promise<boolean> {
  if (!canListen()) return false;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** Asks for the microphone once per visit. */
export function enableMic(): Promise<boolean> {
  micReady ??= (async () => {
    if (!canListen()) return false;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const c = audio();
    if (c.state !== 'running') await c.resume().catch(() => {});
    input = c.createMediaStreamSource(stream);
    worklet = c.audioWorklet
      ? c.audioWorklet.addModule(`${import.meta.env.BASE_URL}rec-worklet.js`).then(() => true, () => false)
      : Promise.resolve(false);
    await worklet;
    return true;
  })().catch(() => { micReady = null; return false; });
  return micReady;
}

/** Lets go of the microphone (the browser's recording light goes out). */
export function releaseMic() {
  stream?.getTracks().forEach(t => t.stop());
  try { input?.disconnect(); } catch { /* fine */ }
  stream = null; input = null; micReady = null; worklet = null;
}

/**
 * Starts capturing now. Pass `armed: false` when Mibo is still talking and
 * call `arm()` when he stops. `onLevel` gets 0..1 about 20 times a second.
 * Ends after `pause` seconds of quiet once the child has spoken, after
 * `maxTry` seconds of trying, or after `maxWait` seconds with no speech.
 */
export function listen(opts: {
  onLevel?: (v: number) => void; armed?: boolean; maxWait?: number; maxTry?: number; pause?: number;
} = {}): Listening {
  const { onLevel, maxWait = 6, maxTry = 8, pause = 1.2 } = opts;
  const c = audio(), sr = c.sampleRate;
  const chunks: Float32Array[] = [];
  let seen = 0, armedAt = -1, floor = -55, startAt = -1, quietSince = -1, stopped = false;
  let wantArm = opts.armed !== false;
  let finish: (h: Heard) => void = () => {};
  const done = new Promise<Heard>(res => { finish = res; });
  let node: AudioNode | null = null, sink: GainNode | null = null;

  const end = (speech: boolean) => {
    if (stopped) return;
    stopped = true;
    try { if (node) { input?.disconnect(node); node.disconnect(); } sink?.disconnect(); } catch { /* fine */ }
    onLevel?.(0);
    if (!speech || armedAt < 0) { finish({ samples: new Float32Array(0), sr, speech: false }); return; }
    const all = new Float32Array(seen);
    let at = 0;
    for (const ch of chunks) { all.set(ch, at); at += ch.length; }
    chunks.length = 0;
    // everything after Mibo stopped talking (a little before, for a child who jumped in)
    finish({ samples: all.subarray(Math.max(0, Math.round((armedAt - 0.1) * sr))), sr, speech: true });
  };

  const onChunk = (ch: Float32Array) => {
    if (stopped) return;
    chunks.push(ch);
    seen += ch.length;
    const t = seen / sr;
    if (armedAt < 0) { if (wantArm) armedAt = t; else return; }   // Mibo is still talking
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const level = 10 * Math.log10(sum / ch.length + 1e-12);        // dBFS
    if (level < floor) floor = 0.9 * floor + 0.1 * level;          // settles on the room once Mibo's voice is gone
    else floor = Math.min(floor + 0.02, -35);                      // and drifts up slowly if the room gets louder
    const speaking = level > Math.max(floor + 14, -50);
    if (speaking) { if (startAt < 0) startAt = t; quietSince = -1; } else if (startAt >= 0 && quietSince < 0) quietSince = t;
    onLevel?.(Math.max(0, Math.min(1, (level - floor) / 35)));
    if (startAt >= 0 && ((quietSince >= 0 && t - quietSince > pause) || t - armedAt > maxTry)) end(true);
    else if (startAt < 0 && t - armedAt > maxWait) end(false);
  };

  (async () => {
    try {
      if (!input) throw new Error('mic is off');
      if (await worklet) {
        const w = new AudioWorkletNode(c, 'mibo-rec', { numberOfInputs: 1, numberOfOutputs: 0 });
        w.port.onmessage = e => onChunk(e.data as Float32Array);
        node = w;
        input.connect(w);
      } else {
        // older browsers: a script processor only runs while it is wired to the output, so it goes through a silent gain
        const sp = c.createScriptProcessor(2048, 1, 1);
        sp.onaudioprocess = e => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
        sink = c.createGain();
        sink.gain.value = 0;
        node = sp;
        input.connect(sp); sp.connect(sink); sink.connect(c.destination);
      }
      if (stopped) { try { input.disconnect(node); } catch { /* fine */ } }
    } catch {
      end(false);
    }
  })();

  return { done, stop: () => { end(startAt >= 0); }, arm: () => { wantArm = true; } };
}
