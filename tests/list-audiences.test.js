/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';

track(test);

/**
 * Exposes the plugin's `loadLazy` on `window.aemExpLoadLazy`. The import lives in
 * a string so the test runner's Babel transform leaves it alone and the browser
 * resolves it natively.
 */
async function exposeLoadLazy(page) {
  await page.addScriptTag({
    type: 'module',
    content: 'import { loadLazy } from "/src/index.js"; window.aemExpLoadLazy = loadLazy;',
  });
  await page.waitForFunction(() => typeof window.aemExpLoadLazy === 'function');
}

/**
 * Runs the plugin's lazy phase with an optional in-browser `listAudiences`
 * (functions can't cross page.evaluate, so it is built browser-side from data).
 * `mode`: 'return' | 'empty' | 'throw' | 'none'; `preview` forces the debug gate.
 */
async function runLoadLazy(page, {
  mode = 'none', catalog = [], preview = true,
} = {}) {
  await page.evaluate(async (args) => {
    const opts = {};
    if (args.preview) {
      opts.isProd = () => false;
    }
    if (args.mode === 'return') {
      opts.listAudiences = async () => args.catalog;
    } else if (args.mode === 'empty') {
      opts.listAudiences = async () => [];
    } else if (args.mode === 'throw') {
      opts.listAudiences = async () => { throw new Error('catalog boom'); };
    }
    await window.aemExpLoadLazy(document, opts);
  }, { mode, catalog, preview });
}

test.describe('listAudiences catalog seam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/global');
    // Seed a registered audience the way loadEager's serveAudience would.
    await page.evaluate(() => { document.body.dataset.audiences = 'foo'; });
    await exposeLoadLazy(page);
  });

  test('advertises the engine catalog on body[data-audiences] in preview.', async ({ page }) => {
    await runLoadLazy(page, {
      mode: 'return',
      catalog: [{ name: 'remote-segment-a', label: 'Segment A' }, { name: 'remote-segment-b' }],
    });
    // Fire-and-forget, so poll for the merged switcher list.
    await expect(page.locator('body')).toHaveAttribute('data-audiences', /remote-segment-a/);
    const names = (await page.locator('body').getAttribute('data-audiences')).split(',');
    expect(names).toContain('foo');
    expect(names).toContain('remote-segment-a');
    expect(names).toContain('remote-segment-b');
  });

  test('does not fetch the catalog in production (author-time only).', async ({ page }) => {
    await runLoadLazy(page, { mode: 'return', catalog: [{ name: 'remote-segment-a' }], preview: false });
    // loadLazy returns early in production; the catalog is never consulted.
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('is a no-op in preview when no catalog hook is provided.', async ({ page }) => {
    await runLoadLazy(page, { mode: 'none' });
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('leaves registered audiences untouched for an empty catalog.', async ({ page }) => {
    await runLoadLazy(page, { mode: 'empty' });
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('keeps the page working when the catalog throws.', async ({ page }) => {
    await runLoadLazy(page, { mode: 'throw' });
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });
});
