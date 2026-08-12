# RFC: First-class "bring your own decision engine" support

- **Status:** Draft / RFC (for discussion — not a merge-ready change)
- **Target branch:** `v2`
- **Related:** #63, #65 (merged — fix the two bugs below)

## Summary

Today the plugin is excellent at *deciding* experiences itself (random-split
experiments, audience/campaign resolution) and rendering them. A growing use
case is the opposite: a customer already owns a **decision engine** (an in-house
personalization/experimentation service, or a third party) and wants the plugin
to **apply** its decisions — while the engine keeps ownership of segmentation,
bucketing, and exposure tracking.

This RFC captures what a real "bring your own engine" (BYO) integration ran into,
proposes a small set of extension points to make BYO first-class, and suggests a
reference kit so customers don't hand-roll the same glue each time.

## Background: the integration we built

We wired a customer's decision engine to the plugin with this shape:

```
browser ──► aem-experimentation (client)
                │  resolves "remote" audiences / assignments
                ▼
        edge worker (auth proxy)  ──►  customer decision engine
        - hides the API key
        - reads the visitor id (cookie)
        - normalizes the decision
```

The **audience seam carried it**: every engine decision is modeled as an
async audience resolved through the worker, so the plugin applies the result
client-side. That part was clean. Two areas were not.

## What the current API made hard

### A. Bugs / footguns (contained)

1. **Single audience/campaign per selector crashes the manifest parsers.**
   `parseAudienceManifest` / `parseCampaignManifest` call `.forEach` on the
   aggregated value, but `aggregateEntries` only builds an array for a selector
   with *multiple* values — a single value stays a scalar, so `.forEach` throws
   and aborts `loadEager`. This is the *common* shape for BYO (one remote
   decision per slot). **Fixed in #63.**

2. **Multi-word audience/campaign names don't resolve at page level.**
   `getAllMetadata` camelCased metadata keys, so `audience-returning-visitor`
   became `returningVisitor`. Downstream, names are matched/looked up in
   class-name form, and `toClassName('returningVisitor')` → `returningvisitor`
   (the word boundary is lost) — which matched neither the `returning-visitor`
   project config key nor the camelCase one. The camelCasing is lossy, so it
   couldn't be fixed downstream; the fix belonged at the metadata reader
   (section- and fragment-level already keep class-name keys and work).
   **Fixed in #65:** `getAllMetadata` takes an optional key transform, and
   `applyAllModifications` passes `toClassName` for audience/campaign page
   metadata while experiments keep `toCamelCase` (config readers unchanged).
   Audiences and campaigns now read names by class-name at **every** level
   (page/section/fragment); experiments stay on `toCamelCase` deliberately —
   an experiment's name is a metadata *value*, not a key, and its multi-word
   *keys* (`startDate`, `requiresConsent`, …) are config props that need it.
   Folding all three behind a single normalized metadata read is the clean
   end-state — see the decision-provider convergence under **Decisions**.
   *(Removes the need for hyphen-free tokens like `ixptreatment` at page level.)*

### B. Design gaps (the actual BYO enablers)

3. **No batched decision resolver with a shared context.** Each audience is an
   independent, argument-less `options.audiences[key]()`, run in `Promise.all`.
   A remote engine wants **one** call per page with a shared context
   (`{ visitorId, url, consent, geo, … }`), then answers all audiences from it.
   We hand-rolled a memoized fetch to avoid N round trips. Proposed:
   ```js
   loadEager(document, {
     resolveAudiences: async (names, context) => { /* one call */ },
   });
   ```

4. **No external experiment assignment — the biggest gap.** Experiments
   self-bucket client-side (`ued.evaluateDecisionPolicy`); the only override is a
   `?experiment=id/variant` query param. There is no clean way to say *"the arm
   comes from my engine — don't randomize."* We could not use the experiment
   primitive at all and had to model BYO experiments as audiences/campaigns.
   Proposed: a pluggable assignment provider the engine owns, e.g.
   `getAssignment(experimentId, context) → variant`, with the plugin still
   rendering variants and reporting.

5. **No exposure/tracking override.** The plugin fires its own RUM per type with
   no opt-out. A BYO engine already fires exposure server-side, so you get
   double counting, and the inline reporting doesn't apply. Proposed:
   `rumTracking: 'off' | (event) => void`. (Custom tracking can also hook the
   `aem:experimentation` DOM events the plugin already emits per decision;
   `rumTracking` specifically governs the built-in RUM.)

6. **No pluggable decision renderer.** Application is fetch-URL-then-`innerHTML`
   with a fixed `main > div` fallback. Engines return JSON, content refs, or
   external-CMS ids. Proposed: `renderDecision(el, decision)` (e.g. json2html,
   external fetch) so every integrator doesn't re-implement the seam.

## Proposal (sketch, for discussion)

Add a small, optional set of config hooks — all no-ops by default, so nothing
changes for existing users:

| Hook | Purpose |
|---|---|
| `resolveAudiences(names, context)` | one batched, context-aware resolution |
| `getAssignment(experimentId, context)` | delegate the split to an external engine |
| `rumTracking` | disable or delegate the built-in RUM exposure tracking |
| `renderDecision(el, decision)` | pluggable application of a decision |

Plus a stable, versioned **client ⇄ engine contract** (the normalized decision
shapes) so any conforming worker/engine works out of the box.

## Reference kit (DX)

The highest-leverage deliverable is not the hooks — it's a template so customers
stop re-inventing the glue:

- **A reference auth-proxy worker** (Cloudflare + a framework-neutral core) that
  hides the key, reads/mints the visitor id, and returns the normalized
  decision. ~80% of a real integration is this.
- **A client helper** shipped in the plugin (a memoized remote-audience resolver
  with a timeout → control fallback) so integrators don't hand-roll it.
- **Contract tests** that validate the decision shapes on both ends via shared
  fixtures.

## Decisions

- **Converge on one decision provider.** Audiences, campaigns, and experiments
  resolve behind a single provider abstraction rather than three parallel
  mechanisms. This is also where the bug-#2 metadata-name normalization folds
  together cleanly for all three.
- **Reference worker lives in this repo under `examples/`** (for now).

## Open questions

- API surface + backward compatibility for the hooks.

## Non-goals

- Bundling any specific engine or vendor.
- Changing default behavior for projects that let the plugin do the deciding.
