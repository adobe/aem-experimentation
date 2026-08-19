/**
 * Returns alloy configuration
 * Documentation https://experienceleague.adobe.com/docs/experience-platform/edge/fundamentals/configuring-the-sdk.html
 */
function getAlloyConfiguration(document, { edgeConfigId, orgId, enhanceAnalyticsEvent }) {
  const { hostname } = document.location;

  return {
    // enable while debugging
    debugEnabled: hostname.startsWith('localhost') || hostname.includes('--'),
    // disable when clicks are also tracked via sendEvent with additional details
    clickCollectionEnabled: true,
    // adjust default based on customer use case
    defaultConsent: 'in',
    edgeConfigId,
    orgId,
    onBeforeEventSend: enhanceAnalyticsEvent,
  };
}

async function setupAlloy(document, options) {
  // eslint-disable-next-line no-undef
  let loadPromise = Promise.resolve();
  if (!window.alloy) {
    /* eslint-disable */
    (function(n,o){o.forEach(function(o){n[o]||((n.__alloyNS=n.__alloyNS||
    []).push(o),n[o]=function(){var u=arguments;return new Promise(
    function(i,l){n[o].q.push([i,l,u])})},n[o].q=[])}) }
    (window, ["alloy"]));
    /* eslint-enable */
    loadPromise = import('./alloy-2.19.2.min.js');
  }
  return loadPromise.then(() => {
    window.alloy('configure', getAlloyConfiguration(document, options));
  });
}

function getSegmentsFromAlloyResponse(response) {
  const segments = [];
  if (response && response.destinations) {
    Object.values(response.destinations).forEach((destination) => {
      if (destination.segments) {
        Object.values(destination.segments).forEach((segment) => {
          segments.push(segment.id);
        });
      }
    });
  }
  return segments;
}

let segments;
let renderDecisions;

// eslint-disable-next-line import/prefer-default-export
export async function getSegmentsFromAlloy(options) {
  // {
  //   edgeConfigId: '2324184b-260b-4d66-a8ca-897ab9374fb3',
  //   orgId: '908936ED5D35CC220A495CD4@AdobeOrg',
  //   enhanceAnalyticsEvent: (...args) => console.log(args),
  //   isConsentGiven: () => true,
  // }
  console.assert(options.edgeConfigId, 'aep.edgeConfigId is required');
  console.assert(options.orgId, 'aep.orgId is required');
  console.assert(options.isConsentGiven, 'aep.isConsentGiven is required');

  // make sure that the cookie consent is available before making the call to alloy,
  // otherwise the call will be queued and never executed
  if (!options.isConsentGiven()) {
    return [];
  }

  if (segments) {
    return segments;
  }

  if (!window.alloy) {
    await setupAlloy(document, options);
  }

  // avoid multiple calls to alloy for render decisions from different audiences
  if (renderDecisions) {
    return getSegmentsFromAlloyResponse(renderDecisions);
  }

  try {
    renderDecisions = await window.alloy('sendEvent', {
      renderDecisions: true,
    });
    segments = getSegmentsFromAlloyResponse(renderDecisions);
    return segments;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error sending event to alloy:', err);
    return [];
  }
}
