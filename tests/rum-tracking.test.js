/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunAudience, goToAndRunExperiment } from './utils.js';

track(test);

/**
 * Captures every `sampleRUM` call in `window.rumCalls` so a test can assert the
 * built-in RUM was (or was not) fired.
 */
async function captureBuiltInRUM(page) {
  await page.addInitScript(() => {
    window.rumCalls = [];
    window.hlx = { rum: { sampleRUM: (...args) => window.rumCalls.push(args) } };
  });
}

test.describe('rumTracking hook (#69)', () => {
  test("'off' suppresses the built-in RUM but still applies the decision.", async ({ page }) => {
    await captureBuiltInRUM(page);
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--rum-off');
    // The audience is still resolved and applied…
    expect(await page.locator('main').textContent()).toContain('Hello v1!');
    expect(await page.locator('body').getAttribute('class')).toContain('audience-foo');
    // …but nothing is reported to the built-in RUM.
    expect(await page.evaluate(() => window.rumCalls)).toEqual([]);
  });

  test('a function delegates the audience event instead of the built-in RUM.', async ({ page }) => {
    await captureBuiltInRUM(page);
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--rum-delegate');
    expect(await page.locator('main').textContent()).toContain('Hello v1!');
    // The custom sink receives the same payload the built-in RUM would have.
    expect(await page.evaluate(() => window.rumTrackingCalls)).toContainEqual({
      type: 'audience',
      source: 'foo',
      target: 'foo:bar',
    });
    // The built-in RUM is not called when a delegate is provided.
    expect(await page.evaluate(() => window.rumCalls)).toEqual([]);
  });

  test('a function delegates the experiment event with the experiment payload.', async ({ page }) => {
    await captureBuiltInRUM(page);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--rum-delegate');
    const calls = await page.evaluate(() => window.rumTrackingCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'experiment', source: 'foo' });
    expect(['control', 'challenger-1', 'challenger-2']).toContain(calls[0].target);
    // The built-in RUM is not called when a delegate is provided.
    expect(await page.evaluate(() => window.rumCalls)).toEqual([]);
  });
});
