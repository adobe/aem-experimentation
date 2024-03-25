/*
 * Copyright 2022 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const MAX_SAMPLING_RATE = 10; // At a maximum we sample 1 in 10 requests

let isDebugEnabled = false;
function debug(...args) {
  if (isDebugEnabled) {
    console.debug.call(this, '[experimentation]', ...args);
  }
}

export const DEFAULT_OPTIONS = {
  decorateExperience: () => {},
  trackingFunction: window.sampleRUM,

  // Generic properties
  rumSamplingRate: MAX_SAMPLING_RATE, // 1 in 10 requests

  // Audiences related properties
  audiences: {},
  audiencesMetaTagPrefix: 'audience',
  audiencesQueryParameter: 'audience',

  // Campaigns related properties
  campaignsMetaTagPrefix: 'campaign',
  campaignsQueryParameter: 'campaign',

  // Experimentation related properties
  experimentsRoot: '/experiments',
  experimentsConfigFile: 'manifest.json',
  experimentsMetaTag: 'experiment',
  experimentsQueryParameter: 'experiment',
};

function stringToArray(str) {
  return str ? str.split(/[,\n]/) : [];
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
 * Sanitizes a name for use as a js property name.
 * @param {String} name The unsanitized name
 * @returns {String} The camelCased name
 */
