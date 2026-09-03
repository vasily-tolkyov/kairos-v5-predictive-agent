import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eventRows, actionObservationTrackedIdsV1, cueFor } from '../dist/src/events.js';
import { DistanceEmbedding } from '../dist/src/distance-embedding.js';
import { R1_CONFIG, R2_CONFIG, FORMAL_EVALUATION } from '../dist/src/core/config.js';
import { r2AtomDescriptorV2 } from '../dist/src/core/learning/r2-atom-descriptor.js';
import {
  R2_ATOM_EQUIVALENT_RESOLUTION_V1,
  R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1,
  R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1,
  R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1,
  R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1,
  R2AtomMeasurementAdapterV1,
} from '../dist/src/core/learning/r2-atom-measurement.js';

const evidence = resolve(process.argv[2] ??
  'evidence/hierarchical-minecraft-short-chain-live-v1-timing-repair-001');
const parseLines = async path => (await readFile(path, 'utf8')).trim().split(/\r?\n/)
  .filter(Boolean).map(line => JSON.parse(line));
const frameRecords = await parseLines(resolve(evidence, 'frames.jsonl'));
const eventRecords = await parseLines(resolve(evidence, 'events.jsonl'));
const frames = new Map(frameRecords.filter(x => x.kind === 'frame').map(x => [x.value.sequence, x.value]));
const receipts = eventRecords.filter(x => x.kind === 'body-result').map(x => x.value).slice(0, 128);
if (receipts.length !== 128) throw new Error(`expected-128-body-results:${receipts.length}`);

const events = receipts.map((receipt, index) => {
  const window = [];
  for (let sequence = receipt.startSequence; sequence <= receipt.endSequence; sequence++) {
    const frame = frames.get(sequence); if (!frame) throw new Error(`missing-frame:${sequence}`); window.push(frame);
  }
  const first = window[0];
  const noteId = receipt.action.targetId ?? first.objects.find(x => x.type === 'note_block')?.id
    ?? window.flatMap(x => x.objects).find(x => x.type === 'note_block')?.id;
  const scope = noteId ? { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [noteId] } : undefined;
  return { version: 'RealEventV5', id: `diagnostic-${index + 1}`,
    cue: cueFor(receipt.action, first), frames: window,
    trackedIds: actionObservationTrackedIdsV1(receipt.action.targetId, scope, [], window),
    bodyResult: receipt, provenance: 'executed-real-body', complete: true };
});

const series = events.map(eventRows);
const firstEmbedding = DistanceEmbedding.fit(series.flatMap(x => x.rows));
let maximumAdjacentGap = 0;
for (const item of series) {
  const points = item.rows.map(row => firstEmbedding.encode(row).coordinate);
  for (let i = 1; i < points.length; i++) maximumAdjacentGap = Math.max(maximumAdjacentGap,
    Math.hypot(...points[i].map((v, axis) => v - points[i - 1][axis])));
}
const eventMap = new DistanceEmbedding({ ...firstEmbedding.state,
  scale: R1_CONFIG.kernelWidth * .4 / maximumAdjacentGap });
const paths = series.map(item => item.rows.map(row => Float64Array.from(eventMap.encode(row).coordinate)));
const rows = paths.map(path => {
  const geometry = r2AtomDescriptorV2(path);
  return Object.fromEntries([...geometry].map((value, i) => [`FrozenR1EventPathDescriptorV2/${i}`, value]));
});
const fitted = DistanceEmbedding.fitRawRms(rows);
const coordinates = rows.map(row => fitted.encode(row).coordinate);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const sourceDistance = (a, b) => {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return Math.sqrt(keys.reduce((sum, key) => sum + ((a[key] ?? 0) - (b[key] ?? 0)) ** 2, 0)
    / Math.max(1, keys.length));
};
const describe = index => ({ index, kind: receipts[index].action.kind,
  parameters: receipts[index].action.parameters, start: receipts[index].startSequence,
  end: receipts[index].endSequence });
let protectedNearPairCount = 0, obviousPairCount = 0;
let maximumUnscaledProtectedNearDistance = 0, minimumUnscaledObviousDistance = Infinity;
let maximumProtectedPair = null, minimumObviousPair = null;
for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
  const source = sourceDistance(rows[left], rows[right]);
  const output = distance(coordinates[left], coordinates[right]);
  if (source <= R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1 + 1e-12) {
    protectedNearPairCount++;
    if (output > maximumUnscaledProtectedNearDistance) {
      maximumUnscaledProtectedNearDistance = output;
      maximumProtectedPair = { left: describe(left), right: describe(right), source, output };
    }
  }
  if (source + 1e-12 >= R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1) {
    obviousPairCount++;
    if (output < minimumUnscaledObviousDistance) {
      minimumUnscaledObviousDistance = output;
      minimumObviousPair = { left: describe(left), right: describe(right), source, output };
    }
  }
}
const maximumMagnitude = Math.max(...coordinates.flatMap(x => x.map(Math.abs)));
const margin = R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale;
const available = Math.min(...R2_CONFIG.boundary.max.map((max, axis) =>
  Math.min(max - margin, -R2_CONFIG.boundary.min[axis] - margin)));
