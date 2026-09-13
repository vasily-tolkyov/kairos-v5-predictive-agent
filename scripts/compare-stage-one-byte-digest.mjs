import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const [oldBuild, newBuild, source, output] = process.argv.slice(2);
assert(output, 'usage: OLD_ACTOR_DIST NEW_DIST STOPPED_STAGE_ONE_RUN NEW_JSON');
const load = build => import(pathToFileURL(resolve(build, 'src/stage-one-movement.js')));
const [{ StageOneMovement: Old }, { StageOneMovement: New }] = await Promise.all([load(oldBuild), load(newBuild)]);
const old = new Old(), candidate = new New(), hash = value => createHash('sha256').update(value).digest('hex');
const decisions = (await readFile(resolve(source, 'decisions.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const result = { version: 'StageOneByteDigestDifferential1', status: 'running', checkedWindows: 0,
  oldModuleSha256: hash(await readFile(resolve(oldBuild, 'src/stage-one-movement.js'))),
  newModuleSha256: hash(await readFile(resolve(newBuild, 'src/stage-one-movement.js'))),
  sourceReportSha256: hash(await readFile(resolve(source, 'results.json'))), oldLearningMs: 0, newLearningMs: 0,
  scope: 'Private discarded replay only. Same measured rows, fits, pre-update predictions and support; V2 event ledger hashes exact original JSON bytes instead of canonical reordered bytes. No native actions or new independent windows.' };
try {
  for (const decision of decisions.filter(row => row.executed)) {
    const originalBytes = gunzipSync(await readFile(resolve(source, decision.eventPath))), event = JSON.parse(originalBytes);
    assert.equal(JSON.stringify(candidate.predict(event.frames[0], decision.choice.offer)), JSON.stringify(old.predict(event.frames[0], decision.choice.offer)));
    let begin = performance.now(); const prior = old.observe(event); result.oldLearningMs += performance.now() - begin;
    begin = performance.now(); const next = candidate.observe(event); result.newLearningMs += performance.now() - begin;
    assert.equal(next.learned, prior.learned); assert.equal(next.sourceEventSha256, hash(originalBytes));
    assert.equal(JSON.stringify(candidate.snapshot().contexts), JSON.stringify(old.snapshot().contexts));
    result.checkedWindows++;
  }
  result.contextDigest = hash(JSON.stringify(candidate.snapshot().contexts));
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = String(error.stack ?? error); process.exitCode = 1; }
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
