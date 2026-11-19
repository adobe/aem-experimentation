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
 * Versioned client ⇄ engine decision contract.
 *
 * A "bring your own decision engine" integration exchanges decisions between the
 * client (this plugin, via its hooks) and an engine — usually through an
 * auth-proxy worker (see examples/). This module pins down the normalized shapes
 * so any conforming worker/engine works out of the box, and ships lightweight,
 * dependency-free validators usable on both ends (browser + edge/Node).
 *
 * The shapes are intentionally small and forward-compatible: unknown extra
 * fields are ignored, and a response only needs to carry the facets it answers.
 */

/** The contract version. Bump on a breaking change to the shapes below. */
export const CONTRACT_VERSION = '1';

/**
 * @typedef {Object} DecisionContext
 * The context the client sends with a decision request. The client fills what
 * it knows authoritatively (`url`, `consent`); a worker/engine enriches the rest
 * server-side (`visitorId` from the cookie, `geo` from the edge).
 * @property {string} url the current page URL (`window.location.href`)
 * @property {boolean} consent whether experimentation consent is given
 * @property {string} [visitorId] engine visitor id (added server-side)
 * @property {string} [geo] coarse geo (added at the edge)
 */

/**
 * @typedef {Object.<string, boolean>} AudienceResolution
 * Membership per requested audience name, e.g. `{ 'returning-visitor': true }`.
 */

/**
 * @typedef {Object.<string, string>} ExperimentAssignment
 * The assigned variant per experiment id, e.g. `{ 'hero-test': 'challenger-1' }`.
 */

/**
 * @typedef {Object} RenderedDecision
 * How to apply a decision for a slot. At least one of the fields is present.
 * @property {string} [url] a content URL to fetch and apply
 * @property {string} [content] inline markup to apply
 * @property {string} [ref] an external reference / CMS id to resolve
 */

/**
 * @typedef {Object} DecisionResponse
 * The normalized envelope a worker/engine returns. A response carries at least
 * one facet (audiences, assignments, or decisions).
 * @property {string} [version] the contract version (defaults to `CONTRACT_VERSION`)
 * @property {AudienceResolution} [audiences]
 * @property {ExperimentAssignment} [assignments]
 * @property {Object.<string, RenderedDecision>} [decisions] keyed by selector
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} ctx
 * @returns {boolean} whether `ctx` is a valid {@link DecisionContext}
 */
export function isDecisionContext(ctx) {
  return isPlainObject(ctx)
    && typeof ctx.url === 'string'
    && typeof ctx.consent === 'boolean'
    && (ctx.visitorId === undefined || typeof ctx.visitorId === 'string')
    && (ctx.geo === undefined || typeof ctx.geo === 'string');
}

/**
 * @param {*} map
 * @returns {boolean} whether `map` is a valid {@link AudienceResolution}
 */
export function isAudienceResolution(map) {
  return isPlainObject(map)
    && Object.values(map).every((v) => typeof v === 'boolean');
}

/**
 * @param {*} map
 * @returns {boolean} whether `map` is a valid {@link ExperimentAssignment}
 */
export function isExperimentAssignment(map) {
  return isPlainObject(map)
    && Object.values(map).every((v) => typeof v === 'string');
}

/**
 * @param {*} decision
 * @returns {boolean} whether `decision` is a valid {@link RenderedDecision}
 */
export function isRenderedDecision(decision) {
  return isPlainObject(decision)
    && (typeof decision.url === 'string'
      || typeof decision.content === 'string'
      || typeof decision.ref === 'string');
}

/**
 * Validates a full {@link DecisionResponse} envelope.
 * @param {*} res
 * @returns {boolean} whether `res` conforms to the contract
 */
export function isDecisionResponse(res) {
  if (!isPlainObject(res)) {
    return false;
  }
  if (res.version !== undefined && res.version !== CONTRACT_VERSION) {
    return false;
  }
  if (res.audiences !== undefined && !isAudienceResolution(res.audiences)) {
    return false;
  }
  if (res.assignments !== undefined && !isExperimentAssignment(res.assignments)) {
    return false;
  }
  if (res.decisions !== undefined) {
    if (!isPlainObject(res.decisions)
      || !Object.values(res.decisions).every(isRenderedDecision)) {
      return false;
    }
  }
  // A response must answer at least one facet.
  return res.audiences !== undefined
    || res.assignments !== undefined
    || res.decisions !== undefined;
}
