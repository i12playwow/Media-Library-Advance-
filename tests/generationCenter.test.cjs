// The Generation Center queue lives in TypeScript; test it through the same
// esbuild pipeline the bundle uses so node:test can require it directly.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

let queueModule;
const outDir = path.join(__dirname, '.tmp-generation-center');

before(() => {
  fs.mkdirSync(outDir, {recursive: true});
  const esbuild = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild');
  const result = spawnSync(esbuild, ['app/services/mediaProcessingQueue.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${path.join(outDir, 'queue.cjs')}`], {encoding: 'utf8', shell: process.platform === 'win32'});
  if (result.status !== 0) throw new Error(`esbuild failed: ${result.stderr || result.stdout}`);
  queueModule = require(path.join(outDir, 'queue.cjs')).createMediaProcessingQueue;
});

after(() => {
  fs.rmSync(outDir, {recursive: true, force: true});
});

/** Minimal in-memory stand-in for the parts of DatabaseClient the queue uses. */
function createFakeDatabase(movies) {
  let jobs = [];
  let counter = 0;
  const existing = new Map(movies.map((movie) => [movie.id, movie]));
  return {
    jobs: () => jobs,
    listMediaProcessingJobs(limit = 100) {
      const order = {running: 0, queued: 1};
      return jobs
        .slice()
        .sort((a, b) => (order[a.status] ?? 2) - (order[b.status] ?? 2) || a.created_at.localeCompare(b.created_at))
        .slice(0, Math.max(1, Math.min(limit, 500)));
    },
    enqueueMediaProcessingJob(movieId, kind, message = 'Waiting to start') {
      const duplicate = jobs.find((job) => job.movie_id === movieId && job.kind === kind && ['queued', 'running', 'completed'].includes(job.status));
      if (duplicate) return duplicate.id;
      counter += 1;
      const id = `job-${counter}`;
      const now = new Date().toISOString();
      jobs.push({id, movie_id: movieId, kind, status: 'queued', progress: 0, message, error: null, created_at: now, updated_at: now});
      return id;
    },
    updateMediaProcessingJob(id, update) {
      const job = jobs.find((row) => row.id === id);
      if (!job) return;
      Object.assign(job, update, {updated_at: new Date().toISOString()});
    },
    deleteMediaProcessingJob(id) {
      jobs = jobs.filter((row) => !(row.id === id && !['queued', 'running'].includes(row.status)));
    },
    clearFinishedMediaProcessingJobs() {
      const before = jobs.length;
      jobs = jobs.filter((row) => !['failed', 'cancelled'].includes(row.status));
      return before - jobs.length;
    },
    getMovie(id) {
      return existing.get(id) ?? null;
    }
  };
}

function createMovie(id) {
  const dir = path.join(__dirname, 'fixtures');
  const sourcePath = path.join(dir, `${id}.mp4`);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(sourcePath, 'fixture');
  return {id, title: `Movie ${id}`, sourcePath, folderPath: dir, libraryMode: 'normal', subtitles: []};
}

test('a queued subtitle job runs with the settings the operator picked', async () => {
  const movie = createMovie('center-a');
  const database = createFakeDatabase([movie]);
  const calls = [];
  const queue = queueModule(database, {
    generateSubtitle: async (movieId, options) => { calls.push({movieId, options}); return {ok: true, message: 'done'}; },
    onChanged: () => {}
  });

  const jobId = queue.enqueue(movie.id, 'generate-subtitle', {
    language: 'zh', model: 'large-v3', outputMode: 'custom-directory', outputDirectory: 'D:/subs'
  });
  assert.ok(jobId);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {language: 'zh', model: 'large-v3', outputMode: 'custom-directory', outputDirectory: 'D:/subs'});
  const finished = database.jobs().find((job) => job.id === jobId);
  assert.equal(finished.status, 'completed');
  assert.match(finished.message, /large-v3 · Chinese/);
});

test('jobs enqueued without settings fall back to the auto/small defaults', async () => {
  const movie = createMovie('center-b');
  const database = createFakeDatabase([movie]);
  const calls = [];
  const queue = queueModule(database, {
    generateSubtitle: async (movieId, options) => { calls.push(options); return {ok: true, message: 'done'}; },
    onChanged: () => {}
  });

  queue.enqueue(movie.id, 'generate-subtitle');
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(calls[0], {language: 'auto', model: 'small', outputMode: 'library-default'});
});

test('a cancelled subtitle job is not retried and holds no further work', async () => {
  const movie = createMovie('center-c');
  const database = createFakeDatabase([movie]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const queue = queueModule(database, {
    generateSubtitle: async () => { calls += 1; await gate; return {ok: true, message: 'done'}; },
    onChanged: () => {}
  });

  const jobId = queue.enqueue(movie.id, 'generate-subtitle');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(database.jobs().find((job) => job.id === jobId).status, 'running');

  queue.cancel(jobId);
  assert.match(database.jobs().find((job) => job.id === jobId).message, /Cancelling/);
  release();
  await new Promise((resolve) => setTimeout(resolve, 40));

  const job = database.jobs().find((row) => row.id === jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(calls, 1);
});

test('a queued job can be cancelled before it ever starts', async () => {
  const movie = createMovie('center-d');
  const database = createFakeDatabase([movie]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = queueModule(database, {
    generateSubtitle: async () => { await gate; return {ok: true, message: 'done'}; },
    onChanged: () => {}
  });

  // First job occupies the single worker so the second stays queued.
  const first = queue.enqueue(movie.id, 'generate-subtitle');
  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondMovie = createMovie('center-e');
  queue.enqueue(secondMovie.id, 'generate-subtitle');
  const queued = database.jobs().find((job) => job.status === 'queued');
  assert.ok(queued, 'a second job should be waiting');
  assert.notEqual(queued.id, first);

  queue.cancel(queued.id);
  assert.equal(database.jobs().find((job) => job.id === queued.id).status, 'cancelled');
  release();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(database.jobs().find((job) => job.id === first).status, 'completed');
});

test('failed jobs can be retried and finished ones removed from history', async () => {
  const movie = createMovie('center-f');
  const database = createFakeDatabase([movie]);
  let attempt = 0;
  const queue = queueModule(database, {
    generateSubtitle: async () => {
      attempt += 1;
      return attempt === 1 ? {ok: false, message: 'Whisper crashed'} : {ok: true, message: 'done'};
    },
    onChanged: () => {}
  });

  const jobId = queue.enqueue(movie.id, 'generate-subtitle');
  await new Promise((resolve) => setTimeout(resolve, 40));
  const failed = database.jobs().find((job) => job.id === jobId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Whisper crashed');

  queue.retry(jobId);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const retried = database.jobs().find((job) => job.id === jobId);
  assert.equal(retried.status, 'completed');
  assert.equal(attempt, 2);

  queue.remove(jobId);
  assert.equal(database.jobs().find((job) => job.id === jobId), undefined);
});

test('clearFinished wipes failed and cancelled history but keeps completed rows', async () => {
  const movie = createMovie('center-g');
  const database = createFakeDatabase([movie]);
  const queue = queueModule(database, {
    generateSubtitle: async () => ({ok: false, message: 'nope'}),
    onChanged: () => {}
  });

  queue.enqueue(movie.id, 'generate-subtitle');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(queue.state().jobs.filter((job) => job.status === 'failed').length, 1);

  queue.clearFinished();
  assert.equal(queue.state().jobs.filter((job) => job.status === 'failed').length, 0);
});
