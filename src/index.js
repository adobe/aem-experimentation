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


let isDebugEnabled;
function setDebugMode(url, pluginOptions) {
  const { host, hostname, origin } = url;
  const { isProd, prodHost } = pluginOptions;
  isDebugEnabled = (url.hostname === 'localhost'
    || url.hostname.endsWith('.page')
    || (typeof isProd === 'function' && !isProd())
    || (prodHost && ![host, hostname, origin].includes(prodHost))
    || false);
  return isDebugEnabled;
}

function debug(...args) {
  if (isDebugEnabled) {
    // eslint-disable-next-line no-console
    console.debug.call(this, '[aem-experimentation]', ...args);
  }
}

const DEFAULT_OPTIONS = {

  // Audiences related properties
  audiences: {},
  audiencesMetaTagPrefix: 'audience',
  audiencesQueryParameter: 'audience',

  // Campaigns related properties
  campaignsMetaTagPrefix: 'campaign',
  campaignsQueryParameter: 'campaign',

  // Experimentation related properties
  experimentsMetaTagPrefix: 'experiment',
  experimentsQueryParameter: 'experiment',

  // Redecoration function for fragments
  decorateFunction: () => {},
};

/**
 * Converts a given comma-seperate string to an array.
 * @param {String|String[]} str The string to convert
 * @returns an array representing the converted string
 */
function stringToArray(str) {
  if (Array.isArray(str)) {
    return str;
  }
  return str ? str.split(/[,\n]/).filter((s) => s.trim()) : [];
}

/**
 * Sanitizes a name for use as class name.
 * @param {String} name The unsanitized name
 * @returns {String} The class name
 */
function toClassName(name) {
  return typeof name === 'string'
    ? name.toLowerCase().replace(/[^0-9a-z]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : '';
}

/**
 * Fires a Real User Monitoring (RUM) event based on the provided type and configuration.
 * @param {string} type - the type of event to be fired ("experiment", "campaign", or "audience")
 * @param {Object} config - contains details about the experience
 * @param {Object} pluginOptions - default plugin options with custom options
 * @param {string} result - the URL of the served experience.
 */
function fireRUM(type, config, pluginOptions, result) {
  const { selectedCampaign = 'default', selectedAudience = 'default' } = config;

  const typeHandlers = {
    experiment: () => ({
      source: config.id,
      target: result ? config.selectedVariant : config.variantNames[0],
    }),
    campaign: () => ({
      source: result ? toClassName(selectedCampaign) : 'default',
      target: Object.keys(pluginOptions.audiences).join(':'),
    }),
    audience: () => ({
      source: result ? toClassName(selectedAudience) : 'default',
      target: Object.keys(pluginOptions.audiences).join(':'),
    }),
  };

  const { source, target } = typeHandlers[type]();
  const rumType = type === 'experiment' ? 'experiment' : 'audience';
  window.hlx?.rum?.sampleRUM(rumType, { source, target });
}

/**
 * Sanitizes a name for use as a js property name.
 * @param {String} name The unsanitized name
 * @returns {String} The camelCased name
 */
function toCamelCase(name) {
  return toClassName(name).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

/**
 * Removes all leading hyphens from a string.
 * @param {String} after the string to remove the leading hyphens from, usually is colon
 * @returns {String} The string without leading hyphens
 */
function removeLeadingHyphens(inputString) {
  // Remove all leading hyphens which are converted from the space in metadata
  return inputString.replace(/^(-+)/, '');
}

/**
 * Retrieves the content of metadata tags.
 * @param {String} name The metadata name (or property)
 * @returns {String} The metadata value(s)
 */
function getMetadata(name) {
  const meta = [...document.body.querySelectorAll(`meta[name="${name}"]`)].map((m) => m.content).join(', ');
  return meta || '';
}

/**
 * Gets all the metadata elements that are in the given scope.
 * @param {String} scope The scope/prefix for the metadata
 * @returns a map of key/value pairs for the given scope
 */
function getAllMetadata(scope) {
  const value = getMetadata(scope);
  const metaTags = document.body.querySelectorAll(`meta[name^="${scope}"], meta[property^="${scope}:"]`);
  return [...metaTags].reduce((res, meta) => {
    const key = removeLeadingHyphens(
      meta.getAttribute('name')
        ? meta.getAttribute('name').substring(scope.length)
        : meta.getAttribute('property').substring(scope.length + 1),
    );

    const camelCaseKey = toCamelCase(key);
    res[camelCaseKey] = meta.getAttribute('content');
    return res;
  }, value ? { value } : {});
}

  /**
 * Gets all the data attributes that are in the given scope.
 * @param {String} scope The scope/prefix for the metadata
 * @returns a map of key/value pairs for the given scope
 */
// eslint-disable-next-line no-unused-vars
async function getAllDataAttributes(document, scope) {
  if (document.readyState === 'loading') {
    return new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', () => {
        resolve(getAllDataAttributes(document, scope));
      });
    });
  }

  const results = [];
  const components = Array.from(document.querySelectorAll('*')).filter(element =>
    Array.from(element.attributes).some(attr => attr.name.startsWith(`data-${scope}-`))
  );

  components.forEach(component => {
    const obj = {};

    Array.from(component.attributes).forEach(attribute => {
      if (attribute.name.startsWith(`data-${scope}-`)) {
        obj[attribute.name.replace(`data-${scope}-`, '')] = attribute.value;
      } else if (attribute.name === `data-${scope}`) {
        obj['value'] = attribute.value;
      }
    });
    
    obj['selector'] = Array.from(component.classList).map(cls => `.${cls}`).join('');

    results.push(obj);
  });
  return results;
}  

