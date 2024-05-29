import { expect } from '@playwright/test';

async function waitForNamespace(page, namespace) {
  await expect(async () => {
    expect(await page.evaluate((ns) => window.hlx[ns], namespace)).toBeDefined();
  }).toPass();
  // Wait for the fragments to decorate
  await new Promise((res) => { setTimeout(res); });
}

export async function goToAndRunAudience(page, url) {
  await page.goto(url);
  await waitForNamespace(page, 'audiences');
}

export async function goToAndRunCampaign(page, url) {
  await page.goto(url);
  await waitForNamespace(page, 'campaigns');
}

export async function goToAndRunExperiment(page, url) {
  await page.goto(url);
  await waitForNamespace(page, 'experiments');
}

export async function waitForDomEvent(page, eventName) {
  return page.evaluate((name) => new Promise((resolve) => {
    document.addEventListener(name, (ev) => resolve(ev.detail));
  }), eventName);
}
