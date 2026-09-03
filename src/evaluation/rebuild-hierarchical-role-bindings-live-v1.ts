import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { BodyResult, Observation, RealEvent } from '../contracts.js';
import { Compute } from '../compute.js';
import { cueIdentity, realEventHierarchyContinuityV1, validateEvent } from '../events.js';
import { HIERARCHICAL_MEMORY_VERSION_V1, type HierarchicalMemoryObservationReceiptV1,
  type HierarchicalMemorySnapshotV1, type R1ExperienceAtomV2 } from '../hierarchical-memory.js';
import { assert, canonical, sha } from '../util.js';

export interface LegacyR1ExperienceAtomV4LiveV1 extends Omit<R1ExperienceAtomV2,
  'version' | 'publicRoleBindings'> {
  readonly version: 'R1ExperienceAtomV4';
}

export interface LegacyHierarchicalMemoryV9LiveV1 extends Omit<HierarchicalMemorySnapshotV1,
  'version' | 'annotations'> {
  readonly version: 'KairosV5HierarchicalMemoryV9';
  readonly annotations: readonly LegacyR1ExperienceAtomV4LiveV1[];
}

interface PublicRecordLiveV1 { readonly kind: string; readonly value: unknown }

function annotationWithoutRoleBindingForAuditLiveV1(value: LegacyR1ExperienceAtomV4LiveV1 | R1ExperienceAtomV2):
Record<string, unknown> {
  const copy = structuredClone(value) as unknown as Record<string, unknown>;
  delete copy.version; delete copy.publicRoleBindings;
  // Changes inside one observation frame are simultaneous public facts. Their
  // array order is a JSON/object-enumeration detail and carries no event time.
  for (const field of ['kernelChanges', 'measurementChanges'] as const) {
    const rows = copy[field] as unknown[][];
    copy[field] = rows.map(row => [...row].sort((left, right) =>
      canonical(left).localeCompare(canonical(right), 'en')));
  }
  return copy;
}

export interface HierarchicalRoleBindingRebuildAuditLiveV1 {
  readonly version: 'HierarchicalRoleBindingRebuildAuditLiveV1';
  readonly sourceVersion: 'KairosV5HierarchicalMemoryV9';
  readonly rebuiltVersion: typeof HIERARCHICAL_MEMORY_VERSION_V1;
  readonly sourceEventCount: number;
  readonly reconstructedFrameCount: number;
  readonly reconstructedBodyResultCount: number;
  readonly interventionLedgerRecordCount: number;
  readonly roleBindingCount: number;
  readonly annotationsWithPublicObjectEffects: number;
  readonly publicObjectEffectAnnotationsWithoutBindings: number;
  readonly physicalSectionHashesBefore: Readonly<Record<string, string>>;
  readonly physicalSectionHashesAfter: Readonly<Record<string, string>>;
  readonly physicalSectionsUnchanged: boolean;
  readonly rebuiltSnapshotSha256: string;
}

const physicalSectionHashes = (snapshot: LegacyHierarchicalMemoryV9LiveV1 | HierarchicalMemorySnapshotV1) => ({
  clocks: sha({ activeSeconds: snapshot.activeSeconds, writes: snapshot.writes }),
  representation: sha({ eventMap: snapshot.eventMap, contextKeys: snapshot.contextKeys,
    contextVocabulary: snapshot.contextVocabulary, r2AtomAdapter: snapshot.r2AtomAdapter,
    tokenEncoder: snapshot.tokenEncoder }),
  r1: sha(snapshot.r1Store),
  r2: sha(snapshot.r2Store),
  r2a: sha(snapshot.r2a),
  replayLedger: sha(snapshot.hierarchyReplayLedger),
  interventionLedger: sha(snapshot.hierarchyInterventionLedger),
  pendingAndSeen: sha({ pendingInitialization: snapshot.pendingInitialization,
    seenEventIds: snapshot.seenEventIds }),
  annotationsWithoutRoleBindings: sha(snapshot.annotations.map(annotationWithoutRoleBindingForAuditLiveV1)),
});

function publicDifferencePathsLiveV1(before: unknown, after: unknown, path = '$', limit = 32): string[] {
  if (Object.is(before, after)) return [];
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object')
    return [`${path}:${canonical(before)}=>${canonical(after)}`];
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const result: string[] = [];
  for (const key of keys) {
    result.push(...publicDifferencePathsLiveV1(left[key], right[key], `${path}/${key}`, limit - result.length));
    if (result.length >= limit) break;
  }
  return result;
}