/**
 * Gets all the query parameters that are in the given scope.
 * @param {String} scope The scope/prefix for the metadata
 * @returns a map of key/value pairs for the given scope
 */
function getAllQueryParameters(scope) {
  const usp = new URLSearchParams(window.location.search);
  return [...usp.entries()]
    .filter(([param]) => param === scope || param.startsWith(`${scope}-`))
    .reduce((res, [param, value]) => {
      const key = param === scope ? 'value' : param.replace(`${scope}-`, '');
      if (res[key]) {
        res[key] = [].concat(res[key], value);
      } else {
        res[key] = value;
      }
      return res;
    }, {});
}

/**
 * Extracts the config from a block that is in the given scope.
 * @param {HTMLElement} block The block element
 * @returns a map of key/value pairs for the given scope
 */
// eslint-disable-next-line import/prefer-default-export
function getAllSectionMeta(block, scope) {
  const config = {};
  block.querySelectorAll(':scope > div').forEach((row) => {
    if (row.children) {
      const cols = [...row.children];
      if (cols[1]) {
        const col = cols[1];
        let key = toClassName(cols[0].textContent);
        if (key !== scope && !key.startsWith(`${scope}-`)) {
          return;
        }
        key = key === scope ? 'value' : key.replace(`${scope}-`, '');
        let value = '';
        if (col.querySelector('a')) {
          const as = [...col.querySelectorAll('a')];
          if (as.length === 1) {
            value = as[0].href;
          } else {
            value = as.map((a) => a.href);
          }
        } else if (col.querySelector('p')) {
          const ps = [...col.querySelectorAll('p')];
          if (ps.length === 1) {
            value = ps[0].textContent;
          } else {
            value = ps.map((p) => p.textContent);
          }
        } else value = row.children[1].textContent;
        config[key] = value;
      }
    }
  });
  return config;
}

/**
 * Replaces element with content from path
 * @param {String} path
 * @param {HTMLElement} el
 * @return Returns the path that was loaded or null if the loading failed
 */
async function replaceInner(path, el, selector) {
  try {
    const resp = await fetch(path);
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      return null;
    }
    const html = await resp.text();
    // parse with DOMParser to guarantee valid HTML, and no script execution(s)
    const dom = new DOMParser().parseFromString(html, 'text/html');
    // eslint-disable-next-line no-param-reassign
    let newEl;
    if (selector) {
      newEl = dom.querySelector(selector);
    }
    if (!newEl) {
      newEl = dom.querySelector(el.tagName === 'MAIN' ? 'main' : 'main > div');
    }
    el.innerHTML = newEl.innerHTML;
    return path;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`error loading content: ${path}`, e);
  }
  return null;
}

