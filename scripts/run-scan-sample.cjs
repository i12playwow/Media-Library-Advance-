const path = require('node:path');
const os = require('node:os');

const { scanLibraries, createCancelToken, DEFAULT_SCAN_OPTIONS } = require('../dist/services/libraryScanner.js');

// Minimal in-memory fake DB to avoid native better-sqlite3 dependency when running tests
class FakeDatabase {
  constructor() {
    this._movies = new Map();
  }
  getMetadataSettings() {
    return { tmdbReadAccessToken: "", language: "en-US", region: "US", autoFetchWebPosters: false };
  }
  getOrganizationSettings() {
    return { normalTemplate: "{title}", gentleTemplate: "{title}", fileNameTemplate: "{title}" };
  }
  findMovieIdBySourcePath(_p) {
    return null;
  }
  createMovieId(sourcePath) {
    const id = `tmp-${Math.random().toString(36).slice(2, 9)}`;
    this._movies.set(id, { id, sourcePath });
    return id;
  }
  createSubtitleId(movieId, subtitlePath) {
    return `sub-${movieId}-${Math.random().toString(36).slice(2, 6)}`;
  }
  upsertMovie(movie) {
    this._movies.set(movie.id, movie);
  }
  replaceSubtitles(_movieId, _subtitles) {
    // no-op
  }
  getRoots() {
    return { normal: [], gentle: [] };
  }
  close() {}
}

async function main() {
  const samplePath = process.argv[2];
  if (!samplePath) {
    console.error('Usage: node scripts/run-scan-sample.cjs <path-to-sample-folder>');
    process.exit(2);
  }

  const abs = path.resolve(samplePath);
  console.log(`Scanning sample folder: ${abs}`);

  const db = new FakeDatabase();

  try {
    const roots = { normal: [abs], gentle: [] };
    const cancelToken = createCancelToken();

    const scanOptions = {
      ...DEFAULT_SCAN_OPTIONS,
      moveRename: false,
      autoResolveDuplicates: false
    };

    const summary = await scanLibraries(db, roots, {
      mode: 'normal',
      onProgress: (p) => console.log(`[progress] ${p.stage} ${p.currentFile ?? ''}`),
      scanOptions,
      cancelToken
    });

    console.log('\nScan Summary:');
    console.dir(summary, { depth: null });
  } catch (err) {
    console.error('Scan failed:', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    try { db.close(); } catch {}
  }
}

main();
