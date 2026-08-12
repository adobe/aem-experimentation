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
 * A deterministic, dependency-free fake engine so the reference worker runs
 * standalone — no real engine and no API key required. Membership is stable per
 * visitor (sticky), which is what a real engine guarantees too.
 *
 * Replace this with a fetch to your engine, e.g.:
 *
 *   export async function engine({ visitorId, names, context, env }) {
 *     const resp = await fetch(env.ENGINE_URL, {
 *       method: 'POST',
 *       headers: { authorization: `Bearer ${env.ENGINE_API_KEY}` },
 *       body: JSON.stringify({ visitorId, names, context }),
 *     });
 *     const data = await resp.json();
 *     return { audiences: data.segments }; // map to the contract shape
 *   }
 */

/** Stable 0..1 hash of a string (FNV-1a). */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Resolves audience membership deterministically per visitor + audience name.
 * @param {Object} input
 * @param {string} input.visitorId
 * @param {string[]} input.names
 * @returns {{ audiences: Object.<string, boolean> }}
 */
export async function stubEngine({ visitorId, names }) {
  const audiences = {};
  names.forEach((name) => {
    audiences[name] = hash01(`${visitorId}:${name}`) < 0.5;
  });
  return { audiences };
}
