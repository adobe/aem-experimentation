/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunExperiment } from './utils.js';

track(test);

test.describe('getAssignment hook (#68)', () => {
  test('serves the engine-assigned variant without re-bucketing.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment');
    expect(await page.locator('main').textContent()).toContain('Hello v1!');
    // Deterministic: the same arm is served every time (no randomization).
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment');
    expect(await page.locator('main').textContent()).toContain('Hello v1!');

    const calls = await page.evaluate(() => window.getAssignmentCalls);
    expect(calls[0].experimentId).toBe('foo');
    expect(calls[0].context).toMatchObject({ consent: false });
    expect(calls[0].context.url).toContain('/tests/fixtures/experiments/page-level--get-assignment');
  });

  test('serves control when the engine assigns control.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment-control');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
  });

  test('the ?experiment override still wins over the engine.', async ({ page }) => {
    await goToAndRunExperiment(
      page,
      '/tests/fixtures/experiments/page-level--get-assignment?experiment=foo/challenger-2',
    );
    expect(await page.locator('main').textContent()).toContain('Hello v2!');
  });

  test('falls back to self-bucketing when the engine declines.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment-decline');
    // No assignment → the plugin buckets itself; any known variant may show.
    expect(await page.locator('main').textContent()).toMatch(/Hello (World|v1|v2)!/);
  });

  test('serves control when the engine assigns an unknown variant.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment-unknown');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
  });

  test('falls back to self-bucketing when getAssignment throws.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--get-assignment-error');
    expect(await page.locator('main').textContent()).toMatch(/Hello (World|v1|v2)!/);
  });
});
