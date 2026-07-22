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
const SIMULATION_PANEL_REOPEN_KEY = 'aem-experimentation-simulation-open';

let isCommunicationLayerInitialized = false;

/**
 * Sets up the postMessage handshake the hosted panel/rail UI talks over.
 * @param {Object} options the plugin options
 */
function setupCommunicationLayer(options) {
  // Only ever register once.
  if (isCommunicationLayerInitialized) {
    return;
  }
  isCommunicationLayerInitialized = true;
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'hlx:last-modified-request') {
      const { url } = event.data;

      try {
        const response = await fetch(url, {
          method: 'HEAD',
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
          },
        });

        const lastModified = response.headers.get('Last-Modified');

        event.source.postMessage(
          {
            type: 'hlx:last-modified-response',
            url,
            lastModified,
            status: response.status,
          },
          event.origin,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error fetching Last-Modified header:', error);
      }
    } else if (event.data?.type === 'hlx:experimentation-get-config') {
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
    } else if (
      event.data?.type === 'hlx:experimentation-window-reload'
      && event.data?.action === 'reload'
    ) {
      // Preserve the panel's open state across the reload so it re-opens once
      // the page comes back (see setupSimulationUI).
      try {
        window.sessionStorage.setItem(SIMULATION_PANEL_REOPEN_KEY, 'true');
      } catch (e) {
        debug('Failed to persist simulation panel state:', e);
      }
      window.location.reload();
    }
  });
}

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
          if (doc.getElementById(SIMULATION_PANEL_ID) || tries >= 20) {
            resolve();
          } else {
            tries += 1;
            setTimeout(waitForContainer, 200);
          }
        };
        waitForContainer();
      };
      script.onerror = reject;
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
 */
function setupSimulationUI(pluginOptions, doc) {
  const panel = createSimulationPanelController(doc);

  const attachToSidekick = (sk) => {
    sk.addEventListener(SIMULATION_SIDEKICK_EVENT, () => panel.toggle());
  };

  // The Sidekick custom element may be injected by the extension after this
  // runs, so fall back to its ready event.
  const sidekick = doc.querySelector('aem-sidekick, helix-sidekick');
  if (sidekick) {
    attachToSidekick(sidekick);
  } else {
    doc.addEventListener('sidekick-ready', () => {
      const sk = doc.querySelector('aem-sidekick, helix-sidekick');
      if (sk) {
        attachToSidekick(sk);
      }
    }, { once: true });
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
    if (window.sessionStorage.getItem(SIMULATION_PANEL_REOPEN_KEY) === 'true') {
      window.sessionStorage.removeItem(SIMULATION_PANEL_REOPEN_KEY);
      panel.open();
    }
  } catch (e) {
    debug('Failed to read simulation panel state:', e);
  }
}

/**
 * Entry point for the lazily-loaded simulation UI. Sets up the postMessage
 * handshake and wires up the Sidekick panel.
 * @param {Object} pluginOptions the plugin options
 * @param {Document} doc The document object
 */
export default function setupSimulation(pluginOptions, doc) {
  setupCommunicationLayer(pluginOptions);
  setupSimulationUI(pluginOptions, doc);
}
