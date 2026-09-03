import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  hierarchicalMultilevelRepresentationProfileLiveV1,
  materializeTrainingEpisodeLiveV1,
  minecraftHierarchicalMultilevelPlanLiveV1,
} from '../dist/src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.js';
import {
  minecraftMultilevelGuidedActionScopeLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedVocabularyPanelLiveV1,
} from '../dist/src/evaluation/minecraft-multilevel-guided-training-live-v1.js';
import { HierarchicalPhysicalMemoryV1 } from '../dist/src/hierarchical-memory.js';
import {
  actionObservationTrackedIdsV1,
  cueFor,
  publicTransitionTopologyV1,
  realEventHierarchyContinuityV1,
} from '../dist/src/events.js';
import { canonical } from '../dist/src/util.js';

const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error('usage: diagnose-hierarchical-r2a-patterns.mjs <attempt-directory>');
const outputName = process.argv[3] ?? 'R2A_PATTERN_FRAGMENTATION_DIAGNOSTIC.json';

const jsonLines = async path => (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
  .map(line => JSON.parse(line));
const frames = new Map((await jsonLines(resolve(sourceDirectory, 'frames.jsonl')))
  .filter(record => record.kind === 'frame').map(record => [record.value.sequence, record.value]));
const results = (await jsonLines(resolve(sourceDirectory, 'events.jsonl')))
  .filter(record => record.kind === 'body-result').map(record => record.value);
const plan = minecraftHierarchicalMultilevelPlanLiveV1();
if (results.length !== plan.foundation.length * 2)
  throw new Error(`unexpected-foundation-body-result-count:${results.length}`);

const memory = new HierarchicalPhysicalMemoryV1();
const sourceByEvent = new Map();
const topologyById = new Map();
const eventIdsByArm = new Map(plan.arms.map(arm => [arm, []]));
let resultIndex = 0;
for (const specification of plan.foundation) {
  const episode = materializeTrainingEpisodeLiveV1(specification);
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(specification.layout);
  const proxy = minecraftMultilevelGuidedVocabularyPanelLiveV1(specification.layout).proxyButton;
  const prepared = {
    buttonId: specification.arm.startsWith('look-') || specification.arm.startsWith('interact-')
      ? geometry.buttonId : null,
    doorId: specification.arm.startsWith('interact-') ? geometry.doorId : null,
    referenceId: `block:${proxy.join(',')}`,
  };
  const scope = minecraftMultilevelGuidedActionScopeLiveV1(episode, prepared);
  for (const part of ['action', 'verification']) {
    const bodyResult = results[resultIndex++];
    const eventFrames = [];
    for (let sequence = bodyResult.startSequence; sequence <= bodyResult.endSequence; sequence++) {
      const frame = frames.get(sequence);
      if (!frame) throw new Error(`missing-frame:${sequence}`);
      eventFrames.push(frame);
    }
    const id = `${specification.episodeId}:${part}`;
    const publicEvent = {
      version: 'RealEventV5', id, cue: cueFor(bodyResult.action, eventFrames[0]), frames: eventFrames,
      trackedIds: actionObservationTrackedIdsV1(bodyResult.action.targetId, scope, [], eventFrames),
      bodyResult, provenance: 'executed-real-body', complete: true,
    };
    const topology = publicTransitionTopologyV1(publicEvent);
    topologyById.set(topology.compatibilitySha256, topology);
    const event = { ...publicEvent, hierarchyContinuity: realEventHierarchyContinuityV1(publicEvent,
      'hierarchical-multilevel-training-v1', part === 'action' ? 'reset' : 'continuous') };
    memory.observe(event);
    sourceByEvent.set(id, { arm: specification.arm, episodeId: specification.episodeId, part });
  }
}

const snapshot = memory.snapshot();
const distance = (left, right) => Math.hypot(...left.map((value, axis) => value - right[axis]));
const eventArm = event => sourceByEvent.get(event.sourceEventIds[0])?.arm;
for (const event of snapshot.r2Store.events) eventIdsByArm.get(eventArm(event))?.push(event.eventId);
const evidenceByEvent = new Map(snapshot.r2a.evidence.map(value => [value.eventId, value]));
const patternByEvent = new Map(snapshot.r2a.patterns.flatMap(pattern =>
  pattern.memberEventIds.map(eventId => [eventId, pattern])));

const compatible = (left, right, threshold) => canonical(left.orderedTransitionTopologyIds)
  === canonical(right.orderedTransitionTopologyIds)
  && left.orderedCoordinates.every((point, index) => distance(point, right.orderedCoordinates[index]) <= threshold + 1e-9);
const components = (items, threshold) => {
  const parents = items.map((_item, index) => index);
  const find = value => parents[value] === value ? value : (parents[value] = find(parents[value]));
  for (let left = 0; left < items.length; left++) for (let right = left + 1; right < items.length; right++) {
    if (compatible(items[left], items[right], threshold)) parents[find(right)] = find(left);
  }
  const sizes = new Map();
  for (let index = 0; index < items.length; index++) sizes.set(find(index), (sizes.get(find(index)) ?? 0) + 1);
  return [...sizes.values()].sort((left, right) => right - left);
};

const arms = [];
for (const arm of plan.arms) {
  const eventIds = eventIdsByArm.get(arm) ?? [];
  if (eventIds.length === 0) continue;
  const evidence = eventIds.map(id => evidenceByEvent.get(id));
  const topologyGroups = new Map();
  for (const item of evidence) {
    const key = canonical(item.orderedTransitionTopologyIds);
    const group = topologyGroups.get(key) ?? [];
    group.push(item); topologyGroups.set(key, group);
  }
  const pairRows = [];
  for (let left = 0; left < evidence.length; left++) for (let right = left + 1; right < evidence.length; right++) {
    const atomDistances = evidence[left].orderedCoordinates.map((point, index) =>
      distance(point, evidence[right].orderedCoordinates[index]));
    pairRows.push({ sameTopology: canonical(evidence[left].orderedTransitionTopologyIds)
      === canonical(evidence[right].orderedTransitionTopologyIds), atomDistances,
    maximumAtomDistance: Math.max(...atomDistances) });
  }
  const transitions = [...topologyGroups.entries()].map(([key, group]) => ({
    count: group.length,
    eventIds: group.map(item => item.eventId),
    sourceEventIds: group.map(item => snapshot.r2Store.events.find(event => event.eventId === item.eventId)?.sourceEventIds),
    orderedTopologyIds: JSON.parse(key),
    topologies: JSON.parse(key).map(id => topologyById.get(id)),
    strictComponents: components(group, .064),
    coarseComponents: components(group, .48),
  })).sort((left, right) => right.count - left.count);
  const patternGroups = new Map();
  for (const eventId of eventIds) {
    const pattern = patternByEvent.get(eventId);
    const id = pattern?.patternId ?? 'missing';
    const row = patternGroups.get(id) ?? { patternId: id, grade: pattern?.grade ?? 'missing', count: 0 };
    row.count++; patternGroups.set(id, row);
  }
  arms.push({ arm, eventCount: eventIds.length,
    topologyGroupSizes: transitions.map(value => value.count), transitions,
    sameTopologyPairMaximumDistance: pairRows.filter(value => value.sameTopology)
      .reduce((maximum, value) => Math.max(maximum, value.maximumAtomDistance), 0),
    crossTopologyPairMinimumDistance: pairRows.filter(value => !value.sameTopology)
      .reduce((minimum, value) => Math.min(minimum, value.maximumAtomDistance), Number.POSITIVE_INFINITY),
    strictComponents: components(evidence, .064), coarseComponents: components(evidence, .48),
    patterns: [...patternGroups.values()].sort((left, right) => right.count - left.count),
  });
}

const result = {
  version: 'HierarchicalR2APatternFragmentationDiagnosticV1',
  sourceDirectory, frameCount: frames.size, bodyResultCount: results.length,
  r1Atoms: snapshot.annotations.length, r2Events: snapshot.r2Store.events.length,
  r2aPatterns: snapshot.r2a.patterns.length,
  thresholds: { strictAtomEquivalence: .064, coarsePhysicalCorridor: .48 },
  arms,
};
await writeFile(resolve(sourceDirectory, outputName),
  JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
