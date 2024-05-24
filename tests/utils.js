import { expect } from '@playwright/test';

async function waitForNamespace(page, namespace) {
  await expect(async () => {
    expect(await page.evaluate((ns) => window.hlx[ns], namespace)).toBeDefined();
  }).toPass();
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
