import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import type { ActionCue, Observation, RealEvent } from '../src/contracts.js';
import { DistributedR1ExperienceStoreV1 } from '../src/core/learning/distributed-r1.js';
import { DistributedPhysicalMedium3DV1, distributedMediumConfig }
  from '../src/core/physics/distributed-physical-medium.js';
import { DistributedPredictionCloneV2 }
  from '../src/core/prediction/distributed-prediction-clone.js';
import { eventRows } from '../src/events.js';
import { sha } from '../src/util.js';

type Arm = 'A' | 'B';

const cue = (arm: Arm): ActionCue => ({ kind: 'select-hotbar',
  parameters: { slot: arm === 'A' ? 0 : 1 }, targetRole: null });

function frame(sequence: number, activeSeconds: number, selectedSlot: number,
  contextId: string): Observation {
  return { sequence, activeSeconds, contextId, targetId: null, objects: [],
    self: { position: [0, 0, 0], yaw: 0, pitch: 0,
      properties: { selectedSlot, stable: true } } };
}

function realEvent(arm: Arm, repetition: number): RealEvent {
  const before = frame(repetition * 10 + 1, repetition, 2,
    `native-rollout-context-${repetition % 4}`);
  const after = frame(repetition * 10 + 2, repetition + .05,
    arm === 'A' ? 0 : 1, before.contextId);
  return { version: 'RealEventV5', id: `native-rollout-${arm}-${repetition}`,
    cue: cue(arm), frames: [before, after], trackedIds: ['self'],
    bodyResult: { action: { kind: 'select-hotbar', parameters: cue(arm).parameters },
      executed: true, status: 'completed', startSequence: before.sequence,
      endSequence: after.sequence, terminationReason: 'stable' },
    provenance: 'executed-real-body', complete: true };
}

type CloneResult = ReturnType<DistributedPredictionCloneV2['run']>;

function publicTerminalReadout(store: DistributedR1ExperienceStoreV1, result: CloneResult) {
  const core = new Set(result.attractorReadout.coreSiteIds);
  return store.readPublicState(result.fieldRun.finalActivations
    .filter(value => core.has(value.siteId) && value.activation > 0)
    .map(value => ({ siteId: value.siteId, intensity: value.activation })));
}

function decodedSelectedSlot(store: DistributedR1ExperienceStoreV1, result: CloneResult): number | null {
  const readout = publicTerminalReadout(store, result);
  const channel = readout.channels.find(value => value.property === 'selectedSlot');
  return channel?.status === 'decoded' && typeof channel.value === 'number' ? channel.value : null;
}

test('G5 production predictCandidate has no historical event-result template readout', async () => {
  const source = await readFile(resolve('src/distributed-hierarchical-memory.ts'), 'utf8');
  const start = source.indexOf('\n  predictCandidate(');
  const end = source.indexOf('\n  #emptyBranch(', start);
  assert(start >= 0 && end > start, 'predictCandidate production block is not auditable');
  const block = source.slice(start, end);

  assert.doesNotMatch(block, /changeWaves|byAssembly|#annotations\.(?:get|values)/,
    'predictCandidate still converts a reached field basin into a historical event result template');
  assert.match(block, /#stableR1AssembliesForCue\s*\(\s*candidate\.actionCue\s*\)/,
    'readout assemblies are not selected from stable physical attractors for the exact cue');
  assert.match(block, /#r1\.readPublicState\s*\(/,
    'the terminal distributed activation is not decoded through the learned afferent field');
  assert.match(block, /currentPerceptionSeedDrives:\s*currentPerception\.drives/,
    'predictCandidate rebuilds current perception at unit intensity instead of forwarding its physical drives');
  assert.match(block, /actionSeedDrives:\s*actionInput\.drives/,
    'predictCandidate rebuilds action population at unit intensity instead of forwarding its physical drives');
});

