import type { Viseme } from '../voice/analyze';
import { preload, type Clip } from '../voice/player';
import manifest from './clips.json';

/** Mibo's bundled voice: every built-in line, made once and checked by ear (public/voice/*.wav). */
const CLIPS = manifest as unknown as Record<string, { text: string; seconds: number; visemes: Viseme[] }>;
const url = (id: string) => `${import.meta.env.BASE_URL}voice/${id}.wav`;

export const bundled = (id: string): Clip => {
  const c = CLIPS[id];
  return { source: url(id), text: c?.text ?? '', visemes: c?.visemes ?? [], seconds: c?.seconds ?? 0 };
};

/**
 * Fetch and decode a lesson's clips before it starts, so no line waits on the
 * network: bundled ids, plus `extra` sources (a made lesson's saved voice).
 * Resolves false if any clip could not be loaded.
 */
export function preloadClips(ids: string[], extra: string[] = []): Promise<boolean> {
  return preload([...ids.filter(id => CLIPS[id]).map(url), ...extra]);
}