/**
 * Checks if any of the configured audiences on the page can be resolved.
 * @param {String[]} pageAudiences a list of configured audiences for the page
 * @param {Object} options the plugin options
 * @returns Returns the names of the resolved audiences, or `null` if no audience is configured
 */
async function getResolvedAudiences(pageAudiences, options) {
  if (!pageAudiences.length || !Object.keys(options.audiences).length) {
    return null;
  }
  // If we have a forced audience set in the query parameters (typically for simulation purposes)
  // we check if it is applicable
  const usp = new URLSearchParams(window.location.search);
  const forcedAudience = usp.has(options.audiencesQueryParameter)
    ? toClassName(usp.get(options.audiencesQueryParameter))
    : null;
  if (forcedAudience) {
    return pageAudiences.includes(forcedAudience) ? [forcedAudience] : [];
  }

  // Otherwise, return the list of audiences that are resolved on the page
  const results = await Promise.all(
    pageAudiences
      .map((key) => {
        if (options.audiences[key] && typeof options.audiences[key] === 'function') {
          return options.audiences[key]();
        }
        return false;
      }),
  );
  return pageAudiences.filter((_, i) => results[i]);
}

/**
 * Calculates percentage split for variants where the percentage split is not
 * explicitly configured.
 * Substracts from 100 the explicitly configured percentage splits,
 * and divides the remaining percentage, among the variants without explicit
 * percentage split configured
 * @param {Array} variant objects
 */
function inferEmptyPercentageSplits(variants) {
  const variantsWithoutPercentage = [];

  const remainingPercentage = variants.reduce((result, variant) => {
    if (!variant.percentageSplit) {
      variantsWithoutPercentage.push(variant);
    }
    const newResult = result - parseFloat(variant.percentageSplit || 0);
    return newResult;
  }, 1);
  if (variantsWithoutPercentage.length) {
    const missingPercentage = remainingPercentage / variantsWithoutPercentage.length;
    variantsWithoutPercentage.forEach((v) => {
      v.percentageSplit = missingPercentage.toFixed(4);
    });
  }
}

/**
 * Converts the experiment config to a decision policy
 * @param {Object} config The experiment config
 * @returns a decision policy for the experiment config
 */
function toDecisionPolicy(config) {
  const decisionPolicy = {
    id: 'content-experimentation-policy',
    rootDecisionNodeId: 'n1',
    decisionNodes: [{
      id: 'n1',
      type: 'EXPERIMENTATION',
      experiment: {
        id: config.id,
        identityNamespace: 'ECID',
        randomizationUnit: 'DEVICE',
        treatments: Object.entries(config.variants).map(([key, props]) => ({
          id: key,
          allocationPercentage: Number(props.percentageSplit) * 100,
        })),
      },
    }],
  };
  return decisionPolicy;
}

/**
 * Creates an instance of a modification handler that will be responsible for applying the desired
 * personalized experience.
 *
 * @param {String} type The type of modifications to apply
 * @param {Object} overrides The config overrides
 * @param {Function} metadataToConfig a function that will handle the parsing of the metadata
 * @param {Function} getExperienceUrl a function that returns the URL to the experience
 * @param {Object} pluginOptions the plugin options
 * @param {Function} cb the callback to handle the final steps
 * @returns the modification handler
 */
