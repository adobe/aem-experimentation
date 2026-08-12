/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';

track(test);

test.describe('listAudiences catalog seam', () => {
  test('advertises the engine catalog on body[data-audiences] in preview.', async ({ page }) => {
    await page.goto('/tests/fixtures/audiences/page-level--list-audiences');
    // The panel enumerates its switcher from body[data-audiences]; the catalog
    // names are merged in alongside any registered audiences.
    await expect(page.locator('body')).toHaveAttribute('data-audiences', /remote-segment-a/);
    const names = (await page.locator('body').getAttribute('data-audiences')).split(',');
    expect(names).toContain('foo');
    expect(names).toContain('remote-segment-a');
    expect(names).toContain('remote-segment-b');
  });

  test('does not fetch the catalog in production (author-time only).', async ({ page }) => {
    await page.goto('/tests/fixtures/audiences/page-level--list-audiences-prod');
    // Only the registered audience is advertised; the catalog was never called.
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('is a no-op in preview when no catalog hook is provided.', async ({ page }) => {
    await page.goto('/tests/fixtures/audiences/page-level--catalog-none');
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('leaves registered audiences untouched for an empty catalog.', async ({ page }) => {
    await page.goto('/tests/fixtures/audiences/page-level--catalog-empty');
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });

  test('keeps the page working when the catalog throws.', async ({ page }) => {
    await page.goto('/tests/fixtures/audiences/page-level--catalog-error');
    await expect(page.locator('body')).toHaveAttribute('data-audiences', 'foo');
  });
});
