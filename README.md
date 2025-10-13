# AEM Edge Delivery Services Experimentation

The AEM Experimentation plugin helps you quickly set up experimentation and segmentation on your AEM project. 
It is currently available to customers in collaboration with AEM Engineering via co-innovation VIP Projects. 
To implement experimentation or personalization use-cases, please reach out to the AEM Engineering team in the Slack channel dedicated to your project.

## Features

The AEM Experimentation plugin supports:
- :busts_in_silhouette: serving different content variations to different audiences, including custom audience definitions for your project that can be either resolved directly in-browser or against a trusted backend API.
- :money_with_wings: serving different content variations based on marketing campaigns you are running, so that you can easily track email and/or social campaigns
- :chart_with_upwards_trend: running A/B test experiments on a set of variants to measure and improve the conversion on your site. This works particularly with our :chart: [RUM conversion tracking plugin](https://github.com/adobe/franklin-rum-conversion).
- :rocket: easy simulation of each experience and basic reporting leveraging in-page overlays

## Installation

Add the plugin to your AEM project by running:
```sh
git subtree add --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2
```

If you later want to pull the latest changes and update your local copy of the plugin
```sh
git subtree pull --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2
```

If you prefer using `https` links you'd replace `git@github.com:adobe/aem-experimentation.git` in the above commands by `https://github.com/adobe/aem-experimentation.git`.

## Project instrumentation

### On top of a regular boilerplate project

Typically, you'd know you don't have the plugin system if you don't see a reference to `window.aem.plugins` or `window.hlx.plugins` in your `scripts.js`. In that case, you can still manually instrument this plugin in your project by falling back to a more manual instrumentation. To properly connect and configure the plugin for your project, you'll need to edit your `scripts.js` in your AEM project and add the following:

1. at the start of the file:
    ```js
    const experimentationConfig = {
      prodHost: 'www.my-site.com',
      audiences: {
        mobile: () => window.innerWidth < 600,
        desktop: () => window.innerWidth >= 600,
        // define your custom audiences here as needed
      }
    };

    let runExperimentation;
    let showExperimentationOverlay;
    const isExperimentationEnabled = document.head.querySelector('[name^="experiment"],[name^="campaign-"],[name^="audience-"],[property^="campaign:"],[property^="audience:"]')
        || [...document.querySelectorAll('.section-metadata div')].some((d) => d.textContent.match(/Experiment|Campaign|Audience/i));
    if (isExperimentationEnabled) {
      ({
        loadEager: runExperimentation,
        loadLazy: showExperimentationOverlay,
      } = await import('../plugins/experimentation/src/index.js'));
    }
    ```
2. Early in the `loadEager` method you'll need to add:
    ```js
    async function loadEager(doc) {
      …
      // Add below snippet early in the eager phase
      if (runExperimentation) {
        await runExperimentation(document, experimentationConfig);
      }
      …
    }
    ```
    This needs to be done as early as possible since this will be blocking the eager phase and impacting your LCP, so we want this to execute as soon as possible.
3. Finally at the end of the `loadLazy` method you'll have to add:
    ```js
    async function loadLazy(doc) {
      …
      // Add below snippet at the end of the lazy phase
      if (showExperimentationOverlay) {
        await showExperimentationOverlay(document, experimentationConfig);
      }
    }
    ```
    This is mostly used for the authoring overlay, and as such isn't essential to the page rendering, so having it at the end of the lazy phase is good enough.

### On top of the plugin system (deprecated)

The easiest way to add the plugin is if your project is set up with the plugin system extension in the boilerplate.
You'll know you have it if either `window.aem.plugins` or `window.hlx.plugins` is defined on your page.

If you don't have it, you can follow the proposal in https://github.com/adobe/aem-lib/pull/23 and https://github.com/adobe/aem-boilerplate/pull/275 and apply the changes to your `aem.js`/`lib-franklin.js` and `scripts.js`.

Once you have confirmed this, you'll need to edit your `scripts.js` in your AEM project and add the following at the start of the file:
```js
const experimentationConfig = {
  prodHost: 'www.my-site.com',
  audiences: {
    mobile: () => window.innerWidth < 600,
    desktop: () => window.innerWidth >= 600,
    // define your custom audiences here as needed
  }
};

window.aem.plugins.add('experimentation', { // use window.hlx instead of your project has this
  condition: () =>
    // page level metadata
    document.head.querySelector('[name^="experiment"],[name^="campaign-"],[name^="audience-"]')
    // decorated section metadata
    || document.querySelector('.section[class*=experiment],.section[class*=audience],.section[class*=campaign]')
    // undecorated section metadata
    || [...document.querySelectorAll('.section-metadata div')].some((d) => d.textContent.match(/Experiment|Campaign|Audience/i)),
  options: experimentationConfig,
  url: '/plugins/experimentation/src/index.js',
});
```

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

There are various aspects of the plugin that you can configure via options you are passing to the 2 main methods above (`runEager`/`runLazy`).
You have already seen the `audiences` option in the examples above, but here is the full list we support:

```js
runEager.call(document, {
  // Lets you configure the prod environment.
  // (prod environments do not get the pill overlay)
  prodHost: 'www.my-website.com',
  // if you have several, or need more complex logic to toggle pill overlay, you can use
  isProd: () => !window.location.hostname.endsWith('hlx.page')
    && window.location.hostname !== ('localhost'),

  // the storage type used to persist data between page views
  // (for instance to remember what variant in an experiment the user was served)
  storage: window.sessionStorage,

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
});
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

The experimentation plugin exposes APIs that allow you to integrate with analytics platforms and other 3rd-party libraries.
The plugin exposes experiment data through two mechanisms:
1. **Events** - React immediately when experiments are applied (V2 only)
2. **Global Objects** - Access complete experiment details after page load

### Available APIs

#### Events

Listen for the `aem:experimentation` event to react when experiments, campaigns, or audiences are applied:

```javascript
document.addEventListener('aem:experimentation', (event) => {
  console.log(event.detail);
});
```

The event details will contain one of 3 possible sets of properties:

- **For experiments:**
```javascript
{
  type: 'experiment',
  element: DOMElement, // the DOM element that was modified
  experiment: 'experiment-name', // the experiment name
  variant: 'variant-name' // the variant name that was served
}
```

- **For campaigns:**
```javascript
{
  type: 'campaign',
  element: DOMElement, // the DOM element that was modified
  campaign: 'campaign-name' // the campaign that was resolved
}
```

- **For audiences:**
```javascript
{
  type: 'audience',
  element: DOMElement, // the DOM element that was modified
  audience: 'audience-name' // the audience that was resolved
}
```

#### Global Objects

You can leverage the following global JS objects:

```javascript
// All experiments (page, section, fragment levels)  
const allExperiments = window.hlx.experiments;

// All audiences (page, section, fragment levels)
const allAudiences = window.hlx.audiences;

// All campaigns (page, section, fragment levels)
const allCampaigns = window.hlx.campaigns;

// backward compatibility with V1
const experiment = window.hlx.experiment;
const audience = window.hlx.audience;
const campaign = window.hlx.campaign;
```

- **Array Structure:**

`window.hlx.experiments`, `window.hlx.audiences`, and `window.hlx.campaigns` are each an array of objects containing:

```javascript
[
  {
    type: 'page', // one of: page, section, fragment
    el: DOMElement, // the DOM element that was modified
    servedExperience: '/variant-url', // the URL for the content that was inlined (if any)
    config: { /* see Complete Reference section below */ }
  }
  // ... more objects for section/fragment level modifications
]
```

### Integration Examples

#### Adobe Analytics, Target & AJO Integration

For Adobe Analytics, Target, and Adobe Journey Optimizer integration:

- **Event-driven approach:**
```javascript
document.addEventListener('aem:experimentation', (event) => {
  if (event.detail.type === 'experiment') {
    const { experiment, variant } = event.detail;
    
    // Choose your Adobe integration method below
  }
});
```

<details>
<summary>Option 1: Adobe Client Data Layer (works with all Adobe products via Tags)</summary>

```javascript
document.addEventListener('aem:experimentation', (event) => {
  if (event.detail.type === 'experiment') {
    const { experiment, variant } = event.detail;
    
    window.adobeDataLayer = window.adobeDataLayer || [];
    window.adobeDataLayer.push({
      event: 'experiment-applied',
      experiment: {
        id: experiment,
        variant: variant
      }
    });
  }
});
```

</details>

<details>
<summary>Option 2: Web SDK with XDM (direct AEP + Analytics integration)</summary>

```javascript
document.addEventListener('aem:experimentation', (event) => {
  if (event.detail.type === 'experiment') {
    const { experiment, variant } = event.detail;
    
    if (window.alloy) {
      alloy("sendEvent", {
        xdm: {
          eventType: "decisioning.propositionDisplay",
          timestamp: new Date().toISOString(),
          _experience: {
            decisioning: {
              propositions: [{
                id: experiment,
                scope: "page",
                items: [{
                  id: variant,
                  schema: "https://ns.adobe.com/personalization/default-content-item"
                }]
              }],
              propositionEventType: {
                display: 1
              }
            }
          }
        },
        data: {
          __adobe: {
            analytics: {
              eVar1: experiment,
              eVar2: variant,
              events: "event1"
            }
          }
        }
      });
    }
  }
});
```

</details>

- **Global object approach:**
```javascript
if (window.hlx.experiment) {
  const { id, selectedVariant } = window.hlx.experiment;
  
  // Choose your Adobe integration method below
}
```

<details>
<summary>Option 1: Adobe Client Data Layer (works with all Adobe products via Tags)</summary>

```javascript
if (window.hlx.experiment) {
  const { id, selectedVariant } = window.hlx.experiment;
  
  window.adobeDataLayer = window.adobeDataLayer || [];
  window.adobeDataLayer.push({
    event: 'experiment-applied',
    experiment: {
      id: id,
      variant: selectedVariant
    }
  });
}
```

</details>

<details>
<summary>Option 2: Web SDK with XDM (direct AEP + Analytics integration)</summary>

```javascript
if (window.hlx.experiment) {
  const { id, selectedVariant } = window.hlx.experiment;
  
  if (window.alloy) {
    alloy("sendEvent", {
      xdm: {
        eventType: "decisioning.propositionDisplay",
        timestamp: new Date().toISOString(),
        _experience: {
          decisioning: {
            propositions: [{
              id: id,
              scope: "page",
              items: [{
                id: selectedVariant,
                schema: "https://ns.adobe.com/personalization/default-content-item"
              }]
            }],
            propositionEventType: {
              display: 1
            }
          }
        }
      },
      data: {
        __adobe: {
          analytics: {
            eVar1: id,
            eVar2: selectedVariant,
            events: "event1"
          }
        }
      }
    });
  }
}
```

</details>

#### Google Tag Manager / Google Analytics

- **Event-driven integration (recommended):**
```javascript
document.addEventListener('aem:experimentation', (event) => {
  if (event.detail.type === 'experiment') {
    const { experiment, variant } = event.detail;
    
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'experiment_view',
      experiment_id: experiment,
      experiment_variant: variant
    });
  }
});
```

- **Global object access:**
```javascript
if (window.hlx.experiment) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'experiment_view',
    experiment_id: window.hlx.experiment.id,
    experiment_variant: window.hlx.experiment.selectedVariant
  });
}
```

#### Tealium

- **Event-driven integration (recommended):**
```javascript
document.addEventListener('aem:experimentation', (event) => {
  if (event.detail.type === 'experiment') {
    const { experiment, variant } = event.detail;
    
    window.utag_data = window.utag_data || {};
    window.utag_data.cms_experiment = `${experiment}:${variant}`;
  }
});
```

- **Global object access:**
```javascript
// Example from UPS implementation
if (window.hlx.experiment) {
  window.utag_data = window.utag_data || {};
  window.utag_data.cms_experiment = `${window.hlx.experiment.id}:${window.hlx.experiment.selectedVariant}`;
}
```

### Implementation Notes

- **Customer responsibility**: You implement the analytics integration in your project code
- **Runtime only**: Data is available at runtime - no backend integration provided  
- **Project-specific**: Integration depends on your analytics setup and project structure
- **Existing analytics required**: Your analytics platform must already be implemented

### Complete Reference

#### Experiment Config Structure

Here's the complete experiment config structure available in `window.hlx.experiment`:

```javascript
{
  id: "experiment-name",
  selectedVariant: "challenger-1", 
  status: "active",
  variantNames: ["control", "challenger-1"],
  audiences: ["mobile", "desktop"],
  resolvedAudiences: ["mobile"],
  run: true,
  variants: {
    control: { percentageSplit: "0.5", pages: ["/current"], label: "Control" },
    "challenger-1": { percentageSplit: "0.5", pages: ["/variant"], label: "Challenger 1" }
  }
}
```

> **Note**: For analytics integration, you typically only need `id` and `selectedVariant`. The full config structure above is available if you need detailed experiment settings for custom logic.