function createModificationsHandler(
  type,
  overrides,
  metadataToConfig,
  getExperienceUrl,
  pluginOptions,
  cb,
) {
  return async (el, metadata) => {
    const config = await metadataToConfig(pluginOptions, metadata, overrides);
    if (!config) {
      return null;
    }
    const ns = { config, el };
    const url = await getExperienceUrl(ns.config);
    let res;
    if (url && new URL(url, window.location.origin).pathname !== window.location.pathname) {
      if (toClassName(metadata?.resolution) === 'redirect') {
        // Firing RUM event early since redirection will stop the rest of the JS execution
        fireRUM(type, config, pluginOptions, url);
        window.location.replace(url);
        // eslint-disable-next-line consistent-return
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      res = await replaceInner(new URL(url, window.location.origin).pathname, el);
    } else {
      res = url;
    }
   // cb(el.tagName === 'MAIN' ? document.body : ns.el, ns.config, res ? url : null);
    if (res) {
      ns.servedExperience = url;
    }
    return ns;
  };
}

/**
 * Rename plural properties on the object to singular.
 * @param {Object} obj The object
 * @param {String[]} props The properties to rename.
 * @returns the object with plural properties renamed.
 */
function depluralizeProps(obj, props = []) {
  props.forEach((prop) => {
    if (obj[`${prop}s`]) {
      obj[prop] = obj[`${prop}s`];
      delete obj[`${prop}s`];
    }
  });
  return obj;
}

/**
 * Fetch the configuration entries from a JSON manifest.
 * @param {String} urlString the URL to load
 * @returns the list of entries that apply to the current page
 */
async function getManifestEntriesForCurrentPage(urlString) {
  try {
    const url = new URL(urlString, window.location.origin);
    const response = await fetch(url.pathname);
    const json = await response.json();
    return json.data
      .map((entry) => Object.keys(entry).reduce((res, k) => {
        res[k.toLowerCase()] = entry[k];
        return res;
      }, {}))
      .filter((entry) => (!entry.page && !entry.pages)
        || entry.page === window.location.pathname
        || entry.pages === window.location.pathname)
      .filter((entry) => entry.selector || entry.selectors)
      .filter((entry) => entry.url || entry.urls)
      .map((entry) => depluralizeProps(entry, ['page', 'selector', 'url']));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Cannot apply manifest: ', urlString, err);
  }
  return null;
}

/**
 * Watches the page for injected DOM elements and automatically applies the fragment customizations
 */
function watchMutationsAndApplyFragments(
  ns,
  scope,
  entries,
  aggregator,
  getExperienceUrl,
  pluginOptions,
  metadataToConfig,
  overrides,
  cb,
) {
  if (!entries.length) {
    return;
  }

  new MutationObserver(async (_, observer) => {
    for (const entry of entries) {
      // eslint-disable-next-line no-await-in-loop
      const config = await metadataToConfig(pluginOptions, entry, overrides);
      if (!config || entry.isApplied) {
        return;
      }
      const el = scope.querySelector(entry.selector);

      if (!el) {
        return;
      }
      entry.isApplied = true;
      const fragmentNS = { config, el, type: 'fragment' };
      // eslint-disable-next-line no-await-in-loop
      const url = await getExperienceUrl(fragmentNS.config);
      let res;
      if (url && new URL(url, window.location.origin).pathname !== window.location.pathname) {
        // eslint-disable-next-line no-await-in-loop
        res = await replaceInner(new URL(url, window.location.origin).pathname, el, entry.selector);
        // eslint-disable-next-line no-await-in-loop
        await pluginOptions.decorateFunction(el);
      } else {
        res = url;
      }
      cb(el.tagName === 'MAIN' ? document.body : fragmentNS.el, fragmentNS.config, res ? url : null);
      if (res) {
        fragmentNS.servedExperience = url;
      }
      debug('fragment', ns, fragmentNS);
      aggregator.push(fragmentNS);
    }
    if (entries.every((entry) => entry.isApplied)) {
      observer.disconnect();
    }
  }).observe(scope, { childList: true, subtree: true });
}

/**
 * Apply the page modifications for the specified type.
 *
 * @param {String} ns the type of modifications to do
 * @param {String} paramNS the query parameter namespace
 * @param {Object} pluginOptions the plugin options
 * @param {Function} metadataToConfig a function that will handle the parsing of the metadata
 * @param {Function} manifestToConfig a function that will handle the parsing of the manifest
 * @param {Function} getExperienceUrl a function that returns the URL to the experience
 * @param {Function} cb the callback to handle the final steps
 * @returns an object containing the details of the page modifications that where applied
 */
async function applyAllModifications(
  type,
  paramNS,
  pluginOptions,
  metadataToConfig,
  dataAttributeToConfig,
  getExperienceUrl,
  cb,
) {

  const configs = [];

  let dataList = await getAllDataAttributes(document, type);
  console.log("xinyiyyyyydocument,tyle", document, type);
  // dataList = dataList.slice(1,2);
    // Fragment-level modifications
  if (dataList.length) {
    console.log("111111xinyidataList", dataList);
    const entries = dataAttributeToConfig(dataList);
    console.log("111111xinyientries", entries);
    watchMutationsAndApplyFragments(
    type,
    document.body,
    entries,
    configs,
    getExperienceUrl,
    pluginOptions,
    metadataToConfig,
    getAllQueryParameters(paramNS),
    cb,
    );
  }

  return configs;
}

function aggregateEntries(type, allowedMultiValuesProperties) {
  return (entries) => entries.reduce((aggregator, entry) => {
    Object.entries(entry).forEach(([key, value]) => {
      if (!aggregator[key]) {
        aggregator[key] = value;
      } else if (aggregator[key] !== value) {
        if (allowedMultiValuesProperties.includes(key)) {
          aggregator[key] = [].concat(aggregator[key], value);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`Key "${key}" in the ${type} manifest must be the same for every variant on the page.`);
        }
      }
    });
    return aggregator;
  }, {});
}

