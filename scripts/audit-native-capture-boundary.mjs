import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Independent, read-only accounting of every archived physical interval.
const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('usage: STOPPED_RUN NEW_AUDIT_JSON');
const root = resolve(source), load = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
const report = await load('results.json'), initial = await load('initial-observation.json');
assert(report.stoppedAt && report.final, 'stopped native evidence required');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const frames = new Map(), intervals = new Map(), conflicts = [], duplicateIntervals = [], events = [];
frames.set(initial.sequence, digest(initial));
for (const directory of ['events', 'passive-events']) {
  for (const file of (await readdir(resolve(root, directory))).filter(name => name.endsWith('.json.gz')).sort()) {
    const bytes = await readFile(resolve(root, directory, file)), event = JSON.parse(gunzipSync(bytes));
    const path = directory + '/' + file;
    events.push({ path, id: event.id, sha256: createHash('sha256').update(bytes).digest('hex'),
      first: event.frames[0].sequence, last: event.frames.at(-1).sequence });
    for (const [i, frame] of event.frames.entries()) {
      const hash = digest(frame), old = frames.get(frame.sequence);
      if (old && old !== hash) conflicts.push({ sequence: frame.sequence, path, expected: old, actual: hash });
      frames.set(frame.sequence, hash);
      if (!i) continue;
      const before = event.frames[i - 1];
      assert.equal(frame.sequence, before.sequence + 1, 'internal unobserved interval: ' + path);
      if (intervals.has(before.sequence)) duplicateIntervals.push({ sequence: before.sequence, path, previous: intervals.get(before.sequence) });
      intervals.set(before.sequence, path);
    }
  }
}
const lastArchived = Math.max(initial.sequence, ...frames.keys()), missing = [];
for (let sequence = initial.sequence; sequence < lastArchived; sequence++) if (!intervals.has(sequence)) missing.push([sequence, sequence + 1]);
const finalSequence = report.finalObservation?.sequence;
const finalAvailable = Number.isSafeInteger(finalSequence) && finalSequence >= lastArchived;
const result = { version: 'NativeCaptureBoundaryAudit2', source: root, status: missing.length || conflicts.length || duplicateIntervals.length ? 'failed' : finalAvailable ? 'passed' : 'incomplete',
  initialSequence: initial.sequence, lastArchivedSequence: lastArchived, finalObservedSequence: finalSequence ?? null,
  finalObservationAvailable: finalAvailable,
  archivedIntervals: intervals.size, expectedIntervalsThroughArchive: lastArchived - initial.sequence,
  unarchivedCheckpointTailIntervals: finalAvailable ? finalSequence - lastArchived : null,
  missing, conflictingSharedFrames: conflicts, duplicateIntervals, events,
  newActions: 0, learningWrites: 0,
  scope: 'Archived acquisition continuity only. The checkpoint/close tail is reported separately and is not counted as experience or capability.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, events: events.length }));
if (result.status !== 'passed') process.exitCode = 1;
