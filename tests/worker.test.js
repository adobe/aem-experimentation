/* eslint-disable import/no-extraneous-dependencies, import/no-relative-packages */
// Intentionally reaches across into the in-repo reference worker (examples/) to
// prove its output conforms to the decision contract.
import { test, expect } from '@playwright/test';
import { handleDecisionRequest } from '../examples/auth-proxy-worker/src/core.js';
import { stubEngine } from '../examples/auth-proxy-worker/src/engine-stub.js';
import { isDecisionResponse, CONTRACT_VERSION } from '../src/contract.js';

// These run in Node (no browser page), exercising the reference worker's
// framework-neutral core directly.

test.describe('reference auth-proxy worker (#72)', () => {
  test('emits a contract-conforming decision response.', async () => {
    const res = await handleDecisionRequest({
      cookieHeader: '',
      payload: {
        names: ['returning-visitor', 'new-visitor'],
        context: { url: 'https://example.com/', consent: false },
      },
      engine: stubEngine,
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(CONTRACT_VERSION);
    expect(isDecisionResponse(res.body)).toBe(true);
    expect(Object.keys(res.body.audiences).sort()).toEqual(['new-visitor', 'returning-visitor']);
  });

  test('mints a visitor-id cookie when absent, reuses it when present.', async () => {
    const minted = await handleDecisionRequest({
      cookieHeader: '',
      payload: { names: ['a'] },
      engine: stubEngine,
    });
    expect(minted.headers['set-cookie']).toMatch(/^aemexp_vid=.+/);
    expect(minted.headers['set-cookie']).toContain('HttpOnly');

    const reused = await handleDecisionRequest({
      cookieHeader: 'aemexp_vid=fixed-visitor',
      payload: { names: ['a'] },
      engine: stubEngine,
    });
    // No new cookie is set when the visitor already has an id.
    expect(reused.headers['set-cookie']).toBeUndefined();
  });

  test('is deterministic per visitor (sticky membership).', async () => {
    const call = () => handleDecisionRequest({
      cookieHeader: 'aemexp_vid=v-42',
      payload: { names: ['seg-a', 'seg-b', 'seg-c'] },
      engine: stubEngine,
    });
    const a = await call();
    const b = await call();
    expect(a.body.audiences).toEqual(b.body.audiences);
  });

  test('receives the API key server-side but never leaks it to the client.', async () => {
    let sawKey = false;
    const engineWithKey = async (input) => {
      sawKey = input.env.ENGINE_API_KEY === 'super-secret';
      return stubEngine(input);
    };
    const res = await handleDecisionRequest({
      cookieHeader: '',
      payload: { names: ['a'] },
      engine: engineWithKey,
      env: { ENGINE_API_KEY: 'super-secret' },
    });
    expect(sawKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
    expect(JSON.stringify(res.headers)).not.toContain('super-secret');
  });

  test('forwards the visitor id into the engine context.', async () => {
    let receivedContext;
    const spyEngine = async (input) => {
      receivedContext = input.context;
      return stubEngine(input);
    };
    await handleDecisionRequest({
      cookieHeader: 'aemexp_vid=v-99',
      payload: { names: ['a'], context: { url: 'https://x/', consent: true } },
      engine: spyEngine,
    });
    expect(receivedContext).toMatchObject({
      url: 'https://x/',
      consent: true,
      visitorId: 'v-99',
    });
  });
});
