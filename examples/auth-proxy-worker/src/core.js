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
 * Framework-neutral core for the reference auth-proxy worker.
 *
 * Given the client's decision request and the environment (secrets, engine
 * URL), it:
 *   1. reads or mints the visitor id (server-side, from a cookie),
 *   2. calls the decision engine with the server-side API key,
 *   3. normalizes the engine's answer into the versioned client ⇄ engine
 *      contract (see src/contract.js in the plugin repo).
 *
 * It deals only in plain data (no runtime `Request`/`Response`), so it ports to
 * any runtime — the Cloudflare entry in ./cloudflare.js adapts it. ~80% of a
 * real integration is this glue; swap `engine` for a fetch to your engine.
 */

// Keep in sync with CONTRACT_VERSION in the plugin's src/contract.js.
export const CONTRACT_VERSION = '1';

/** The first-party cookie the worker uses to keep a stable visitor id. */
export const VISITOR_COOKIE = 'aemexp_vid';

/**
 * Parses a `Cookie` header into a plain object.
 * @param {string} cookieHeader
 * @returns {Object.<string, string>}
 */
export function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key) {
        acc[key] = decodeURIComponent(value);
      }
    }
    return acc;
  }, {});
}

/**
 * Reads the visitor id from the cookie header, or mints a new one server-side.
 * @param {string} cookieHeader
 * @returns {{ visitorId: string, minted: boolean }}
 */
export function readOrMintVisitorId(cookieHeader) {
  const existing = parseCookies(cookieHeader)[VISITOR_COOKIE];
  if (existing) {
    return { visitorId: existing, minted: false };
  }
  return { visitorId: crypto.randomUUID(), minted: true };
}

/**
 * Handles a decision request end to end and returns a framework-neutral
 * response descriptor (`{ status, headers, body }`).
 *
 * @param {Object} args
 * @param {string} [args.cookieHeader] the incoming `Cookie` header
 * @param {Object} [args.payload] the parsed request body (`{ names, context }`)
 * @param {Function} args.engine `(input) => { audiences?, assignments?, decisions? }`
 *   — the decision engine. In production this is a fetch to your engine using
 *   the server-side API key; the bundled stub lets it run standalone.
 * @param {Object} [args.env] runtime env / secrets (never sent to the client)
 * @returns {Promise<{ status: number, headers: Object, body: Object }>}
 */
export async function handleDecisionRequest({
  cookieHeader = '',
  payload = {},
  engine,
  env = {},
}) {
  const { visitorId, minted } = readOrMintVisitorId(cookieHeader);
  const names = Array.isArray(payload.names) ? payload.names : [];
  // Enrich the client context with what only the server knows (the visitor id).
  const context = { ...(payload.context || {}), visitorId };

  // The API key authenticates the call to the engine; it never leaves the
  // server and never appears in the response we hand back to the browser.
  const answer = (await engine({
    visitorId, names, context, env,
  })) || {};

  const body = { version: CONTRACT_VERSION };
  if (answer.audiences) {
    body.audiences = answer.audiences;
  }
  if (answer.assignments) {
    body.assignments = answer.assignments;
  }
  if (answer.decisions) {
    body.decisions = answer.decisions;
  }

  const headers = { 'content-type': 'application/json' };
  if (minted) {
    // First-party, HttpOnly so the id is never readable from client JS.
    headers['set-cookie'] = `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;
  }
  return { status: 200, headers, body };
}
