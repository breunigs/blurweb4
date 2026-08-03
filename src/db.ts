/**
 * Shared IndexedDB connection for the app.
 *
 * Single source of truth for the database name, version, and schema.
 * All modules that need IDB access import from here.
 *
 * When IDB is unavailable (private browsing, storage disabled, quota exceeded),
 * operations gracefully return undefined / no-op instead of throwing.
 */

const DB_NAME = 'blurweb4-detections';
const DB_VERSION = 3;

let _idbUnavailableLogged = false;

export const dbPromise: Promise<IDBDatabase | null> = new Promise((resolve) => {
  try {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('stats')) db.createObjectStore('stats', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('trims')) db.createObjectStore('trims', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('ocr')) db.createObjectStore('ocr', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('[db] IndexedDB open failed:', req.error);
      resolve(null);
    };
    req.onblocked = () => {
      console.warn('[db] IndexedDB open blocked — another tab may have an older version open');
    };
  } catch (err) {
    console.warn('[db] IndexedDB unavailable:', err);
    resolve(null);
  }
});

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return dbPromise.then(
    (db) => {
      if (!db) {
        if (!_idbUnavailableLogged) { _idbUnavailableLogged = true; console.warn('[db] IDB unavailable — cache/persistence disabled'); }
        return undefined;
      }
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      });
    },
  );
}

export function idbPut(store: string, value: unknown): Promise<void> {
  return dbPromise.then(
    (db) => {
      if (!db) return;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  );
}

export function idbClear(store: string): Promise<void> {
  return dbPromise.then(
    (db) => {
      if (!db) return;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  );
}
