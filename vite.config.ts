import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Baked into the renderer bundle: package version + build date, shown in
// Settings → System. The version lives in package.json (electron-builder
// stamps the installer with the same value).
const pkg = require("./package.json") as { version?: string };
const buildStamp = `${pkg.version ?? "unknown"} · built ${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  base: "./",
  root: path.resolve(__dirname, "app/renderer"),
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: false,
    cssMinify: false
  },
  test: {
    globals: true,
    environment: "happy-dom",
    // threads boots ~2x faster than the default fork pool here: the per-file
    // prepare phase (worker import + harness setup) is charged to every test
    // file, and forking made that the suite's largest fixed tax. Measured
    // warm median: 1.46s wall vs 2.05s forks across 3 interleaved reps.
    pool: "threads",
    setupFiles: ["src/__tests__/setup.ts"],
    include: ["src/__tests__/**/*.{test,spec}.{ts,tsx}"]
  }
});
