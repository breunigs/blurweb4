/**
 * Unit tests for applyPattern (src/naming.ts).
 *
 * applyPattern is exposed as window.__applyPattern by app.ts. Tests navigate to
 * the dev server (same as media.test.ts) so the real module is used, with
 * localStorage controlling config-derived variables.
 */

import { test, expect, Page } from '@playwright/test';
import type { FileMeta } from '../src/fileMeta';

type ApplyPatternFn = (pattern: string, inputStem: string, index: number, meta: FileMeta) => string;

/** Call window.__applyPattern in the page. */
async function applyPattern(
  page: Page,
  pattern: string,
  inputStem: string,
  index: number,
  meta: FileMeta,
): Promise<string> {
  return page.evaluate(
    ([pattern, inputStem, index, meta]) =>
      (window as unknown as { __applyPattern: ApplyPatternFn }).__applyPattern(
        pattern,
        inputStem,
        index,
        meta as FileMeta,
      ),
    [pattern, inputStem, index, meta] as [string, string, number, FileMeta],
  );
}

const FULL_META: FileMeta = {
  year: '2024',
  month: '03',
  day: '15',
  hour: '10',
  minute: '42',
  timezone: '+01:00',
  lat: '53.5616',
  lon: '9.9222',
  duration: '00:01:23',
};

test.describe('applyPattern — meta variables', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3100');
  });

  test('{input} substitutes the file stem', async ({ page }) => {
    const result = await applyPattern(page, '{input}', 'myvideo', 1, {});
    expect(result).toBe('myvideo');
  });

  test('{index} substitutes the sequential index', async ({ page }) => {
    expect(await applyPattern(page, '{index}', 'f', 7, {})).toBe('7');
    expect(await applyPattern(page, '{index}', 'f', 0, {})).toBe('0');
  });

  test('{year}, {month}, {day} substituted from meta', async ({ page }) => {
    const result = await applyPattern(page, '{year}-{month}-{day}', 'clip', 1, FULL_META);
    expect(result).toBe('2024-03-15');
  });

  test('{hour} and {minute} substituted from meta', async ({ page }) => {
    const result = await applyPattern(page, '{hour}{minute}', 'clip', 1, FULL_META);
    expect(result).toBe('1042');
  });

  test('{timezone} substituted from meta', async ({ page }) => {
    const result = await applyPattern(page, '{timezone}', 'clip', 1, FULL_META);
    expect(result).toBe('+01:00');
  });

  test('{lat} and {lon} substituted from meta', async ({ page }) => {
    const result = await applyPattern(page, '{lat},{lon}', 'clip', 1, FULL_META);
    expect(result).toBe('53.5616,9.9222');
  });

  test('{duration} substituted from meta', async ({ page }) => {
    const result = await applyPattern(page, '{duration}', 'clip', 1, FULL_META);
    expect(result).toBe('00:01:23');
  });

  test('multiple variables combined in one pattern', async ({ page }) => {
    const result = await applyPattern(
      page,
      '{input}_{year}{month}{day}_{lat}',
      'dashcam',
      3,
      FULL_META,
    );
    expect(result).toBe('dashcam_20240315_53.5616');
  });

  test('pattern with no variables is returned verbatim', async ({ page }) => {
    const result = await applyPattern(page, 'static_output', 'x', 1, {});
    expect(result).toBe('static_output');
  });

  test('missing meta fields become empty string', async ({ page }) => {
    const result = await applyPattern(page, '{year}-{month}', 'clip', 1, {});
    expect(result).toBe('-');
  });

  test('unknown variable becomes empty string', async ({ page }) => {
    const result = await applyPattern(page, '{unknown}_{input}', 'vid', 1, {});
    expect(result).toBe('_vid');
  });

  test('empty pattern produces empty string', async ({ page }) => {
    const result = await applyPattern(page, '', 'clip', 1, FULL_META);
    expect(result).toBe('');
  });
});

/** Navigate to the app with a specific config pre-seeded into localStorage. */
async function gotoWithConfig(page: Page, config: Record<string, unknown>): Promise<void> {
  // First visit: seed localStorage, then reload so the app boots with that config.
  await page.goto('http://localhost:3100');
  await page.evaluate((cfg) => {
    window.localStorage.setItem('blurweb4-config', JSON.stringify(cfg));
  }, config);
  await page.reload();
}

test.describe('applyPattern — config-derived variables', () => {
  test('{model} reflects small model (detect_n)', async ({ page }) => {
    await gotoWithConfig(page, { model: 'detect_n' });
    const result = await applyPattern(page, '{model}', 'f', 1, {});
    expect(result).toBe('small');
  });

  test('{model} reflects large model (detect_x)', async ({ page }) => {
    await gotoWithConfig(page, { model: 'detect_x' });
    const result = await applyPattern(page, '{model}', 'f', 1, {});
    expect(result).toBe('large');
  });

  test('{redaction_style} reflects current drawMode', async ({ page }) => {
    await gotoWithConfig(page, { drawMode: 'pixelate' });
    const result = await applyPattern(page, '{redaction_style}', 'f', 1, {});
    expect(result).toBe('pixelate');
  });

  test('{detect} lists enabled labels sorted alphabetically', async ({ page }) => {
    // Labels stored in reverse order — output must still be sorted: person-plate
    await gotoWithConfig(page, { enabledLabels: ['person', 'plate'] });
    const result = await applyPattern(page, '{detect}', 'f', 1, {});
    expect(result).toBe('person-plate');
  });

  test('{detect} with single label', async ({ page }) => {
    await gotoWithConfig(page, { enabledLabels: ['plate'] });
    const result = await applyPattern(page, '{detect}', 'f', 1, {});
    expect(result).toBe('plate');
  });

  test('{min_confidence} reflects configured value', async ({ page }) => {
    await gotoWithConfig(page, { minConfidence: 0.25 });
    const result = await applyPattern(page, '{min_confidence}', 'f', 1, {});
    expect(result).toBe('0.25');
  });

  test('{area_expansion} reflects configured value', async ({ page }) => {
    await gotoWithConfig(page, { expansionFraction: 0.1 });
    const result = await applyPattern(page, '{area_expansion}', 'f', 1, {});
    expect(result).toBe('0.1');
  });
});
