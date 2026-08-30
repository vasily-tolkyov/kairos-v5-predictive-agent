import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import { cueFor, eventRows } from '../src/events.js';
import type { RawExperience, Vec3 } from '../src/core/contracts.js';
import { R1_CONFIG, R2_CONFIG } from '../src/core/config.js';
import { DistanceEmbedding } from '../src/distance-embedding.js';
import { emptyFirewallRejections, emptyLeakageAudit, ObservationGate, type TrustedExperience } from '../src/core/firewall.js';
import { calibrateR2OutputResolution, densifyPolylineVertices, PathProjector,
  pathInitialTangent } from '../src/core/learning/path-projector.js';

const evidenceRoot = resolve('evidence/minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup');

interface TimelineRow {
  readonly action: Action;
  readonly eventId: string;
  readonly observationWindow: readonly [number, number];
}

let sealedExperiences: Promise<readonly TrustedExperience[]> | null = null;
function readSealedTrustedExperiences(): Promise<readonly TrustedExperience[]> {
  sealedExperiences ??= (async () => {
    const frameLines = (await readFile(resolve(evidenceRoot, 'frames.jsonl'), 'utf8')).trim().split(/\r?\n/);
    const observations = new Map<number, Observation>();
    for (const line of frameLines) {
      const record = JSON.parse(line) as { readonly kind: string; readonly value: Observation };
      if (record.kind === 'frame') observations.set(record.value.sequence, record.value);
    }
    const timeline = JSON.parse(await readFile(resolve(evidenceRoot, 'GUIDED_TRAINING_TIMELINE.json'), 'utf8')) as readonly TimelineRow[];
    assert.equal(timeline.length, 128);
    const events: RealEvent[] = timeline.map(row => {
      const frames: Observation[] = [];
      for (let sequence = row.observationWindow[0]; sequence <= row.observationWindow[1]; sequence += 1) {
        const frame = observations.get(sequence); assert(frame, `missing sealed frame ${sequence}`); frames.push(frame);
      }
      const action: Action = structuredClone(row.action);
      return { version: 'RealEventV5', id: row.eventId, cue: cueFor(action, frames[0]!), frames,
        trackedIds: ['self', ...(action.targetId ? [action.targetId] : [])],
        bodyResult: { action, executed: true, status: 'completed', startSequence: frames[0]!.sequence,
          endSequence: frames.at(-1)!.sequence, terminationReason: 'stable' },
        provenance: 'executed-real-body', complete: true };
    });
    const series = events.map(eventRows);
    const initialEmbedding = DistanceEmbedding.fit(series.flatMap(value => value.rows));
    let maximumAdjacentGap = 0;
    for (const event of series) {
      const points = event.rows.map(row => initialEmbedding.encode(row).coordinate);
      for (let index = 1; index < points.length; index += 1) {
        maximumAdjacentGap = Math.max(maximumAdjacentGap,
          Math.hypot(...points[index]!.map((value, axis) => value - points[index - 1]![axis]!)));
      }
    }
    assert(maximumAdjacentGap > 0);
    const embedding = new DistanceEmbedding({ ...initialEmbedding.state,
      scale: R1_CONFIG.kernelWidth * .4 / maximumAdjacentGap });
    const gate = new ObservationGate(emptyLeakageAudit(), emptyFirewallRejections());
    return events.map((event): TrustedExperience => {
      const trajectory = eventRows(event).rows.map(row => new Float64Array(embedding.encode(row).coordinate));
      const tangent = pathInitialTangent(trajectory); assert(tangent);
      const raw: RawExperience = { trajectory, perception: new Float64Array(256),
        r1State: { position: trajectory[0]!, velocity: tangent, causalPrefix: trajectory.slice(0, 2),
          observedAt: event.frames.at(-1)!.activeSeconds, numericAttributes: new Float64Array() },
        provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true,
          containsSimulatorPrivate: false, containsFutureObservation: false, containsSemanticRuleOrResult: false } };
      return gate.admit(raw);
    });
  })();
  return sealedExperiences;
}

test('sealed raw attempt-017 traces calibrate one label-free boundary-bounded R2 unit end to end', async () => {
  const projector = new PathProjector();
  const experiences = await readSealedTrustedExperiences();
  projector.fit(experiences);
  const state = projector.exportState() as unknown as { readonly resolution: {
    readonly version: string; readonly selectionRule: string; readonly outputScale: number;
    readonly equivalentVariationMaximum: number; readonly equivalenceLimitedScale: number | null;
    readonly boundaryLimitedScale: number | null; readonly boundaryMargin: number;
    readonly componentSizes: readonly number[];
  } };
  const resolution = state.resolution;
  assert.equal(resolution.version, 'R2MeasurementResolutionCalibrationV4');
  assert.equal((resolution as any).equivalentGeometryMethod, 'vertex-preserving-polyline-densification');
  assert.equal((resolution as any).boundaryGeometry, 'max-centered-radius-within-inscribed-sphere');
  assert.equal(resolution.selectionRule, 'min-equivalence-and-boundary-caps');
  assert(resolution.outputScale > 0);
  assert(resolution.equivalentVariationMaximum * resolution.outputScale <= R2_CONFIG.kernelWidth * (1 + 1e-10));
  if (resolution.equivalentVariationMaximum === 0) {
    assert.equal(resolution.equivalenceLimitedScale, null);
    assert.equal(resolution.outputScale, resolution.boundaryLimitedScale,
      'exact parameterization invariance must not be described as an identified measurement scale');
  }
  assert.equal(resolution.componentSizes.reduce((sum, value) => sum + value, 0), 128);
  assert(resolution.componentSizes.length > 1);
  assert(Math.max(...resolution.componentSizes) < 128,
    'the real 128-event cloud must not collapse back into one physical R2 basin');
  const margin = resolution.boundaryMargin;
  for (const experience of experiences) for (const [axis, value] of projector.projectTrustedPath(experience).entries()) {
    assert(value >= R2_CONFIG.boundary.min[axis]! + margin - 1e-9);
    assert(value <= R2_CONFIG.boundary.max[axis]! - margin + 1e-9);
  }
});

