import { useSyncExternalStore } from 'react';

/** A tiny hash router: `#/lesson?lesson=sh&from=3`. Enough for five screens, and it works from any static host. */
export type Route = { path: string; params: Record<string, string> };

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => { current = parse(); listeners.forEach(f => f()); });

export function useRoute(): Route {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}

export function go(path: string, params: Record<string, string> = {}, opts: { replace?: boolean } = {}) {
  const q = new URLSearchParams(params).toString();
  const hash = `#/${path}${q ? `?${q}` : ''}`;
  if (opts.replace) window.location.replace(hash); else window.location.hash = hash;
}

export const goHome = () => go('', {}, { replace: true });
