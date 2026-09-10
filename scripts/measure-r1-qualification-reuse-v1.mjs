/** Neutral exact-algorithm oracle; never a Minecraft capability result. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
const [build, output] = process.argv.slice(2);
if (!build || !output) throw new Error('compiled-root-and-new-report-required');
const load = path => import(pathToFileURL(resolve(build, path)).href);
const { DistributedPhysicalMedium3DV1: Medium } = await load('src/core/physics/distributed-physical-medium.js');
const { DistributedR1ExperienceStoreV1: Store } = await load('src/core/learning/distributed-r1.js');
const { sha, canonical } = await load('src/util.js');
const medium = new Medium({ name: 'neutral-exact-qualification' }), store = new Store(medium), ids = [];
for (let i = 0; i < 16; i++) {
  const frame = (sequence, selectedSlot) => ({ sequence, activeSeconds: sequence * .05,
    contextId: `neutral-context-${i % 8}`, targetId: null, objects: [],
    self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot, stable: true } } });
  const frames = [frame(i * 2 + 1, 2 + i % 7), frame(i * 2 + 2, i % 2)];
  const cue = { kind: 'select-hotbar', parameters: { slot: i % 2 }, targetRole: null };
  const event = { version: 'RealEventV5', id: `neutral-${i}`, cue, frames, trackedIds: ['self'],
    bodyResult: { action: { kind: cue.kind, parameters: cue.parameters }, executed: true,
      status: 'completed', startSequence: frames[0].sequence, endSequence: frames[1].sequence,
      terminationReason: 'stable' }, provenance: 'executed-real-body', complete: true };
  store.observe(event); ids.push(event.id);
}
const before = sha(medium.snapshot()), original = Medium.prototype.probe;
let probeCount = 0;
Medium.prototype.probe = function (...args) { probeCount++; return original.apply(this, args); };
const started = performance.now();
const qualifications = ids.map(id => store.attractorQualification(id));
const durationMs = performance.now() - started;
Medium.prototype.probe = original;
const report = { version: 'NeutralExactR1QualificationMeasurementV1',
  fixture: 'neutral-not-real-Minecraft', qualifications, qualificationSha256: sha(qualifications),
  durationMs, probeCount, before, after: sha(medium.snapshot()),
  gameCalls: 0, writesDuringMeasurement: 0 };
await writeFile(output, canonical(report), { flag: 'wx' });
console.log(JSON.stringify({ qualificationSha256: report.qualificationSha256, durationMs, probeCount,
  readOnly: report.before === report.after }));