test('G5 exact action A/B drives separate physical terminal populations in 24x180 read-only rollouts', () => {
  const medium = new DistributedPhysicalMedium3DV1(
    distributedMediumConfig('R1-native-action-readout', 'a0b0c0d0'));
  const store = new DistributedR1ExperienceStoreV1(medium, 0xa0b0c0d0n);
  const records = new Map<string, ReturnType<DistributedR1ExperienceStoreV1['record']>>();
  for (let repetition = 0; repetition < 8; repetition += 1) {
    for (const arm of ['A', 'B'] as const) {
      const event = realEvent(arm, repetition);
      store.observe(event);
      records.set(`${arm}-${repetition}`, store.record(event.id));
    }
  }

  const firstA = records.get('A-0');
  const firstB = records.get('B-0');
  assert(firstA && firstB, 'real R1 records were not deposited');
  const qualifiedA = store.attractorQualification(firstA.eventId);
  const qualifiedB = store.attractorQualification(firstB.eventId);
  assert.equal(qualifiedA.status, 'stable-attractor', JSON.stringify(qualifiedA));
  assert.equal(qualifiedB.status, 'stable-attractor', JSON.stringify(qualifiedB));
  assert.notDeepEqual(qualifiedA.coreSiteIds, qualifiedB.coreSiteIds,
    'opposite exact actions collapsed into one physical terminal attractor');

  const current = realEvent('A', 100).frames[0]!;
  const roleBindings = eventRows(realEvent('A', 0)).roleBindings;
  const perception = store.lookupCurrentObservation(current, roleBindings);
  // Afferent lookup is intentionally sparse: unlearned incidental frame
  // components remain unresolved, while the already learned public state
  // population is still a legitimate physical prefix.
  assert(perception.siteIds.length > 0);
  assert.deepEqual(perception.unresolvedRoles, []);
  const snapshot = medium.snapshot(), before = sha(snapshot);
  const clone = new DistributedPredictionCloneV2(snapshot);
  const assemblies = [
    { assemblyId: 'outcome-A', siteIds: qualifiedA.coreSiteIds, minimumCoverage: .75,
      minimumPurity: .75 },
    { assemblyId: 'outcome-B', siteIds: qualifiedB.coreSiteIds, minimumCoverage: .75,
      minimumPurity: .75 },
  ];

  const run = (arm: Arm) => clone.runMany({
    currentPerceptionSeedSiteIds: perception.siteIds,
    currentPerceptionMode: 'sequential-prefix',
    realPrefixSeedSiteIds: [perception.siteIds],
    actionSeedSiteIds: store.lookupActionCue(cue(arm)).siteIds,
    readoutAssemblies: assemblies, steps: 180,
    seeds: Array.from({ length: 24 }, (_unused, index) => BigInt(index + 1)),
  });
  const a = run('A'), b = run('B');
  assert.equal(a.length, 24); assert.equal(b.length, 24);
  assert(a.every(value => value.fieldRun.steps === 180));
  assert(b.every(value => value.fieldRun.steps === 180));

  const reachedA = a.filter(value => value.status === 'reached');
  const reachedB = b.filter(value => value.status === 'reached');
  const aCorrect = reachedA.filter(value => value.reachedAssemblyIds[0] === 'outcome-A').length;
  const bCorrect = reachedB.filter(value => value.reachedAssemblyIds[0] === 'outcome-B').length;
  const decodedA = reachedA.map(value => decodedSelectedSlot(store, value));
  const decodedB = reachedB.map(value => decodedSelectedSlot(store, value));
  const decodedACorrect = decodedA.filter(value => value === 0).length;
  const decodedBCorrect = decodedB.filter(value => value === 1).length;
  const audit = { reachedA: reachedA.length, reachedB: reachedB.length,
    aCorrect, bCorrect, decodedACorrect, decodedBCorrect,
    aReachedIds: reachedA.map(value => value.reachedAssemblyIds[0]),
    bReachedIds: reachedB.map(value => value.reachedAssemblyIds[0]),
    decodedA, decodedB,
    firstAReadout: reachedA[0] ? publicTerminalReadout(store, reachedA[0]) : null,
    firstBReadout: reachedB[0] ? publicTerminalReadout(store, reachedB[0]) : null };
  assert.equal(reachedA.length >= 8 && reachedB.length >= 8
    && aCorrect / reachedA.length >= .75 && bCorrect / reachedB.length >= .75
    && decodedACorrect / reachedA.length >= .75 && decodedBCorrect / reachedB.length >= .75,
  true, `exact action/terminal/readout physical separation failed:${JSON.stringify(audit)}`);
  assert.equal(sha(medium.snapshot()), before,
    '24x180 prediction or native afferent readout wrote into the production medium');
});
