/**
 * Shared IndexedDB connection for the app.
 *
 * Single source of truth for the database name, version, and schema.
 * All modules that need IDB access import from here.
 */

const DB_NAME = 'blurweb4-detections';
const DB_VERSION = 3;

export const dbPromise: Promise<IDBDatabase> = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('trims')) db.createObjectStore('trims', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('ocr')) db.createObjectStore('ocr', { keyPath: 'key' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function idbPut(store: string, value: unknown): Promise<void> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export function idbClear(store: string): Promise<void> {
  return dbPromise.then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}
