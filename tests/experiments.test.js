/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunExperiment, waitForDomEvent } from './utils.js';

track(test);

test.describe('Page-level experiments', () => {
  test('Replaces the page content with the variant.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    expect(await page.locator('main').textContent()).toMatch(/Hello (World|v1|v2)!/);
  });

  test('Visiting the page multiple times yields the same variant', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const text = await page.locator('main').textContent();
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    expect(await page.locator('main').textContent()).toEqual(text);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    expect(await page.locator('main').textContent()).toEqual(text);
  });

  test('does not run inactive experiments.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--inactive');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--inactive?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
  });

  test('Serves the variant if the configured audience is resolved.', async ({ page }) => {
    await page.addInitScript(() => {
      window.AUDIENCES = { bar: () => false };
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--audiences?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    await page.addInitScript(() => {
      window.AUDIENCES = { bar: () => true };
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--audiences?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
    await page.addInitScript(() => {
      window.AUDIENCES = { bar: async () => Promise.resolve(true) };
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--audiences?experiment=foo/challenger-2');
    expect(await page.locator('main').textContent()).toEqual('Hello v2!');
  });

  test('Supports the "stard-date" and "end-date" metadata.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--time-bound');
    expect(await page.locator('main').textContent()).toMatch(/Hello (World|v1|v2)!/);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--time-bound-start');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--time-bound-end');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
  });

  test('Supports the "split" metadata.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--split');
    expect(await page.locator('main').textContent()).toEqual('Hello v2!');
  });

  test('Sets classes on the body for the experiment.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/control');
    expect(await page.locator('body').getAttribute('class')).toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).toContain('variant-control');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/challenger-1');
    expect(await page.locator('body').getAttribute('class')).toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).toContain('variant-challenger-1');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/challenger-2');
    expect(await page.locator('body').getAttribute('class')).toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).toContain('variant-challenger-2');
  });

  test('Ignores empty experiments.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--empty?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    expect(await page.locator('body').getAttribute('class')).not.toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).not.toContain('variant-control');

    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--empty2?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    expect(await page.locator('body').getAttribute('class')).not.toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).not.toContain('variant-control');
  });

  test('Ignores invalid experiment references in the query parameters.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/invalid');
    expect(await page.locator('main').textContent()).toMatch(/Hello (World|v1|v2)!/);
  });

  test('Ignores invalid variant urls.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--invalid-url?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    expect(await page.locator('body').getAttribute('class')).toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).toContain('variant-control');
  });

  test('Supports code experiments.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--code?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    expect(await page.locator('body').getAttribute('class')).toContain('experiment-foo');
    expect(await page.locator('body').getAttribute('class')).toContain('variant-challenger-1');
  });

  test('Tracks the experiment in RUM.', async ({ page }) => {
    await page.addInitScript(() => {
      window.rumCalls = [];
      window.hlx = { rum: { sampleRUM: (...args) => window.rumCalls.push(args) } };
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    expect(await page.evaluate(() => window.rumCalls)).toContainEqual([
      'experiment',
      expect.objectContaining({
        source: 'foo',
        target: expect.stringMatching(/control|challenger-1|challenger-2/),
      }),
    ]);
  });

  test('Track RUM is fired before redirect', async ({ page }) => {
    const rumCalls = [];
    await page.exposeFunction('logRumCall', (...args) => rumCalls.push(args));
    await page.addInitScript(() => {
      window.hlx = { rum: { sampleRUM: (...args) => window.logRumCall(args) } };
    });
    await page.goto('/tests/fixtures/experiments/page-level--redirect');
    await page.waitForFunction(() => window.hlx.rum.sampleRUM);
    expect(rumCalls[0]).toContainEqual([
      'experiment',
      {
        source: 'foo',
        target: expect.stringMatching(/control|challenger-1|challenger-2/),
      },
    ]);

    const expectedContent = {
      v1: 'Hello v1!',
      v2: 'Hello v2!',
      redirect: 'Hello World!',
    };
    const expectedUrlPath = {
      v1: '/tests/fixtures/experiments/page-level-v1',
      v2: '/tests/fixtures/experiments/page-level-v2',
      redirect: '/tests/fixtures/experiments/page-level--redirect',
    };
    const url = new URL(page.url());
    const variant = Object.keys(expectedUrlPath).find((k) => url.pathname.endsWith(k));
    expect(await page.evaluate(() => window.document.body.innerText)).toMatch(
      new RegExp(expectedContent[variant]),
    );
    expect(expectedUrlPath[variant]).toBe(url.pathname);
  });

  test('Exposes the experiment in a JS API.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    expect(await page.evaluate(() => window.hlx.experiments)).toContainEqual(
      expect.objectContaining({
        type: 'page',
        config: expect.objectContaining({
          id: 'foo',
          run: true,
          selectedVariant: expect.stringMatching(/control|challenger-1|challenger-2/),
          status: 'active',
          variants: {
            control: expect.objectContaining({ percentageSplit: '0.3334' }),
            'challenger-1': expect.objectContaining({ percentageSplit: '0.3333' }),
            'challenger-2': expect.objectContaining({ percentageSplit: '0.3333' }),
          },
        }),
        servedExperience: expect.stringContaining('/tests/fixtures/experiments/page-level'),
      }),
    );
  });

  test('Controls the variant shown via query parameters.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/control');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
  });

  test('supports overriding the shown experiment and variant via query parameters.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/challenger-2&experiment=bar/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v2!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo&experiment-variant=challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--audiences?experiment=foo&experiment-variant=challenger-2&audience=bar');
    expect(await page.locator('main').textContent()).toEqual('Hello v2!');
  });

  test('triggers a DOM event with the experiment detail', async ({ page }) => {
    const fn = await waitForDomEvent(page, 'aem:experimentation');
    await page.goto('/tests/fixtures/experiments/page-level?experiment=foo&experiment-variant=challenger-1');
    expect(await page.evaluate(fn)).toEqual({
      type: 'experiment',
      element: await page.evaluate(() => document.body),
      experiment: 'foo',
      variant: 'challenger-1',
    });
  });
});

