/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunAudience } from './utils.js';

track(test);

test.describe('resolveAudiences hook (#67)', () => {
  test('resolves every audience in one context-aware call.', async ({ page }) => {
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--resolve-audiences');
    // foo resolved → variant-1; the per-audience resolvers were never called.
    expect(await page.locator('main').textContent()).toContain('Hello v1!');
    expect(await page.locator('body').getAttribute('class')).toContain('audience-foo');
    expect(await page.locator('body').getAttribute('class')).not.toContain('audience-bar');

    const calls = await page.evaluate(() => window.resolveAudiencesCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].names).toEqual(['foo', 'bar']);
    expect(calls[0].context).toMatchObject({ consent: false });
    expect(calls[0].context.url).toContain('/tests/fixtures/audiences/page-level--resolve-audiences');
  });

  test('falls back to control when the resolver rejects.', async ({ page }) => {
    await goToAndRunAudience(page, '/tests/fixtures/audiences/page-level--resolve-audiences-error');
    expect(await page.locator('main').textContent()).toContain('Hello World!');
    expect(await page.locator('body').getAttribute('class')).not.toContain('audience-foo');
    expect(await page.locator('body').getAttribute('class')).not.toContain('audience-bar');
  });
});

test.describe('createRemoteAudienceResolver helper (#67)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/fixtures/helper');
    await page.waitForFunction(() => window.helperReady === true);
  });

  test('memoizes one request per page and unwraps the contract envelope.', async ({ page }) => {
    const out = await page.evaluate(async () => {
      let calls = 0;
      window.fetch = async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ audiences: { foo: true, bar: false } }),
          { status: 200 },
        );
      };
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/api/audiences/resolve' });
      const a = await resolve(['foo', 'bar'], { url: 'u' });
      const b = await resolve(['foo', 'bar'], { url: 'u' });
      return { a, b, calls };
    });
    expect(out.a).toEqual({ foo: true, bar: false });
    expect(out.b).toEqual({ foo: true, bar: false });
    expect(out.calls).toBe(1);
  });

  test('accepts a bare resolution map (no envelope).', async ({ page }) => {
    const result = await page.evaluate(async () => {
      window.fetch = async () => new Response(JSON.stringify({ foo: true }), { status: 200 });
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/x' });
      return resolve(['foo'], { url: 'u' });
    });
    expect(result).toEqual({ foo: true });
  });

  test('serves control on timeout without blocking.', async ({ page }) => {
    const out = await page.evaluate(async () => {
      window.fetch = () => new Promise((res) => {
        setTimeout(() => res(new Response('{}', { status: 200 })), 500);
      });
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/x', timeout: 50 });
      const start = Date.now();
      const result = await resolve(['foo'], { url: 'u' });
      return { result, elapsed: Date.now() - start };
    });
    expect(out.result).toEqual({});
    expect(out.elapsed).toBeLessThan(400);
  });

  test('serves control on rejection and on a non-ok status.', async ({ page }) => {
    const rejected = await page.evaluate(async () => {
      window.fetch = async () => { throw new Error('network down'); };
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/x' });
      return resolve(['foo'], { url: 'u' });
    });
    expect(rejected).toEqual({});

    const nonOk = await page.evaluate(async () => {
      window.fetch = async () => new Response('nope', { status: 500 });
      const resolve = window.createRemoteAudienceResolver({ endpoint: '/x' });
      return resolve(['foo'], { url: 'u' });
    });
    expect(nonOk).toEqual({});
  });
});
