const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const binDir = path.join(rootDir, "node_modules", ".bin");
const isWindows = process.platform === "win32";

// Node >= 18.20 / 20.12 / 22 refuses to spawn .cmd/.bat shims with
// shell:false (CVE-2024-27980), so on Windows every npm .bin shim needs
// shell:true. Node resolves the shim through cmd.exe; args stay literal.
function bin(name) {
  return path.join(binDir, `${name}${isWindows ? ".cmd" : ""}`);
}

function run(command, args, extraEnv = {}) {
  return spawn(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      ...extraEnv
    },
    shell: isWindows,
    stdio: "inherit"
  });
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const probe = () => {
      const socket = net.connect(port, host);

      socket.once("connect", () => {
        socket.end();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }

        setTimeout(probe, 250);
      });
    };

    probe();
  });
}

function shutdown(children, code = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(code);
}

async function main() {
  const initialBuild = spawnSync(bin("tsc"), ["-b"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development"
    },
    shell: isWindows,
    stdio: "inherit"
  });

  if (initialBuild.status !== 0) {
    process.exit(initialBuild.status ?? 1);
  }

  const children = [];
  let exiting = false;

  const tscWatch = run(bin("tsc"), ["-b", "--watch", "--preserveWatchOutput"]);
  children.push(tscWatch);

  const vite = run(bin("vite"), ["--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
  children.push(vite);

  tscWatch.on("exit", (code) => {
    if (!exiting) {
      exiting = true;
      shutdown(children.filter((child) => child !== tscWatch), code ?? 1);
    }
  });

  vite.on("exit", (code) => {
    if (!exiting) {
      exiting = true;
      shutdown(children.filter((child) => child !== vite), code ?? 1);
    }
  });

  await waitForPort("127.0.0.1", 5173, 30000);

  // The agent host exports ELECTRON_RUN_AS_NODE=1; if it leaks through,
  // Electron boots as plain Node and require("electron") yields nothing.
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  delete electronEnv.ELECTRON_NO_ATTACH_CONSOLE;

  const electron = spawn(bin("electron"), ["."], {
    cwd: rootDir,
    env: {
      ...electronEnv,
      NODE_ENV: "development",
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5173"
    },
    shell: isWindows,
    stdio: "inherit"
  });
  children.push(electron);

  electron.on("exit", (code) => {
    if (!exiting) {
      exiting = true;
      shutdown(children.filter((child) => child !== electron), code ?? 0);
    }
  });

  const stop = () => {
    if (exiting) {
      return;
    }

    exiting = true;
    shutdown(children, 0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
