import * as path from "node:path";
import * as os from "node:os";

import { DatabaseClient } from "../app/database/database";
import { scanLibraries, createCancelToken, DEFAULT_SCAN_OPTIONS } from "../app/services/libraryScanner";

async function main() {
  const samplePath = process.argv[2];
  if (!samplePath) {
    console.error("Usage: npx ts-node scripts/run-scan-sample.ts <path-to-sample-folder>");
    process.exit(2);
  }

  const abs = path.resolve(samplePath);
  console.log(`Scanning sample folder: ${abs}`);

  // Use a disposable DB in temp to avoid touching user's real DB
  const dbPath = path.join(os.tmpdir(), `mla-scan-${Date.now()}.db`);
  const db = new DatabaseClient(dbPath);

  try {
    const roots = { normal: [abs], gentle: [] };
    const cancelToken = createCancelToken();

    const scanOptions = {
      ...DEFAULT_SCAN_OPTIONS,
      moveRename: false, // safe: don't move or delete files during test
      autoResolveDuplicates: false // don't auto-delete during test
    };

    const summary = await scanLibraries(db, roots, {
      mode: "normal",
      onProgress: (p) => console.log(`[progress] ${p.stage} ${p.currentFile ?? ""}`),
      scanOptions,
      cancelToken
    });

    console.log("\nScan Summary:", summary);
  } catch (err) {
    console.error("Scan failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    db.close?.();
  }
}

void main();
