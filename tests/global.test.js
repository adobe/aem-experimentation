/* eslint-disable import/no-extraneous-dependencies */
import { test, expect } from '@playwright/test';
import { track } from './coverage.js';
import { goToAndRunAudience } from './utils.js';

track(test);

test.describe('Plugin config', () => {
  test('debug statements are shown in dev/stage');
  test('debug statements are not shown on prod');
  test('can use a custom trackingFunction instead of sampleRUM');
  test('can use a custom decoration callback to decorate the variants');
});
