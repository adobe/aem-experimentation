/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';

track(test);

const MFE_GLOB = '**/ExpSuccess-aem-experimentation-mfe/**';
const REOPEN_KEY = 'aem-experimentation-simulation-open';

/**
 * Intercepts the hosted MFE script and fulfills it with a stub that injects the
 * `#aemExperimentation` container the panel controller waits for. Returns a
 * getter that reports whether the MFE was ever requested.
 */
async function stubMfe(page) {
  let requested = false;
  await page.route(MFE_GLOB, async (route) => {
    requested = true;
    await route.fulfill({
      contentType: 'application/javascript',
      body: `(function () {
        var el = document.createElement('div');
        el.id = 'aemExperimentation';
        el.classList.add('aemExperimentationHidden');
        document.body.appendChild(el);
      })();`,
    });
  });
  return () => requested;
}

/**
 * Exposes the plugin's `loadLazy` on `window.aemExpLoadLazy`. The import lives in a
 * string (not a transformed `import()` expression) so the test runner's Babel
 * transform leaves it alone and the browser resolves it natively.
 */
async function exposePlugin(page) {
  await page.addScriptTag({
    type: 'module',
    content: 'import { loadLazy } from "/src/index.js"; window.aemExpLoadLazy = loadLazy;',
  });
  await page.waitForFunction(() => typeof window.aemExpLoadLazy === 'function');
}

/**
 * Runs the plugin's lazy phase. `debug` forces the preview gate on by supplying
 * `isProd: () => false` (built browser-side, since functions can't cross evaluate).
 */
async function runLoadLazy(page, options = {}, debug = true) {
  await page.evaluate(async ({ opts, dbg }) => {
    const config = dbg ? { isProd: () => false, ...opts } : { ...opts };
    await window.aemExpLoadLazy(document, config);
  }, { opts: options, dbg: debug });
}

const panel = (page) => page.locator('#aemExperimentation');

