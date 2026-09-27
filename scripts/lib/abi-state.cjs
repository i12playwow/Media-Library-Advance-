"use strict";

// Shared ABI-state helpers for the ABI gate scripts (scripts/abi-check.cjs,
// scripts/diagnose-abi.cjs, scripts/drill-abi-contract.cjs).
//
// docs/testing.md rule 1: "require() alone proves nothing" — a green verdict
// must rest on a real better-sqlite3 Database instantiation that runs an FTS5
// query, or (in --electron mode without the Electron runtime installed) on the
// explicitly-reported parse-only fallback. Nothing in here ever rebuilds or
// otherwise mutates the binding: the callers decide that.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BINDING_PATH = path.join(
  REPO_ROOT,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
const ELECTRON_BIN = path.join(
  REPO_ROOT,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32"
    ? "electron.exe"
    : process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : "electron"
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getVersions() {
  let electron = "unknown";
  try {
    electron = readJson(path.join(REPO_ROOT, "node_modules", "electron", "package.json")).version;
  } catch { /* electron not installed */ }
  let betterSqlite3 = "unknown";
  try {
    betterSqlite3 = readJson(path.join(REPO_ROOT, "node_modules", "better-sqlite3", "package.json")).version;
  } catch { /* better-sqlite3 not installed */ }
  return { node: process.version, betterSqlite3, electron };
}

function electronRuntimePresent() {
  return fs.existsSync(ELECTRON_BIN);
}

// Ground truth: ask the actual Electron binary (run as Node) which ABI it loads.
function electronAbiFromRuntime() {
  if (!electronRuntimePresent()) return null;
  const res = spawnSync(ELECTRON_BIN, ["-e", "process.stdout.write(String(process.versions.modules));"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 30000,
    shell: false,
  });
  const abi = (res.stdout || "").trim();
  return res.status === 0 && /^\d+$/.test(abi) ? abi : null;
}

// Heuristic fallback: node-abi's table (used only when the binary is absent).
function electronAbiFromNodeAbi(electronVersion) {
  if (!electronVersion || electronVersion === "unknown") return null;
  try {
    const nodeAbi = require("node-abi");
    const getAbi = nodeAbi.getAbi || nodeAbi.default?.getAbi;
    return String(getAbi(electronVersion, "electron"));
  } catch {
    return null;
  }
}

function getElectronAbi(electronVersion) {
  return electronAbiFromRuntime() ?? electronAbiFromNodeAbi(electronVersion);
}

// The rule-1 proof itself: instantiate a real database and exercise FTS5.
// Throws with a diagnostic message on any failure.
function fts5Proof() {
  let mod;
  try {
    mod = require("better-sqlite3");
  } catch (err) {
    throw new Error(`better-sqlite3 failed to load: ${err && err.message ? err.message : err}`);
  }
  const Database = mod && mod.default ? mod.default : mod;
  const db = new Database(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE abi_probe USING fts5(content)");
    db.prepare("INSERT INTO abi_probe (content) VALUES (?)").run("media library probe");
    const hit = db
      .prepare("SELECT count(*) AS n FROM abi_probe WHERE abi_probe MATCH ?")
      .get("media");
    if (!hit || hit.n !== 1) {
      throw new Error(`FTS5 MATCH returned ${hit ? hit.n : "no row"} (expected 1)`);
    }
  } finally {
    db.close();
  }
}

// Loads the binding in the current process and runs the FTS5 proof when it
// loads. Returns one of:
//   { kind: "ok" }                — binding loaded AND FTS5 proof passed
//   { kind: "abi", bindingAbi }   — wrong-ABI binding; its ABI parsed from the loader error
//   { kind: "load", message }     — load failed for a non-ABI reason
function probeBinding() {
  try {
    fts5Proof();
    return { kind: "ok" };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const match = message.match(/NODE_MODULE_VERSION (\d+)/);
    if (match) return { kind: "abi", bindingAbi: match[1], message };
    return { kind: "load", message };
  }
}

// Internal mode for scripts/abi-check.cjs --run-proof: executed under the
// Electron binary with ELECTRON_RUN_AS_NODE=1, this loads the Electron-ABI
// binding and proves it works. Exits 0 with "FTS5 OK" on success.
function runProofHere() {
  try {
    fts5Proof();
    process.stdout.write("FTS5 OK\n");
  } catch (err) {
    process.stderr.write(`FTS5 proof failed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

function runFts5ProofUnderElectron() {
  if (!electronRuntimePresent()) {
    return { ok: false, reason: "electron runtime not installed" };
  }
  const selfPath = fs.realpathSync(__filename);
  const checkPath = path.join(path.dirname(path.dirname(selfPath)), "abi-check.cjs");
  const res = spawnSync(ELECTRON_BIN, [checkPath, "--run-proof"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 60000,
    shell: false,
  });
  if (res.status !== 0) {
    const tail = `${res.stderr || ""}${res.stdout || ""}`.trim();
    return { ok: false, reason: `electron-as-node proof exited ${res.status}${tail ? `: ${tail.slice(-400)}` : ""}` };
  }
  if (!/FTS5 OK/.test(res.stdout || "")) {
    return { ok: false, reason: "electron-as-node proof did not report FTS5 OK" };
  }
  return { ok: true };
}

function getBindingState() {
  if (!fs.existsSync(BINDING_PATH)) return { present: false };
  const stat = fs.statSync(BINDING_PATH);
  return { present: true, mtimeMs: stat.mtimeMs, size: stat.size };
}

// Run an npm command in the repo. npm is not a local dependency (there is no
// node_modules/npm), so resolve the npm that ships with the active Node
// installation: standard installs keep npm-cli.js next to node.exe. Spawning
// node + npm-cli.js directly avoids shell quoting entirely; a non-standard
// install falls back to resolving "npm" through the shell.
function npmCliPath() {
  const candidate = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return fs.existsSync(candidate) ? candidate : null;
}

function runNpm(args, timeoutMs = 600000) {
  const npmCli = npmCliPath();
  const res = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: timeoutMs,
        shell: false,
      })
    : spawnSync("npm", args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: timeoutMs,
        shell: process.platform === "win32",
      });
  return { status: res.status, output: `${res.stdout || ""}\n${res.stderr || ""}` };
}

function getCommitSha() {
  const res = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    timeout: 10000,
    shell: false,
  });
  return res.status === 0 ? (res.stdout || "").trim() : "unknown";
}

module.exports = {
  REPO_ROOT,
  BINDING_PATH,
  ELECTRON_BIN,
  getVersions,
  electronRuntimePresent,
  getElectronAbi,
  probeBinding,
  runProofHere,
  runFts5ProofUnderElectron,
  getBindingState,
  getCommitSha,
  runNpm,
};
