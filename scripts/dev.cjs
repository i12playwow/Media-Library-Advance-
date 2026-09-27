const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const binDir = path.join(rootDir, "node_modules", ".bin");
const isWindows = process.platform === "win32";

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
    shell: false,
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
    shell: false,
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

  const electron = run(bin("electron"), ["."], {
    ELECTRON_RENDERER_URL: "http://127.0.0.1:5173"
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
