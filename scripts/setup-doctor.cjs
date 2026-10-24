"use strict";

// scripts/setup-doctor.cjs — finds the native binaries an interrupted or
// partial install leaves behind, and repairs them in place.
//
// The failure this exists for (observed for real on 2026-10-24): node_modules
// was present and `npm ci` reported success, yet the tree held no .exe files at
// all — esbuild's platform package was an empty shell and electron/dist had no
// runtime, so `npm test` died in config loading and every e2e gate failed
// before launching. Neither ABI gate can report that state usefully: they
// assume an installed tree.
//
//   npm run doctor                     → detect and repair, exit 0 only if both are usable
//   npm run doctor -- --check          → detect only, exit 1 when unhealthy
//   npm run doctor -- --check --quiet  → silent when green (used as a preflight)
//   ... --check --skip electron        → only the binaries this command needs
//
// `npm test` preflights esbuild and `npm run dev` preflights both, so a tree
// stripped by an interrupted install fails in one sentence instead of inside
// vite's config loader. The test preflight skips Electron deliberately: vitest
// needs the transform, not the Electron runtime, and a broken Electron install
// must not block unit tests.
//
// Repairs are deliberately scoped to downloads the packages own:
//   esbuild  → node node_modules/esbuild/install.js (its own downloader),
//              falling back to `npm rebuild esbuild`
//   electron → node node_modules/electron/install.js, then — because that
//              installer can leave a locales-only dist behind on Node 26 —
//              an extraction of the cached release zip with the platform's
//              own archive tool
// Neither path touches better-sqlite3, so the ABI state survives a repair.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ELECTRON_BIN, runNpm } = require("./lib/abi-state.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const NM = path.join(REPO_ROOT, "node_modules");
const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
// Preflights have nothing useful to say on the green path; --quiet keeps
// `npm run dev` from printing a banner on every restart.
const QUIET = argv.includes("--quiet");
const SKIP = new Set(
  argv
    .flatMap((arg, index) => {
      if (arg === "--skip") return String(argv[index + 1] || "").split(",");
      if (arg.startsWith("--skip=")) return arg.slice("--skip=".length).split(",");
      return [];
    })
    .map((name) => name.trim())
    .filter(Boolean)
);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function exists(file) {
  return fs.existsSync(file);
}

function run(command, args, timeoutMs = 600000) {
  const res = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: false,
  });
  return { status: res.status, output: `${res.stdout || ""}${res.stderr || ""}` };
}

// ── esbuild ─────────────────────────────────────────────────────────────────

function esbuildVersion() {
  return readJson(path.join(NM, "esbuild", "package.json"))?.version ?? null;
}

// esbuild's platform binary can live in the platform package OR in
// esbuild/lib/downloaded-… when its installer had to fetch it itself, so
// presence is judged by what actually matters: a real transform through the
// binary. A `require()` alone proves nothing — esbuild only spawns the
// executable when it is asked to do work — and the probe runs in a child
// process because esbuild caches the resolved binary path at module load, so
// an in-process check that ran before a repair would keep failing after the
// binary came back.
function esbuildHealthy() {
  const pkg = readJson(path.join(NM, "esbuild", "package.json"));
  if (!pkg) return { ok: false, detail: "esbuild is not installed" };
  const probe = run(process.execPath, [
    "-e",
    'const r = require("esbuild").transformSync("let doctor = 1"); if (!/doctor/.test(r.code)) process.exit(3);',
  ]);
  if (probe.status === 0) return { ok: true, detail: "transform ok" };
  return {
    ok: false,
    detail: `esbuild cannot run: ${firstErrorLine(probe.output) || `probe exited ${probe.status}`}`,
  };
}

// A failed probe prints a Node crash preamble before the thrown message; the
// useful sentence follows the first `Error:` line (esbuild puts a blank line
// between the two).
function firstErrorLine(output) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => /^Error:/.test(line));
  const picked = (start >= 0 ? lines.slice(start) : lines).find(
    (line) => !/^Error:\s*$/.test(line)
  );
  return (picked || "").replace(/^Error:\s*/, "").slice(0, 140);
}