let experimentCounter = 0;
/**
 * Parses the experiment configuration from the metadata
 */
async function getExperimentConfig(pluginOptions, metadata, overrides) {
  // Generate a unique ID for each experiment instance
  const baseId = toClassName(metadata.value || metadata.experiment);
  if (!baseId) {
    return null;
  }
  
  // Append a unique suffix to the base ID
  const id = `${baseId}-${experimentCounter++}`; 

  let pages = metadata.variants || metadata.url;

  // Backward compatibility
  if (!pages) {
    pages = getMetadata('instant-experiment');
  }
  if (metadata.audience) {
    metadata.audiences = metadata.audience;
  }

  const nbOfVariants = Number(pages);
  pages = Number.isNaN(nbOfVariants)
    ? stringToArray(pages).map((p) => new URL(p.trim(), window.location).pathname)
    : new Array(nbOfVariants).fill(window.location.pathname);
  if (!pages.length) {
    return null;
  }

  const audiences = stringToArray(metadata.audiences).map(toClassName);

  const splits = metadata.split
    // custom split
    ? stringToArray(metadata.split).map((i) => parseFloat(i) / 100)
    // even split
    : [...new Array(pages.length)].map(() => 1 / (pages.length + 1));


  const variantNames = [];
  variantNames.push('control');

  const variants = {};
  variants.control = {
    percentageSplit: '',
    pages: [window.location.pathname],
    label: 'Control',
  };

  // get the customized name for the variant in page metadata and manifest
  const labelNames = stringToArray(metadata.name)?.length
    ? stringToArray(metadata.name)
    : stringToArray(depluralizeProps(metadata, ['variantName']).variantName);

  pages.forEach((page, i) => {
    const vname = `challenger-${i + 1}`;
    //  label with custom name or default
    const customLabel = labelNames.length > i ? labelNames[i] : `Challenger ${i + 1}`;

    variantNames.push(vname);
    variants[vname] = {
      percentageSplit: `${splits[i].toFixed(4)}`,
      pages: [page],
      blocks: [],
      label: customLabel,
    };
  });
  inferEmptyPercentageSplits(Object.values(variants));

  const resolvedAudiences = await getResolvedAudiences(
    audiences,
    pluginOptions,
  );

  const startDate = metadata.startDate ? new Date(metadata.startDate) : null;
  const endDate = metadata.endDate ? new Date(metadata.endDate) : null;

  const config = {
    id,
    label: `Experiment ${metadata.value || metadata.experiment}`,
    status: metadata.status || 'active',
    audiences,
    endDate,
    resolvedAudiences,
    startDate,
    variants,
    variantNames,
  };

  config.run = (
    // experiment is active or forced
    (['active', 'on', 'true'].includes(toClassName(config.status)) || overrides.value)
    // experiment has resolved audiences if configured
    && (!resolvedAudiences || resolvedAudiences.length)
    // forced audience resolves if defined
    && (!overrides.audience || audiences.includes(overrides.audience))
    && (!startDate || startDate <= Date.now())
    && (!endDate || endDate > Date.now())
  );

  if (!config.run) {
    return config;
  }

  const [, forcedVariant] = (Array.isArray(overrides.value)
    ? overrides.value
    : stringToArray(overrides.value))
    .map((value) => value?.split('/'))
    .find(([experiment]) => toClassName(experiment) === config.id) || [];
  if (variantNames.includes(toClassName(forcedVariant))) {
    config.selectedVariant = toClassName(forcedVariant);
  } else if (overrides.variant && variantNames.includes(overrides.variant)) {
    config.selectedVariant = toClassName(overrides.variant);
  } else {
    // eslint-disable-next-line import/extensions
    //const { ued } = await import('http://localhost:4502/apps/wknd/clientlibs/clientlib-experimentation/js/ued.js');
    //const decision = ued.evaluateDecisionPolicy(toDecisionPolicy(config), {});
    //config.selectedVariant = decision.items[0].id;
      config.selectedVariant = "control";
  }

  return config;
}

