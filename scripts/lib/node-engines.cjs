"use strict";

// scripts/lib/node-engines.cjs — the range evaluator behind the setup doctor's
// Node-version warning (scripts/setup-doctor.cjs). It is deliberately small and
// dependency-free: the doctor runs before the tree is trusted, so it cannot lean
// on node_modules or on npm's bundled semver.
//
// `satisfiesRange(versionText, range)` returns:
//   true  — the version satisfies the range;
//   false — it does not;
//   null  — the range (or the version) is outside the grammar this module
//           judges, so the caller must stay silent rather than warn on a guess.
//
// Grammar: `>= > <= < =`, `^` and `~`, trailing wildcards (`*`, `22.x`,
// `22.12.*`), conjunctions separated by spaces, alternatives by `||`.
// Prerelease tags, hyphen ranges, bare partials (`22`, `22.12`) and wildcards
// under an explicit comparator (`>=22.x`) are not guessed at.

function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function compareTo(op, version, target) {
  const order = compareVersions(version, target);
  if (op === ">=") return order >= 0;
  if (op === ">") return order > 0;
  if (op === "<=") return order <= 0;
  if (op === "<") return order < 0;
  return order === 0;
}

// One comparator → one or two [operator, version] bounds. Only the grammar the
// field plausibly uses is understood: `>= > <= < =`, `^` and `~`, trailing
// wildcard shorthands (`*`, `22.x`, `22.12.*`), conjunctions separated by
// spaces, alternatives by `||`. Prerelease tags and hyphen ranges are not
// guessed at, and a wildcard combined with an explicit comparator is left
// unjudged rather than given a guessed meaning.
function expandComparator(token) {
  const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(
    token
  );
  if (!match) return null;
  const [, op = "=", majorText, minorText, patchText] = match;
  const isWild = (text) => text !== undefined && /^[xX*]$/.test(text);
  if (isWild(majorText) || isWild(minorText) || isWild(patchText)) {
    // `*` alone admits every version; `22.x` and `22.12.*` are the usual
    // trailing-wildcard shorthands. A wildcard after an explicit comparator
    // (`>=22.x`) or before a fixed component (`22.x.3`) has no agreed meaning
    // here, so it stays unjudged instead of inventing one.
    if (op !== "=") return null;
    if (isWild(majorText)) {
      return minorText === undefined && patchText === undefined ? [[">=", [0, 0, 0]]] : null;
    }
    if (isWild(minorText)) {
      if (patchText !== undefined && !isWild(patchText)) return null;
      return [[">=", [Number(majorText), 0, 0]], ["<", [Number(majorText) + 1, 0, 0]]];
    }
    return [
      [">=", [Number(majorText), Number(minorText), 0]],
      ["<", [Number(majorText), Number(minorText) + 1, 0]],
    ];
  }
  const lower = [Number(majorText), Number(minorText ?? 0), Number(patchText ?? 0)];
  if (op !== "=" && op !== "^" && op !== "~") return [[op, lower]];
  if (op === "=") {
    // A bare partial version (`22`, `22.12`) is a range shorthand in semver,
    // not an equality; without an explicit wildcard it is left unjudged rather
    // than guessed at.
    return minorText !== undefined && patchText !== undefined ? [["=", lower]] : null;
  }
  if (op === "^") {
    if (lower[0] > 0) return [[">=", lower], ["<", [lower[0] + 1, 0, 0]]];
    if (minorText === undefined) return null;
    if (lower[1] > 0) return [[">=", lower], ["<", [0, lower[1] + 1, 0]]];
    if (patchText === undefined) return null;
    return [[">=", lower], ["<", [0, 0, lower[2] + 1]]];
  }
  const upper = minorText === undefined ? [lower[0] + 1, 0, 0] : [lower[0], lower[1] + 1, 0];
  return [[">=", lower], ["<", upper]];
}

// true / false when the range is understood, null when it is not — an
// unrecognized range warns about nothing rather than crying wolf.
function satisfiesRange(versionText, range) {
  const version = parseVersion(versionText);
  if (!version) return null;
  const alternatives = String(range)
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  if (alternatives.length === 0) return null;
  for (const alternative of alternatives) {
    const bounds = [];
    for (const token of alternative.split(/\s+/)) {
      const expanded = expandComparator(token);
      if (!expanded) return null;
      bounds.push(...expanded);
    }
    if (bounds.every(([op, target]) => compareTo(op, version, target))) return true;
  }
  return false;
}

module.exports = { satisfiesRange };
