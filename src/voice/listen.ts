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
import { TryWatch, type VadConfig } from './vad';

export type Heard = { samples: Float32Array; sr: number; speech: boolean };
/** `arm()`: Mibo has finished talking; only what comes after counts. */
export type Listening = { done: Promise<Heard>; stop: () => void; arm: () => void };

let stream: MediaStream | null = null;
let input: MediaStreamAudioSourceNode | null = null;
/** The context the microphone is joined to: Mibo's own, or (Firefox) one at the microphone's sample rate. */
let cap: AudioContext | null = null;
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
    try {
      input = c.createMediaStreamSource(stream);
      cap = c;
    } catch (e) {
      // Firefox will not join a microphone to a context running at another sample rate
      const rate = stream.getAudioTracks()[0]?.getSettings().sampleRate;
      console.warn('[mic] own context for the microphone:', (e as Error).message, rate);
      cap = new AudioContext(rate ? { sampleRate: rate } : {});
      await cap.resume().catch(() => {});
      input = cap.createMediaStreamSource(stream);
    }
    const settings = stream.getAudioTracks()[0]?.getSettings();
    console.log(`[mic] on: context ${cap.sampleRate} Hz, microphone ${settings?.sampleRate ?? '?'} Hz`);
    worklet = cap.audioWorklet
      ? cap.audioWorklet.addModule(`${import.meta.env.BASE_URL}rec-worklet.js`).then(() => true, () => false)
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
  if (cap && cap !== audio()) void cap.close().catch(() => {});
  stream = null; input = null; micReady = null; worklet = null; cap = null;
}

/**
 * Starts capturing now. Pass `armed: false` when Mibo is still talking and
 * call `arm()` when he stops. `onLevel` gets 0..1 about 20 times a second.
 * Ends after `pause` seconds of quiet once the child has spoken, after
 * `maxTry` seconds of trying, or after `maxWait` seconds with no speech.
 * Speech is found by vad.ts; `vad` overrides its numbers for this try.
 */
export function listen(opts: {
  onLevel?: (v: number) => void; armed?: boolean; maxWait?: number; maxTry?: number; pause?: number; vad?: Partial<VadConfig>;
} = {}): Listening {
  const { onLevel, maxWait = 6, maxTry = 8, pause = 1.2 } = opts;
  const c = cap ?? audio(), sr = c.sampleRate;
  const watch = new TryWatch(sr, { maxWait, maxTry, pause }, opts.vad);
  const chunks: Float32Array[] = [];
  let seen = 0, stopped = false;
  let wantArm = opts.armed !== false;
  let finish: (h: Heard) => void = () => {};
  const done = new Promise<Heard>(res => { finish = res; });
  let node: AudioNode | null = null, sink: GainNode | null = null;
  // a phone can suspend the context while it switches the speaker to the microphone's audio mode
  if (c.state !== 'running') void c.resume().catch(() => {});

  const end = (speech: boolean) => {
    if (stopped) return;
    stopped = true;
    try { if (node) { input?.disconnect(node); node.disconnect(); } sink?.disconnect(); } catch { /* fine */ }
    onLevel?.(0);
    // numbers only, for tuning against real sessions (never audio)
    console.log(`[mic] ${speech ? 'heard' : 'nothing'}: ${watch.summary()}${seen ? '' : ', NO AUDIO ARRIVED'}`);
    const armedAt = watch.armedTime;
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
    const level = watch.push(ch, wantArm);
    if (watch.armedTime >= 0) onLevel?.(level);
    if (watch.state === 'heard') end(true);
    else if (watch.state === 'nothing') end(false);
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

  const arm = () => {
    if (wantArm && watch.armedTime >= 0) return;
    wantArm = true;
    // if the microphone sends nothing at all (a suspended context), give up instead of waiting forever
    setTimeout(() => { if (!stopped && watch.armedTime < 0) end(false); }, (maxWait + 1) * 1000);
  };
  if (wantArm) arm();
  return { done, stop: () => { end(watch.startAt >= 0); }, arm };
}
