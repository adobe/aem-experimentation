# AEM Edge Delivery Services Experimentation

The AEM Experimentation plugin helps you quickly set up experimentation and segmentation on your AEM project. 
It is currently available to customers in collaboration with AEM Engineering via co-innovation VIP Projects. 
To implement experimentation or personalization use-cases, please reach out to the AEM Engineering team in the Slack channel dedicated to your project.

> **Note:** We are adding new support for the contextual experimentation rail UI. This is still under development. The instrumentation flow will be simplified once finalized. Feel free to reach out if you have any questions about experimentation or the contextual experimentation rail in the Slack channel **#contextual-exp-team**.

## Features

The AEM Experimentation plugin supports:
- :busts_in_silhouette: serving different content variations to different audiences, including custom audience definitions for your project that can be either resolved directly in-browser or against a trusted backend API.
- :money_with_wings: serving different content variations based on marketing campaigns you are running, so that you can easily track email and/or social campaigns
- :chart_with_upwards_trend: running A/B test experiments on a set of variants to measure and improve the conversion on your site. This works particularly with our :chart: [RUM conversion tracking plugin](https://github.com/adobe/franklin-rum-conversion).
- :rocket: easy simulation of each experience and basic reporting leveraging in-page overlays

## Installation

Add the plugin to your AEM project by running:

```sh
git subtree add --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2-ui
```

If you later want to pull the latest changes and update your local copy of the plugin:

```sh
git subtree pull --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2-ui
```

If you prefer using `https` links you'd replace `git@github.com:adobe/aem-experimentation.git` in the above commands by `https://github.com/adobe/aem-experimentation.git`.

## Project instrumentation

### Starting from Boilerplate for Xwalk

If you are starting from scratch, use the following template repository:
https://github.com/adobe-rnd/aem-boilerplate-xwalk

For reference, check this example project:
https://github.com/sudo-buddy/ue-experimentation

### Key Files to Add or Modify

1. **plugins/experimentation** - Add this folder containing the experimentation engine plugins (see Installation section above)
2. **scripts/experiment-loader.js** - Add this script to handle experiment loading
3. **scripts/scripts.js** - Modify this script with the configuration

### Step 1: Create `scripts/experiment-loader.js`

Create a new file `scripts/experiment-loader.js` with the following content:

```js
/**
 * Checks if experimentation is enabled.
 * @returns {boolean} True if experimentation is enabled, false otherwise.
 */
const isExperimentationEnabled = () => document.head.querySelector('[name^="experiment"],[name^="campaign-"],[name^="audience-"],[property^="campaign:"],[property^="audience:"]')
  || [...document.querySelectorAll('.section-metadata div')].some((d) => d.textContent.match(/Experiment|Campaign|Audience/i));

/**
 * Loads the experimentation module (eager).
 * @param {Document} document The document object.
 * @param {Object} config The experimentation configuration.
 * @returns {Promise<void>} A promise that resolves when the experimentation module is loaded.
 */
export async function runExperimentation(document, config) {
  if (!isExperimentationEnabled()) {
    window.addEventListener('message', async (event) => {
      if (event.data?.type === 'hlx:experimentation-get-config') {
        event.source.postMessage({
          type: 'hlx:experimentation-config',
          config: { experiments: [], audiences: [], campaigns: [] },
          source: 'no-experiments'
        }, '*');
      }
    });
    return null;
  }

  try {
    const { loadEager } = await import(
      '../plugins/experimentation/src/index.js'
    );
    return loadEager(document, config);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load experimentation module (eager):', error);
    return null;
  }
}

/**
 * Loads the experimentation module (lazy).
 * @param {Document} document The document object.
 * @param {Object} config The experimentation configuration.
 * @returns {Promise<void>} A promise that resolves when the experimentation module is loaded.
 */
export async function showExperimentationRail(document, config) {
  if (!isExperimentationEnabled()) {
    return null;
  }

  try {
    const { loadLazy } = await import(
      '../plugins/experimentation/src/index.js'
    );
    await loadLazy(document, config);

    const loadSidekickHandler = () => import('../tools/sidekick/aem-experimentation.js');

    if (document.querySelector('helix-sidekick, aem-sidekick')) {
      await loadSidekickHandler();
    } else {
      await new Promise((resolve) => {
        document.addEventListener(
          'sidekick-ready',
          () => {
            loadSidekickHandler().then(resolve);
          },
          { once: true },
        );
      });
    }

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load experimentation module (lazy):', error);
    return null;
  }
}
```

### Step 2: Update `scripts/scripts.js`

Add the following import and configuration at the top of your `scripts/scripts.js`:

```js
import {
  runExperimentation,
  showExperimentationRail,
} from './experiment-loader.js';

const experimentationConfig = {
  prodHost: 'www.mysite.com', // add your prodHost here, otherwise we will show mock data
  audiences: {
    mobile: () => window.innerWidth < 600,
    desktop: () => window.innerWidth >= 600,
    // define your custom audiences here as needed
  },
};
```

Then, add the following line early in your `loadEager()` function:

```js
async function loadEager(doc) {
  // ... existing code ...
  await runExperimentation(doc, experimentationConfig);
  // ... rest of your code ...
}
```

Finally, add the following line at the end of your `loadLazy()` function:

```js
async function loadLazy(doc) {
  // ... existing code ...
  await showExperimentationRail(doc, experimentationConfig);
}
```

### Configuration for Existing Xwalk Projects

If you're adding experimentation rail UI to an existing project that already has the experimentation engine:

1. **Update the engine with UI support** by running:
   ```sh
   git subtree pull --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2-ui
   ```

2. **Verify the communication layer** is set up in `plugins/experimentation/src/index.js`. The `loadEager` function should include the `setupCommunicationLayer` call:

```js
export async function loadEager(document, options = {}) {
  const pluginOptions = { ...DEFAULT_OPTIONS, ...options };
  setDebugMode(window.location, pluginOptions);

  const ns = window.aem || window.hlx || {};
  ns.audiences = await serveAudience(document, pluginOptions);
  ns.experiments = await runExperiment(document, pluginOptions);
  ns.campaigns = await runCampaign(document, pluginOptions);

  // Backward compatibility
  ns.experiment = ns.experiments.find((e) => e.type === 'page');
  ns.audience = ns.audiences.find((e) => e.type === 'page');
  ns.campaign = ns.campaigns.find((e) => e.type === 'page');

  if (isDebugEnabled) {
    setupCommunicationLayer(pluginOptions);
  }
}

// Support new Rail UI communication
function setupCommunicationLayer(options) {
  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'hlx:experimentation-get-config') {
      try {
        const safeClone = JSON.parse(JSON.stringify(window.hlx));

        if (options.prodHost) {
          safeClone.prodHost = options.prodHost;
        }

        event.source.postMessage(
          {
            type: 'hlx:experimentation-config',
            config: safeClone,
            source: 'index-js',
          },
          '*',
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Error sending hlx config:', e);
      }
    }
  });
}
```

3. **Follow Steps 1 and 2 above** to create the `experiment-loader.js` file and update your `scripts.js`.

### Increasing sampling rate for low traffic pages

When running experiments during short periods (i.e. a few days or 2 weeks) or on low-traffic pages (<100K page views a month), it is unlikely that you'll reach statistical significance on your tests with the default RUM sampling. For those use cases, we recommend adjusting the sampling rate for the pages in question to 1 out of 10 instead of the default 1 out of 100 visits.

Edit your html `<head>` and set configure the RUM sampling like:
```html
<meta name="experiment" content="...">
...
<!-- insert this script tag before loading aem.js or lib-franklin.js -->
<script>
  window.RUM_SAMPLING_RATE = document.head.querySelector('[name^="experiment"],[name^="campaign-"],[name^="audience-"]')
    || [...document.querySelectorAll('.section-metadata div')].some((d) => d.textContent.match(/Experiment|Campaign|Audience/i))
    ? 10
    : 100;
</script>
<script type="module" src="/scripts/aem.js"></script>
<script type="module" src="/scripts/scripts.js"></script>
```

Then double-check your `aem.js` file around line 20 and look for:
```js
const weight = new URLSearchParams(window.location.search).get('rum') === 'on' ? 1 : defaultSamplingRate;
```

If this is not present, please apply the following changes to the file: https://github.com/adobe/helix-rum-js/pull/159/files#diff-bfe9874d239014961b1ae4e89875a6155667db834a410aaaa2ebe3cf89820556

### Custom options

There are various aspects of the plugin that you can configure via the `experimentationConfig` object.
You have already seen the `audiences` option in the examples above, but here is the full list we support:

```js
const experimentationConfig = {
  // Lets you configure the prod environment.
  // (prod environments do not get the pill overlay)
  prodHost: 'www.my-website.com',
  // if you have several, or need more complex logic to toggle pill overlay, you can use
  isProd: () => !window.location.hostname.endsWith('hlx.page')
    && window.location.hostname !== ('localhost'),

  // the storage type used to persist data between page views
  // (for instance to remember what variant in an experiment the user was served)
  storage: window.SessionStorage,

  /* Audiences related properties */
  // See more details on the dedicated Audiences page linked below
  audiences: {},
  audiencesMetaTagPrefix: 'audience',
  audiencesQueryParameter: 'audience',

  /* Campaigns related properties */
  // See more details on the dedicated Campaigns page linked below
  campaignsMetaTagPrefix: 'campaign',
  campaignsQueryParameter: 'campaign',

  /* Experimentation related properties */
  // See more details on the dedicated Experiments page linked below
  experimentsMetaTagPrefix: 'experiment',
  experimentsQueryParameter: 'experiment',

  /* Fragment experiment needs redecoration */
  // See more details below
  decorationFunction: (el) => {
    /* handle custom decoration here, for example: */
    buildBlock(el);
    decorateBlock(el);
  }
};
```

For detailed implementation instructions on the different features, please read the dedicated pages we have on those topics:
- [Audiences](/documentation/audiences.md)
- [Campaigns](/documentation/campaigns.md)
- [Experiments](/documentation/experiments.md)

**Cases of passing `decorationFunction`**
Fragment replacement is handled by async observer, which may execute before or after default decoration complete. So, you need to provide a decoration method to redecorate. There are several common cases:
1. Have a selector for an element inside a block and the block needs to be redecorated => sample code above
2. Have a `.block` selector and  need to redecorate => switch block status to `"loading"` and call `loadBlock(el)`
3. Have a `.section` selector and need to redecorate => call `decorateBlocks(el)`
4. Have a `main` selector and need to redecorate => call `decorateMain(el)`

## Extensibility & integrations

If you need to further integrate the experimentation plugin with custom analytics reporting or other 3rd-party libraries, you can listen for the `aem:experimentation` event:
```js
document.addEventListener('aem:experimentation', (ev) => console.log(ev.detail));
```

The event details will contain one of 3 possible sets of properties:
- For experiments:
  - `type`: `experiment`
  - `element`: the DOM element that was modified
  - `experiment`: the experiment name
  - `variant`: the variant name that was served
- For audiences:
  - `type`: `audience`
  - `element`: the DOM element that was modified
  - `audience`: the audience that was resolved
- For campaigns:
  - `type`: `campaign`
  - `element`: the DOM element that was modified
  - `campaign`: the campaign that was resolved

Additionally, you can leverage the following global JS objects `window.hlx.experiments`, `window.hlx.audiences` and `window.hlx.campaigns`.
Those will each be an array of objects containing:
  - `type`: one of `page`, `section` or `fragment`
  - `el`: the DOM element that was modified
  - `servedExperience`: the URL for the content that was inlined for that experience
  - `config`: an object containing the config details
