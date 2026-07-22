/* eslint-disable */
(function () {
  function isDebugEnvironment() {
    const { host, hostname, origin } = window.location;

    return (
      hostname === 'localhost' ||
      hostname.endsWith('.page') ||
      (window.hlx?.experimentation?.options?.isProd &&
        typeof window.hlx.experimentation?.options?.isProd === 'function' &&
        !window.hlx.experimentation?.options?.isProd()) ||
      (window.hlx?.experimentation?.options?.prodHost &&
        ![host, hostname, origin].includes(
          window.hlx.experimentation?.options?.prodHost
        )) ||
      false
    );
  }

  if (!isDebugEnvironment()) {
    // eslint-disable-next-line no-console
    console.log(
      '[AEM Exp] Experimentation UI disabled in production environment'
    );
    return;
  }

  let isAEMExperimentationAppLoaded = false;
  let scriptLoadPromise = null;
  let isHandlingSimulation = false;

  function toggleExperimentPanel(forceShow = false) {
    const container = document.getElementById('aemExperimentation');
    if (container) {
      if (forceShow) {
        container.classList.remove('aemExperimentationHidden');
      } else {
        container.classList.toggle('aemExperimentationHidden');
      }
    }
  }

  function loadAEMExperimentationApp() {
    if (scriptLoadPromise) {
      return scriptLoadPromise;
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
      if (isAEMExperimentationAppLoaded) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src =
        'https://experience.adobe.com/solutions/ExpSuccess-aem-experimentation-mfe/static-assets/resources/sidekick/client.js?source=plugin';

      script.onload = function () {
        isAEMExperimentationAppLoaded = true;
        const waitForContainer = (retries = 0, maxRetries = 20) => {
          const container = document.getElementById('aemExperimentation');
          if (container) {
            toggleExperimentPanel(true);
            resolve();
          } else if (retries < maxRetries) {
            setTimeout(() => waitForContainer(retries + 1, maxRetries), 200);
          } else {
            resolve();
          }
        };

        waitForContainer();
      };

      script.onerror = reject;
      document.head.appendChild(script);
    });

    return scriptLoadPromise;
  }

  function checkExperimentParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const experimentParam = urlParams.get('experiment');

    if (experimentParam && !isHandlingSimulation) {
      const decodedParam = decodeURIComponent(experimentParam);

      const [experimentId, variantId] = decodedParam.split('/');
      if (experimentId && variantId) {
        isHandlingSimulation = true;
        loadAEMExperimentationApp()
          .then(() => {
            toggleExperimentPanel(true);
          })
          .catch((error) => {
            console.error('[AEM Exp] Error loading app:', error);
          });
      }
    }
  }

  function handleSidekickPluginButtonClick() {
    if (!isAEMExperimentationAppLoaded) {
      loadAEMExperimentationApp()
        .then(() => {
          console.log('[AEM Exp] First load - showing panel');
          toggleExperimentPanel(true);
        })
        .catch((error) => {
          console.error('[AEM Exp] Failed to load:', error);
        });
    } else {
      toggleExperimentPanel(false);
    }
  }

  // Initialize Sidekick
  const sidekick = document.querySelector('helix-sidekick, aem-sidekick');
  if (sidekick) {
    sidekick.addEventListener(
      'custom:aem-experimentation-sidekick',
      handleSidekickPluginButtonClick
    );
  } else {
    document.addEventListener(
      'sidekick-ready',
      () => {
        const sidekickElement = document.querySelector(
          'helix-sidekick, aem-sidekick'
        );
        if (sidekickElement) {
          sidekickElement.addEventListener(
            'custom:aem-experimentation-sidekick',
            handleSidekickPluginButtonClick
          );
        }
      },
      { once: true }
    );
  }

  // Check for experiment parameters on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkExperimentParams);
  } else {
    checkExperimentParams();
  }

  window.addEventListener('message', function (event) {
    if (!event.data) return;

    const shouldReload =
      event.data.type === 'hlx:experimentation-window-reload' &&
      event.data.action === 'reload';

    if (shouldReload) {
      sessionStorage.setItem('aem_experimentation_open_panel', 'true');
      window.location.reload();
    }
  });

  if (sessionStorage.getItem('aem_experimentation_open_panel') === 'true') {
    sessionStorage.removeItem('aem_experimentation_open_panel');
    handleSidekickPluginButtonClick();
  }
})();
