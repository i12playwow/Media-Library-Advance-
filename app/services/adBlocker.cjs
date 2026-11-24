'use strict';
// Lightweight ad blocker for the in-app browser session. Filters are
// compiled EasyList-style patterns: network rules (|http…, ||domain^,
// generic keyword blocks) checked against every request URL, plus
// host-only blocklists. Document/stylesheet/image loads on the blocked
// host are cancelled with a counter surfaced in the browser toolbar.
// A small allowlist keeps first-party pages, the app's own protocol, and
// login/checkout endpoints working.

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
  'whi accidents', 'yandexadexchange', 'zenads', 'ad.360yield',
  'ad.22dhub', 'ad.4wnet', 'ad.dynamicyield', 'ad.hi-media', 'ad.leadbolt',
  'ad.mox.tv', 'ad.tpm.ru', 'ad.mail.ru', 'ad.yieldlab', 'ads.pinterest',
  'ads.reddit', 'ads.twitter', 'ads.x.com', 'ads.youtube', 'ads.yimg',
  'analytics.tiktok', 'an.yandex.ru', 'pixel.ad', 'pixel.facebook',
  'pixel.twimg', 'px.ads', 'securepubads.g.doubleclick', 'syndication.twitter',
  'syndication.exoclick', 'track.adform', 'track.adroll', 'widgets.outbrain'
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
  /\/recaptcha\//i
];

function hostFragmentBlocked(hostname) {
  const host = hostname.toLowerCase();
  return BLOCK_HOST_FRAGMENTS.some(fragment => host.includes(fragment));
}

function urlPatternBlocked(rawUrl) {
  return BLOCK_URL_PATTERNS.some(pattern => pattern.test(rawUrl));
}

function allowed(rawUrl) {
  return ALLOW_PATTERNS.some(pattern => pattern.test(rawUrl));
}

function shouldBlock(rawUrl, resourceType, pageOrigin) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  if (allowed(rawUrl)) return false;
  let url;
  try { url = new URL(rawUrl); } catch { return false; }
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  // Never block same-origin requests: the page's own site must work.
  try {
    if (pageOrigin && url.origin === new URL(pageOrigin).origin) return false;
  } catch { /* fall through */ }
  if (resourceType === 'mainFrame') return false;
  return hostFragmentBlocked(url.hostname) || urlPatternBlocked(rawUrl);
}

function attachAdBlocker({ session, onBlocked }) {
  let blocked = 0;
  const handles = [];
  for (const sender of [session.webRequest]) {
    const webRequest = sender;
    const handler = (details, callback) => {
      const pageOrigin = details.referrer ? (() => { try { return new URL(details.referrer).origin; } catch { return ''; } })() : '';
      if (shouldBlock(details.url, details.resourceType, pageOrigin)) {
        blocked++;
        if (blocked % 5 === 0 || blocked === 1) onBlocked?.(blocked);
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
    };
    webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, handler);
    handles.push({ webRequest, handler });
  }
  return {
    count: () => blocked,
    reset: () => { blocked = 0; onBlocked?.(blocked); },
    dispose: () => {
      for (const { webRequest, handler } of handles) {
        try { webRequest.onBeforeRequest(null, handler); } catch { /* session gone */ }
      }
    }
  };
}

module.exports = { attachAdBlocker, shouldBlock, BLOCK_HOST_FRAGMENTS, BLOCK_URL_PATTERNS, ALLOW_PATTERNS };
