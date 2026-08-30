import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, BodyResult, Observation, PublicChange, RealEvent } from '../contracts.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { ExperienceMediaStore } from '../core/learning/experience-store.js';
import { cueFor, eventRows, validateEvent } from '../events.js';
import { PhysicalMemory, type MemorySnapshot } from '../memory.js';
import { saveExperienceBundleV1 } from '../runtime.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';

export const ATTEMPT017_RAW_INPUTS_V1 = Object.freeze({
  frames: Object.freeze({ filename: 'frames.jsonl',
    sha256: 'b94396d0b8d0339cb36c809056b19e823bedc90c71512346a081e51b51e9039d' }),
  events: Object.freeze({ filename: 'events.jsonl',
    sha256: 'f54a5da5e0a0766cdac82615f1eeb7e2b84e62884c1ad7a9da02e8ccb42c5178' }),
  timeline: Object.freeze({ filename: 'GUIDED_TRAINING_TIMELINE.json',
    sha256: '10713f67ca6419c4141963d9ed0f5c68ad719eb0d8da7d8ce878a3b2f0c3d2f4' }),
});

interface TimelineRowV1 {
  readonly action: Action;
  readonly changes: readonly PublicChange[];
  readonly contextId: string;
  readonly eventId: string;
  readonly observationWindow: readonly [number, number];
}

interface JsonLineRecord { readonly kind: string; readonly value: unknown; }

export interface Attempt017RawAuditV1 {
  readonly version: 'Attempt017RawAuditV1';
  readonly inputs: Readonly<Record<string, { readonly filename: string; readonly sha256: string; readonly bytes: number }>>;
  readonly frameCount: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly bodyResultCount: number;
  readonly timelineEventCount: number;
  readonly exactReceiptMatches: number;
  readonly exactChangeMatches: number;
  readonly firstActiveSeconds: number;
  readonly lastActiveSeconds: number;
}

async function readJsonLines(path: string): Promise<readonly JsonLineRecord[]> {
  const source = await readFile(path, 'utf8');
  return source.split(/\r?\n/).filter(line => line.length > 0).map(line => JSON.parse(line) as JsonLineRecord);
}

export async function reconstructAttempt017RealEventsV1(sourceDirectory: string): Promise<{
  readonly events: readonly RealEvent[];
  readonly observations: ReadonlyMap<number, Observation>;
  readonly audit: Attempt017RawAuditV1;
}> {
  const inputEntries = Object.entries(ATTEMPT017_RAW_INPUTS_V1);
  const inputAudit: Record<string, { filename: string; sha256: string; bytes: number }> = {};
  for (const [name, identity] of inputEntries) {
    const path = resolve(sourceDirectory, identity.filename);
    const [actualSha, metadata] = await Promise.all([fileSha(path), stat(path)]);
    assert(actualSha === identity.sha256, `attempt017-input-identity-mismatch:${name}:${actualSha}`);
    inputAudit[name] = { ...identity, bytes: metadata.size };
  }

  const frameRecords = await readJsonLines(resolve(sourceDirectory, ATTEMPT017_RAW_INPUTS_V1.frames.filename));
  const observations = new Map<number, Observation>();
  for (const record of frameRecords) {
    if (record.kind !== 'frame') continue;
    const observation = record.value as Observation;
    assert(!observations.has(observation.sequence), `attempt017-duplicate-frame:${observation.sequence}`);
    observations.set(observation.sequence, observation);
  }
  const orderedSequences = [...observations.keys()].sort((left, right) => left - right);
  assert(orderedSequences.length > 0, 'attempt017-no-public-frames');
  for (let index = 1; index < orderedSequences.length; index += 1) {
    assert(orderedSequences[index] === orderedSequences[index - 1]! + 1,
      `attempt017-frame-gap:${orderedSequences[index - 1]}:${orderedSequences[index]}`);
  }

  const eventRecords = await readJsonLines(resolve(sourceDirectory, ATTEMPT017_RAW_INPUTS_V1.events.filename));
  const bodyResults = eventRecords.filter(record => record.kind === 'body-result').map(record => record.value as BodyResult);
  const timeline = JSON.parse(await readFile(
    resolve(sourceDirectory, ATTEMPT017_RAW_INPUTS_V1.timeline.filename), 'utf8')) as readonly TimelineRowV1[];
  assert(timeline.length === 128, `attempt017-timeline-event-count:${timeline.length}`);
  assert(new Set(timeline.map(row => row.eventId)).size === timeline.length, 'attempt017-duplicate-event-id');

  let exactReceiptMatches = 0;
  let exactChangeMatches = 0;
  const rebuilt = timeline.map((row): RealEvent => {
    const [firstSequence, lastSequence] = row.observationWindow;
    assert(Number.isInteger(firstSequence) && Number.isInteger(lastSequence) && lastSequence > firstSequence,
      `attempt017-invalid-observation-window:${row.eventId}`);
    const frames: Observation[] = [];
    for (let sequence = firstSequence; sequence <= lastSequence; sequence += 1) {
      const frame = observations.get(sequence);
      assert(frame, `attempt017-missing-event-frame:${row.eventId}:${sequence}`);
      frames.push(frame);
    }
    assert(frames[0]!.contextId === row.contextId, `attempt017-context-mismatch:${row.eventId}`);
    const matches = bodyResults.filter(result => result.startSequence === firstSequence
      && result.endSequence === lastSequence && canonical(result.action) === canonical(row.action));
    assert(matches.length === 1, `attempt017-body-result-match-count:${row.eventId}:${matches.length}`);
    exactReceiptMatches += 1;
    const action = structuredClone(row.action);
    const event: RealEvent = { version: 'RealEventV5', id: row.eventId, cue: cueFor(action, frames[0]!), frames,
      trackedIds: ['self', ...(action.targetId ? [action.targetId] : [])], bodyResult: structuredClone(matches[0]!),
      provenance: 'executed-real-body', complete: true };
    validateEvent(event);
    assert(canonical(eventRows(event).changes.flat()) === canonical(row.changes),
      `attempt017-public-change-mismatch:${row.eventId}`);
    exactChangeMatches += 1;
    return event;
  });
  for (let index = 1; index < rebuilt.length; index += 1) {
    assert(rebuilt[index]!.frames[0]!.activeSeconds > rebuilt[index - 1]!.frames.at(-1)!.activeSeconds,
      `attempt017-event-time-order:${rebuilt[index]!.id}`);
  }
  const audit: Attempt017RawAuditV1 = { version: 'Attempt017RawAuditV1', inputs: inputAudit,
    frameCount: observations.size, firstSequence: orderedSequences[0]!, lastSequence: orderedSequences.at(-1)!,
    bodyResultCount: bodyResults.length, timelineEventCount: rebuilt.length, exactReceiptMatches, exactChangeMatches,
    firstActiveSeconds: rebuilt[0]!.frames[0]!.activeSeconds,
    lastActiveSeconds: rebuilt.at(-1)!.frames.at(-1)!.activeSeconds };
  return { events: rebuilt, observations, audit };
}

