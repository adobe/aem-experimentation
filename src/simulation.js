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
 * Simulation / preview UI for the experimentation plugin.
 *
 * This module is intentionally kept out of the core engine (index.js) and is
 * only ever loaded lazily, in preview/development environments, via a dynamic
 * import from `loadLazy`. Production pages never download or parse it.
 *
 * The tiny, UI-less `postMessage` handshake the panel talks over lives in
 * index.js instead (setupCommunicationLayer), so it can be registered eagerly
 * and never miss a bookmarklet-injected MFE. This module owns only the heavy
 * part: loading the hosted MFE and wiring the Sidekick toolbar button to it.
 */

/**
 * Logs a debug message. This module is only ever imported in preview/dev (from
 * `loadLazy`, behind the debug-mode check), so logging is always enabled here.
 * @param {...*} args the values to log
 */
function debug(...args) {
  // eslint-disable-next-line no-console
  console.debug('[aem-experimentation]', ...args);
}

// The panel itself ships as a hosted micro-frontend that the Sidekick extension
// loads on demand; this module only wires the toolbar button to it.
const SIMULATION_MFE_URL = 'https://experience.adobe.com/solutions/ExpSuccess-aem-experimentation-mfe/static-assets/resources/sidekick/client.js?source=plugin';
const SIMULATION_SIDEKICK_EVENT = 'custom:aem-experimentation-sidekick';
const SIMULATION_PANEL_ID = 'aemExperimentation';
const SIMULATION_PANEL_HIDDEN_CLASS = 'aemExperimentationHidden';

let isSimulationUIInitialized = false;

/**
 * Creates a controller for the hosted simulation panel that loads the MFE once
 * (on first use) and then just toggles its visibility.
 * @param {Document} doc The document object
 * @returns {{ open: Function, toggle: Function }} the panel controller
 */
function createSimulationPanelController(doc) {
  let loadPromise = null;

  const togglePanel = (forceShow = false) => {
    const container = doc.getElementById(SIMULATION_PANEL_ID);
    if (!container) {
      return;
    }
    if (forceShow) {
      container.classList.remove(SIMULATION_PANEL_HIDDEN_CLASS);
    } else {
      container.classList.toggle(SIMULATION_PANEL_HIDDEN_CLASS);
    }
  };

  const load = () => {
    if (loadPromise) {
      return loadPromise;
    }
    loadPromise = new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = SIMULATION_MFE_URL;
      script.onload = () => {
        // The MFE injects its own container asynchronously, so wait for it to
        // appear (bounded) before resolving.
        let tries = 0;
        const waitForContainer = () => {
          if (doc.getElementById(SIMULATION_PANEL_ID)) {
            resolve();
          } else if (tries >= 20) {
            // Resolve anyway so we don't hang, but flag it: a subsequent
            // togglePanel() will silently no-op without a container, so this
            // distinguishes "MFE never injected its panel" from "button not wired".
            debug('Simulation panel container did not appear after loading the MFE; the panel will not toggle.');
            resolve();
          } else {
            tries += 1;
            setTimeout(waitForContainer, 200);
          }
        };
        waitForContainer();
      };
      script.onerror = (e) => {
        // Drop the cached (rejected) promise so the next toggle retries the
        // load instead of permanently bricking the button on a transient blip.
        loadPromise = null;
        reject(e);
      };
      doc.head.appendChild(script);
    });
    return loadPromise;
  };

  const open = () => load()
    .then(() => togglePanel(true))
    .catch((e) => debug('Failed to open simulation panel:', e));

  const toggle = () => {
    // The first interaction loads the MFE and reveals the panel; afterwards we
    // just show/hide the already-loaded panel.
    if (!loadPromise) {
      return open();
    }
    togglePanel(false);
    return loadPromise;
  };

  return { open, toggle };
}

/**
 * Wires up the AEM Sidekick simulation panel: binds the toolbar button to the
 * panel, opens it on a simulation deep-link, and restores it after a reload.
 * @param {Object} pluginOptions the plugin options
 * @param {Document} doc The document object
 * @param {string} reopenKey sessionStorage key used to re-open after a reload
 */
function setupSimulationUI(pluginOptions, doc, reopenKey) {
  // Guard against a consumer's loadLazy running more than once (e.g. on
  // client-side navigation), which would otherwise stack duplicate button
  // listeners and make each click toggle the panel twice — appearing dead.
  if (isSimulationUIInitialized) {
    return;
  }
  isSimulationUIInitialized = true;

  const panel = createSimulationPanelController(doc);

  const SIDEKICK_SELECTOR = 'aem-sidekick, helix-sidekick';
  const SIDEKICK_BOUND_ATTR = 'data-aem-experimentation-bound';

  const attachToSidekick = (sk) => {
    // Multiple discovery paths (sync query, sidekick-ready, and the poll below)
    // may all fire, so only bind the toggle listener once per element.
    if (sk.hasAttribute(SIDEKICK_BOUND_ATTR)) {
      return;
    }
    sk.setAttribute(SIDEKICK_BOUND_ATTR, '');
    sk.addEventListener(SIMULATION_SIDEKICK_EVENT, () => panel.toggle());
  };

  // The Sidekick custom element is injected by the extension asynchronously and
  // may appear before or after this runs. Bind if it's already here; otherwise
  // listen for its ready event AND poll briefly, since the event can fire before
  // our listener is attached and would otherwise be missed silently.
  const sidekick = doc.querySelector(SIDEKICK_SELECTOR);
  if (sidekick) {
    attachToSidekick(sidekick);
  } else {
    doc.addEventListener('sidekick-ready', () => {
      const sk = doc.querySelector(SIDEKICK_SELECTOR);
      if (sk) {
        attachToSidekick(sk);
      }
    }, { once: true });

    let tries = 0;
    const pollForSidekick = () => {
      const sk = doc.querySelector(SIDEKICK_SELECTOR);
      if (sk) {
        attachToSidekick(sk);
      } else if (tries < 20) {
        tries += 1;
        setTimeout(pollForSidekick, 200);
      }
    };
    pollForSidekick();
  }

  // Open the panel straight away when the page is loaded with a simulation
  // deep-link (e.g. ?experiment=<id>/<variant> shared from the panel).
  const usp = new URLSearchParams(window.location.search);
  const [experimentId, variantId] = (usp.get(pluginOptions.experimentsQueryParameter) || '').split('/');
  if (experimentId && variantId) {
    panel.open();
  }

  // Re-open the panel after a variant switch forced a full-page reload.
  try {
    if (window.sessionStorage.getItem(reopenKey) === 'true') {
      window.sessionStorage.removeItem(reopenKey);
      panel.open();
    }
  } catch (e) {
    debug('Failed to read simulation panel state:', e);
  }
}

/**
 * Entry point for the lazily-loaded simulation UI. Wires up the Sidekick panel.
 * The postMessage handshake it talks over is set up eagerly in index.js
 * (setupCommunicationLayer), so it already exists by the time this runs.
 * @param {Object} pluginOptions the plugin options
 * @param {Document} doc The document object
 * @param {string} reopenKey sessionStorage key used to re-open after a reload
 */
export default function setupSimulation(pluginOptions, doc, reopenKey) {
  setupSimulationUI(pluginOptions, doc, reopenKey);
}
