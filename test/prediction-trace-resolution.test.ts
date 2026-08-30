import test from 'node:test';
import assert from 'node:assert/strict';
import { PREDICTION_CONFIG, R1_CONFIG } from '../src/core/config.js';
import type { R1TraceSnapshot, Vec3 } from '../src/core/contracts.js';
import { emptyFirewallRejections, emptyLeakageAudit } from '../src/core/firewall.js';
import { pathInitialTangent } from '../src/core/learning/path-projector.js';
import { PredictionClone } from '../src/core/prediction/prediction-clone.js';
import { PhysicalMedium3D } from '../src/core/physics/physical-medium.js';
import { adaptPredictionTraceResolution, restorePredictionTracePositions } from '../src/core/prediction/trace-resolution-adapter.js';
import { SplitMix64 } from '../src/core/random.js';
import { readVisitedRegions } from '../src/memory.js';
import { sha } from '../src/util.js';

// Exact public geometry of the sealed attempt-017 interaction trace.  The
// opaque IDs are deliberately replaced; no Minecraft rule or result is used
// by the adapter.
const centers = [
  [-0.043338467245087275, -0.004761539345498224, -0.005930034977305936],
  [-0.0425361219402799, -0.00419007475124338, -0.00442126044679974],
  [-0.0426424241670983, -0.0040337707043203, -0.00413788973532769],
  [-0.0426381449032179, -0.00386795518824876, -0.00384417434515982],
  [-0.0425370364171098, -0.00369513601516181, -0.00354377226345555],
  [-0.0423514245295849, -0.00351744676948101, -0.00323974117144316],
  [-0.0420923304735066, -0.00333669519851217, -0.00293462414723385],
  [-0.0417695903143404, -0.00315440634063261, -0.00263052428673101],
] as const;
const coefficients = [-1.33, -6.12, -7.02, -7.92, -8.88, -9.94, -11.10, -12.38];
const trace: R1TraceSnapshot = {
  pageId: 'page', traceId: 'trace', capturedAt: 0,
  kernels: centers.map((center, index) => ({ center: new Float64Array(center), coefficient: coefficients[index]!,
    originalMagnitude: -coefficients[index]!, sigma: R1_CONFIG.kernelWidth, depositedAt: 0,
    kind: 'road' as const, arcFraction: index / (centers.length - 1), traceId: 'trace' })),
};
const change = { subject: 'opaque-subject', property: 'opaque-property', before: 'a', after: 'b',
  observationIndex: 1, meaning: 'observed-co-occurrence' as const };
const annotations = [[], [change], [], [], [], [], [], []] as const;

function run(snapshot: R1TraceSnapshot, seeds = 24): { valid: number; progressed: number; moved: number } {
  const clone = new PredictionClone(emptyLeakageAudit(), emptyFirewallRejections());
  const tangent = pathInitialTangent(snapshot.kernels.map(kernel => kernel.center))!;
  let valid = 0, progressed = 0, moved = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const prediction = clone.run(snapshot, snapshot.kernels[0]!.center, tangent, new SplitMix64(BigInt(seed + 1)), 180);
    if (prediction.acceptedSteps > 0) moved += 1;
    const read = readVisitedRegions(snapshot, prediction.positions, annotations);
    if (read.readout.length > 0) valid += 1;
    if (read.readout.flatMap(item => item.changes).some(item => item.after === 'b')) progressed += 1;
  }
  return { valid, progressed, moved };
}

function potential(snapshot: R1TraceSnapshot, point: ArrayLike<number>): number {
  return snapshot.kernels.reduce((sum, kernel) => {
    const radius = Math.hypot(...kernel.center.map((value, axis) => value - point[axis]!));
    return sum + kernel.coefficient * Math.exp(-.5 * (radius / kernel.sigma) ** 2);
  }, 0);
}

test('sealed short interaction reproduces the physical resolution failure before adaptation', () => {
  assert.deepEqual(run(trace), { valid: 0, progressed: 0, moved: 1 });
});