function repairEsbuild() {
  const installer = path.join(NM, "esbuild", "install.js");
  if (!exists(installer)) return { ok: false, detail: "esbuild install.js is missing" };
  const first = run(process.execPath, [installer]);
  if (esbuildHealthy().ok) return { ok: true, detail: "re-downloaded by esbuild's installer" };
  const second = runNpm(["rebuild", "esbuild"]);
  if (esbuildHealthy().ok) return { ok: true, detail: "restored by npm rebuild esbuild" };
  return {
    ok: false,
    detail: `installer exited ${first.status}, rebuild exited ${second.status}`,
  };
}

// ── electron ────────────────────────────────────────────────────────────────

// The value electron/index.js reads out of path.txt.
function electronRelativeBin() {
  if (process.platform === "win32") return "electron.exe";
  if (process.platform === "darwin") return "Electron.app/Contents/MacOS/Electron";
  return "electron";
}

function electronPaths() {
  const version = readJson(path.join(NM, "electron", "package.json"))?.version ?? null;
  const dist = path.join(NM, "electron", "dist");
  const pathTxt = path.join(NM, "electron", "path.txt");
  return { version, dist, pathTxt };
}

function electronHealthy() {
  const pkg = readJson(path.join(NM, "electron", "package.json"));
  if (!pkg) return { ok: false, detail: "electron is not installed" };
  if (!exists(ELECTRON_BIN)) {
    const { dist } = electronPaths();
    const partial = exists(dist) && fs.readdirSync(dist).length > 0;
    return {
      ok: false,
      detail: partial
        ? `electron/dist exists but has no runtime (partial extraction)`
        : `electron/dist has no runtime`,
    };
  }
  const { pathTxt } = electronPaths();
  if (!exists(pathTxt)) {
    return { ok: false, detail: "electron/path.txt is missing" };
  }
  return { ok: true, detail: path.relative(REPO_ROOT, ELECTRON_BIN) };
}

// Electron's own cache, in the order @electron/get searches it.
function electronCacheDirs() {
  const dirs = [];
  if (process.env.ELECTRON_CACHE) dirs.push(process.env.ELECTRON_CACHE);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    dirs.push(path.join(process.env.LOCALAPPDATA, "electron", "Cache"));
  } else if (process.platform === "darwin") {
    dirs.push(path.join(os.homedir(), "Library", "Caches", "electron"));
  } else {
    dirs.push(path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "electron"));
  }
  return dirs.filter((dir) => exists(dir));
}

function findCachedElectronZip(version) {
  const wanted = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === wanted) hits.push(full);
    }
  };
  for (const dir of electronCacheDirs()) walk(dir, 0);
  // Newest first: a re-download after a version bump should win.
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] ?? null;
}

// bsdtar (macOS, and Windows at System32\tar.exe) reads zips directly;
// Linux needs unzip. `tar` in a Windows shell's PATH may be Git's GNU tar,
// which cannot read zips, so the system binary is addressed explicitly and
// PowerShell's Expand-Archive is the last resort (slow, but always present).
function extractZip(zip, destination) {
  if (process.platform === "win32") {
    const bsdtar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    if (exists(bsdtar)) {
      const viaBsdtar = run(bsdtar, ["-xf", zip, "-C", destination]);
      if (viaBsdtar.status === 0) return viaBsdtar;
    }
    return run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ]);
  }
  const args =
    process.platform === "linux"
      ? ["unzip", ["-q", zip, "-d", destination]]
      : ["tar", ["-xf", zip, "-C", destination]];
  return run(args[0], args[1]);
}