async function readTrustedFramesLiveV1(path: string,
  neededSequences: ReadonlySet<number>): Promise<Map<number, Observation>> {
  const frames = new Map<number, Observation>();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = JSON.parse(line) as PublicRecordLiveV1;
    if (record.kind !== 'frame') continue;
    const value = record.value as Observation;
    if (!neededSequences.has(value.sequence)) continue;
    assert(!frames.has(value.sequence), `role-binding-source-frame-duplicated:${value.sequence}`);
    frames.set(value.sequence, value);
  }
  assert(frames.size === neededSequences.size,
    `role-binding-source-frames-missing:${neededSequences.size - frames.size}`);
  return frames;
}

async function readTrustedBodyResultsLiveV1(path: string): Promise<Map<string, BodyResult>> {
  const bodyResults = new Map<string, BodyResult>();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const record = JSON.parse(line) as PublicRecordLiveV1;
    if (record.kind !== 'body-result') continue;
    const value = record.value as BodyResult;
    const key = `${value.startSequence}:${value.endSequence}`;
    assert(!bodyResults.has(key), `role-binding-source-body-result-duplicated:${key}`);
    bodyResults.set(key, value);
  }
  return bodyResults;
}

function interventionTriggerIndexLiveV1(snapshot: LegacyHierarchicalMemoryV9LiveV1,
  atomIndex: ReadonlyMap<string, number>, afterProcessedR2EventCount: number): number {
  assert(Number.isSafeInteger(afterProcessedR2EventCount) && afterProcessedR2EventCount > 0
    && afterProcessedR2EventCount <= snapshot.r2Store.events.length,
  'role-binding-intervention-evidence-count-out-of-range');
  const event = snapshot.r2Store.events[afterProcessedR2EventCount - 1]!;
  const indices = event.atomIds.map(atomId => atomIndex.get(atomId));
  assert(indices.every((value): value is number => value !== undefined),
    'role-binding-intervention-R2-atom-not-found');
  return Math.max(...indices);
}

/**
 * Rebuild V10 role metadata only from the complete trusted event record that
 * originally produced a V9 snapshot.  No role is inferred from a type,
 * coordinate, array ordinal, goal, or learned result.  The physical sections
 * must reproduce byte-for-byte under canonical serialization.
 */