/**
 * Parses the campaign manifest.
 */
function parseExperimentManifest(rawEntries) {
  const entries = [];
  for (const entry of rawEntries) {
    const experiment = entry['value'];
    const urls = entry['variant'].split(',').map((url) => url.trim());
    const length = urls.length;
    const vnames = Array.from({ length }, (_, i) => `challenger-${i + 1}`);

    let customLabels = (entry['name']||'').split(',').map((url) => url.trim());
    const labels = Array.from({ length }, (_, i) => customLabels[i] || `Challenger ${i + 1}`);
    const selector = entry['selector'];
    const page = window.location.pathname;
    
    //split
    const split = entry['split'] 
    ? entry['split'].split(',').map((i) => parseFloat(i))
    : Array.from({ length }, () => 1 / length); 

    //status
    const status = entry['status'];

    //date
    const startDate = entry['start-date'] ? new Date(entry['start-date']) : null;
    const endDate = entry['end-date'] ? new Date(entry['end-date']) : null;

    //audience
    const audience = entry['audience'].split(',').map((url) => url.trim());
    
    const entryC = {
      audience,
      startDate,
      endDate,
      status,
      split,
      experiment,
      name: labels,
      variant:vnames,
      selector,
      url: urls,
      page
    };

    entries.push(entryC);
  }
  console.log("entries", entries);
  return entries;  
}

function getUrlFromExperimentConfig(config) {
  return config.run
    ? config.variants[config.selectedVariant].pages[0]
    : null;
}

async function runExperiment(document, pluginOptions) {
  return applyAllModifications(
    pluginOptions.experimentsMetaTagPrefix,
    pluginOptions.experimentsQueryParameter,
    pluginOptions,
    getExperimentConfig,
    parseExperimentManifest,
    getUrlFromExperimentConfig,
    (el, config, result) => {
      fireRUM('experiment', config, pluginOptions, result);
      // dispatch event
      const { id, selectedVariant, variantNames } = config;
      const variant = result ? selectedVariant : variantNames[0];
      el.dataset.experiment = id;
      el.dataset.variant = variant;
      el.classList.add(`experiment-${toClassName(id)}`);
      el.classList.add(`variant-${toClassName(variant)}`);
      document.dispatchEvent(new CustomEvent('aem:experimentation', {
        detail: {
          element: el,
          type: 'experiment',
          experiment: id,
          variant,
        },
      }));
    },
  );
}

/**
 * Parses the campaign configuration from the metadata
 */
async function getCampaignConfig(pluginOptions, metadata, overrides) {
  if (!Object.keys(metadata).length || (Object.keys(metadata).length === 1 && metadata.manifest)) {
    return null;
  }

  // Check UTM parameters
  let campaign = overrides.value;
  if (!campaign) {
    const usp = new URLSearchParams(window.location.search);
    if (usp.has('utm_campaign')) {
      campaign = toClassName(usp.get('utm_campaign'));
    }
  } else {
    campaign = toClassName(campaign);
  }

  if (metadata.audience) {
    metadata.audiences = metadata.audience;
  }

  const audiences = stringToArray(metadata.audiences).map(toClassName);
  const resolvedAudiences = await getResolvedAudiences(
    audiences,
    pluginOptions,
  );
  if (resolvedAudiences && !resolvedAudiences.length) {
    return null;
  }

  const configuredCampaigns = Object.fromEntries(Object.entries(metadata.campaigns || metadata)
    .filter(([key]) => !['audience', 'audiences'].includes(key)));

  return {
    audiences,
    configuredCampaigns,
    resolvedAudiences,
    selectedCampaign: campaign && (metadata.campaigns || metadata)[campaign]
      ? campaign
      : null,
  };
}

