/**
 * Small on-device stores. Everything the app remembers lives in this
 * browser only: JSON in localStorage, Mibo's made voice lines in IndexedDB.
 * There are no accounts and no server database.
 */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- audio made for this family (name lines, made lessons), as WAV bytes

const DB = 'mibo-audio-v1', STORE = 'clips';
let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { db = null; reject(req.error); };
  });
  return db;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(d => new Promise<T>((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const putAudio = (key: string, wav: Uint8Array) => tx('readwrite', s => s.put(wav, key)).then(() => {});
export const getAudio = (key: string) => tx<Uint8Array | undefined>('readonly', s => s.get(key));
export const deleteAudio = (key: string) => tx('readwrite', s => s.delete(key)).then(() => {}, () => {});