test('uniform prediction-unit adaptation resolves the trace without changing its dimensionless field or persistent snapshot', () => {
  const before = sha(trace), adapted = adaptPredictionTraceResolution(trace);
  assert(adapted.scaleFactor > 20);
  assert(Math.abs(adapted.adaptedMaximumAdjacentGap - R1_CONFIG.kernelWidth * .4) < 1e-12);
  assert.equal(sha(trace), before);
  for (let index = 0; index < trace.kernels.length; index += 1) {
    const original = trace.kernels[index]!, scaled = adapted.snapshot.kernels[index]!;
    assert.equal(scaled.coefficient, original.coefficient);
    assert.equal(scaled.sigma / original.sigma, adapted.scaleFactor);
    assert.equal(scaled.traceId, original.traceId);
  }
  for (let index = 0; index < trace.kernels.length; index += 1) {
    assert(Math.abs(potential(trace, trace.kernels[index]!.center)
      - potential(adapted.snapshot, adapted.snapshot.kernels[index]!.center)) < 1e-10,
    `uniform unit conversion changed the dimensionless potential at kernel ${index}`);
  }
  assert.deepEqual(run(adapted.snapshot), { valid: 24, progressed: 24, moved: 24 });
});

test('reported random positions return to the persistent R1 unit and well-scaled traces are not contracted', () => {
  const adapted = adaptPredictionTraceResolution(trace), source = adapted.snapshot.kernels[0]!.center;
  const restored = restorePredictionTracePositions(adapted.snapshot.kernels.map(kernel => kernel.center), source, adapted.scaleFactor);
  restored.forEach((point, index) => point.forEach((value, axis) => {
    assert(Math.abs(value - trace.kernels[index]!.center[axis]!) < 1e-12);
  }));
  const wide = { ...trace, kernels: trace.kernels.map((kernel, index) => ({ ...kernel,
    center: new Float64Array([index * .05, 0, 0]) })) };
  assert.equal(adaptPredictionTraceResolution(wide).scaleFactor, 1);
});

test('clone gauge is exactly the smaller-step original-coordinate Metropolis process, not a historical result shortcut', () => {
  const adapted = adaptPredictionTraceResolution(trace), steps = 180, seed = 7n;
  const clone = new PredictionClone(emptyLeakageAudit(), emptyFirewallRejections());
  const tangent = pathInitialTangent(trace.kernels.map(kernel => kernel.center))!;
  const scaled = clone.run(adapted.snapshot, adapted.snapshot.kernels[0]!.center, tangent,
    new SplitMix64(seed), steps);
  const restored = restorePredictionTracePositions(scaled.positions,
    adapted.snapshot.kernels[0]!.center, adapted.scaleFactor);

  const reference = new PhysicalMedium3D({ ...PREDICTION_CONFIG,
    timeStep: adapted.equivalentOriginalTimeStep });
  const page = reference.createPageFromTrace(trace, trace.kernels.map(kernel => kernel.center));
  const originalPositions: Vec3[] = [new Float64Array(trace.kernels[0]!.center)];
  const random = new SplitMix64(seed); let current: Vec3 = originalPositions[0]!, accepted = 0;
  for (let step = 0; step < steps; step += 1) {
    const result = reference.stochasticStep(page, current, random);
    current = result.position; if (result.accepted) accepted += 1; originalPositions.push(current);
  }
  assert.equal(scaled.acceptedSteps, accepted);
  restored.forEach((position, index) => position.forEach((value, axis) => {
    assert(Math.abs(value - originalPositions[index]![axis]!) < 2e-12,
      `clone gauge diverged from smaller-step reference at ${index}/${axis}`);
  }));
  const scaledRead = readVisitedRegions(adapted.snapshot, scaled.positions, annotations);
  const referenceRead = readVisitedRegions(trace, originalPositions, annotations);
  assert.deepEqual(scaledRead.readout.map(item => [item.kernelIndex, item.changes]),
    referenceRead.readout.map(item => [item.kernelIndex, item.changes]));
});