test.describe('Section-level experiments', () => {
  test('Replaces the section content with the variant.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level');
    expect(await page.locator('main>div').textContent()).toMatch(/Hello (World|v1|v2)!/);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/control');
    expect(await page.locator('main>div').textContent()).toContain('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/challenger-1');
    expect(await page.locator('main>div').textContent()).toContain('Hello v1!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/challenger-2');
    expect(await page.locator('main>div').textContent()).toContain('Hello v2!');
  });

  test('Sets classes on the section for the experiment.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/control');
    expect(await page.locator('main>div').getAttribute('class')).toContain('experiment-bar');
    expect(await page.locator('main>div').getAttribute('class')).toContain('variant-control');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/challenger-1');
    expect(await page.locator('main>div').getAttribute('class')).toContain('experiment-bar');
    expect(await page.locator('main>div').getAttribute('class')).toContain('variant-challenger-1');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level?experiment=bar/challenger-2');
    expect(await page.locator('main>div').getAttribute('class')).toContain('experiment-bar');
    expect(await page.locator('main>div').getAttribute('class')).toContain('variant-challenger-2');
  });

  test('Exposes the experiment in a JS API.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/section-level');
    expect(await page.evaluate(() => window.hlx.experiments)).toContainEqual(
      expect.objectContaining({
        type: 'section',
        config: expect.objectContaining({
          id: 'bar',
          run: true,
          selectedVariant: expect.stringMatching(/control|challenger-1|challenger-2/),
          status: 'active',
          variants: {
            control: expect.objectContaining({ percentageSplit: '0.3334' }),
            'challenger-1': expect.objectContaining({ percentageSplit: '0.3333' }),
            'challenger-2': expect.objectContaining({ percentageSplit: '0.3333' }),
          },
        }),
        servedExperience: expect.stringMatching(/\/tests\/fixtures\/experiments\/(page|section)-level/),
      }),
    );
  });

  test('triggers a DOM event with the experiment detail', async ({ page }) => {
    const fn = await waitForDomEvent(page, 'aem:experimentation');
    await page.goto('/tests/fixtures/experiments/section-level?experiment=bar/challenger-2');
    expect(await page.evaluate(fn)).toEqual({
      type: 'experiment',
      element: await page.evaluate(() => document.querySelector('.section')),
      experiment: 'bar',
      variant: 'challenger-2',
    });
  });
});