test('changing only the unscaled measurement unit leaves calibrated R2 coordinates unchanged', () => {
  const points = Array.from({ length: 16 }, (_, index) => new Float64Array([
    (index - 7.5) * .2, Math.sin(index) * .1, Math.cos(index * .7) * .08,
  ]));
  const variations = points.flatMap((_, index) => [.003 + index * 1e-5, .004 + index * 2e-5]);
  const inputScale = .125;
  const left = calibrateR2OutputResolution(points, variations);
  const right = calibrateR2OutputResolution(
    points.map(point => new Float64Array(point.map(value => value * inputScale))),
    variations.map(value => value * inputScale),
  );
  assert(Math.abs(left.outputScale - right.outputScale * inputScale) / left.outputScale < 1e-10);
  for (let index = 0; index < points.length; index += 1) for (let axis = 0; axis < 3; axis += 1) {
    const a = (points[index]![axis]! - left.unscaledCenter[axis]!) * left.outputScale;
    const scaledPoint = points[index]![axis]! * inputScale;
    const b = (scaledPoint - right.unscaledCenter[axis]!) * right.outputScale;
    assert(Math.abs(a - b) < 1e-9);
  }
});

test('rigidly rotating an arbitrary R2 embedding cannot change its calibrated physical unit or basin topology', () => {
  const points = Array.from({ length: 16 }, (_, index) => new Float64Array([
    (index - 7.5) * .2, Math.sin(index) * .31, Math.cos(index * .7) * .17,
  ]));
  const angle = .73, cosine = Math.cos(angle), sine = Math.sin(angle);
  const rotated = points.map(point => new Float64Array([
    point[0]! * cosine - point[1]! * sine,
    point[0]! * sine + point[1]! * cosine,
    point[2]!,
  ]));
  const variations = Array.from({ length: 32 }, () => 0);
  const left = calibrateR2OutputResolution(points, variations);
  const right = calibrateR2OutputResolution(rotated, variations);
  assert(Math.abs(left.outputScale - right.outputScale) < 1e-10);
  assert.deepEqual(left.componentSizes, right.componentSizes);
});

test('connectivity plateaus and component counts cannot select the output scale', () => {
  const cloud = (levels: readonly number[]): readonly Vec3[] => levels.flatMap(value => [
    new Float64Array([value, 0, 0]), new Float64Array([-value, 0, 0]),
  ]);
  const separated = cloud([4, 3.5, 3, 2.5, 2, 1.5, 1, .5]);
  const concentrated = cloud([4, .07, .06, .05, .04, .03, .02, .01]);
  const variations = Array.from({ length: 32 }, () => .05);
  const left = calibrateR2OutputResolution(separated, variations);
  const right = calibrateR2OutputResolution(concentrated, variations);
  assert.equal(left.outputScale, R2_CONFIG.kernelWidth / .05);
  assert.equal(right.outputScale, left.outputScale);
  assert.notDeepEqual(left.componentSizes, right.componentSizes);
});

test('frozen checkpoint rejects forged measurement calibration metadata', async () => {
  const projector = new PathProjector(); projector.fit(await readSealedTrustedExperiences());
  const state = structuredClone(projector.exportState()) as any;
  state.resolution.outputScale *= 1.1;
  assert.throws(() => PathProjector.fromState(state), /invalid frozen PathProjector checkpoint state/);
  const state2 = structuredClone(projector.exportState()) as any;
  state2.resolution.equivalentVariationMaximum = 1e-3;
  assert.throws(() => PathProjector.fromState(state2), /invalid frozen PathProjector checkpoint state/);
  const state3 = structuredClone(projector.exportState()) as any;
  state3.resolution.componentSizes[0] = 0;
  assert.throws(() => PathProjector.fromState(state3), /invalid frozen PathProjector checkpoint state/);
});

test('legacy projector states fail closed with an explicit raw-rebuild requirement', async () => {
  const projector = new PathProjector(); projector.fit(await readSealedTrustedExperiences());
  const legacy = structuredClone(projector.exportState()) as any;
  delete legacy.version; delete legacy.resolution;
  assert.throws(() => PathProjector.fromState(legacy),
    /PathProjectorStateV1\/V2\/V3 is audit-only; rebuild from trusted raw events/);
});

test('measurement-equivalent variants preserve every observed polyline vertex and cannot cut a corner', () => {
  const corner = [new Float64Array([0, 0, 0]), new Float64Array([1, 0, 0]),
    new Float64Array([1, 1, 0])] as const;
  for (const subdivisions of [2, 3, 4]) {
    const dense = densifyPolylineVertices(corner, subdivisions);
    assert.equal(dense.length, (corner.length - 1) * subdivisions + 1);
    for (const vertex of corner) assert(dense.some(point => point.every((value, axis) => value === vertex[axis])));
    assert(dense.every(point => (Math.abs(point[1]!) < 1e-12 && point[0]! >= 0 && point[0]! <= 1)
      || (Math.abs(point[0]! - 1) < 1e-12 && point[1]! >= 0 && point[1]! <= 1)));
  }
});

test('resolution fails closed when neither measurement variation nor boundary extent identifies a scale', () => {
  const collapsed = Array.from({ length: 8 }, () => new Float64Array([0, 0, 0]));
  assert.throws(() => calibrateR2OutputResolution(collapsed, Array.from({ length: 8 }, () => 0)),
    /r2-physical-resolution-not-identifiable/);
});
