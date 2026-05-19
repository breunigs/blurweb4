/**
 * Persists video trim points (trimStart, trimEnd) in IndexedDB.
 *
 * Opens the same 'blurweb4-detections' database used by detector.ts.
 * Having two connections to the same DB is safe — IDB handles concurrent
 * opens and only one onupgradeneeded fires per version upgrade.
 */

const DB_NAME = 'blurweb4-detections';
const DB_VERSION = 2;

const dbPromise: Promise<IDBDatabase> = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('trims')) db.createObjectStore('trims', { keyPath: 'key' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function idbGet(key: string): Promise<{ key: string; start: number; end: number } | undefined> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction('trims', 'readonly').objectStore('trims').get(key);
        req.onsuccess = () => resolve(req.result as { key: string; start: number; end: number } | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbPut(value: { key: string; start: number; end: number }): Promise<void> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction('trims', 'readwrite');
        tx.objectStore('trims').put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function saveTrim(fileKey: string, start: number, end: number): void {
  idbPut({ key: fileKey, start, end }).catch((err) => {
    console.warn('[trimStorage] idbPut trims failed:', err);
  });
}

export async function loadTrim(fileKey: string): Promise<{ start: number; end: number } | null> {
  try {
    const rec = await idbGet(fileKey);
    return rec ? { start: rec.start, end: rec.end } : null;
  } catch {
    return null;
  }
}