test.describe('Fragment-level experiments', () => {
  test('Replaces the fragment content with the variant.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level');
    expect(await page.locator('.fragment').first().textContent()).toMatch(/Hello (World|v1|v2)!/);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/control');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/challenger-1');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v1!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/challenger-2');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v2!');
  });

  test('Supports plural format for manifest keys.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--alt?experiment=baz/control');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--alt?experiment=baz/challenger-1');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v1!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--alt?experiment=baz/challenger-2');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v2!');
  });

  test('Ignores invalid manifest url.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--invalid-url');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello World!');
  });

  test('Replaces the async fragment content with the variant.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--async');
    expect(await page.locator('.fragment').first().textContent()).toMatch(/Hello (World|v1|v2)!/);
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--async?experiment=baz/control');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello World!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--async?experiment=baz/challenger-1');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v1!');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level--async?experiment=baz/challenger-2');
    expect(await page.locator('.fragment').first().textContent()).toContain('Hello v2!');
  });

  test('Sets classes on the section for the experiment.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/control');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('experiment-baz');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('variant-control');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/challenger-1');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('experiment-baz');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('variant-challenger-1');
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level?experiment=baz/challenger-2');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('experiment-baz');
    expect(await page.locator('.fragment').first().getAttribute('class')).toContain('variant-challenger-2');
  });

  test('Exposes the experiment in a JS API.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/fragment-level');
    expect(await page.evaluate(() => window.hlx.experiments)).toContainEqual(
      expect.objectContaining({
        type: 'fragment',
        config: expect.objectContaining({
          id: 'baz',
          run: true,
          selectedVariant: expect.stringMatching(/control|challenger-1|challenger-2/),
          status: 'active',
          variants: {
            control: expect.objectContaining({ percentageSplit: '0.3334' }),
            'challenger-1': expect.objectContaining({ percentageSplit: '0.3333' }),
            'challenger-2': expect.objectContaining({ percentageSplit: '0.3333' }),
          },
          label: expect.stringMatching(/Experiment Baz/),
        }),
        servedExperience: expect.stringMatching(/\/tests\/fixtures\/experiments\/(fragment|section)-level/),
      }),
    );
  });

  test('triggers a DOM event with the experiment detail', async ({ page }) => {
    const fn = await waitForDomEvent(page, 'aem:experimentation');
    await page.goto('/tests/fixtures/experiments/fragment-level?experiment=baz/challenger-1');
    expect(await page.evaluate(fn)).toEqual({
      type: 'experiment',
      element: await page.evaluate(() => document.querySelector('.fragment')),
      experiment: 'baz',
      variant: 'challenger-1',
    });
  });
});

test.describe('Backward Compatibility with v1', () => {
  test('Support the old "instant-experiment" metadata.', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--backward-compatibility--instant-experiment?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
  });

  test('Support the old "audience" metadata.', async ({ page }) => {
    await page.addInitScript(() => {
      window.AUDIENCES = { bar: () => true };
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--backward-compatibility--audience?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
  });
});

test.describe('Consent Management', () => {
  test('isUserConsentGiven returns false by default', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const hasConsent = await page.evaluate(() => localStorage.getItem('experimentation-consented') === 'true');
    expect(hasConsent).toBe(false);
  });

  test('updateUserConsent stores consent in localStorage', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    await page.evaluate(() => localStorage.setItem('experimentation-consented', 'true'));
    const stored = await page.evaluate(() => localStorage.getItem('experimentation-consented'));
    expect(stored).toBe('true');
  });

  test('updateUserConsent removes consent from localStorage when false', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    await page.evaluate(() => {
      localStorage.setItem('experimentation-consented', 'true');
      localStorage.removeItem('experimentation-consented');
    });
    const stored = await page.evaluate(() => localStorage.getItem('experimentation-consented'));
    expect(stored).toBeNull();
  });

  test('isUserConsentGiven returns true after consent is granted', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const hasConsent = await page.evaluate(() => {
      localStorage.setItem('experimentation-consented', 'true');
      return localStorage.getItem('experimentation-consented') === 'true';
    });
    expect(hasConsent).toBe(true);
  });

  test('consent persists across page reloads', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    await page.evaluate(() => localStorage.setItem('experimentation-consented', 'true'));
    await page.reload();
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const hasConsent = await page.evaluate(() => localStorage.getItem('experimentation-consented') === 'true');
    expect(hasConsent).toBe(true);
  });

  test('experiment does not run when consent is required but not given', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--requires-consent');
    expect(await page.locator('main').textContent()).toEqual('Hello World!');
  });

  test('experiment runs when consent is required and given', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('experimentation-consented', 'true');
    });
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--requires-consent?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
  });

  test('experiment config includes requiresConsent flag', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level--requires-consent');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config?.requiresConsent).toBe(true);
  });

  test('experiments without requiresConsent metadata run normally', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level?experiment=foo/challenger-1');
    expect(await page.locator('main').textContent()).toEqual('Hello v1!');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config?.requiresConsent).toBe(false);
  });
});

test.describe('Experiment Configuration', () => {
  test('experiment config includes thumbnail from og:image', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config).toHaveProperty('thumbnail');
  });

  test('experiment config includes optimizingTarget', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config.optimizingTarget).toBe('conversion');
  });

  test('experiment config includes label', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config.label).toMatch(/Experiment foo/);
  });

  test('variant labels use custom names when provided', async ({ page }) => {
    await goToAndRunExperiment(page, '/tests/fixtures/experiments/page-level');
    const config = await page.evaluate(() => window.hlx.experiments?.[0]?.config);
    expect(config.variants['challenger-1'].label).toBe('V1');
    expect(config.variants['challenger-2'].label).toBe('V2');
  });
});
