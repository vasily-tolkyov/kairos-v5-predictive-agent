import test from 'node:test';
import assert from 'node:assert/strict';
import { eventRows } from '../src/events.js';
import { DistanceEmbedding } from '../src/distance-embedding.js';
import { PhysicalMemory, readVisitedRegions } from '../src/memory.js';
import { PhysicalMedium3D } from '../src/core/physics/physical-medium.js';
import { R1_CONFIG } from '../src/core/config.js';
import { PredictionClone } from '../src/core/prediction/prediction-clone.js';
import { emptyFirewallRejections, emptyLeakageAudit } from '../src/core/firewall.js';
import { SplitMix64 } from '../src/core/random.js';
import { canonical, sha } from '../src/util.js';
import type { RealEvent, Observation } from '../src/contracts.js';

export function syntheticEvent(index: number, mode: 'door' | 'jump' | 'none' = 'none', translation = 0): RealEvent {
  const frames: Observation[] = Array.from({ length: 21 }, (_, i) => ({ sequence: index * 21 + i,
    activeSeconds: index * 2 + i * .05,
    self: { position: [translation, mode === 'jump' ? Math.sin(Math.PI * i / 20) : 0, 0], yaw: 0, pitch: 0,
      properties: { grounded: mode !== 'jump' || i === 0 || i === 20 } },
    objects: [{ id: 'object-1', type: 'synthetic-panel', relativePosition: [1, 0, 0], properties: { open: mode === 'door' && i >= 10 } }],
    targetId: 'object-1', contextId: `synthetic-layout-${index % 8}` }));
  return { version: 'RealEventV5', id: `synthetic-event-${index}`, cue: { kind: mode === 'jump' ? 'jump' : mode === 'door' ? 'interact' : 'wait', parameters: {}, targetRole: null },
    frames, trackedIds: ['self', 'object-1'], provenance: 'executed-real-body', complete: true,
    bodyResult: { action: { kind: 'wait', parameters: {} }, executed: true, status: 'completed',
      startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence } };
}

test('concrete public state, stationary jump and no-change window are distinct; translation is not an event feature', () => {
  const door = eventRows(syntheticEvent(0, 'door'));
  assert(door.changes.flat().some(c => c.property === 'open' && c.before === false && c.after === true));
  const jump = syntheticEvent(1, 'jump'); assert(Math.abs(jump.frames.at(-1)!.self.position[1]) < 1e-12);
  assert(eventRows(jump).changes.flat().some(c => c.property === 'displacement.1'));
  assert.equal(canonical(eventRows(syntheticEvent(0, 'door'))), canonical(eventRows(syntheticEvent(0, 'door', 1000))));
  assert(eventRows(syntheticEvent(2)).changes.flat().some(c => c.property === 'change-within-observed-window'));
  const map = DistanceEmbedding.fit([door, eventRows(jump), eventRows(syntheticEvent(2))].flatMap(x => x.rows));
  assert.notDeepEqual(map.encode(door.rows[0]!).coordinate, map.encode(door.rows.at(-1)!).coordinate);
  assert.equal(map.state.weights.length, 3);
});
test('unchanged physical engine: zero diffusion, actual exponential recovery and read-only random clone', () => {
  const medium = new PhysicalMedium3D({ ...R1_CONFIG, diffusion: 0 }); const page = medium.createPage();
  const path = Array.from({ length: 21 }, (_, i) => new Float64Array([i * .01, 0, 0]));
  medium.depositOrderedTrajectory(page, path, 1, 'real-trace');
  assert.deepEqual(medium.stochasticStep(page, path[0]!, new SplitMix64(1n)).position, path[0]);
  const before = medium.potentialAt(page, path[0]!); medium.recover(1);
  assert(Math.abs(medium.potentialAt(page, path[0]!) / before - Math.exp(-.002)) < 1e-12);
  const hash = sha(medium.snapshot()), clone = new PredictionClone(emptyLeakageAudit(), emptyFirewallRejections());
  const result = clone.run(medium.traceSnapshot(page, 'real-trace'), path[0]!, new Float64Array([1, 0, 0]), new SplitMix64(1n), 180);
  assert.equal(result.positions.length, 181); assert.equal(sha(medium.snapshot()), hash);
});
test('selected history is not a future answer: off-road positions and local collisions never complete an old outcome', () => {
  const medium = new PhysicalMedium3D(R1_CONFIG); const page = medium.createPage();
  medium.depositOrderedTrajectory(page, [new Float64Array([0, 0, 0]), new Float64Array([.02, 0, 0])], 1, 'trace');
  const snapshot = medium.traceSnapshot(page, 'trace')!;
  const change = { subject: 'x', property: 'open', before: false, after: true, observationIndex: 1, meaning: 'observed-co-occurrence' as const };
  const absent = readVisitedRegions(snapshot, [new Float64Array([0, 0, 0]), new Float64Array([4, 4, 4])], [[], [change]]);
  assert.equal(absent.readout.length, 0); assert.equal(absent.reason, 'random-trajectory-did-not-reach-readout');
  const reached = readVisitedRegions(snapshot, [new Float64Array([0, 0, 0]), new Float64Array([.02, 0, 0])], [[], [change]]);
  assert.equal(reached.readout.length, 1); assert.equal(reached.readout[0]!.sampleStep, 1);
  const collision = { ...snapshot, kernels: [snapshot.kernels[1]!, snapshot.kernels[1]!] };
  const uncertain = readVisitedRegions(collision, [new Float64Array([0, 0, 0]), new Float64Array([.02, 0, 0])],
    [[change], [{ ...change, before: true, after: false }]]);
  assert.equal(uncertain.readout.length, 0); assert.equal(uncertain.reason, 'indistinguishable-local-outcomes');
});
test('zero-start, one new 128-event calibration, physical recall disappears with erased R1/R2 and never predicts without R2A', () => {
  const memory = new PhysicalMemory();
  assert.equal(memory.writes, 0);
  for (let i = 0; i < 128; i++) memory.observe(syntheticEvent(i, i % 3 === 0 ? 'door' : i % 3 === 1 ? 'jump' : 'none'));
  assert.equal(memory.writes, 128); assert(memory.ready);
  const snapshot = memory.snapshot(); assert.equal(canonical(PhysicalMemory.restore(snapshot).snapshot()), canonical(snapshot));
  const observation = syntheticEvent(128).frames[0]!;
  const before = sha(memory.snapshot());
  const recalled = memory.recall({ property: 'open', value: true }, observation) as { total: number };
  assert(recalled.total > 0);
  const prediction = memory.predict({ kind: 'interact', parameters: {}, targetRole: null }, observation);
  assert.equal(sha(memory.snapshot()), before);
  if (prediction.support === 0) assert.equal(prediction.samples.length, 0);
  for (const layer of ['R1', 'R2'] as const) {
    const erased = PhysicalMemory.restore(snapshot); erased.ablateForTest(layer);
    assert.equal((erased.recall({ property: 'open' }, observation) as { total: number }).total, 0);
  }
  const erased = PhysicalMemory.restore(snapshot); erased.ablateForTest('R2A');
  assert.equal(erased.predict({ kind: 'interact', parameters: {}, targetRole: null }, observation).support, 0);
});