const lower = R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1 / minimumUnscaledObviousDistance;
const nearCap = maximumUnscaledProtectedNearDistance > 1e-12
  ? R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1 / maximumUnscaledProtectedNearDistance : Infinity;
const boundaryCap = maximumMagnitude > 1e-12 ? available / maximumMagnitude : Infinity;
console.log(JSON.stringify({ eventCount: events.length, pathSamples: FORMAL_EVALUATION.pathSamples,
  thresholds: { protectedNearSource: R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1,
    obviousSource: R2_ATOM_OBVIOUS_SOURCE_RESOLUTION_V1,
    protectedNearOutput: R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1,
    obviousOutput: R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1,
    equivalentOutput: R2_ATOM_EQUIVALENT_RESOLUTION_V1 },
  maximumAdjacentGap, protectedNearPairCount, obviousPairCount,
  maximumUnscaledProtectedNearDistance, minimumUnscaledObviousDistance, maximumMagnitude,
  requiredScaleLower: lower, protectedNearScaleCap: nearCap, boundaryScaleCap: boundaryCap,
  upperScale: Math.min(nearCap, boundaryCap), infeasibilityRatio: lower / Math.min(nearCap, boundaryCap),
  maximumProtectedPair, minimumObviousPair }, null, 2));

const productionAdapter = R2AtomMeasurementAdapterV1.fit(paths);
const qualified = productionAdapter.exportState().qualification;
const reversedQualified = R2AtomMeasurementAdapterV1.fit([...paths].reverse()).exportState().qualification;
console.log(JSON.stringify({ productionAdapterQualification: qualified,
  reversedOrderQualification: reversedQualified }, null, 2));

const measured = paths.map(path => [...productionAdapter.measure(path)]);
const arm = episode => `P${episode % 3}`;
const foundation = Array.from({ length: 36 }, (_, episode) => ({ episode, arm: arm(episode),
  atoms: [20 + episode * 3, 21 + episode * 3, 22 + episode * 3] }));
const distribution = atomPosition => {
  const groups = Object.fromEntries(['P0', 'P1', 'P2'].map(name => [name,
    foundation.filter(x => x.arm === name).map(x => x.atoms[atomPosition])]));
  const pairs = (left, right) => groups[left].flatMap(li => groups[right]
    .filter(ri => left !== right || li < ri).map(ri => distance(measured[li], measured[ri])));
  return { within: Object.fromEntries(['P0', 'P1', 'P2'].map(name => {
    const values = pairs(name, name); return [name, { min: Math.min(...values), max: Math.max(...values) }];
  })), between: Object.fromEntries([['P0','P1'],['P1','P2'],['P0','P2']].map(([a,b]) => {
    const values = pairs(a,b); return [`${a}-${b}`, { min: Math.min(...values), max: Math.max(...values) }];
  })) };
};
const publicChangeSignature = index => JSON.stringify(eventRows(events[index]).changes.flat().map(change => ({
  subject: change.subject, property: change.property, before: change.before, after: change.after,
})).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
let maxSameSignatureNear = 0, minDifferentSignature = Infinity, differentWitness = null;
for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
  const source = sourceDistance(rows[left], rows[right]);
  const output = distance(coordinates[left], coordinates[right]);
  const same = publicChangeSignature(left) === publicChangeSignature(right);
  if (same && source <= R2_ATOM_PROTECTED_NEAR_SOURCE_RESOLUTION_V1 + 1e-12)
    maxSameSignatureNear = Math.max(maxSameSignatureNear, output);
  if (!same && output < minDifferentSignature) {
    minDifferentSignature = output;
    differentWitness = { left: describe(left), right: describe(right), source, output,
      leftSignature: publicChangeSignature(left), rightSignature: publicChangeSignature(right) };
  }
}
console.log(JSON.stringify({ scaledR2AtomDistributions: {
  look: distribution(0), interact: distribution(1), observe: distribution(2) },
  compositeQualificationDiagnostic: { maxSameSignatureNear, minDifferentSignature,
    transitionRequiredScale: R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1 / minDifferentSignature,
    sameSignatureNearScaleCap: maxSameSignatureNear > 1e-12
      ? R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1 / maxSameSignatureNear : null,
    differentWitness },
  publicChangeSignatures: Object.fromEntries(['P0','P1','P2'].map(name => [name,
    Object.fromEntries([['look',0],['interact',1],['observe',2]].map(([label, position]) => [label,
      [...new Set(foundation.filter(x => x.arm === name)
        .map(x => publicChangeSignature(x.atoms[position])))]]))])) }, null, 2));