export interface RebuiltPhysicalMemoryAuditV1 {
  readonly version: 'RebuiltPhysicalMemoryAuditV1';
  readonly snapshotVersion: MemorySnapshot['version'];
  readonly writes: number;
  readonly seenEvents: number;
  readonly pendingEvents: number;
  readonly activeSeconds: number;
  readonly snapshotSha256: string;
  readonly eventMapSha256: string;
  readonly projectorVersion: string;
  readonly resolutionVersion: string;
  readonly resolutionScale: number;
  readonly diagnosticComponentSizes: readonly number[];
  readonly physicalR2BasinSizes: readonly number[];
  readonly physicalR2BasinCount: number;
  readonly r2aVersion: string;
  readonly outcomeIdentityVersion: string;
  readonly r2aEventSummaries: number;
  readonly factorNodes: number;
  readonly stableFactorNodes: number;
  readonly hyperedges: number;
  readonly stableHyperedges: number;
  readonly resolvableEventSummaryVisits: number;
  readonly resolvableHyperedgeVisits: number;
  readonly restoreCanonicalEqual: boolean;
}

export function auditRebuiltPhysicalMemoryV1(memory: PhysicalMemory): RebuiltPhysicalMemoryAuditV1 {
  assert(memory.ready && memory.writes === 128 && memory.bufferedEvents === 0,
    'attempt017-rebuild-not-complete');
  const snapshot = memory.snapshot();
  assert(snapshot.version === 'KairosV5MemoryV4' && snapshot.eventMap && snapshot.projector && snapshot.r2a,
    'attempt017-rebuild-current-representation-missing');
  assert(snapshot.projector.version === 'PathProjectorStateV4'
    && snapshot.projector.resolution.version === 'R2MeasurementResolutionCalibrationV4'
    && snapshot.projector.resolution.equivalentGeometryMethod === 'vertex-preserving-polyline-densification'
    && snapshot.projector.resolution.boundaryGeometry === 'max-centered-radius-within-inscribed-sphere',
  'attempt017-rebuild-projector-version-mismatch');
  assert(snapshot.r2a.version === 'CausalFactorGraphStateV3'
    && snapshot.r2a.outcomeIdentityVersion === 'ActiveR2BasinMembershipV1'
    && snapshot.r2a.legacyOutcomeModesMigrated === false,
  'attempt017-rebuild-r2a-version-mismatch');

  const store = new ExperienceMediaStore(snapshot.store);
  const coactivations = snapshot.store.coactivations;
  assert(coactivations.length === 128, `attempt017-r2-visit-count:${coactivations.length}`);
  const uniqueBasins = new Map<string, readonly string[]>();
  for (const visit of coactivations) {
    const membership = store.resolveActiveR2Basin(visit.coactivationId);
    assert(membership && membership.memberVisitIds.includes(visit.coactivationId),
      `attempt017-r2-visit-unresolved:${visit.coactivationId}`);
    uniqueBasins.set(canonical(membership.memberVisitIds), membership.memberVisitIds);
  }
  const allMembers = new Set<string>();
  for (const members of uniqueBasins.values()) for (const member of members) {
    assert(!allMembers.has(member), `attempt017-r2-basin-overlap:${member}`); allMembers.add(member);
  }
  assert(allMembers.size === coactivations.length
    && coactivations.every(visit => allMembers.has(visit.coactivationId)), 'attempt017-r2-basin-membership-incomplete');
  const physicalR2BasinSizes = [...uniqueBasins.values()].map(members => members.length).sort((a, b) => b - a);
  const diagnosticComponentSizes = [...snapshot.projector.resolution.componentSizes].sort((a, b) => b - a);
  assert(physicalR2BasinSizes.length > 1 && physicalR2BasinSizes[0]! < 128,
    'attempt017-r2-still-collapsed-to-one-basin');
  assert(canonical(physicalR2BasinSizes) === canonical(diagnosticComponentSizes),
    'attempt017-r2-physical-and-diagnostic-components-disagree');

  const resolvableEventSummaryVisits = snapshot.r2a.eventSummaries.filter(summary =>
    store.resolveActiveR2Basin(summary.r2VisitId) !== null).length;
  const resolvableHyperedgeVisits = snapshot.r2a.hyperedges.filter(edge =>
    store.resolveActiveR2Basin(edge.targetR2VisitId) !== null).length;
  assert(resolvableEventSummaryVisits === snapshot.r2a.eventSummaries.length,
    'attempt017-r2a-event-summary-visit-unresolved');
  assert(resolvableHyperedgeVisits === snapshot.r2a.hyperedges.length,
    'attempt017-r2a-hyperedge-visit-unresolved');
  const restored = PhysicalMemory.restore(snapshot);
  const restoreCanonicalEqual = canonical(restored.snapshot()) === canonical(snapshot);
  assert(restoreCanonicalEqual, 'attempt017-rebuild-restore-not-exact');
  return { version: 'RebuiltPhysicalMemoryAuditV1', snapshotVersion: snapshot.version,
    writes: snapshot.writes, seenEvents: snapshot.seenEventIds.length,
    pendingEvents: snapshot.pendingInitialization.length, activeSeconds: snapshot.activeSeconds,
    snapshotSha256: sha(snapshot), eventMapSha256: sha(snapshot.eventMap),
    projectorVersion: snapshot.projector.version, resolutionVersion: snapshot.projector.resolution.version,
    resolutionScale: snapshot.projector.resolution.outputScale,
    diagnosticComponentSizes, physicalR2BasinSizes, physicalR2BasinCount: physicalR2BasinSizes.length,
    r2aVersion: snapshot.r2a.version, outcomeIdentityVersion: snapshot.r2a.outcomeIdentityVersion,
    r2aEventSummaries: snapshot.r2a.eventSummaries.length, factorNodes: snapshot.r2a.factorNodes.length,
    stableFactorNodes: snapshot.r2a.factorNodes.filter(node => node.state === 'stable').length,
    hyperedges: snapshot.r2a.hyperedges.length,
    stableHyperedges: snapshot.r2a.hyperedges.filter(edge => edge.state === 'stable'
      || edge.state === 'minimal-under-tested-interventions').length,
    resolvableEventSummaryVisits, resolvableHyperedgeVisits, restoreCanonicalEqual };
}

