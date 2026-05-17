/**
 * Unit tests for LruMap (src/lruMap.ts).
 * Run with: node --experimental-strip-types tests/lruMap.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruMap } from '../../src/lruMap.ts';

test('stores and retrieves values', () => {
  const m = new LruMap<string, number>(10);
  m.set('a', 1);
  assert.equal(m.get('a'), 1);
});

test('returns undefined for missing keys', () => {
  const m = new LruMap<string, number>(10);
  assert.equal(m.get('x'), undefined);
});

test('size reflects entry count', () => {
  const m = new LruMap<string, number>(10);
  m.set('a', 1);
  m.set('b', 2);
  assert.equal(m.size, 2);
});

test('evicts oldest entry when capacity is exceeded', () => {
  const m = new LruMap<string, number>(3);
  m.set('a', 1);
  m.set('b', 2);
  m.set('c', 3);
  m.set('d', 4); // 'a' should be evicted
  assert.equal(m.size, 3);
  assert.equal(m.get('a'), undefined);
  assert.equal(m.get('b'), 2);
  assert.equal(m.get('c'), 3);
  assert.equal(m.get('d'), 4);
});

test('get refreshes LRU position, preventing eviction', () => {
  const m = new LruMap<string, number>(3);
  m.set('a', 1);
  m.set('b', 2);
  m.set('c', 3);
  m.get('a'); // 'a' is now most-recently-used; 'b' becomes oldest
  m.set('d', 4); // 'b' should be evicted, not 'a'
  assert.equal(m.get('a'), 1);
  assert.equal(m.get('b'), undefined);
  assert.equal(m.get('c'), 3);
  assert.equal(m.get('d'), 4);
});

test('overwriting an existing key does not grow past capacity', () => {
  const m = new LruMap<string, number>(2);
  m.set('a', 1);
  m.set('b', 2);
  m.set('a', 99); // update, not a new entry
  assert.equal(m.size, 2);
  assert.equal(m.get('a'), 99);
  assert.equal(m.get('b'), 2);
});

test('clear removes all entries', () => {
  const m = new LruMap<string, number>(10);
  m.set('a', 1);
  m.set('b', 2);
  m.clear();
  assert.equal(m.size, 0);
  assert.equal(m.get('a'), undefined);
});

test('capacity of 1 keeps only the latest entry', () => {
  const m = new LruMap<string, number>(1);
  m.set('a', 1);
  m.set('b', 2);
  assert.equal(m.size, 1);
  assert.equal(m.get('a'), undefined);
  assert.equal(m.get('b'), 2);
});
