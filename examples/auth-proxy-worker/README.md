# Reference auth-proxy worker

An edge worker that sits between the browser and a **bring-your-own decision
engine**, so the [`@adobe/aem-experimentation`](../../README.md) plugin can
*apply* an engine's decisions while the engine keeps ownership of segmentation,
bucketing and exposure. About 80% of a real BYO integration is this same glue,
so this is a template to adapt rather than rebuild.

```
browser ──► aem-experimentation (client)
                │  resolveAudiences / getAssignment
                ▼
        this worker (auth proxy)  ──►  your decision engine
        - hides the API key (server-side secret)
        - reads / mints the visitor id (first-party cookie)
        - normalizes the answer to the decision contract
```

## What it does

- **Hides the API key.** The key authenticates the call from the worker to your
  engine; it never reaches the browser and never appears in the response.
- **Reads or mints the visitor id** server-side, in a first-party `HttpOnly`
  cookie the client JS can't read.
- **Normalizes** the engine's answer into the versioned client ⇄ engine
  [decision contract](../../src/contract.js) (`{ version, audiences?,
  assignments?, decisions? }`).

## Files

| File | Role |
|---|---|
| `src/core.js` | Framework-neutral core (plain data in/out). Ports to any runtime. |
| `src/cloudflare.js` | Cloudflare Worker entry — a thin adapter over the core. |
| `src/engine-stub.js` | A deterministic fake engine so it runs standalone. |
| `wrangler.toml` | Cloudflare config. |

## Run it standalone

No engine or API key needed — it uses the bundled stub engine:

```bash
npm install
npx wrangler dev
```

Then POST a decision request:

```bash
curl -i http://localhost:8787 \
  -H 'content-type: application/json' \
  -d '{ "names": ["returning-visitor", "new-visitor"], "context": { "url": "https://example.com/", "consent": false } }'
```

You get a contract-shaped response and a `Set-Cookie: aemexp_vid=…` on the first
call:

```json
{ "version": "1", "audiences": { "returning-visitor": true, "new-visitor": false } }
```

## Wire it to your engine

Replace the stub in `src/engine-stub.js` with a call to your engine, mapping its
answer onto the contract shape:

```js
export async function engine({ visitorId, names, context, env }) {
  const resp = await fetch(env.ENGINE_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ENGINE_API_KEY}` },
    body: JSON.stringify({ visitorId, names, context }),
  });
  const data = await resp.json();
  return { audiences: data.segments }; // → { [name]: boolean }
}
```

Set the URL and secret (the secret is never committed):

```bash
wrangler secret put ENGINE_API_KEY
# and ENGINE_URL under [vars] in wrangler.toml
```

## Wire it to the client

Mount the worker on a route of **your own origin** (e.g. `/api/decide`) so the
visitor cookie stays first-party, then point the plugin's bundled resolver at
it:

```js
import { loadEager, createRemoteAudienceResolver } from '@adobe/aem-experimentation';

loadEager(document, {
  resolveAudiences: createRemoteAudienceResolver({ endpoint: '/api/decide' }),
  // rumTracking: 'off',   // if your engine fires exposure itself
});
```

`createRemoteAudienceResolver` sends `POST { names, context }`, memoizes one
request per page, and falls back to control on timeout or error. The worker's
response conforms to the [decision contract](../../src/contract.js), so any
conforming client works out of the box.

## Non-goals

This reference bundles no specific engine or vendor. The stub exists only so the
worker runs standalone; swap it for your engine.
