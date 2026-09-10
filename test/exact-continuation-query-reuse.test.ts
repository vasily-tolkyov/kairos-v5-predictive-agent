import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActionCue, Observation } from '../src/contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1 } from '../src/distributed-hierarchical-memory.js';
import { DistributedR2APhysicalPatternLearnerV2 } from '../src/core/learning/distributed-r2a.js';
import type { DistributedR2APhysicalPatternV2 } from '../src/core/learning/distributed-r2a-physical-contracts.js';

// Only the read-through cache is under test here. No synthetic pattern is
// asserted to be learned; the real frozen-memory equality probe is separate.
const pattern: DistributedR2APhysicalPatternV2 = {
  version: 'DistributedR2APhysicalPatternV2', patternId: 'p',
  memberR2EventIds: [], contextIds: [], physicalTraceIds: [], supportCount: 0,
  contradictionCount: 0, grade: 'single-observation',
  attractor: { version: 'DistributedAttractorReadoutV1', coreSiteIds: [], dwellSteps: 0,
    returnRate: 0, escapeRate: 1, evidenceLevel: 'none', ambiguous: false,
    run: { version: 'DistributedFieldRunV1', steps: 0, acceptedSteps: 0, rejectedSteps: 0,
      leaderSiteIds: [], finalActivations: [] } },
  corridor: { orderedPrefixPulseSiteIds: [], prefixSiteIds: [], actionPulseSiteIds: [],
    actionSiteIds: [], terminalCoreSiteIds: [], corridorCoreSiteIds: [],
    forwardPropagationRate: 0, reverseRejectionRate: 0 },
};
const observation: Observation = { sequence: 1, activeSeconds: 0, contextId: 'c', targetId: 'o',
  self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: {} },
  objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, 1], properties: { s: false } }] };
const cue: ActionCue = { kind: 'interact', parameters: {}, targetRole: 'opaque#0' };

test('identical continuation queries reuse exactly one result without exposing mutable cache objects', t => {
  const read = t.mock.method(DistributedR2APhysicalPatternLearnerV2.prototype, 'patterns', () => [pattern]);
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const first = memory.predictContinuation('p', cue, observation);
  const original = structuredClone(first);
  (first.unknown as string[]).push('caller-only');
  const second = memory.predictContinuation('p', structuredClone(cue), structuredClone(observation));
  assert.deepEqual(second, original);
  assert.equal(read.mock.callCount(), 1, 'identical query repeated physical evidence traversal');
  assert.notEqual(first, second);
  assert.deepEqual(second.unknown, ['current-real-distributed-R2-prefix-unavailable']);
});

test('reuse retains full pattern, cue, observation and physical-version identity', t => {
  const read = t.mock.method(DistributedR2APhysicalPatternLearnerV2.prototype, 'patterns',
    () => [pattern, { ...pattern, patternId: 'q' }]);
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const queries: readonly [string, ActionCue, Observation][] = [
    ['p', cue, observation],
    ['q', cue, observation],
    ['q', { ...cue, targetRole: 'opaque#1' }, observation],
    ['q', { kind: 'look', parameters: { yaw: .1, pitch: 0 }, targetRole: null }, observation],
    ['q', cue, { ...observation, sequence: 2 }],
    ['q', cue, { ...observation, contextId: 'other' }],
    ['q', cue, { ...observation, targetId: null }],
    ['q', cue, { ...observation, objects: [{ ...observation.objects[0]!, properties: { s: true } }] }],
  ];
  for (const [id, action, frame] of queries) memory.predictContinuation(id, action, frame);
  assert.equal(read.mock.callCount(), queries.length);
  const [id, action, frame] = queries.at(-1)!;
  memory.predictContinuation(id, action, frame);
  assert.equal(read.mock.callCount(), queries.length);
  const before = memory.physicalVersion();
  memory.advanceTo(.05);
  assert.notEqual(memory.physicalVersion(), before);
  memory.predictContinuation(id, action, frame);
  assert.equal(read.mock.callCount(), queries.length + 1, 'recovery reused an old physical result');
});

test('a failed continuation query is never stored as a substitute result', t => {
  const read = t.mock.method(DistributedR2APhysicalPatternLearnerV2.prototype, 'patterns', () => []);
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  for (let i = 0; i < 2; i++) assert.throws(() => memory.predictContinuation('missing', cue, observation),
    /unknown-distributed-continuous-pattern/);
  assert.equal(read.mock.callCount(), 2);
});
