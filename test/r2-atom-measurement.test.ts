import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../src/core/contracts.js';
import {
  R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1,
  R2_ATOM_EQUIVALENT_RESOLUTION_V1,
  R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1,
  R2AtomMeasurementAdapterV1,
  solveR2AtomQualificationScaleV1,
} from '../src/core/learning/r2-atom-measurement.js';
import { sha } from '../src/util.js';
import { DistanceEmbedding } from '../src/distance-embedding.js';

const point = (x: number, y: number, z: number): Vec3 => new Float64Array([x, y, z]);

function densify(path: readonly Vec3[], subdivisions: number): Vec3[] {
  const result: Vec3[] = [new Float64Array(path[0]!)];
  for (let index = 1; index < path.length; index++) {
    const before = path[index - 1]!, after = path[index]!;
    for (let part = 1; part <= subdivisions; part++) result.push(point(
      before[0]! + (after[0]! - before[0]!) * part / subdivisions,
      before[1]! + (after[1]! - before[1]!) * part / subdivisions,
      before[2]! + (after[2]! - before[2]!) * part / subdivisions,
    ));
  }
  return result;
}

const shapes: readonly (readonly Vec3[])[] = [
  [point(0, 0, 0), point(.2, 0, 0), point(.4, 0, 0), point(.6, 0, 0)],
  [point(0, 0, 0), point(0, .2, 0), point(0, .4, 0), point(0, .6, 0)],
  [point(0, 0, 0), point(0, 0, .2), point(0, 0, .4), point(0, 0, .6)],
  [point(0, 0, 0), point(.2, 0, 0), point(.35, .1, 0), point(.4, .3, 0)],
  [point(0, 0, 0), point(-.2, 0, 0), point(-.35, .1, 0), point(-.4, .3, 0)],
  [point(0, 0, 0), point(.1, .1, 0), point(.2, 0, .1), point(.3, -.1, .2)],
  [point(0, 0, 0), point(.1, -.1, 0), point(.2, 0, -.1), point(.3, .1, -.2)],
  [point(0, 0, 0), point(-.1, .1, .1), point(-.2, .2, 0), point(-.3, .3, -.1)],
];

function distance(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return Math.hypot(...Array.from({ length: left.length }, (_unused, axis) => left[axis]! - right[axis]!));
}

test('R2 atom measurement qualifies one label-free 3D map for resampling equivalence and clear separation', () => {
  const adapter = R2AtomMeasurementAdapterV1.fit(shapes);
  const state = adapter.exportState();
  assert.equal(state.qualification.result, 'equivalence-and-separation-passed');
  assert(state.qualification.maximumEquivalentDistance <= R2_ATOM_EQUIVALENT_RESOLUTION_V1);
  assert(state.qualification.maximumProtectedNearDistance <= R2_ATOM_PROTECTED_NEAR_OUTPUT_RESOLUTION_V1);
  assert(state.qualification.obviousPairCount > 0);

  const original = adapter.measure(shapes[3]!);
  const resampled = adapter.measure(densify(shapes[3]!, 4));
  assert(distance(original, resampled) <= state.qualification.equivalentOutputMaximum + 1e-9);
  assert(distance(adapter.measure(shapes[0]!), adapter.measure(shapes[1]!))
    >= R2_ATOM_DISTINCT_OUTPUT_RESOLUTION_V1);

  const restored = R2AtomMeasurementAdapterV1.restore(state);
  assert.deepEqual([...restored.measure(shapes[5]!)], [...adapter.measure(shapes[5]!)]);
  assert.deepEqual(restored.exportState(), state);
});

test('R2 atom measurement rejects collapsed calibration, infeasible scale, and false qualification', () => {
  const repeated = Array.from({ length: 8 }, () => shapes[0]!);
  assert.throws(() => R2AtomMeasurementAdapterV1.fit(repeated),
    /event-representation-has-no-identifiable-variation|R2-measurement-has-no-clearly-distinct/);

  const state = R2AtomMeasurementAdapterV1.fit(shapes).exportState();
  const { identitySha256: _oldIdentity, ...body } = state;
  assert.throws(() => solveR2AtomQualificationScaleV1({ maximumUnscaledEquivalentDistance: 2,
    maximumUnscaledProtectedNearDistance: 2, minimumUnscaledObviousDistance: 1,
    maximumUnscaledCoordinateMagnitude: 1 }), /three-dimensional-qualification-infeasible/);

  const invalidBody = { ...body, qualification: { ...body.qualification, minimumObviousDistance: 0 } };
  const invalid = { ...invalidBody, identitySha256: sha(invalidBody) };
  assert.throws(() => R2AtomMeasurementAdapterV1.restore(invalid),
    /legacy-or-incompatible-R2-atom-adapter/);
});

test('raw RMS embedding does not silently replace the qualified metric with per-feature standardization', () => {
  const rows = Array.from({ length: 8 }, (_unused, index) => ({
    broad: index,
    narrow: index === 7 ? 1e-6 : 0,
  }));
  const raw = DistanceEmbedding.fitRawRms(rows);
  assert.deepEqual(raw.state.mean, [0, 0]);
  assert.deepEqual(raw.state.deviation, [1, 1]);
  const restored = new DistanceEmbedding(raw.state);
  assert.deepEqual(restored.encode(rows[3]!), raw.encode(rows[3]!));
  assert.notDeepEqual(DistanceEmbedding.fit(rows).state.deviation, raw.state.deviation);
});

test('R2 atom restore refuses the old standardized adapter identity', () => {
  const current = R2AtomMeasurementAdapterV1.fit(shapes).exportState();
  const { identitySha256: _identity, embeddingInputMetric: _metric, ...legacyBody } = current;
  const legacy = { ...legacyBody, version: 'R2AtomMeasurementAdapterStateV2',
    embedding: { ...legacyBody.embedding, deviation: legacyBody.embedding.deviation.map(() => 2) } };
  assert.throws(() => R2AtomMeasurementAdapterV1.restore(legacy as never),
    /legacy-or-incompatible-R2-atom-adapter/);
});
