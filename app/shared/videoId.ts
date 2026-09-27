const EXCLUDED_PREFIXES = new Set([
  "AAC",
  "AC3",
  "AMZN",
  "ATMOS",
  "BLURAY",
  "DDP",
  "DISC",
  "DTS",
  "DVDRIP",
  "HDR",
  "HEVC",
  "REMUX",
  "UHD",
  "WEB",
  "WEBRIP"
]);

const EXCLUDED_STRICT_PREFIXES = new Set([
  "BEST",
  "CLIP",
  "CUT",
  "FEATURE",
  "FULL",
  "HD",
  "MOVIE",
  "OFFICIAL",
  "OF",
  "PREVIEW",
  "SPECIAL",
  "SAMPLE",
  "TEASER",
  "TRAILER",
  "VIDEO"
]);

export function extractVideoId(value: string): string | null {
  return extractVideoIdCandidates(value)[0] ?? null;
}

export function extractVideoIdCandidates(value: string): string[] {
  const normalized = value
    .toUpperCase()
    .replace(/[._]+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const matches: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: string | null) => {
    if (!candidate) {
      return;
    }

    const normalizedCandidate = candidate
      .toUpperCase()
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const prefix = normalizedCandidate.split("-")[0];
    if (
      !prefix ||
      prefix.length < 2 ||
      prefix.length > 6 ||
      EXCLUDED_PREFIXES.has(prefix) ||
      EXCLUDED_STRICT_PREFIXES.has(prefix) ||
      seen.has(normalizedCandidate)
    ) {
      return;
    }

    seen.add(normalizedCandidate);
    matches.push(normalizedCandidate);
  };

  const fc2Match = normalized.match(/\bFC2[- ]?PPV[- ]?(\d{3,8})\b/i);
  if (fc2Match) {
    addCandidate(`FC2-PPV-${fc2Match[1]}`);
  }

  const standardPattern = /\b([A-Z]{2,10})[- ]?(\d{2,6})(?:[- ]?([A-Z]{1,4}))?\b/g;
  for (const match of normalized.matchAll(standardPattern)) {
    const [, prefix, digits, suffix] = match;
    const base = `${prefix}-${digits}`;
    // Prefer the base ID (PREFIX-DIGITS) first so variants like A/B group to the same base
    addCandidate(base);
    if (suffix) {
      const suf = suffix.toUpperCase();
      if (suf !== prefix) {
        addCandidate(`${base}-${suffix}`);
      }
    }
  }

  return matches;
}

export function extractStrictJavVideoIdCandidates(value: string): string[] {
  const normalized = value
    .toUpperCase()
    .replace(/[._]+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const matches: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: string | null) => {
    if (!candidate) return;

    const normalizedCandidate = candidate
      .toUpperCase()
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const prefix = normalizedCandidate.split("-")[0];
    if (
      !prefix ||
      prefix.length < 2 ||
      prefix.length > 6 ||
      EXCLUDED_PREFIXES.has(prefix) ||
      EXCLUDED_STRICT_PREFIXES.has(prefix) ||
      seen.has(normalizedCandidate)
    ) {
      return;
    }

    seen.add(normalizedCandidate);
    matches.push(normalizedCandidate);
  };

  const fc2Match = normalized.match(/\bFC2[- ]?PPV[- ]?(\d{3,8})\b/i);
  if (fc2Match) {
    addCandidate(`FC2-PPV-${fc2Match[1]}`);
  }

  const strictPattern = /\b([A-Z]{2,6})[- ](\d{3,6})(?:[- ]([A-Z]{1,4}))?\b/g;
  for (const match of normalized.matchAll(strictPattern)) {
    const [, prefix, digits, suffix] = match;
    const base = `${prefix}-${digits}`;
    addCandidate(base);
    if (suffix) {
      const suf = suffix.toUpperCase();
      if (suf !== prefix) {
        addCandidate(`${base}-${suffix}`);
      }
    }
  }

  return matches;
}

export function expandVideoIdLookupCandidates(videoId: string): string[] {
  const normalized = videoId
    .toUpperCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const candidates = [normalized];
  const baseCandidate = normalized.replace(/-[A-Z]{1,4}$/, "");
  if (baseCandidate !== normalized) {
    candidates.push(baseCandidate);
  }

  return Array.from(new Set(candidates));
}
