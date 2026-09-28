#!/usr/bin/env node
// probe-poster-sources.cjs — live, database-free check of the keyless
// poster chain (metadataService's own code, real network):
//
//   node scripts/probe-poster-sources.cjs
//   node scripts/probe-poster-sources.cjs --id=MIDV-002 --title="Inception|2010"
//   node scripts/probe-poster-sources.cjs --title="Some Title Without Any ID"
//
// --id=…                video-ID probes: walk javdatabase → javbus exactly
//                       like the app does (candidate expansion included).
// --title="Name|YYYY"   title probes through the iTunes strategy (year
//                       optional; the relevance gate must reject garbage).
//
// Each line reports WHICH source served the poster, so this doubles as a
// live verification that the source attribution is honest. No database is
// opened, nothing is written anywhere.

const { fetchOnlineMovieMetadataByVideoId, resolveOnlineMovieMetadata } = require("../dist/services/metadataService.js");

// The service's fetch calls carry no deadline, so a blackholed or
// geo-blocked site would hang the whole probe. Every item races a timer;
// a timeout is reported as its own outcome and the run continues.
const ITEM_TIMEOUT_MS = 20000;

const SETTINGS = {
  tmdbReadAccessToken: "",
  language: "en-US",
  region: "US",
  autoFetchWebPosters: true,
  tmdbNonCommercialUse: false,
  sourceProfile: "auto"
};

function parseArgs(argv) {
  const ids = [];
  const titles = [];
  for (const arg of argv) {
    if (arg.startsWith("--id=")) {
      ids.push(arg.slice("--id=".length).trim());
    } else if (arg.startsWith("--title=")) {
      titles.push(arg.slice("--title=".length).trim());
    }
  }
  if (ids.length === 0 && titles.length === 0) {
    ids.push("MIDV-002", "SSIS-406", "FC2-PPV-3105887");
    titles.push("Inception|2010", "Spirited Away|2001", "Qwzxjalksdhf Nothing Real|2099");
  }
  return { ids, titles };
}

function splitTitle(raw) {
  const [name, yearRaw] = raw.split("|").map((part) => part.trim());
  const year = Number(yearRaw);
  return { name, year: Number.isFinite(year) && year > 1900 ? year : null };
}

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve("__timeout__"), ITEM_TIMEOUT_MS))
  ]);
}

async function main() {
  const { ids, titles } = parseArgs(process.argv.slice(2));
  let hits = 0;
  let misses = 0;

  console.log(`probe-poster-sources: ${ids.length} video ID(s), ${titles.length} title(s)\n`);

  // Titles first: the iTunes endpoint is fast and reliable, so its live
  // results land even when an ID site blackholes this network.
  for (const raw of titles) {
    const { name, year } = splitTitle(raw);
    process.stdout.write(`[title] ${name.slice(0, 30).padEnd(32)} `);
    try {
      const metadata = await withTimeout(
        resolveOnlineMovieMetadata(
          {
            title: name,
            year,
            sourcePath: `C:/probe/${name}.mp4`,
            videoId: null
          },
          SETTINGS
        )
      );
      if (metadata === "__timeout__") {
        misses += 1;
        console.log(`TIMEOUT (no answer within ${ITEM_TIMEOUT_MS / 1000}s)`);
      } else if (metadata?.posterUrl) {
        hits += 1;
        console.log(`HIT   source=${metadata.source}  ${metadata.posterUrl.slice(0, 90)}`);
      } else {
        misses += 1;
        console.log("MISS  (gate refused, or no source served a poster)");
      }
    } catch (error) {
      misses += 1;
      console.log(`ERROR ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  for (const id of ids) {
    process.stdout.write(`[id] ${id.padEnd(22)} `);
    try {
      const metadata = await withTimeout(fetchOnlineMovieMetadataByVideoId(id));
      if (metadata === "__timeout__") {
        misses += 1;
        console.log(`TIMEOUT (no answer within ${ITEM_TIMEOUT_MS / 1000}s)`);
      } else if (metadata?.posterUrl) {
        hits += 1;
        console.log(`HIT   source=${metadata.source}  ${metadata.posterUrl.slice(0, 90)}`);
      } else {
        misses += 1;
        console.log("MISS  (no source served a poster)");
      }
    } catch (error) {
      misses += 1;
      console.log(`ERROR ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  console.log(`\nprobe finished: ${hits} hit(s), ${misses} miss(es)`);
  // Dangling (timed-out) fetches must not hold the process open.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