/**
 * Parses the campaign manifest.
 */
function parseCampaignManifest(rawEntries) {
  return rawEntries.map(entry => {
    const { selector, audience = '', ...campaigns } = entry;
    const audiences = audience.split(',').map(aud => aud.trim());
    const page = window.location.pathname;

    return {
      audiences,
      campaigns,
      page,
      selector
    };
  });
}



function getUrlFromCampaignConfig(config) {
  return config.selectedCampaign
    ? config.configuredCampaigns[config.selectedCampaign]
    : null;
}

async function runCampaign(document, pluginOptions) {
  return applyAllModifications(
    pluginOptions.campaignsMetaTagPrefix,
    pluginOptions.campaignsQueryParameter,
    pluginOptions,
    getCampaignConfig,
    parseCampaignManifest,
    getUrlFromCampaignConfig,
    (el, config, result) => {
      //fireRUM('campaign', config, pluginOptions, result);
      // dispatch event
      const { selectedCampaign = 'default' } = config;
      const campaign = result ? toClassName(selectedCampaign) : 'default';
      el.dataset.audience = selectedCampaign;
      el.dataset.audiences = Object.keys(pluginOptions.audiences).join(',');
      el.classList.add(`campaign-${campaign}`);
      document.dispatchEvent(new CustomEvent('aem:experimentation', {
        detail: {
          element: el,
          type: 'campaign',
          campaign,
        },
      }));
    },
  );
}

/**
 * Parses the audience configuration from the metadata
 */
async function getAudienceConfig(pluginOptions, metadata, overrides) {
  if (!Object.keys(metadata).length || (Object.keys(metadata).length === 1 && metadata.manifest)) {
    return null;
  }

  const configuredAudiencesName = Object.keys(metadata.audiences || metadata).map(toClassName);
  const resolvedAudiences = await getResolvedAudiences(
    configuredAudiencesName,
    pluginOptions,
  );
  if (resolvedAudiences && !resolvedAudiences.length) {
    return false;
  }

  const selectedAudience = overrides.audience || resolvedAudiences[0];

  return {
    configuredAudiences: metadata.audiences || metadata,
    resolvedAudiences,
    selectedAudience,
  };
}

/**
 * Parses the audience manifest.
 */
function parseAudienceManifest(rawEntries) {
  return rawEntries.map(entry => {
    const { selector, ...audiences } = entry;
    const page = window.location.pathname;

    return {
      audiences,
      page,
      selector
    };
  });
}

function getUrlFromAudienceConfig(config) {
  return config.selectedAudience
    ? config.configuredAudiences[config.selectedAudience]
    : null;
}

async function serveAudience(document, pluginOptions) {
  //document.body.dataset.audiences = Object.keys(pluginOptions.audiences).join(',');
  return applyAllModifications(
    pluginOptions.audiencesMetaTagPrefix,
    pluginOptions.audiencesQueryParameter,
    pluginOptions,
    getAudienceConfig,
    parseAudienceManifest,
    getUrlFromAudienceConfig,
    (el, config, result) => {
      //fireRUM('audience', config, pluginOptions, result);
      // dispatch event
      const { selectedAudience = 'default' } = config;
      const audience = result ? toClassName(selectedAudience) : 'default';
      el.dataset.audience = audience;
      el.classList.add(`audience-${audience}`);
      document.dispatchEvent(new CustomEvent('aem:experimentation', {
        detail: {
          element: el,
          type: 'audience',
          audience,
        },
      }));
    },
  );
}

async function loadEager(document, options = {}) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...options };
  setDebugMode(window.location, pluginOptions);

  const ns = window.aem || window.hlx || {};
  ns.audiences = await serveAudience(document, pluginOptions);
  ns.experiments = await runExperiment(document, pluginOptions);
  ns.campaigns = await runCampaign(document, pluginOptions);
}

async function loadLazy(document, options = {}) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...options} ;
  if (!isDebugEnabled) {
    return;
  }
  // eslint-disable-next-line import/no-unresolved
  const preview = await import('https://opensource.adobe.com/aem-experimentation/preview.js');
  const context = {
    getMetadata,
    toClassName,
    debug,
  };
  preview.default.call(context, document, pluginOptions);
}
