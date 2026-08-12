# Bring your own decision engine

The plugin is good at *deciding* experiences itself — random-split experiments,
audience and campaign resolution — and rendering them. Sometimes you want the
opposite: you already own a **decision engine** (an in-house
personalization/experimentation service, or a third party) and you want the
plugin to **apply** its decisions, while the engine keeps ownership of
segmentation, bucketing and exposure tracking.

A small set of **opt-in** config hooks make that "bring your own engine" (BYO)
path first-class. Every hook is a **no-op by default** — omit them and nothing
changes for a project that lets the plugin do the deciding.

```
browser ──► aem-experimentation (client)
                │  resolves "remote" audiences / assignments
                ▼
        edge worker (auth proxy)  ──►  your decision engine
        - hides the API key
        - reads / mints the visitor id (cookie)
        - normalizes the decision
```

A ready-to-adapt worker for that middle box lives in
[`examples/auth-proxy-worker`](../examples/auth-proxy-worker/README.md).

## The hooks at a glance

| Hook | Purpose |
|---|---|
| [`resolveAudiences(names, context)`](#resolveaudiences) | one batched, context-aware audience resolution |
| [`getAssignment(experimentId, context)`](#getassignment) | delegate the experiment split to your engine |
| [`rumTracking`](#rumtracking) | disable or delegate the built-in RUM exposure tracking |
| [`renderDecision(el, decision)`](#renderdecision) | apply a decision however it is shaped |
| [`listAudiences()`](#listaudiences) | advertise the audience universe to the simulation panel |

All are passed to `loadEager(document, options)`.

## The decision context

The batched hooks (`resolveAudiences`, `getAssignment`) receive a shared
`context`. The client fills what it knows authoritatively; your worker/engine
enriches the rest server-side:

```js
{
  url: 'https://example.com/pricing', // window.location.href
  consent: false,                      // whether experimentation consent is given
  // added server-side by the worker/engine:
  // visitorId: '…', // from the first-party cookie
  // geo: 'US',      // from the edge
}
```

## resolveAudiences

Resolve **every** configured audience in a single call with a shared context,
instead of an argument-less call per audience.

```js
loadEager(document, {
  resolveAudiences: async (names, context) => {
    // names: ['returning-visitor', 'high-value']
    // return { [name]: boolean } for the requested names
    const resp = await fetch('/api/decide', {
      method: 'POST',
      body: JSON.stringify({ names, context }),
    });
    const { audiences } = await resp.json();
    return audiences;
  },
});
```

- Called once per scope with the full set of requested names.
- The `?audience=…` forced audience (simulation) still wins.
- A rejection falls back to **control** (no audience resolved) rather than
  blocking render.
- It replaces the per-audience `audiences[key]()` path, and works even without a
  configured `audiences` map.

### Bundled helper: `createRemoteAudienceResolver`

Most integrations want the same thing: one memoized request per page, a timeout,
and a control fallback. That is bundled:

```js
import { loadEager, createRemoteAudienceResolver } from '@adobe/aem-experimentation';

loadEager(document, {
  resolveAudiences: createRemoteAudienceResolver({
    endpoint: '/api/decide', // POST { names, context }
    timeout: 1000,           // ms before serving control (default 1000)
  }),
});
```

It POSTs `{ names, context }`, memoizes one request per page, accepts the
contract envelope `{ audiences: { … } }` (or a bare map), and serves control on
timeout, rejection or a non-ok status.

## getAssignment

Let your engine own an experiment's arm — the plugin renders and reports the
variant but does **not** randomize.

```js
loadEager(document, {
  getAssignment: async (experimentId, context) => {
    const resp = await fetch('/api/decide', {
      method: 'POST',
      body: JSON.stringify({ experimentId, context }),
    });
    const { assignments } = await resp.json();
    return assignments[experimentId]; // e.g. 'challenger-1' | 'control'
  },
});
```

- A known variant is served as-is (no re-bucketing). Sticky assignment and
  exposure stay your engine's responsibility.
- A falsy answer or an error falls back to the plugin's own client-side
  bucketing (as if the hook were absent).
- An unknown variant serves **control** rather than re-randomizing.
- The `?experiment=<id>/<variant>` QA override still wins.

## rumTracking

The plugin fires its own RUM per decision. If your engine already fires exposure
server-side, opt out to avoid double counting — or delegate it to your own sink.

```js
loadEager(document, {
  rumTracking: 'off', // suppress the built-in RUM for all decision types
});

// …or delegate:
loadEager(document, {
  rumTracking: (event) => {
    // event: { type: 'experiment' | 'audience', source, target }
    myAnalytics.track('exposure', event);
  },
});
```

Unset keeps today's behavior. The plugin also emits `aem:experimentation` DOM
events per decision, which you can hook without an override; `rumTracking`
specifically governs the **built-in RUM**.

## renderDecision

Applying a decision defaults to *fetch URL → replace `innerHTML`*. Engines often
return JSON, content references or external-CMS ids instead. Provide
`renderDecision` to own application:

```js
loadEager(document, {
  renderDecision: async (el, decision) => {
    // decision: { type, scope, url, selector?, config }
    //   type:  'experiment' | 'campaign' | 'audience'
    //   scope: 'page' | 'section' | 'fragment'
    //   url:   the resolved experience URL / content reference
    el.innerHTML = await myRenderer(decision);
  },
});
```

Unset keeps the default fetch-and-replace. When provided, the hook receives the
resolved element and the normalized decision for every application (page,
section and fragment).

## listAudiences

The [simulation panel](../README.md#enabling-the-simulation-panel-aem-sidekick)
builds its audience switcher from the audiences registered on the page. A BYO
project registers a single generic remote resolver, so there is no exhaustive
list to enumerate. `listAudiences` advertises the engine's audience *universe*
at author time (this is **enumeration**, distinct from `resolveAudiences`, which
resolves *membership* for a visitor):

```js
loadEager(document, {
  listAudiences: async () => [
    { name: 'returning-visitor', label: 'Returning visitor' },
    { name: 'high-value' },
  ],
});
```

Preview/dev only, opt-in, and never fetched in production. It runs in the lazy
phase alongside the panel — never in the eager/LCP path — so it can't slow down
the page. The returned names are merged into `body[data-audiences]`, which the
panel enumerates from.

## The client ⇄ engine contract

The shapes exchanged between the client and the engine/worker are pinned down by
a small, **versioned** contract in [`src/contract.js`](../src/contract.js), with
dependency-free validators usable on both ends:

```js
{
  version: '1',
  audiences?:   { [name: string]: boolean },   // membership
  assignments?: { [experimentId: string]: string }, // variant per experiment
  decisions?:   { [selector: string]: { url? | content? | ref? } },
}
```

A response carries at least one facet. The reference worker emits this shape,
and `createRemoteAudienceResolver` consumes it — so any conforming worker/engine
works out of the box.

## The reference worker

[`examples/auth-proxy-worker`](../examples/auth-proxy-worker/README.md) is a
runnable edge worker that hides the engine API key, reads/mints the visitor-id
cookie, and returns a contract-conforming decision. It runs standalone against a
bundled stub engine (`npx wrangler dev`) and documents how to wire it to a real
engine and to the client resolver hook.

## Putting it together

```js
import { loadEager, createRemoteAudienceResolver } from '@adobe/aem-experimentation';

await loadEager(document, {
  // Resolve audiences through your engine (via the auth-proxy worker).
  resolveAudiences: createRemoteAudienceResolver({ endpoint: '/api/decide' }),
  // Let the engine own experiment assignment.
  getAssignment: async (experimentId, context) => {
    const resp = await fetch('/api/decide', {
      method: 'POST',
      body: JSON.stringify({ experimentId, context }),
    });
    return (await resp.json()).assignments?.[experimentId];
  },
  // The engine fires exposure itself.
  rumTracking: 'off',
});
```