function toCamelCase(name) {
  return toClassName(name).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

/**
 * Retrieves the content of metadata tags.
 * @param {String} name The metadata name (or property)
 * @returns {String} The metadata value(s)
 */
function getMetadata(name) {
  const attr = name && name.includes(':') ? 'property' : 'name';
  const meta = [...document.head.querySelectorAll(`meta[${attr}="${name}"]`)].map((m) => m.content).join(', ');
  return meta || '';
}

/**
 * Gets all the metadata elements that are in the given scope.
 * @param {String} scope The scope/prefix for the metadata
 * @returns a map of key/value pairs for the given scope
 */
function getAllMetadata(scope) {
  const value = getMetadata(scope);
  return [...document.head.querySelectorAll(`meta[property^="${scope}:"],meta[name^="${scope}-"]`)]
    .reduce((res, meta) => {
      const key = toClassName(meta.name
        ? meta.name.substring(scope.length + 1)
        : meta.getAttribute('property').split(':')[1]);
      res[key] = meta.getAttribute('content');
      return res;
    }, value ? { value } : {});
}

/**
 * Gets all the data attributes that are in the given scope.
 * @param {String} scope The scope/prefix for the metadata
 * @returns a map of key/value pairs for the given scope
 */
function getAllDataAttributes(el, scope) {
  return el.getAttributeNames()
    .filter((attr) => attr === `data-${scope}` || attr.startsWith(`data-${scope}-`))
    .reduce((res, attr) => {
      const key = attr === `data-${scope}` ? 'value' : attr.replace(`data-${scope}-`, '');
      res[key] = el.getAttribute(attr);
      return res;
    }, {});
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
      res[key] = value;
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
        } else if (col.querySelector('img')) {
          const imgs = [...col.querySelectorAll('img')];
          if (imgs.length === 1) {
            value = imgs[0].src;
          } else {
            value = imgs.map((img) => img.src);
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
 * @param {HTMLElement} main
 * @return Returns the path that was loaded or null if the loading failed
 */
async function replaceInner(path, main) {
  if (!path || new URL(path, window.location.origin).pathname === window.location.pathname) {
    return null;
  }
  try {
    const resp = await fetch(path);
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.log('error loading content:', resp);
      return null;
    }
    const html = await resp.text();
    // parse with DOMParser to guarantee valid HTML, and no script execution(s)
    const dom = new DOMParser().parseFromString(html, 'text/html');
    // eslint-disable-next-line no-param-reassign
    main.replaceWith(dom.querySelector('main'));
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
export async function getResolvedAudiences(pageAudiences, options) {
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
      v.percentageSplit = missingPercentage.toFixed(2);
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

async function applyExperienceModifications(
  ns,
  paramNS,
  pluginOptions,
  metadataToConfig,
  getExperienceUrl,
  cb,
) {
  const queryParamsConfig = getAllQueryParameters(paramNS);

  // Full-page modifications
  const page = {};
  const pageMeta = getAllMetadata(ns);
  page.config = await metadataToConfig(pluginOptions, pageMeta, queryParamsConfig);
  if (page.config) {
    const url = await getExperienceUrl(page.config);
    const result = await replaceInner(url, document.querySelector('main'));
    pluginOptions.decorateExperience(document.querySelector('main'));
    cb(document.querySelector('main'), page.config, result);
    page.servedExperience = result ? url : window.location.pathname;
    debug('page', ns, page);
  }

  // Section-level modifications
  const sections = [];
  await Promise.all([...document.querySelectorAll('.section-metadata')].map(async (sm) => {
    const sectionMeta = getAllSectionMeta(sm, ns);
    const section = {};
    section.config = await metadataToConfig(pluginOptions, sectionMeta, queryParamsConfig);
    if (section.config) {
      sections.push(section);
      const url = await getExperienceUrl(section.config);
      // eslint-disable-next-line no-shadow
      const result = replaceInner(url, sm.parentElement);
      pluginOptions.decorateExperience(sm.parentElement);
      cb(sm.parentElement, section.config, result);
      debug('section', ns, sm.parentElement);
      return result || window.location.pathname;
    }
    return null;
  }))
    .then((urls) => urls.forEach((u, i) => {
      if (u) {
        sections[i].servedExperience = u;
      }
    }));

  // TODO: Fragment-level modifications via manifest
  const fragments = [];

  return { page, sections, fragments };
}

async function getExperimentConfig(pluginOptions, metadata, overrides) {
  if (!metadata.value) {
    return null;
  }

  let pages = metadata.variants;

  // Backward compatibility
  if (!pages) {
    pages = getMetadata('instant-experiment');
  }
  if (metadata.audience) {
    metadata.audiences = metadata.audience;
  }

  pages = stringToArray(pages);
  if (!pages.length) {
    return null;
  }

  const audiences = stringToArray(metadata.audiences).map(toClassName);

  const splits = metadata.split
    // custom split
    ? stringToArray(metadata.split).map((i) => parseInt(i, 10) / 100)
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

  pages.forEach((page, i) => {
    const vname = `challenger-${i + 1}`;
    variantNames.push(vname);
    variants[vname] = {
      percentageSplit: `${splits[i].toFixed(2)}`,
      pages: [page],
      blocks: [],
      label: `Challenger ${i + 1}`,
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
    id: metadata.value,
    label: metadata.name || `Experiment ${metadata.value}`,
    status: metadata.status || 'active',
    audiences,
    endDate,
    startDate,
    variants,
    variantNames,
  };

  config.run = (
    // experiment is active or forced
    (['active', 'on', 'true'].includes(toClassName(config.status)) || overrides.experiment)
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

  if (overrides.variant && variantNames.includes(overrides.variant)) {
    config.selectedVariant = overrides.variant;
  } else {
    // eslint-disable-next-line import/extensions
    const { ued } = await import('./ued.js');
    const decision = ued.evaluateDecisionPolicy(toDecisionPolicy(config), {});
    config.selectedVariant = decision.items[0].id;
  }

  return config;
}

function getUrlFromExperimentConfig(config) {
  return config.run
    ? config.variants[config.selectedVariant].pages[0]
    : null;
}

async function runExperiment(document, options) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
  return applyExperienceModifications(
    pluginOptions.experimentsMetaTag,
    pluginOptions.experimentsQueryParameter,
    pluginOptions,
    getExperimentConfig,
    getUrlFromExperimentConfig,
    (el, config, result) => {
      const { id, selectedVariant, variantNames } = config;
      el.classList.add(`experiment-${toClassName(id)}`);
      el.classList.add(`variant-${toClassName(result ? selectedVariant : variantNames[0])}`);
      if (pluginOptions.trackingFunction) {
        pluginOptions.trackingFunction('experiment', {
          source: id,
          target: result ? selectedVariant : variantNames[0],
        });
      }
    },
  );
}

async function runCampaign(document, options) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
  return applyExperienceModifications(
    pluginOptions.campaignsMetaTagPrefix,
    pluginOptions.campaignsQueryParameter,
    pluginOptions,
    () => {},
    async (config) => { console.log('campaign', config); return null; },
    (el, config, res) => {
      console.log(el, res);
    },
  );
}

async function serveAudience(document, options) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
  return applyExperienceModifications(
    pluginOptions.audiencesMetaTagPrefix,
    pluginOptions.audiencesQueryParameter,
    pluginOptions,
    () => {},
    async (config) => { console.log('audience', config); return null; },
    (el, config, res) => {
      console.log(el, res);
      const { selectedAudience = 'default' } = config;
      el.classList.add(`audience-${toClassName(selectedAudience)}`);
      if (pluginOptions.trackingFunction) {
        pluginOptions.trackingFunction('audience', {
          source: window.location.href,
          target: selectedAudience,
        });
      }
    },
  );
}

export async function loadEager(document, options) {
  const { host, hostname, origin } = window.location;
  isDebugEnabled = !window.location.hostname.endsWith('.live')
    && (options.isProd !== 'function' || !options.isProd())
    && (!options.prodHost || ![host, hostname, origin].includes(options.prodHost));
  window.hlx ||= {};
  window.hlx.expriments = await runExperiment(document, options);
  window.hlx.campaigns = await runCampaign(document, options);
  window.hlx.audiences = await serveAudience(document, options);
  console.log(window.hlx);
}

// /**
//  * Parses the experimentation configuration sheet and creates an internal model.
//  *
//  * Output model is expected to have the following structure:
//  *      {
//  *        id: <string>,
//  *        label: <string>,
//  *        blocks: <string>,
//  *        audiences: [<string>],
//  *        status: Active | Inactive,
//  *        variantNames: [<string>],
//  *        variants: {
//  *          [variantName]: {
//  *            label: <string>
//  *            percentageSplit: <number 0-1>,
//  *            pages: <string>,
//  *            blocks: <string>,
//  *          }
//  *        }
//  *      };
//  */
// function parseExperimentConfig(json) {
//   const config = {};
//   try {
//     json.settings.data.forEach((line) => {
//       const key = toCamelCase(line.Name);
//       if (key === 'audience' || key === 'audiences') {
//         config.audiences = line.Value ? line.Value.split(',').map((str) => str.trim()) : [];
//       } else if (key === 'experimentName') {
//         config.label = line.Value;
//       } else {
//         config[key] = line.Value;
//       }
//     });
//     const variants = {};
//     let variantNames = Object.keys(json.experiences.data[0]);
//     variantNames.shift();
//     variantNames = variantNames.map((vn) => toCamelCase(vn));
//     variantNames.forEach((variantName) => {
//       variants[variantName] = {};
//     });
//     let lastKey = 'default';
//     json.experiences.data.forEach((line) => {
//       let key = toCamelCase(line.Name);
//       if (!key) key = lastKey;
//       lastKey = key;
//       const vns = Object.keys(line);
//       vns.shift();
//       vns.forEach((vn) => {
//         const camelVN = toCamelCase(vn);
//         if (key === 'pages' || key === 'blocks') {
//           variants[camelVN][key] = variants[camelVN][key] || [];
//           if (key === 'pages') variants[camelVN][key].push(new URL(line[vn]).pathname);
//           else variants[camelVN][key].push(line[vn]);
//         } else {
//           variants[camelVN][key] = line[vn];
//         }
//       });
//     });
//     config.variants = variants;
//     config.variantNames = variantNames;
//     return config;
//   } catch (e) {
//     // eslint-disable-next-line no-console
//     console.log('error parsing experiment config:', e, json);
//   }
//   return null;
// }

// /**
//  * Checks if the given config is a valid experimentation configuration.
//  * @param {object} config the config to check
//  * @returns `true` if it is valid, `false` otherwise
//  */
// export function isValidExperimentationConfig(config) {
//   if (!config.variantNames
//     || !config.variantNames.length
//     || !config.variants
//     || !Object.values(config.variants).length
//     || !Object.values(config.variants).every((v) => (
//       typeof v === 'object'
//       && !!v.blocks
//       && !!v.pages
//       && (v.percentageSplit === '' || !!v.percentageSplit)
//     ))) {
//     return false;
//   }
//   return true;
// }

// /**
//  * Gets experiment config from the metadata.
//  *
//  * @param {string} experimentId The experiment identifier
//  * @param {string} instantExperiment The list of varaints
//  * @returns {object} the experiment manifest
//  */
// function getConfigForInstantExperiment(
//   experimentId,
//   instantExperiment,
//   pluginOptions,
// ) {
//   const audience = getMetadata(`${pluginOptions.experimentsMetaTag}-audience`);
//   const config = {
//     label: `Instant Experiment: ${experimentId}`,
//     audiences: audience ? audience.split(',').map(toClassName) : [],
//     status: getMetadata(`${pluginOptions.experimentsMetaTag}-status`) || 'Active',
//     startDate: getMetadata(`${pluginOptions.experimentsMetaTag}-start-date`),
//     endDate: getMetadata(`${pluginOptions.experimentsMetaTag}-end-date`),
//     id: experimentId,
//     variants: {},
//     variantNames: [],
//   };

//   const pages = instantExperiment.split(',').map((p) => new URL(p.trim(), window.location).pathname);

//   const splitString = getMetadata(`${pluginOptions.experimentsMetaTag}-split`);
//   const splits = splitString
//     // custom split
//     ? splitString.split(',').map((i) => parseInt(i, 10) / 100)
//     // even split fallback
//     : [...new Array(pages.length)].map(() => 1 / (pages.length + 1));

//   config.variantNames.push('control');
//   config.variants.control = {
//     percentageSplit: '',
//     pages: [window.location.pathname],
//     blocks: [],
//     label: 'Control',
//   };

//   pages.forEach((page, i) => {
//     const vname = `challenger-${i + 1}`;
//     config.variantNames.push(vname);
//     config.variants[vname] = {
//       percentageSplit: `${splits[i].toFixed(2)}`,
//       pages: [page],
//       blocks: [],
//       label: `Challenger ${i + 1}`,
//     };
//   });
//   inferEmptyPercentageSplits(Object.values(config.variants));
//   return (config);
// }

// /**
//  * Gets experiment config from the manifest and transforms it to more easily
//  * consumable structure.
//  *
//  * the manifest consists of two sheets "settings" and "experiences", by default
//  *
//  * "settings" is applicable to the entire test and contains information
//  * like "Audience", "Status" or "Blocks".
//  *
//  * "experience" hosts the experiences in rows, consisting of:
//  * a "Percentage Split", "Label" and a set of "Links".
//  *
//  *
//  * @param {string} experimentId The experiment identifier
//  * @param {object} pluginOptions The plugin options
//  * @returns {object} containing the experiment manifest
//  */
// async function getConfigForFullExperiment(experimentId, pluginOptions) {
//   let path;
//   if (experimentId.includes(`/${pluginOptions.experimentsConfigFile}`)) {
//     path = new URL(experimentId, window.location.origin).href;
//     // eslint-disable-next-line no-param-reassign
//     [experimentId] = path.split('/').splice(-2, 1);
//   } else {
//     path = `${pluginOptions.experimentsRoot}/${experimentId}/${pluginOptions.experimentsConfigFile}`;
//   }
//   try {
//     const resp = await fetch(path);
//     if (!resp.ok) {
//       // eslint-disable-next-line no-console
//       console.log('error loading experiment config:', resp);
//       return null;
//     }
//     const json = await resp.json();
//     const config = pluginOptions.parser
//       ? pluginOptions.parser(json)
//       : parseExperimentConfig(json);
//     if (!config) {
//       return null;
//     }
//     config.id = experimentId;
//     config.manifest = path;
//     config.basePath = `${pluginOptions.experimentsRoot}/${experimentId}`;
//     inferEmptyPercentageSplits(Object.values(config.variants));
//     config.status = getMetadata(`${pluginOptions.experimentsMetaTag}-status`) || config.status;
//     return config;
//   } catch (e) {
//     // eslint-disable-next-line no-console
//     console.log(`error loading experiment manifest: ${path}`, e);
//   }
//   return null;
// }

// async function getConfig(experiment, instantExperiment, pluginOptions) {
//   const usp = new URLSearchParams(window.location.search);
//   const [forcedExperiment, forcedVariant] = usp.has(pluginOptions.experimentsQueryParameter)
//     ? usp.get(pluginOptions.experimentsQueryParameter).split('/')
//     : [];

//   const experimentConfig = instantExperiment
//     ? await getConfigForInstantExperiment(experiment, instantExperiment, pluginOptions)
//     : await getConfigForFullExperiment(experiment, pluginOptions);

//   // eslint-disable-next-line no-console
//   console.debug(experimentConfig);
//   if (!experimentConfig) {
//     return null;
//   }

//   const forcedAudience = usp.has(pluginOptions.audiencesQueryParameter)
//     ? toClassName(usp.get(pluginOptions.audiencesQueryParameter))
//     : null;

//   experimentConfig.resolvedAudiences = await getResolvedAudiences(
//     experimentConfig.audiences.map(toClassName),
//     pluginOptions,
//   );
//   experimentConfig.run = (
//     // experiment is active or forced
//     (['active', 'on', 'true'].includes(toClassName(experimentConfig.status)) || forcedExperiment)
//     // experiment has resolved audiences if configured
//     && (!experimentConfig.resolvedAudiences || experimentConfig.resolvedAudiences.length)
//     // forced audience resolves if defined
//     && (!forcedAudience || experimentConfig.audiences.includes(forcedAudience))
//     && (!experimentConfig.startDate || new Date(experimentConfig.startDate) <= Date.now())
//     && (!experimentConfig.endDate || new Date(experimentConfig.endDate) > Date.now())
//   );

//   window.hlx = window.hlx || {};
//   window.hlx.experiment = experimentConfig;

//   // eslint-disable-next-line no-console
//   console.debug('run', experimentConfig.run, experimentConfig.audiences);
//   if (forcedVariant && experimentConfig.variantNames.includes(forcedVariant)) {
//     experimentConfig.selectedVariant = forcedVariant;
//   } else {
//     // eslint-disable-next-line import/extensions
//     const { ued } = await import('./ued.js');
//     const decision = ued.evaluateDecisionPolicy(getDecisionPolicy(experimentConfig), {});
//     experimentConfig.selectedVariant = decision.items[0].id;
//   }
//   return experimentConfig;
// }

// export async function runExperiment(document, options, context) {
//   const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
//   const experiment = getMetadata(pluginOptions.experimentsMetaTag);
//   if (!experiment) {
//     return false;
//   }
//   const variants = getMetadata('instant-experiment')
//     || getMetadata(`${pluginOptions.experimentsMetaTag}-variants`);
//   let experimentConfig;
//   try {
//     experimentConfig = await getConfig(experiment, variants, pluginOptions);
//   } catch (err) {
//     // eslint-disable-next-line no-console
//     console.error('Invalid experiment config.', err);
//   }
//   if (!experimentConfig || !isValidExperimentationConfig(experimentConfig)) {
//     // eslint-disable-next-line no-console
//     console.warn('Invalid experiment config. Please review your metadata, sheet and parser.');
//     return false;
//   }

//   const usp = new URLSearchParams(window.location.search);
//   const forcedVariant = usp.has(pluginOptions.experimentsQueryParameter)
//     ? usp.get(pluginOptions.experimentsQueryParameter).split('/')[1]
//     : null;
//   if (!experimentConfig.run && !forcedVariant) {
//     // eslint-disable-next-line no-console
//     console.warn('Experiment will not run. It is either not active or its configured audiences are not resolved.');
//     return false;
//   }
//   // eslint-disable-next-line no-console
//   console.debug(`running experiment (${window.hlx.experiment.id}) -> ${window.hlx.experiment.selectedVariant}`);

//   if (experimentConfig.selectedVariant === experimentConfig.variantNames[0]) {
//     context.sampleRUM('experiment', {
//       source: experimentConfig.id,
//       target: experimentConfig.selectedVariant,
//     });
//     return false;
//   }

//   const { pages } = experimentConfig.variants[experimentConfig.selectedVariant];
//   if (!pages.length) {
//     return false;
//   }

//   const currentPath = window.location.pathname;
//   const control = experimentConfig.variants[experimentConfig.variantNames[0]];
//   const index = control.pages.indexOf(currentPath);
//   if (index < 0 || pages[index] === currentPath) {
//     return false;
//   }

//   // Fullpage content experiment
//   document.body.classList.add(`experiment-${toClassName(experimentConfig.id)}`);
//   const result = await replaceInner(pages[index], document.querySelector('main'));
//   experimentConfig.servedExperience = result || currentPath;
//   if (!result) {
//     // eslint-disable-next-line no-console
//     console.debug(`failed to serve variant ${window.hlx.experiment.selectedVariant}. Falling back to ${experimentConfig.variantNames[0]}.`);
//   }
//   document.body.classList.add(`variant-${toClassName(result ? experimentConfig.selectedVariant : experimentConfig.variantNames[0])}`);
//   context.sampleRUM('experiment', {
//     source: experimentConfig.id,
//     target: result ? experimentConfig.selectedVariant : experimentConfig.variantNames[0],
//   });
//   return result;
// }

// export async function runCampaign(document, options, context) {
//   const pluginOptions = { ...DEFAULT_OPTIONS, ...options };
//   const usp = new URLSearchParams(window.location.search);
//   const campaign = (usp.has(pluginOptions.campaignsQueryParameter)
//     ? toClassName(usp.get(pluginOptions.campaignsQueryParameter))
//     : null)
//     || (usp.has('utm_campaign') ? toClassName(usp.get('utm_campaign')) : null);
//   if (!campaign) {
//     return false;
//   }

//   let audiences = getMetadata(`${pluginOptions.campaignsMetaTagPrefix}-audience`);
//   let resolvedAudiences = null;
//   if (audiences) {
//     audiences = audiences.split(',').map(toClassName);
//     resolvedAudiences = await getResolvedAudiences(audiences, pluginOptions);
//     if (!!resolvedAudiences && !resolvedAudiences.length) {
//       return false;
//     }
//   }

//   const allowedCampaigns = getAllMetadata(pluginOptions.campaignsMetaTagPrefix);
//   if (!Object.keys(allowedCampaigns).includes(campaign)) {
//     return false;
//   }

//   const urlString = allowedCampaigns[campaign];
//   if (!urlString) {
//     return false;
//   }

//   window.hlx.campaign = { selectedCampaign: campaign };
//   if (resolvedAudiences) {
//     window.hlx.campaign.resolvedAudiences = window.hlx.campaign;
//   }

//   try {
//     const url = new URL(urlString);
//     const result = await replaceInner(url.pathname, document.querySelector('main'));
//     window.hlx.campaign.servedExperience = result || window.location.pathname;
//     if (!result) {
//       // eslint-disable-next-line no-console
//       console.debug(`failed to serve campaign ${campaign}. Falling back to default content.`);
//     }
//     document.body.classList.add(`campaign-${campaign}`);
//     context.sampleRUM('campaign', {
//       source: window.location.href,
//       target: result ? campaign : 'default',
//     });
//     return result;
//   } catch (err) {
//     // eslint-disable-next-line no-console
//     console.error(err);
//     return false;
//   }
// }

// export async function serveAudience(document, options, context) {
//   const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
//   const configuredAudiences = getAllMetadata(pluginOptions.audiencesMetaTagPrefix);
//   if (!Object.keys(configuredAudiences).length) {
//     return false;
//   }

//   const audiences = await getResolvedAudiences(
//     Object.keys(configuredAudiences).map(toClassName),
//     pluginOptions,
//   );
//   if (!audiences || !audiences.length) {
//     return false;
//   }

//   const usp = new URLSearchParams(window.location.search);
//   const forcedAudience = usp.has(pluginOptions.audiencesQueryParameter)
//     ? toClassName(usp.get(pluginOptions.audiencesQueryParameter))
//     : null;

//   const selectedAudience = forcedAudience || audiences[0];
//   const urlString = configuredAudiences[selectedAudience];
//   if (!urlString) {
//     return false;
//   }

//   window.hlx.audience = { selectedAudience };

//   try {
//     const url = new URL(urlString);
//     const result = await replaceInner(url.pathname, document.querySelector('main'));
//     window.hlx.audience.servedExperience = result || window.location.pathname;
//     if (!result) {
//       // eslint-disable-next-line no-console
//       console.debug(`failed to serve audience ${selectedAudience}. Falling back to default content.`);
//     }
//     document.body.classList.add(audiences.map((audience) => `audience-${audience}`));
//     context.sampleRUM('audiences', {
//       source: window.location.href,
//       target: result ? forcedAudience || audiences.join(',') : 'default',
//     });
//     return result;
//   } catch (err) {
//     // eslint-disable-next-line no-console
//     console.error(err);
//     return false;
//   }
// }

// window.hlx.patchBlockConfig?.push((config) => {
//   const { experiment } = window.hlx;

//   // No experiment is running
//   if (!experiment || !experiment.run) {
//     return config;
//   }

//   // The current experiment does not modify the block
//   if (experiment.selectedVariant === experiment.variantNames[0]
//     || !experiment.variants[experiment.variantNames[0]].blocks
//     || !experiment.variants[experiment.variantNames[0]].blocks.includes(config.blockName)) {
//     return config;
//   }

//   // The current experiment does not modify the block code
//   const variant = experiment.variants[experiment.selectedVariant];
//   if (!variant.blocks.length) {
//     return config;
//   }

//   let index = experiment.variants[experiment.variantNames[0]].blocks.indexOf('');
//   if (index < 0) {
//     index = experiment.variants[experiment.variantNames[0]].blocks.indexOf(config.blockName);
//   }
//   if (index < 0) {
//     index = experiment.variants[experiment.variantNames[0]].blocks.indexOf(`/blocks/${config.blockName}`);
//   }
//   if (index < 0) {
//     return config;
//   }

//   let origin = '';
//   let path;
//   if (/^https?:\/\//.test(variant.blocks[index])) {
//     const url = new URL(variant.blocks[index]);
//     // Experimenting from a different branch
//     if (url.origin !== window.location.origin) {
//       origin = url.origin;
//     }
//     // Experimenting from a block path
//     if (url.pathname !== '/') {
//       path = url.pathname;
//     } else {
//       path = `/blocks/${config.blockName}`;
//     }
//   } else { // Experimenting from a different branch on the same branch
//     path = `/blocks/${variant.blocks[index]}`;
//   }
//   if (!origin && !path) {
//     return config;
//   }

//   const { codeBasePath } = window.hlx;
//   return {
//     ...config,
//     cssPath: `${origin}${codeBasePath}${path}/${config.blockName}.css`,
//     jsPath: `${origin}${codeBasePath}${path}/${config.blockName}.js`,
//   };
// });

// let isAdjusted = false;
// function adjustedRumSamplingRate(checkpoint, options, context) {
//   const pluginOptions = { ...DEFAULT_OPTIONS, ...(options || {}) };
//   return (data) => {
//     if (!window.hlx.rum.isSelected && !isAdjusted) {
//       isAdjusted = true;
//       // adjust sampling rate based on project config …
//       window.hlx.rum.weight = Math.min(
//         window.hlx.rum.weight,
//         // … but limit it to the 10% sampling at max to avoid losing anonymization
//         // and reduce burden on the backend
//         Math.max(pluginOptions.rumSamplingRate, MAX_SAMPLING_RATE),
//       );
//       window.hlx.rum.isSelected = (window.hlx.rum.random * window.hlx.rum.weight < 1);
//       if (window.hlx.rum.isSelected) {
//         context.sampleRUM(checkpoint, data);
//       }
//     }
//     return true;
//   };
// }

// export async function loadEager(document, options, context) {
//   context.sampleRUM.always.on('audiences', adjustedRumSamplingRate('audiences', options, context));
//   context.sampleRUM.always.on('campaign', adjustedRumSamplingRate('campaign', options, context));
//   context.sampleRUM.always.on('experiment', adjustedRumSamplingRate('experiment', options, context));
//   let res = await runCampaign(document, options, context);
//   if (!res) {
//     res = await runExperiment(document, options, context);
//   }
//   if (!res) {
//     res = await serveAudience(document, options, context);
//   }
// }

// export async function loadLazy(document, options, context) {
//   const pluginOptions = {
//     ...DEFAULT_OPTIONS,
//     ...(options || {}),
//   };
//   // do not show the experimentation pill on prod domains
//   if (window.location.hostname.endsWith('.live')
//     || (typeof options.isProd === 'function' && options.isProd())
//     || (options.prodHost
//         && (options.prodHost === window.location.host
//           || options.prodHost === window.location.hostname
//           || options.prodHost === window.location.origin))) {
//     return;
//   }
//   // eslint-disable-next-line import/no-cycle
//   const preview = await import('./preview.js');
//   preview.default(document, pluginOptions, { ...context, getResolvedAudiences });
// }
