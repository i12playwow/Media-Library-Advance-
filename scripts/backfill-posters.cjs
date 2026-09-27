const path = require("node:path");

process.env.NODE_ENV = "development";

const { DatabaseClient } = require("../dist/database/database.js");
const { enrichMoviePoster } = require("../dist/services/metadataService.js");

function parseLimit(argv) {
  const limitArg = argv.find((value) => value.startsWith("--limit="));
  if (!limitArg) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number(limitArg.slice("--limit=".length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const dbPath = path.join(process.env.APPDATA, "mla-plus", "mla-plus.db");
  const database = new DatabaseClient(dbPath);
  const settings = database.getMetadataSettings();
  const movies = database
    .listMovies({
      includeGentle: true,
      query: ""
    })
    .filter((movie) => !movie.posterUrl)
    .slice(0, limit);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`Poster backfill starting for ${movies.length} movie(s).`);

  for (let index = 0; index < movies.length; index += 1) {
    const movie = movies[index];
    process.stdout.write(`[${index + 1}/${movies.length}] ${movie.title} ... `);

    try {
      const posterUrl = await enrichMoviePoster(database, movie.id, settings);
      if (posterUrl) {
        updated += 1;
        process.stdout.write("updated\n");
      } else {
        skipped += 1;
        process.stdout.write("skipped\n");
      }
    } catch (error) {
      failed += 1;
      process.stdout.write(
        `failed (${error instanceof Error ? error.message : "unknown error"})\n`
      );
    }
  }

  database.close();
  console.log(
    `Poster backfill finished. Updated: ${updated}, skipped: ${skipped}, failed: ${failed}.`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
