'use strict';
// Shield engine for the in-app browser: the Electron host for Brave's Shields.
//
// Three levels mirror Brave's own: `off` filters nothing, `standard` blocks
// ads and trackers, `strict` additionally blocks ad/tracker scripts. Each
// rule carries its category so the toolbar can report *what* was blocked, and
// per-site overrides let one site relax while everything else stays protected.
//
// The allowlist is generous on purpose: authentication, payment, video
// playback, Cloudflare challenges and the app's own protocols must never be
// cancelled, because a blocked login looks like a broken browser.

const BLOCK_HOST_FRAGMENTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.', 'adnxs.com', 'adsrvr.org', 'rubiconproject.com',
  'pubmatic.com', 'openx.net', 'criteo.com', 'criteo.net', 'taboola.com',
  'outbrain.com', 'zedo.com', 'adcolony.com', 'admob.com', 'applovin.com',
  'chartboost.com', 'inmobi.com', 'moatads.com', 'amazon-adsystem.com',
  'adsystem.amazon.', '2mdn.net', 'smartadserver.com', 'adsafeprotected.com',
  'scorecardresearch.com', 'quantserve.com', 'casalemedia.com', 'adroll.com',
  'bidswitch.net', 'sharethrough.com', 'spotxchange.com', 'teads.tv',
  'yieldmo.com', 'indexww.com', 'gumgum.com', 'media.net', 'adform.net',
  'adition.com', 'adition.net', 'adscale.de', 'advolution.de',
  'advertising.com', 'adtechus.com', 'advertising.amazon.', 'adzerk.net',
  'dan.org', 'glanceadtech.', 'hits4pay', 'intellitxt.com', 'kelkoo',
  'linkedads', 'loudserver', 'madsone', 'mediaads', 'mgid.com',
  'moatpixel', 'nuffnang', 'onclickads.net', 'onetag-sys.com',
  'popads.net', 'popcash.net', 'propellerads', 'revcontent.com',
  'rhythmone.com', 'servenobid', 'smaato.net', 'sociablade',
  'startapp.com', 'sundaysky.com', 'targeting.', 'telemetryverification',
  'tractorslab', 'unityads.unity3d.com', 'upsellit.com', 'vidoomy.com',
  'viglink.com', 'vizu.com', 'webads', 'yieldlab.net', 'zdbb.net',
  'zemanta.com', 'ad-delivery.net', 'adfox.ru', 'adhigh.net',
  'adnami.io', 'adpone.com', 'adprime.com', 'adsco.re', 'adskeeper',
  'adsterra', 'adtaily', 'aduptive', 'adxcg', 'adyard', 'adzcentral',
  'affiliates.', 'clickaine', 'clickadu', 'coinzilla', 'exoclick.com',
  'exosrv.com', 'hilltopads', 'jsecoin', 'juicyads', 'kinad', 'mcads',
  'metaads', 'nativeads', 'oilad', 'plista.com', 'popmyads', 'pushwhy',
  'reklamstore', 'smartad', 'squareads', 'trafficfactory', 'trafficjunky',
  'yandexadexchange', 'zenads', 'ad.360yield',
  'ad.22dhub', 'ad.4wnet', 'ad.dynamicyield', 'ad.hi-media', 'ad.leadbolt',
  'ad.mox.tv', 'ad.tpm.ru', 'ad.mail.ru', 'ad.yieldlab', 'ads.pinterest',
  'ads.reddit', 'ads.twitter', 'ads.x.com', 'ads.youtube', 'ads.yimg',
  'analytics.tiktok', 'an.yandex.ru', 'pixel.ad', 'pixel.facebook',
  'pixel.twimg', 'px.ads', 'securepubads.g.doubleclick', 'syndication.twitter',
  'syndication.exoclick', 'track.adform', 'track.adroll', 'widgets.outbrain'
];

// Pure trackers: analytics beacons that never render anything a person needs.
const TRACKER_HOST_FRAGMENTS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.',
  'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'heap.io',
  'fullstory.com', 'hotjar.com', 'mouseflow.com', 'clarity.ms',
  'statcounter.com', 'histats.com', 'matomo.', 'piwik.', 'plausible.io',
  'branch.io', 'appsflyer.com', 'adjust.com', 'kochava.com', 'newrelic.com',
  'bugsnag.com', 'sentry-cdn.com', 'optimizely.com', 'vwo.com',
  'crazyegg.com', 'clicktale.net', 'luckyorange.com', 'inspectlet.com',
  'doubleverify.com', 'adsafeprotected', 'nielsen.com', 'comscore.com',
  'chartbeat.com', 'parsely.com', 'quantum-advertising', 'bluekai.com',
  'demdex.net', 'krxd.net', 'rlcdn.com', 'agkn.com', 'mathtag.com',
  'tapad.com', 'addthis.com', 'sharethis.com', 'disqus.com/count'
];