function repairElectron() {
  const { dist, pathTxt, version } = electronPaths();
  // A half-extracted dist makes install.js believe it is already installed;
  // remove it so the installer starts from a clean directory.
  if (exists(dist) && !exists(ELECTRON_BIN)) fs.rmSync(dist, { recursive: true, force: true });

  const installer = path.join(NM, "electron", "install.js");
  if (exists(installer)) run(process.execPath, [installer]);
  if (exists(ELECTRON_BIN) && !exists(pathTxt)) fs.writeFileSync(pathTxt, electronRelativeBin());
  if (electronHealthy().ok) return { ok: true, detail: "repaired by electron's installer" };

  // The installer can leave a locales-only dist behind (Node 26 + extract-zip),
  // so fall back to the cached release zip with the OS's own archive tool.
  const zip = version ? findCachedElectronZip(version) : null;
  if (!zip) {
    return {
      ok: false,
      detail: "installer did not produce the runtime and no cached release zip was found",
    };
  }
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const extracted = extractZip(zip, dist);
  if (!exists(ELECTRON_BIN)) {
    return { ok: false, detail: `cached zip extraction failed (exit ${extracted.status})` };
  }
  fs.writeFileSync(pathTxt, electronRelativeBin());
  return { ok: true, detail: `extracted ${path.basename(zip)}` };
}

// ── report ──────────────────────────────────────────────────────────────────

const lines = [
  `setup-doctor — node ${process.version} · ${process.platform}-${process.arch}` +
    `${CHECK_ONLY ? " · check only" : ""}${SKIP.size > 0 ? ` · skip ${[...SKIP].join(",")}` : ""}`,
];

if (!exists(NM)) {
  lines.push("  node_modules: absent — nothing to doctor.");
  lines.push("");
  lines.push("Install first: npm ci");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

const targets = [
  {
    name: "esbuild",
    version: esbuildVersion(),
    check: esbuildHealthy,
    repair: repairEsbuild,
  },
  {
    name: "electron",
    version: electronPaths().version,
    check: electronHealthy,
    repair: repairElectron,
  },
];

// A typo in --skip must not silently select everything (that would make the
// test preflight depend on Electron again), so unknown names are fatal.
const unknown = [...SKIP].filter((name) => !targets.some((target) => target.name === name));
if (unknown.length > 0) {
  process.stderr.write(
    `setup-doctor: unknown --skip target(s): ${unknown.join(", ")} ` +
      `(known: ${targets.map((target) => target.name).join(", ")})\n`
  );
  process.exit(2);
}

const selected = targets.filter((target) => !SKIP.has(target.name));

let failed = 0;
for (const target of selected) {
  const label = `${target.name}${target.version ? ` ${target.version}` : ""}`.padEnd(20);
  const before = target.check();
  if (before.ok) {
    lines.push(`  ${label} ok     ${before.detail}`);
    continue;
  }
  if (CHECK_ONLY) {
    failed += 1;
    lines.push(`  ${label} MISSING ${before.detail}`);
    continue;
  }
  lines.push(`  ${label} missing ${before.detail}`);
  lines.push(`  ${"".padEnd(20)} repairing...`);
  const repaired = target.repair();
  const after = target.check();
  if (repaired.ok && after.ok) {
    lines.push(`  ${"".padEnd(20)} repaired ${repaired.detail}`);
  } else {
    failed += 1;
    lines.push(`  ${"".padEnd(20)} FAILED   ${repaired.detail}`);
  }
}

if (failed > 0) {
  lines.push("");
  if (CHECK_ONLY) {
    lines.push("Doctor found missing executables. Run `npm run doctor` to repair them.");
  } else {
    lines.push("Could not repair every binary. Reinstall the tree: npm ci");
  }
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}

lines.push("");
const checked = selected.map((target) => target.name).join(" and ");
lines.push(
  CHECK_ONLY
    ? `Doctor green: ${checked} present.`
    : `Doctor green: ${checked} present (binding untouched).`
);
if (!QUIET) process.stdout.write(`${lines.join("\n")}\n`);
