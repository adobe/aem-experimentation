/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunAudience } from './utils.js';

track(test);

test.describe('renderDecision hook (#70)', () => {
  test('owns applying a page-level decision instead of fetch → innerHTML.', async ({ page }) => {
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--render-decision');
    // The hook rendered its own content; the default variant fetch did not run.
    const main = await page.locator('main').textContent();
    expect(main).toContain('RENDERED page');
    expect(main).not.toContain('Hello v1!');
    // The hook received the resolved element and the normalized decision.
    expect(await page.evaluate(() => window.renderDecisionCalls)).toEqual([{
      tag: 'MAIN',
      type: 'audience',
      scope: 'page',
      url: '/tests/fixtures/audiences/variant-1',
      selector: null,
      selectedAudience: 'foo',
    }]);
  });

  test('owns applying a fragment-level decision, with its selector.', async ({ page }) => {
    await goToAndRunAudience(page, '/tests/fixtures/audiences/fragment-level--render-decision');
    // Fragments apply asynchronously via a MutationObserver, so poll for it.
    await expect(page.locator('.fragment')).toContainText('RENDERED fragment');
    expect(await page.locator('.fragment').textContent()).not.toContain('Hello v1!');
    expect(await page.evaluate(() => window.renderDecisionCalls)).toEqual([{
      tag: 'DIV',
      type: 'audience',
      scope: 'fragment',
      url: '/tests/fixtures/audiences/variant-1',
      selector: '.fragment',
    }]);
  });

  test('falls back to control when renderDecision throws.', async ({ page }) => {
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--render-decision-error');
    // The renderer threw, so nothing is applied and the page keeps its content.
    expect(await page.locator('main').textContent()).toContain('Hello World!');
    expect(await page.locator('body').getAttribute('class')).toContain('audience-default');
  });
});