const BLOCK_URL_PATTERNS = [
  /\/ads?\/(?:[a-z0-9_/.-]*)$/i,
  /\/ad(?:server|serv|frame|view|banner|call|image|creative)s?\//i,
  /\/prebid(?:js)?[/?]|\/openrtb2?\/(?:auction|request)/i,
  /\/pagead\/|\/adsbygoogle|\/b(?:eacon|anner)?\.js\?(?:.*&)?ad/i,
  /[?&](?:adunit|adslot|adsize|adtype|adunitid|adunitpath)=/i,
  /\/giftalk\//i,
  /\/iadsdk\//i,
  /\/rtb(?:\d)?\/(?:banner|video|native|sync)/i,
  /\/v3?\/ads?\/|\/v4?\/ads?\//i,
  /\/zergnet\//i,
  /(?:^|[./])banners?\.[a-z0-9-]+\.[a-z]{2,}\//i,
  /\/impre?ssions?(?:\?|\/|$)/i,
  /\/pixel(?:\.[a-z0-9-]+)?\?(?:.*)&?(?:id|uid|tag)=/i,
  /\/tracker(?:\.js|\.gif|\.png)\?|\/track\?(?:.*)&?event=|\/track(?:ing)?\.gif\?/i,
  /\/collect\?(?:.*)&?t=pageview/i,
  /\/analytics(?:\.min)?\.js$/i,
  /\/gtag\/js|\/gtm\.js\?|\/fbevents\.js/i,
  /\/hotjar-|\/statcounter|\/histats\.js/i
];

// Tracker-only URL shapes, mapped to the tracker category so the toolbar
// counter separates "ad" from "tracker" the way Brave's does.
const TRACKER_URL_PATTERNS = [
  /\/collect\?(?:.*)&?(?:v|t|tid|aid)=/i,
  /\/j\?(?:.*)&?(?:v|tid)=/i,
  /\/g\/collect|\/batch\/|\/beacon\.gif/i,
  /\/pixel\.(?:gif|png|js)|\/px\.(?:gif|png)|\/track\.gif/i,
  /\/umami|\/matomo\.js|\/piwik\.js|\/plausible\.js/i
];

// Fingerprinting surface: canvas/WebGL probes and font enumeration scripts.
const FINGERPRINT_URL_PATTERNS = [
  /fingerprint2?\.js|fingerprintjs|\/fp\.js|\/fpjs\//i,
  /\/canvas[-_.]?fingerprint/i,
  /clientjs\.min\.js/i
];

