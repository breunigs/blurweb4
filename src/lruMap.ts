/**
 * A Map with a fixed capacity that evicts the least-recently-used entry
 * (oldest by access time) when the limit is exceeded.
 *
 * Access order is maintained via Map insertion order: on every get() the
 * entry is deleted and re-inserted to move it to the end.
 */
export class LruMap<K, V> {
  readonly #map = new Map<K, V>();
  readonly #max: number;

  constructor(max: number) {
    this.#max = max;
  }

  get(key: K): V | undefined {
    const val = this.#map.get(key);
    if (val !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, val); // refresh LRU position
    }
    return val;
  }

  set(key: K, val: V): void {
    this.#map.set(key, val);
    if (this.#map.size > this.#max) {
      this.#map.delete(this.#map.keys().next().value!);
    }
  }

  clear(): void {
    this.#map.clear();
  }

  get size(): number {
    return this.#map.size;
  }
}
