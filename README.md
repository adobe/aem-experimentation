# AEM Edge Delivery Services Experimentation

The AEM Experimentation plugin helps you quickly set up experimentation and segmentation on your AEM project. 
It is currently available to customers in collaboration with AEM Engineering via co-innovation VIP Projects. 
To implement experimentation or personalization use-cases, please reach out to the AEM Engineering team in the Slack channel dedicated to your project.

> **Note:** We are adding new support for the contextual experimentation rail UI. This is still under development. Feel free to reach out if you have any questions via email: aem-contextual-experimentation@adobe.com.

## Features

The AEM Experimentation plugin supports:
- :busts_in_silhouette: serving different content variations to different audiences, including custom audience definitions for your project that can be either resolved directly in-browser or against a trusted backend API.
- :money_with_wings: serving different content variations based on marketing campaigns you are running, so that you can easily track email and/or social campaigns
- :chart_with_upwards_trend: running A/B test experiments on a set of variants to measure and improve the conversion on your site. This works particularly with our :chart: [RUM conversion tracking plugin](https://github.com/adobe/franklin-rum-conversion).
- :shield: privacy-compliant experimentation with built-in consent management support for GDPR, CCPA, and other privacy regulations
- :rocket: easy simulation of each experience and basic reporting leveraging in-page overlays

## Installation

Add the plugin to your AEM project by running:

```sh
git subtree add --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2
```

If you later want to pull the latest changes and update your local copy of the plugin:

```sh
git subtree pull --squash --prefix plugins/experimentation git@github.com:adobe/aem-experimentation.git v2
```

If you prefer using `https` links you'd replace `git@github.com:adobe/aem-experimentation.git` in the above commands by `https://github.com/adobe/aem-experimentation.git`.

## Project instrumentation

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

```

> **Note:** Add the following line to your `head.html` to preload the experiment loader script:
> ```html
> <link rel="modulepreload" href="/scripts/experiment-loader.js" />
> ```

### Step 2: Update `scripts/scripts.js`

Add the following import and configuration at the top of your `scripts/scripts.js`:

```js
import {
  runExperimentation,
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
  prodHost: 'www.mysite.com',
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

The experimentation plugin exposes APIs that allow you to integrate with analytics platforms and other 3rd-party libraries.
The plugin exposes experiment data through two mechanisms:
1. **Events** - React immediately when experiments are applied (V2 only)
2. **Global Objects** - Access complete experiment details after page load

### Available APIs

#### Consent Management

The plugin provides consent management APIs for privacy compliance. Experiments can be configured to require user consent before running.

**APIs:**

```javascript
import { 
  isUserConsentGiven,
  updateUserConsent
} from './plugins/experimentation/src/index.js';

// Check if user has consented to experimentation
const hasConsent = isUserConsentGiven();

// Integrate this with your consent management platform events to track the user's choice
updateUserConsent(true);  // or false to revoke consent
```

**Requiring consent for an experiment:**

Add the `Experiment Requires Consent` metadata property:

| Metadata              |                                                              |
|-----------------------|--------------------------------------------------------------|
| Experiment            | Hero Test                                                    |
| Experiment Variants   | /variant-1, /variant-2                                       |
| Experiment Requires Consent | true                                                   |

**Implementation:**

You can integrate consent management in two ways:

1. **In your `experiment-loader.js`** (recommended) - keeps all experimentation code together
2. **In your `scripts.js`** - if you need consent for other purposes beyond experimentation

<details>
<summary>Recommended: Integrate in experiment-loader.js</summary>

```javascript
// experiment-loader.js
import {
  updateUserConsent,
  isUserConsentGiven,
} from '../plugins/experimentation/src/index.js';

/**
 * Initialize consent management
 * Choose ONE of the setup functions based on your CMP (Consent Management Platform)
 * 
 * IMPORTANT: These are example implementations. Please:
 * 1. Verify the consent categories match your OneTrust/Cookiebot configuration
 * 2. Test thoroughly in your environment
 * 3. Consult with your legal/privacy team about consent requirements
 */
function initConsent() {
  // OPTION 1: OneTrust
  function setupOneTrustConsent() {
    // Step 1: Bridge OneTrust's callback to dispatch a custom event
    window.OptanonWrapper = function() {
      const activeGroups = window.OnetrustActiveGroups || '';
      const groups = activeGroups.split(',').filter(g => g);
      window.dispatchEvent(new CustomEvent('consent.onetrust', { 
        detail: groups 
      }));
    };
    
    // Step 2: Listen for the custom event
    function consentEventHandler(ev) {
      const groups = ev.detail;
      const hasConsent = groups.includes('C0003') // Functional Cookies
        || groups.includes('C0004'); // Targeting Cookies
      updateUserConsent(hasConsent);
    }
    window.addEventListener('consent.onetrust', consentEventHandler);
  }

  // OPTION 2: Cookiebot
  function setupCookiebotConsent() {
    function handleCookiebotConsent() {
      const preferences = window.Cookiebot?.consent?.preferences || false;
      const marketing = window.Cookiebot?.consent?.marketing || false;
      updateUserConsent(preferences || marketing);
    }
    window.addEventListener('CookiebotOnConsentReady', handleCookiebotConsent);
    window.addEventListener('CookiebotOnAccept', handleCookiebotConsent);
  }

  // OPTION 3: Custom Consent Banner
  function setupCustomConsent() {
    document.addEventListener('consent-updated', (event) => {
      updateUserConsent(event.detail.experimentation);
    });
  }

  // Choose ONE:
  setupOneTrustConsent();     // or setupCookiebotConsent() or setupCustomConsent()
}

export async function runExperimentation(document, config) {
  if (!isExperimentationEnabled()) {
    return null;
  }

  // Initialize consent BEFORE loading experimentation
  initConsent();

  const { loadEager } = await import('../plugins/experimentation/src/index.js');
  return loadEager(document, config);
}

// Export consent functions for use elsewhere if needed
export { updateUserConsent, isUserConsentGiven };
```

Your `scripts.js` stays clean - no consent code needed there!

</details>

<details>
<summary>Integrate in scripts.js</summary>

```javascript
// scripts.js
import {
  updateUserConsent,
  isUserConsentGiven,
} from '../plugins/experimentation/src/index.js';

import { runExperimentation } from './experiment-loader.js';

// Setup consent (choose ONE based on your CMP)
function setupOneTrustConsent() {
  // Step 1: Bridge OneTrust's callback to dispatch a custom event
  window.OptanonWrapper = function() {
    const activeGroups = window.OnetrustActiveGroups || '';
    const groups = activeGroups.split(',').filter(g => g);
    window.dispatchEvent(new CustomEvent('consent.onetrust', { 
      detail: groups 
    }));
  };
  
  // Step 2: Listen for the custom event
  function consentEventHandler(ev) {
    const groups = ev.detail;
    const hasConsent = groups.includes('C0003') // Functional Cookies
      || groups.includes('C0004'); // Targeting Cookies
    updateUserConsent(hasConsent);
  }
  window.addEventListener('consent.onetrust', consentEventHandler);
}

async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();

  // Initialize consent BEFORE running experiments
  setupOneTrustConsent();

  await runExperimentation(doc, experimentationConfig);
  
  // ... rest of your code
}
```

</details>

For detailed usage instructions and more examples, see the [Experiments documentation](/documentation/experiments.md#consent-based-experiments).

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
  requiresConsent: false, // whether this experiment requires user consent
  run: true,
  variants: {
    control: { percentageSplit: "0.5", pages: ["/current"], label: "Control" },
    "challenger-1": { percentageSplit: "0.5", pages: ["/variant"], label: "Challenger 1" }
  }
}
```

> **Note**: For analytics integration, you typically only need `id` and `selectedVariant`. The full config structure above is available if you need detailed experiment settings for custom logic.
