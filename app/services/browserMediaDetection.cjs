'use strict';

const MAX_RESULTS = 100;
const MAX_URL_LENGTH = 8192;
const MEDIA_EXTENSION = /\.(?:mp4|m4v|mkv|webm|mov|avi|wmv|mpeg|mpg|mp3|m4a|aac|ogg|oga|opus|wav|flac|m3u8|mpd)(?:$|[?#])/i;
const MANIFEST_EXTENSION = /\.(?:m3u8|mpd)(?:$|[?#])/i;

function discoverPageMedia() {
  const results = new Map();
  const add = (rawUrl, label = '', type = '') => {
    if (results.size >= 100 || typeof rawUrl !== 'string' || rawUrl.length > 8192) return;
    let url;
    try { url = new URL(rawUrl, document.baseURI); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8192) return;
    url.hash = '';
    const href = url.href;
    if (results.has(href)) return;
    const mime = String(type || '').split(';')[0].trim().toLowerCase();
    const manifest = /\.m3u8(?:$|[?#])|\.mpd(?:$|[?#])/i.test(href);
    results.set(href, {
      url: href,
      label: `${label || url.pathname}${manifest ? ` [${/\.mpd(?:$|[?#])/i.test(href) ? 'DASH' : 'HLS'} manifest]` : mime ? ` [${mime}]` : ''}`.slice(0, 200),
      kind: manifest ? 'manifest' : 'file',
      mimeType: mime || undefined
    });
  };

  const addMediaElement = element => {
    add(element.currentSrc || element.src, element.getAttribute('aria-label') || element.getAttribute('title') || 'Media element', element.getAttribute('type') || '');
    for (const source of element.querySelectorAll('source[src]')) add(source.src, source.getAttribute('label') || 'Media source', source.type);
  };
  for (const element of document.querySelectorAll('video, audio')) addMediaElement(element);
  for (const source of document.querySelectorAll('source[src]')) add(source.src, source.getAttribute('label') || 'Media source', source.type);

  const metadataSelectors = [
    'meta[property="og:video"]', 'meta[property="og:video:url"]', 'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]', 'meta[name="twitter:player:stream:content_type"]'
  ];
  for (const meta of document.querySelectorAll(metadataSelectors.join(','))) {
    add(meta.content, meta.getAttribute('property') || meta.getAttribute('name') || 'Page media', meta.getAttribute('type') || '');
  }

  const visitJsonLd = (value, depth = 0) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 100)) visitJsonLd(item, depth + 1); return; }
    if (typeof value !== 'object') return;
    const type = Array.isArray(value['@type']) ? value['@type'].join(',') : String(value['@type'] || '');
    for (const key of ['contentUrl', 'embedUrl', 'url', 'encoding']) {
      const field = value[key];
      if (typeof field === 'string' && (key === 'contentUrl' || key === 'encoding' || MEDIA_EXTENSION.test(field))) add(field, type ? `${type} ${key}` : `JSON-LD ${key}`);
      else if (field && typeof field === 'object') visitJsonLd(field, depth + 1);
    }
    for (const [key, field] of Object.entries(value)) {
      if (['contentUrl', 'embedUrl', 'url', 'encoding'].includes(key)) continue;
      if (field && typeof field === 'object') visitJsonLd(field, depth + 1);
    }
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (script.textContent.length > 1_000_000) continue;
    try { visitJsonLd(JSON.parse(script.textContent)); } catch { /* ignore malformed publisher metadata */ }
  }

  // Resource timing catches media and manifests fetched after the initial DOM was built.
  for (const entry of performance.getEntriesByType('resource').slice(-2000)) {
    if (MEDIA_EXTENSION.test(entry.name)) add(entry.name, 'Page media request');
  }
  return [...results.values()];
}

function validateMediaResults(results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const validated = [];
  for (const result of results) {
    if (validated.length >= MAX_RESULTS) break;
    if (!result || typeof result.url !== 'string' || result.url.length > MAX_URL_LENGTH) continue;
    let url;
    try { url = new URL(result.url); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const manifest = MANIFEST_EXTENSION.test(url.href);
    validated.push({
      url: url.href,
      label: String(result.label || url.pathname).slice(0, 200),
      kind: manifest ? 'manifest' : 'file',
      ...(typeof result.mimeType === 'string' ? { mimeType: result.mimeType.slice(0, 120) } : {})
    });
  }
  return validated;
}

module.exports = { discoverPageMedia, validateMediaResults };