export async function rebuildAttempt017PhysicalMemoryV2(sourceDirectory: string, outputDirectory: string): Promise<{
  readonly snapshot: MemorySnapshot;
  readonly rawAudit: Attempt017RawAuditV1;
  readonly rebuildAudit: RebuiltPhysicalMemoryAuditV1;
  readonly pointer: Awaited<ReturnType<typeof saveExperienceBundleV1>>;
}> {
  const reconstructed = await reconstructAttempt017RealEventsV1(sourceDirectory);
  const memory = new PhysicalMemory();
  for (const event of reconstructed.events) memory.observe(event);
  const rebuildAudit = auditRebuiltPhysicalMemoryV1(memory);
  const snapshot = memory.snapshot();
  await saveJson(resolve(outputDirectory, 'SOURCE_INPUTS.json'), reconstructed.audit);
  const pointer = await saveExperienceBundleV1(outputDirectory, snapshot,
    { actions: 128, eventCount: 128, writes: 128 }, new ControlHabitWeightsV1());
  const snapshotPath = resolve(outputDirectory, pointer.filename);
  await saveJson(resolve(outputDirectory, 'REBUILD_AUDIT.json'), { ...rebuildAudit,
    snapshotFileSha256: await fileSha(snapshotPath), pointerSha256: sha(pointer) });
  return { snapshot, rawAudit: reconstructed.audit, rebuildAudit, pointer };
}
