/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';

track(test);

const VALID = ['valid-full', 'valid-audiences', 'valid-assignments'];
const INVALID = ['invalid-empty', 'invalid-audiences', 'invalid-version'];

const validate = (page, name) => page.evaluate(async (n) => {
  const res = await fetch(`/tests/fixtures/contract/${n}.json`).then((r) => r.json());
  return window.contract.isDecisionResponse(res);
}, name);

test.describe('client ⇄ engine decision contract (#71)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/contract-validators');
    await page.waitForFunction(() => window.contractReady === true);
  });

  test('exposes the contract version.', async ({ page }) => {
    expect(await page.evaluate(() => window.contract.CONTRACT_VERSION)).toBe('1');
  });

  VALID.forEach((name) => {
    test(`accepts the ${name} fixture.`, async ({ page }) => {
      expect(await validate(page, name)).toBe(true);
    });
  });

  INVALID.forEach((name) => {
    test(`rejects the ${name} fixture.`, async ({ page }) => {
      expect(await validate(page, name)).toBe(false);
    });
  });

  test('validates the decision context shape.', async ({ page }) => {
    const result = await page.evaluate(() => ({
      valid: window.contract.isDecisionContext({ url: 'https://x/', consent: false }),
      enriched: window.contract.isDecisionContext({
        url: 'https://x/', consent: true, visitorId: 'v1', geo: 'US',
      }),
      missingUrl: window.contract.isDecisionContext({ consent: false }),
      badConsent: window.contract.isDecisionContext({ url: 'https://x/', consent: 'no' }),
    }));
    expect(result).toEqual({
      valid: true, enriched: true, missingUrl: false, badConsent: false,
    });
  });

  test('the client resolver consumes a contract-shaped audience response.', async ({ page }) => {
    await page.goto('/tests/fixtures/helper');
    await page.waitForFunction(() => window.helperReady === true);
    const resolved = await page.evaluate(async () => {
      const res = await fetch('/tests/fixtures/contract/valid-audiences.json').then((r) => r.json());
      window.fetch = async () => new Response(JSON.stringify(res), { status: 200 });
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/x' });
      return resolve(['returning-visitor', 'new-visitor'], { url: 'u' });
    });
    expect(resolved).toEqual({ 'returning-visitor': true, 'new-visitor': false });
  });

  test('rejects non-objects and invalid facets.', async ({ page }) => {
    const result = await page.evaluate(() => ({
      nullRes: window.contract.isDecisionResponse(null),
      stringRes: window.contract.isDecisionResponse('nope'),
      arrayRes: window.contract.isDecisionResponse([]),
      badAssignments: window.contract.isDecisionResponse({ assignments: { exp: 123 } }),
      badDecision: window.contract.isDecisionResponse({ decisions: { '.x': { foo: 'bar' } } }),
      badDecisionsType: window.contract.isDecisionResponse({ decisions: 'nope' }),
    }));
    expect(result).toEqual({
      nullRes: false,
      stringRes: false,
      arrayRes: false,
      badAssignments: false,
      badDecision: false,
      badDecisionsType: false,
    });
  });
});
