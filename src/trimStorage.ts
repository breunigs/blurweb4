/**
 * Persists video trim points (trimStart, trimEnd) in IndexedDB.
 * Uses the shared database connection from db.ts.
 */

import { idbGet, idbPut, idbClear } from './db';

export function saveTrim(fileKey: string, start: number, end: number): void {
  idbPut('trims', { key: fileKey, start, end }).catch((err) => {
    console.warn('[trimStorage] idbPut trims failed:', err);
  });
}

export async function loadTrim(fileKey: string): Promise<{ start: number; end: number } | null> {
  try {
    const rec = await idbGet<{ key: string; start: number; end: number }>('trims', fileKey);
    return rec ? { start: rec.start, end: rec.end } : null;
  } catch {
    return null;
  }
}

export function clearAllTrims(): Promise<void> {
  return idbClear('trims');
}
