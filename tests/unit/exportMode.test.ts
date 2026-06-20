import { test, expect } from '@playwright/test';
import { jpegQualityFor, effectiveBitrateFor } from '../../src/exportUtils';

test('jpegQualityFor — quality mode returns 0.95', () => {
  expect(jpegQualityFor('quality')).toBe(0.95);
});

test('jpegQualityFor — filesize mode returns 0.65', () => {
  expect(jpegQualityFor('filesize')).toBe(0.65);
});

test('effectiveBitrateFor — quality mode keeps source bitrate', () => {
  expect(effectiveBitrateFor('quality', 10_000_000)).toBe(10_000_000);
});

test('effectiveBitrateFor — filesize mode halves source bitrate', () => {
  expect(effectiveBitrateFor('filesize', 10_000_000)).toBe(5_000_000);
});

test('effectiveBitrateFor — returns null when source bitrate is null', () => {
  expect(effectiveBitrateFor('quality', null)).toBeNull();
  expect(effectiveBitrateFor('filesize', null)).toBeNull();
});
