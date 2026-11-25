'use strict';
// parseNfoXml feeds the Studio/Series columns behind the library-card label
// fields. It is a pure string function, so it is bundled straight from the TS
// source and driven without touching disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

function loadParser() {
  const entry = path.join(__dirname, '..', 'app', 'services', 'libraryLayout.ts');
  const bundle = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent'
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports.parseNfoXml;
}

const parseNfoXml = loadParser();

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Sample Title</title>
  <id>SSIS-123</id>
  <year>2021</year>
  <studio>S1 No.1 Style</studio>
  <series>Beautiful Days</series>
  <actor><name>Actress One</name></actor>
  <actor><name>Actress Two</name></actor>
</movie>`;

test('parseNfoXml reads studio and series', () => {
  const parsed = parseNfoXml(SAMPLE);
  assert.equal(parsed.studio, 'S1 No.1 Style');
  assert.equal(parsed.series, 'Beautiful Days');
  assert.equal(parsed.title, 'Sample Title');
  assert.equal(parsed.videoId, 'SSIS-123');
  assert.equal(parsed.year, 2021);
  assert.deepEqual(parsed.actresses, ['Actress One', 'Actress Two']);
});

test('parseNfoXml leaves studio/series undefined when the sidecar omits them', () => {
  const parsed = parseNfoXml('<movie><title>Only A Title</title></movie>');
  assert.equal(parsed.studio, undefined);
  assert.equal(parsed.series, undefined);
});

test('parseNfoXml trims surrounding whitespace on studio and series', () => {
  const parsed = parseNfoXml('<movie><studio>  Moodyz  </studio><series>\n Series X \n</series></movie>');
  assert.equal(parsed.studio, 'Moodyz');
  assert.equal(parsed.series, 'Series X');
});