export async function rebuildHierarchicalRoleBindingsFromTrustedEvidenceLiveV1(
  compute: Compute, sourceDirectory: string, legacy: LegacyHierarchicalMemoryV9LiveV1,
): Promise<{ readonly snapshot: HierarchicalMemorySnapshotV1;
  readonly audit: HierarchicalRoleBindingRebuildAuditLiveV1 }> {
  assert(legacy.version === 'KairosV5HierarchicalMemoryV9',
    'role-binding-rebuild-source-is-not-V9');
  assert(legacy.pendingInitialization.length === 0 && legacy.annotations.length === legacy.writes,
    'role-binding-rebuild-source-is-not-complete');
  const sequences = new Set<number>();
  for (const annotation of legacy.annotations)
    for (let sequence = annotation.startObservationSequence;
      sequence <= annotation.endObservationSequence; sequence++) sequences.add(sequence);
  const [frames, bodyResults] = await Promise.all([
    readTrustedFramesLiveV1(resolve(sourceDirectory, 'frames.jsonl'), sequences),
    readTrustedBodyResultsLiveV1(resolve(sourceDirectory, 'events.jsonl')),
  ]);
  const replayByAtom = new Map(legacy.hierarchyReplayLedger.map(value => [value.atom.atomId, value]));
  const atomIndex = new Map(legacy.annotations.map((value, index) => [value.atomId, index]));
  const ledgerAtIndex = new Map<number, typeof legacy.hierarchyInterventionLedger[number][]>();
  for (const record of legacy.hierarchyInterventionLedger) {
    const index = interventionTriggerIndexLiveV1(legacy, atomIndex, record.afterProcessedR2EventCount);
    const values = ledgerAtIndex.get(index) ?? []; values.push(record); ledgerAtIndex.set(index, values);
  }
  for (let index = 0; index < legacy.annotations.length; index++) {
    const annotation = legacy.annotations[index]!;
    const eventFrames = Array.from({ length: annotation.endObservationSequence
      - annotation.startObservationSequence + 1 }, (_unused, offset) => {
      const sequence = annotation.startObservationSequence + offset;
      const frame = frames.get(sequence);
      assert(frame, `role-binding-event-frame-missing:${annotation.eventId}:${sequence}`);
      return frame;
    });
    const bodyResult = annotation.kind === 'action'
      ? bodyResults.get(`${annotation.startObservationSequence}:${annotation.endObservationSequence}`) ?? null
      : null;
    assert(annotation.kind !== 'action' || bodyResult !== null,
      `role-binding-body-result-missing:${annotation.eventId}`);
    const raw: RealEvent = { version: 'RealEventV5', id: annotation.eventId,
      cue: structuredClone(annotation.cue), frames: structuredClone(eventFrames),
      trackedIds: [...annotation.observationScopeIds], bodyResult: structuredClone(bodyResult),
      provenance: annotation.kind === 'action' ? 'executed-real-body' : 'observed-passive',
      complete: true };
    const replay = replayByAtom.get(annotation.atomId);
    assert(replay, `role-binding-replay-record-missing:${annotation.atomId}`);
    const event: RealEvent = { ...raw, hierarchyContinuity: realEventHierarchyContinuityV1(raw,
      replay.atom.sessionId, replay.boundaryBefore) };
    validateEvent(event);
    assert(cueIdentity(event.cue) === replay.atom.exactExperienceIdentity
      && event.hierarchyContinuity?.continuityEpochId === replay.atom.continuityEpochId
      && event.frames[0]!.activeSeconds === replay.atom.startedAt
      && event.frames.at(-1)!.activeSeconds === replay.atom.endedAt
      && event.frames[0]!.sequence === replay.atom.startFrameSequence
      && event.frames.at(-1)!.sequence === replay.atom.endFrameSequence,
    `role-binding-reconstructed-event-identity-mismatch:${annotation.eventId}`);
    const receipt = await compute.call<HierarchicalMemoryObservationReceiptV1>('observe', event);
    assert(receipt.representationRejection === null,
      `role-binding-rebuild-event-unrepresented:${annotation.eventId}:${canonical(receipt.representationRejection)}`);
    for (const record of ledgerAtIndex.get(index) ?? []) {
      if (record.kind === 'protocol') {
        const registered = await compute.call('registerMatchedInterventionProtocol', record.input);
        assert(canonical(registered) === canonical(record.registered),
          'role-binding-rebuilt-intervention-protocol-mismatch');
      } else await compute.call('recordMatchedIntervention', record.evidence);
    }
  }
  const snapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
  assert(snapshot.version === HIERARCHICAL_MEMORY_VERSION_V1,
    'role-binding-rebuild-produced-wrong-version');
  const before = physicalSectionHashes(legacy), after = physicalSectionHashes(snapshot);
  const physicalSectionsUnchanged = canonical(before) === canonical(after);
  const annotationDifferences = publicDifferencePathsLiveV1(
    legacy.annotations.map(annotationWithoutRoleBindingForAuditLiveV1),
    snapshot.annotations.map(annotationWithoutRoleBindingForAuditLiveV1));
  assert(physicalSectionsUnchanged, `role-binding-rebuild-changed-physical-sections:${canonical({ before, after,
    mismatched: Object.keys(before).filter(key => before[key as keyof typeof before]
      !== after[key as keyof typeof after]), annotationDifferences })}`);
  assert(await compute.call<string>('hash') === sha(snapshot),
    'role-binding-rebuild-worker-snapshot-hash-mismatch');
  const annotationsWithPublicObjectEffects = snapshot.annotations.filter(annotation =>
    annotation.kernelChanges.flat().some(change => change.subject.includes('#'))).length;
  const publicObjectEffectAnnotationsWithoutBindings = snapshot.annotations.filter(annotation =>
    annotation.kernelChanges.flat().some(change => change.subject.includes('#'))
      && annotation.publicRoleBindings.length === 0).length;
  assert(publicObjectEffectAnnotationsWithoutBindings === 0,
    'role-binding-rebuild-public-effect-provenance-missing');
  const audit: HierarchicalRoleBindingRebuildAuditLiveV1 = {
    version: 'HierarchicalRoleBindingRebuildAuditLiveV1', sourceVersion: legacy.version,
    rebuiltVersion: HIERARCHICAL_MEMORY_VERSION_V1, sourceEventCount: legacy.annotations.length,
    reconstructedFrameCount: frames.size,
    reconstructedBodyResultCount: legacy.annotations.filter(value => value.kind === 'action').length,
    interventionLedgerRecordCount: legacy.hierarchyInterventionLedger.length,
    roleBindingCount: snapshot.annotations.reduce((sum, value) => sum + value.publicRoleBindings.length, 0),
    annotationsWithPublicObjectEffects, publicObjectEffectAnnotationsWithoutBindings,
    physicalSectionHashesBefore: before, physicalSectionHashesAfter: after,
    physicalSectionsUnchanged, rebuiltSnapshotSha256: sha(snapshot),
  };
  return { snapshot, audit };
}

export async function readLegacyHierarchicalMemoryV9LiveV1(sourceDirectory: string):
Promise<LegacyHierarchicalMemoryV9LiveV1> {
  return JSON.parse(await readFile(resolve(sourceDirectory,
    'FROZEN_HIERARCHICAL_EXPERIENCE.json'), 'utf8')) as LegacyHierarchicalMemoryV9LiveV1;
}