const ALLOW_PATTERNS = [
  /^devtools:/i,
  /^mla-media:/i,
  /^file:/i,
  /^chrome(?:-extension)?:/i,
  /^data:/i,
  /^blob:/i,
  /(?:^|\.)youtube\.com\/(?:embed|watch|get_video_info|videoplayback)/i,
  /(?:^|\.)youtube\.com\/api\/stats\/ads/i,
  /(?:^|\.)googlevideo\.com\/videoplayback/i,
  /(?:^|\.)vimeo\.com\/(?:video|player)/i,
  /\/(?:login|signin|oauth|auth|checkout|pay|payment|cart|subscription|register)(?:[/?#]|$)/i,
  /(?:^|\.)cloudflare\.com\/cdn-cgi\//i,
  /\/sw\.js$|\/workbox-/i,
  /(?:^|\.)recaptcha(?:-api)?\.net/i,
  /\/recaptcha\//i,
  /(?:^|\.)hcaptcha\.com|\/hcaptcha\//i,
  /(?:^|\.)turnstile\//i,
  /\/captcha\//i
];

function fragmentMatches(host, fragments) {
  const lower = host.toLowerCase();
  return fragments.some(fragment => lower.includes(fragment));
}

function hostFragmentBlocked(hostname) {
  return fragmentMatches(hostname, BLOCK_HOST_FRAGMENTS);
}

function hostFragmentIsTracker(hostname) {
  return fragmentMatches(hostname, TRACKER_HOST_FRAGMENTS);
}

function urlPatternBlocked(rawUrl) {
  return BLOCK_URL_PATTERNS.some(pattern => pattern.test(rawUrl));
}

function allowed(rawUrl) {
  return ALLOW_PATTERNS.some(pattern => pattern.test(rawUrl));
}

const SCRIPT_TYPES = new Set(['script', 'subFrame', 'xhr', 'fetch', 'other']);

/**
 * Decides what to do with one request.
 *
 * Returns `{ block: false }` when the request may proceed, otherwise
 * `{ block: true, category }` where category is 'ad' | 'tracker' |
 * 'fingerprint' | 'script'. A category of `null` means "allowed" — callers
 * should test `block` rather than the category.
 */
function classifyRequest(rawUrl, resourceType, pageOrigin, options = {}) {
  const level = options.level || 'standard';
  if (level === 'off') return { block: false };
  if (!rawUrl || typeof rawUrl !== 'string') return { block: false };
  if (allowed(rawUrl)) return { block: false };
  let url;
  try { url = new URL(rawUrl); } catch { return { block: false }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { block: false };
  // Never block same-origin requests: the page's own site must work.
  let sameOrigin = false;
  if (pageOrigin) {
    try { sameOrigin = url.origin === new URL(pageOrigin).origin; } catch { /* ignore */ }
  }
  if (resourceType === 'mainFrame') return { block: false };
  // First-party ad path (e.g. /ads/banner.js on the page's own host) is left
  // alone — removing it usually breaks the site's own layout.
  if (sameOrigin) return { block: false };

  if (options.blockFingerprinting !== false && FINGERPRINT_URL_PATTERNS.some(p => p.test(rawUrl))) {
    return { block: true, category: 'fingerprint' };
  }
  if (options.blockAds !== false && (hostFragmentBlocked(url.hostname) || urlPatternBlocked(rawUrl))) {
    // Tracker hosts win when a URL matches both lists: it is a beacon.
    if (options.blockTrackers !== false && (hostFragmentIsTracker(url.hostname) || TRACKER_URL_PATTERNS.some(p => p.test(rawUrl)))) {
      return { block: true, category: 'tracker' };
    }
    return { block: true, category: 'ad' };
  }
  if (options.blockTrackers !== false && (hostFragmentIsTracker(url.hostname) || TRACKER_URL_PATTERNS.some(p => p.test(rawUrl)))) {
    return { block: true, category: 'tracker' };
  }
  // Strict mode also cancels third-party scripts outright.
  if (level === 'strict' && options.blockScripts !== false && SCRIPT_TYPES.has(resourceType)) {
    return { block: true, category: 'script' };
  }
  return { block: false };
}

/** Back-compat shape used by older call sites and tests. */
function shouldBlock(rawUrl, resourceType, pageOrigin, options) {
  return classifyRequest(rawUrl, resourceType, pageOrigin, options).block;
}

/** Rewrites http:// to https:// when the host is not a known plain-HTTP box. */
function upgradeConnection(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return rawUrl;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.local')) return rawUrl;
    url.protocol = 'https:';
    return url.href;
  } catch {
    return rawUrl;
  }
}

function createShields(session, resolveOptions, onBlocked) {
  const counts = { ad: 0, tracker: 0, fingerprint: 0, script: 0, total: 0 };
  const handled = new WeakSet();
  // Per-session counters would be more accurate, but the toolbar shows one
  // running total for the active tab and the categories are what operators
  // read, so a single aggregate is both simpler and enough.
  const targets = Array.isArray(session) ? session : [session];

  function attach(target) {
    if (!target?.webRequest || handled.has(target)) return false;
    handled.add(target);
    target.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      let pageOrigin = '';
      if (details.referrer) {
        try { pageOrigin = new URL(details.referrer).origin; } catch { pageOrigin = ''; }
      }
      const decision = classifyRequest(details.url, details.resourceType, pageOrigin, resolveOptions(pageOrigin));
      if (!decision.block) return callback({ cancel: false });
      counts[decision.category] = (counts[decision.category] ?? 0) + 1;
      counts.total += 1;
      // Throttle notifications: the toolbar only shows totals, and every
      // blocked image firing an IPC message would swamp the renderer.
      if (counts.total === 1 || counts.total % 5 === 0) onBlocked?.(counts);
      return callback({ cancel: true });
    });
    return true;
  }

  for (const target of targets) attach(target);

  return {
    attach,
    counts: () => ({ ...counts }),
    reset: () => {
      for (const key of Object.keys(counts)) counts[key] = 0;
      onBlocked?.(counts);
    },
    dispose: () => { /* rules live on the session; nothing to detach */ }
  };
}

/** Legacy entry point kept so existing wiring keeps working. */
function attachAdBlocker({ session, onBlocked }) {
  const shields = createShields(session, () => ({ level: 'standard', blockAds: true, blockTrackers: true }), onBlocked);
  return {
    count: () => shields.counts().total,
    reset: () => shields.reset(),
    dispose: () => shields.dispose(),
    counts: () => shields.counts()
  };
}

module.exports = {
  attachAdBlocker,
  createShields,
  classifyRequest,
  shouldBlock,
  upgradeConnection,
  hostFragmentBlocked,
  hostFragmentIsTracker,
  BLOCK_HOST_FRAGMENTS,
  TRACKER_HOST_FRAGMENTS,
  BLOCK_URL_PATTERNS,
  TRACKER_URL_PATTERNS,
  FINGERPRINT_URL_PATTERNS,
  ALLOW_PATTERNS
};