test.describe('Simulation UI', () => {
  test('opens the panel automatically from an ?experiment deep-link', async ({ page }) => {
    const wasRequested = await stubMfe(page);
    await page.goto('/tests/fixtures/global?experiment=foo/challenger-1');
    await exposePlugin(page);
    await runLoadLazy(page);

    await expect(panel(page)).toHaveCount(1);
    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);
    expect(wasRequested()).toBe(true);
    // The MFE is loaded with the plugin source marker.
    await expect(page.locator('script[src*="client.js?source=plugin"]')).toHaveCount(1);
  });

  test('toggles the panel when the Sidekick button is clicked', async ({ page }) => {
    await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await page.evaluate(() => {
      document.body.appendChild(document.createElement('aem-sidekick'));
    });
    await exposePlugin(page);
    await runLoadLazy(page);

    const dispatch = () => page.evaluate(() => {
      document.querySelector('aem-sidekick')
        .dispatchEvent(new CustomEvent('custom:aem-experimentation-sidekick'));
    });

    // First click loads the MFE and reveals the panel.
    await dispatch();
    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);

    // Second click hides it again.
    await dispatch();
    await expect(panel(page)).toHaveClass(/aemExperimentationHidden/);
  });

  test('wires the button via the sidekick-ready event when injected late', async ({ page }) => {
    await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await exposePlugin(page);
    // No Sidekick element present when loadLazy runs.
    await runLoadLazy(page);

    await page.evaluate(() => {
      document.body.appendChild(document.createElement('aem-sidekick'));
      document.dispatchEvent(new CustomEvent('sidekick-ready'));
    });
    await page.evaluate(() => {
      document.querySelector('aem-sidekick')
        .dispatchEvent(new CustomEvent('custom:aem-experimentation-sidekick'));
    });

    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);
  });

  test('answers the get-config handshake with the current hlx config', async ({ page }) => {
    await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await exposePlugin(page);
    await runLoadLazy(page, { prodHost: 'www.example.com' });

    const response = await page.evaluate(() => new Promise((resolve) => {
      window.hlx = { experiments: [], audiences: [], campaigns: [] };
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'hlx:experimentation-config') resolve(e.data);
      });
      window.postMessage({ type: 'hlx:experimentation-get-config' }, '*');
    }));

    expect(response.source).toBe('index-js');
    expect(response.config).toBeDefined();
    expect(response.config.experiments).toEqual([]);
    expect(response.config.prodHost).toBe('www.example.com');
  });

  test('answers the last-modified handshake', async ({ page }) => {
    await stubMfe(page);
    await page.route('**/lastmod-probe', (route) => route.fulfill({
      status: 200,
      headers: { 'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      contentType: 'text/plain',
      body: 'x',
    }));
    await page.goto('/tests/fixtures/global');
    await exposePlugin(page);
    await runLoadLazy(page);

    const response = await page.evaluate(() => new Promise((resolve) => {
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'hlx:last-modified-response') resolve(e.data);
      });
      window.postMessage({ type: 'hlx:last-modified-request', url: '/lastmod-probe' }, '*');
    }));

    expect(response.status).toBe(200);
    expect(response.lastModified).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(response.url).toBe('/lastmod-probe');
  });

  test('reloads and re-opens the panel after a variant switch', async ({ page }) => {
    await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await exposePlugin(page);
    await runLoadLazy(page);

    // The MFE asks the page to reload; the panel state is persisted across it.
    await Promise.all([
      page.waitForEvent('load'),
      page.evaluate(() => window.postMessage(
        { type: 'hlx:experimentation-window-reload', action: 'reload' },
        '*',
      )),
    ]);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), REOPEN_KEY)).toBe('true');

    // Running the lazy phase again after the reload re-opens the panel and clears the flag.
    await exposePlugin(page);
    await runLoadLazy(page);
    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), REOPEN_KEY)).toBeNull();
  });

  test('does not load the UI in production', async ({ page }) => {
    const wasRequested = await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await page.evaluate(() => {
      document.body.appendChild(document.createElement('aem-sidekick'));
    });
    await exposePlugin(page);
    // No isProd/prodHost override => 127.0.0.1 is treated as production.
    await runLoadLazy(page, {}, false);
    await page.evaluate(() => {
      document.querySelector('aem-sidekick')
        .dispatchEvent(new CustomEvent('custom:aem-experimentation-sidekick'));
    });

    await expect(panel(page)).toHaveCount(0);
    expect(wasRequested()).toBe(false);
  });

  test('does not load the UI when simulationUI is disabled', async ({ page }) => {
    const wasRequested = await stubMfe(page);
    await page.goto('/tests/fixtures/global?experiment=foo/challenger-1');
    await exposePlugin(page);
    await runLoadLazy(page, { simulationUI: false });

    await expect(panel(page)).toHaveCount(0);
    expect(wasRequested()).toBe(false);
  });

  test('stays out of the way in the Universal Editor', async ({ page }) => {
    const wasRequested = await stubMfe(page);
    await page.goto('/tests/fixtures/global?experiment=foo/challenger-1');
    await exposePlugin(page);
    await runLoadLazy(page, { simulationUI: 'universal-editor' });

    await expect(panel(page)).toHaveCount(0);
    expect(wasRequested()).toBe(false);
  });

  test('binds the Sidekick button only once across repeated loadLazy calls', async ({ page }) => {
    await stubMfe(page);
    await page.goto('/tests/fixtures/global');
    await page.evaluate(() => {
      document.body.appendChild(document.createElement('aem-sidekick'));
    });
    await exposePlugin(page);
    await runLoadLazy(page);
    // A second lazy phase (e.g. a client-side navigation) must be a no-op, not a
    // second binding — otherwise one click would toggle twice and appear dead.
    await runLoadLazy(page);

    await page.evaluate(() => {
      document.querySelector('aem-sidekick')
        .dispatchEvent(new CustomEvent('custom:aem-experimentation-sidekick'));
    });
    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);
  });

  test('retries loading the MFE after a transient script failure', async ({ page }) => {
    let calls = 0;
    await page.route(MFE_GLOB, async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.abort();
        return;
      }
      await route.fulfill({
        contentType: 'application/javascript',
        body: `(function () {
          var el = document.createElement('div');
          el.id = 'aemExperimentation';
          el.classList.add('aemExperimentationHidden');
          document.body.appendChild(el);
        })();`,
      });
    });
    await page.goto('/tests/fixtures/global');
    await page.evaluate(() => {
      document.body.appendChild(document.createElement('aem-sidekick'));
    });
    await exposePlugin(page);
    await runLoadLazy(page);

    const dispatch = () => page.evaluate(() => {
      document.querySelector('aem-sidekick')
        .dispatchEvent(new CustomEvent('custom:aem-experimentation-sidekick'));
    });

    // First click: the MFE request aborts, which resets the cached promise.
    await Promise.all([
      page.waitForEvent('requestfailed', (req) => req.url().includes('aem-experimentation-mfe')),
      dispatch(),
    ]);
    // Second click retries the load rather than staying permanently bricked.
    await dispatch();
    await expect(panel(page)).not.toHaveClass(/aemExperimentationHidden/);
    expect(calls).toBe(2);
  });
});
