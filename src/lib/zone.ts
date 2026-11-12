/**
 * The two zones. The kid zone (lessons) makes no AI calls of any kind: it
 * plays voice that is already on the device and checks tries with signal
 * processing. Everything that uses a model — Mibo's notes on the device,
 * lesson planning and voice in the cloud — lives in the grown-up zone,
 * behind a PIN the grown-up chooses at first use.
 *
 * `inParentZone()` is checked by src/ai/firebase.ts before any model is
 * created, so the rule holds in code, not only in the screens.
 *
 * The PIN is a parental gate, not account security: it is salted, hashed
 * and kept in this browser, and a wrong-guess pause slows a child down.
 */
import { useSyncExternalStore } from 'react';

import { readJson, writeJson } from './store';

type Saved = { salt: string; hash: string };
const KEY = 'mibo-pin-v1';

let unlocked = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach(f => f());

async function digest(salt: string, pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const validPin = (pin: string) => /^\d{4}$/.test(pin);
export const hasPin = () => !!readJson<Saved | null>(KEY, null)?.hash;

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  writeJson(KEY, { salt, hash: await digest(salt, pin) });
}

let misses = 0, pausedUntil = 0;
/** Seconds left before another guess is allowed (0 when guessing is open). */
export const pinPause = () => Math.max(0, Math.ceil((pausedUntil - Date.now()) / 1000));

/** Opens the grown-up zone if the PIN is right. Five misses in a row pause guessing for 30 seconds. */
export async function unlock(pin: string): Promise<boolean> {
  const saved = readJson<Saved | null>(KEY, null);
  if (!saved || pinPause() > 0) return false;
  const ok = (await digest(saved.salt, pin)) === saved.hash;
  if (ok) { misses = 0; unlocked = true; tell(); return true; }
  if (++misses >= 5) { misses = 0; pausedUntil = Date.now() + 30_000; }
  return false;
}

/** Back to the kid zone. Called by "My child is ready" and whenever a kid-zone screen opens. */
export function lock() {
  if (!unlocked) return;
  unlocked = false;
  tell();
}

export const inParentZone = () => unlocked;

export function useParentZone(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, inParentZone);
}

/** Forgotten PIN: wipes everything the app keeps on this device and starts again from first use. */
export async function resetEverything(): Promise<void> {
  for (const k of Object.keys(localStorage)) if (k.startsWith('mibo-')) localStorage.removeItem(k);
  await new Promise<void>(res => {
    const req = indexedDB.deleteDatabase('mibo-audio-v1');
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
  lock();
}
