import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HierarchicalPhysicalMemoryV1 } from '../dist/src/hierarchical-memory.js';
import { actionObservationTrackedIdsV1, cueFor, cueIdentity,
  realEventHierarchyContinuityV1 } from '../dist/src/events.js';

const evidence = resolve(process.argv[2] ??
  'evidence/hierarchical-minecraft-short-chain-live-v1-r2-metric-alignment-001');
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
  const boundaryBefore = index < 20 || (index - 20) % 3 === 0 ? 'reset' : 'continuous';
  const plain = { version: 'RealEventV5', id: `sealed-live-${String(index + 1).padStart(3, '0')}`,
    cue: cueFor(receipt.action, first), frames: window,
    trackedIds: actionObservationTrackedIdsV1(receipt.action.targetId, scope, [], window),
    bodyResult: receipt, provenance: 'executed-real-body', complete: true };
  return { ...plain, hierarchyContinuity: realEventHierarchyContinuityV1(plain,
    'sealed-live-r2a-diagnostic', boundaryBefore) };
});

const memory = new HierarchicalPhysicalMemoryV1();
for (const event of events) memory.observe(event);
const snapshot = memory.snapshot();
const armByR2Event = new Map();
for (let episode = 0; episode < 36; episode++) {
  const atomOffset = 20 + episode * 3;
  const sourceIds = events.slice(atomOffset, atomOffset + 3).map(x => x.id);
  const r2 = snapshot.r2Store.events.find(value => value.sourceEventIds.length === 3
    && value.sourceEventIds.every((id, i) => id === sourceIds[i]));
  if (!r2) throw new Error(`missing-r2:${episode}`);
  armByR2Event.set(r2.eventId, `P${episode % 3}`);
}

const patterns = (snapshot.r2a?.patterns ?? []).map(pattern => {
  const armCounts = {};
  for (const id of pattern.memberEventIds) {
    const arm = armByR2Event.get(id) ?? 'other'; armCounts[arm] = (armCounts[arm] ?? 0) + 1;
  }
  return { patternId: pattern.patternId, grade: pattern.grade, supportCount: pattern.supportCount,
    contextCount: pattern.contextIds.length, orderedCorridorConsistency: pattern.orderedCorridorConsistency,
    memberCount: pattern.memberEventIds.length, armCounts,
    orderedExperienceIdentities: pattern.orderedExperienceIdentities };
});
console.log(JSON.stringify({ writes: snapshot.writes, annotations: snapshot.annotations.length,
  r2Events: snapshot.r2Store.events.length, learningEligibleR2Events: snapshot.r2Store.events
    .filter(x => x.learningEligible).length, patterns,
  relations: (snapshot.r2a?.relations ?? []).map(x => ({ relationId: x.relationId,
    grade: x.grade, targetPatternId: x.targetPatternId, contrastPatternIds: x.contrastPatternIds,
    branchAtomIndex: x.branchAtomIndex, factorCount: x.factorIds.length,
    supportCount: x.supportEventIds.length, contradictionCount: x.contradictionEventIds.length })) }, null, 2));
