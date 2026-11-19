/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/*
 * Cloudflare Worker entry. A thin adapter over the framework-neutral core in
 * ./core.js — it converts the runtime `Request` into plain data, calls the
 * core, and converts the descriptor back into a `Response`.
 *
 * Mount this on a route of your own site (e.g. `/api/decide`) so the visitor
 * cookie stays first-party. Run standalone with `npx wrangler dev`.
 */

import { handleDecisionRequest } from './core.js';
import { stubEngine } from './engine-stub.js';

// For a same-origin route no CORS is needed. These headers keep the standalone
// demo usable cross-origin; tighten `allow-origin` to your site in production.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    let payload = {};
    try {
      payload = await request.json();
    } catch (e) {
      return new Response('Bad Request', { status: 400, headers: CORS });
    }

    const result = await handleDecisionRequest({
      cookieHeader: request.headers.get('cookie') || '',
      payload,
      // Swap `stubEngine` for your engine call (see engine-stub.js).
      engine: stubEngine,
      env,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS, ...result.headers },
    });
  },
};
