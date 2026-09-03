import { createReadStream } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { ActionCue, BodyResult, Observation, RealEvent } from '../contracts.js';
import { cueFor, validateEvent } from '../events.js';
import { DistributedHierarchicalPhysicalMemoryV1,
  DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3 } from '../distributed-hierarchical-memory.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { createDistributedG6ProvenanceV1, validateDistributedG6ProvenanceV1,
  DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1, saveExperienceBundleV1 } from '../runtime.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';

export const TRUSTED_ATTEMPT_018_SOURCE_V1 = Object.freeze({
  version: 'TrustedRawR1SourceSpecificationV1' as const,
  sourceId: 'hierarchical-multilevel-goal-chain-live-v1-attempt-018',
  files: {
    frames: { filename: 'frames.jsonl',
      sha256: 'e47145afc07081a80dd28d29d625bfcc9edb17256276c7cdbb963189ceced59f' },
    events: { filename: 'events.jsonl',
      sha256: 'd9a3e45df39e0c5b3526f53e62feb9a8ba5fcee4948f1941481a120da718f7ca' },
    protocol: { filename: 'RUN_PROTOCOL.json',
      sha256: 'f1ef4b09f53f83b36b64e56c1224c39081b4e97c61324acff3e06a3b523380bc' },
  },
  expected: { frameCount: 6_330, firstSequence: 1, lastSequence: 6_330,
    protocolEpisodes: 128, bodyResults: 256, interactionAttempts: 16 },
  integrityBoundary: 'hashes-frozen-at-rebuild-time-not-a-contemporaneous-capture-manifest' as const,
});

export interface TrustedRawR1SourceSpecificationV1 {
  readonly version: 'TrustedRawR1SourceSpecificationV1';
  readonly sourceId: string;
  readonly files: Readonly<Record<'frames' | 'events' | 'protocol', {
    readonly filename: string; readonly sha256: string;
  }>>;
  readonly expected: {
    readonly frameCount: number; readonly firstSequence: number; readonly lastSequence: number;
    readonly protocolEpisodes: number; readonly bodyResults: number;
    readonly interactionAttempts: number;
  };
  readonly integrityBoundary: 'hashes-frozen-at-rebuild-time-not-a-contemporaneous-capture-manifest';
}

interface RawLine { readonly kind?: unknown; readonly value?: unknown }
interface FrozenFoundationEpisodeV1 {
  readonly chain?: { readonly actionCue?: ActionCue; readonly verificationCue?: ActionCue };
}
interface FrozenProtocolV1 { readonly foundation?: readonly FrozenFoundationEpisodeV1[] }
interface BlockInteractionAttemptV1 {
  readonly observationSequence?: unknown; readonly targetId?: unknown;
  readonly packet?: { readonly sequence?: unknown };
}

export interface TrustedRawR1SourceAuditV1 {
  readonly version: 'TrustedRawR1SourceAuditV1';
  readonly passed: true;
  readonly sourceId: string;
  readonly sourceDirectory: string;
  readonly sourceFileSha256: Readonly<Record<'frames' | 'events' | 'protocol', string>>;
  readonly integrityBoundary: TrustedRawR1SourceSpecificationV1['integrityBoundary'];
  readonly raw: {
    readonly frames: number; readonly firstSequence: number; readonly lastSequence: number;
    readonly bodyResults: number; readonly interactionAttempts: number;
    readonly protocolEpisodes: number; readonly realEventRecords: 0;
    readonly explicitHierarchyContinuityRecords: 0;
  };
  readonly reconstruction: {
    readonly r1Atoms: number; readonly r2ContinuousEvents: 0; readonly r2aPatterns: 0;
    readonly r2aRelations: 0; readonly reconstructedEventSha256: readonly string[];
    readonly armFieldsConsumed: 0; readonly comparisonFieldsConsumed: 0;
    readonly expectedResultFieldsConsumed: 0; readonly legacySnapshotInputsConsumed: 0;
    readonly acceptedSourceFiles: readonly string[];
    readonly continuityQualification: 'R1-only-new-continuous-capture-required';
  };
}

export interface TrustedRawR1ReconstructionV1 {
  readonly audit: TrustedRawR1SourceAuditV1;
  readonly events: readonly RealEvent[];
}

export interface TrustedDistributedR1RebuildAuditV1 {
  readonly version: 'TrustedDistributedR1RebuildAuditV1';
  readonly passed: true;
  readonly source: TrustedRawR1SourceAuditV1;
  readonly output: {
    readonly directory: string; readonly pointerPath: string; readonly pointerSha256: string;
    readonly snapshotPath: string; readonly snapshotFileSha256: string;
    readonly snapshotCanonicalSha256: string; readonly snapshotVersion: string;
    readonly r1Atoms: number; readonly r2ContinuousEvents: 0;
    readonly r2aPatterns: 0; readonly r2aRelations: 0;
  };
  readonly nextStep: 'capture-32-real-continuous-events-across-8-layouts';
}

async function jsonLines(path: string): Promise<RawLine[]> {
  const values: RawLine[] = [];
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const value: unknown = JSON.parse(line);
    assert(value !== null && typeof value === 'object' && !Array.isArray(value),
      'trusted-R1-jsonl-record-must-be-object');
    values.push(value as RawLine);
  }
  return values;
}

function asObservation(value: unknown): Observation {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    'trusted-R1-frame-value-must-be-object');
  return value as Observation;
}

function asBodyResult(value: unknown): BodyResult {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    'trusted-R1-body-result-must-be-object');
  return value as BodyResult;
}

function samePlannedAction(cue: ActionCue | undefined, result: BodyResult): boolean {
  return cue !== undefined && cue.kind === result.action.kind
    && canonical(cue.parameters) === canonical(result.action.parameters);
}

function publicTrackedIds(frames: readonly Observation[], result: BodyResult): readonly string[] {
  const tracked = new Set<string>(['self']);
  if (result.action.targetId) tracked.add(result.action.targetId);
  for (const frame of frames) if (frame.targetId) tracked.add(frame.targetId);
  for (let index = 1; index < frames.length; index++) {
    const before = new Map(frames[index - 1]!.objects.map(value => [value.id, value]));
    const after = new Map(frames[index]!.objects.map(value => [value.id, value]));
    for (const id of new Set([...before.keys(), ...after.keys()]))
      if (canonical(before.get(id) ?? null) !== canonical(after.get(id) ?? null)) tracked.add(id);
  }
  return [...tracked].sort((left, right) => left.localeCompare(right, 'en'));
}

function assertFrames(frames: readonly Observation[], specification: TrustedRawR1SourceSpecificationV1):
Map<number, Observation> {
  assert(frames.length === specification.expected.frameCount,
    `trusted-R1-frame-count:${frames.length}:${specification.expected.frameCount}`);
  const bySequence = new Map<number, Observation>();
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]!;
    assert(Number.isSafeInteger(frame.sequence), 'trusted-R1-frame-sequence-invalid');
    assert(Number.isFinite(frame.activeSeconds), 'trusted-R1-frame-time-invalid');
    assert(!bySequence.has(frame.sequence), `trusted-R1-frame-sequence-duplicate:${frame.sequence}`);
    if (index > 0) {
      assert(frame.sequence === frames[index - 1]!.sequence + 1,
        `trusted-R1-frame-gap:${frames[index - 1]!.sequence}:${frame.sequence}`);
      assert(frame.activeSeconds > frames[index - 1]!.activeSeconds,
        `trusted-R1-frame-time-not-increasing:${frame.sequence}`);
    }
    bySequence.set(frame.sequence, frame);
  }
  assert(frames[0]!.sequence === specification.expected.firstSequence
    && frames.at(-1)!.sequence === specification.expected.lastSequence,
  'trusted-R1-frame-range-mismatch');
  return bySequence;
}

function assertInteractionAttempts(attempts: readonly BlockInteractionAttemptV1[],
  receipts: readonly BodyResult[], expected: number): void {
  assert(attempts.length === expected, `trusted-R1-interaction-attempt-count:${attempts.length}:${expected}`);
  const interacts = receipts.filter(value => value.action.kind === 'interact');
  assert(interacts.length === attempts.length, 'trusted-R1-interaction-receipt-count-mismatch');
  const packetSequences = new Set<number>();
  for (const attempt of attempts) {
    assert(Number.isSafeInteger(attempt.observationSequence)
      && typeof attempt.targetId === 'string' && attempt.targetId.length > 0,
    'trusted-R1-interaction-attempt-invalid');
    const matches = interacts.filter(result => result.startSequence === attempt.observationSequence
      && result.action.targetId === attempt.targetId);
    assert(matches.length === 1, 'trusted-R1-interaction-attempt-receipt-mismatch');
    const packetSequence = attempt.packet?.sequence;
    assert(Number.isSafeInteger(packetSequence) && !packetSequences.has(packetSequence as number),
      'trusted-R1-interaction-packet-sequence-invalid');
    packetSequences.add(packetSequence as number);
  }
}

export async function reconstructTrustedRawR1SourceV1(sourceDirectory: string,
  specification: TrustedRawR1SourceSpecificationV1 = TRUSTED_ATTEMPT_018_SOURCE_V1):
Promise<TrustedRawR1ReconstructionV1> {
  const source = resolve(sourceDirectory);
  const paths = { frames: resolve(source, specification.files.frames.filename),
    events: resolve(source, specification.files.events.filename),
    protocol: resolve(source, specification.files.protocol.filename) };
  await Promise.all(Object.values(paths).map(path => access(path)));
  const actualHashes = { frames: await fileSha(paths.frames), events: await fileSha(paths.events),
    protocol: await fileSha(paths.protocol) };
  for (const key of ['frames', 'events', 'protocol'] as const)
    assert(actualHashes[key] === specification.files[key].sha256,
      `trusted-R1-source-hash-mismatch:${key}:${actualHashes[key]}:${specification.files[key].sha256}`);

  const protocol = JSON.parse(await readFile(paths.protocol, 'utf8')) as FrozenProtocolV1;
  assert(Array.isArray(protocol.foundation)
    && protocol.foundation.length === specification.expected.protocolEpisodes,
  'trusted-R1-protocol-episode-count-mismatch');
  const frameRecords = await jsonLines(paths.frames);
  assert(frameRecords.every(value => value.kind === 'frame'), 'trusted-R1-non-frame-record-in-frame-stream');
  const frames = frameRecords.map(value => asObservation(value.value));
  const bySequence = assertFrames(frames, specification);
  const eventRecords = await jsonLines(paths.events);
  const bodyResults = eventRecords.filter(value => value.kind === 'body-result')
    .map(value => asBodyResult(value.value));
  const interactionAttempts = eventRecords.filter(value => value.kind === 'block-interaction-attempt')
    .map(value => value.value as BlockInteractionAttemptV1);
  assert(eventRecords.every(value => value.kind === 'body-result'
    || value.kind === 'block-interaction-attempt'), 'trusted-R1-unexpected-event-record-kind');
  assert(bodyResults.length === specification.expected.bodyResults,
    `trusted-R1-body-result-count:${bodyResults.length}:${specification.expected.bodyResults}`);
  assertInteractionAttempts(interactionAttempts, bodyResults, specification.expected.interactionAttempts);

  const reconstructed: RealEvent[] = [];
  for (let episodeIndex = 0; episodeIndex < protocol.foundation.length; episodeIndex++) {
    const episode = protocol.foundation[episodeIndex]!;
    for (let part = 0; part < 2; part++) {
      const receiptIndex = episodeIndex * 2 + part;
      const receipt = bodyResults[receiptIndex]!;
      assert(receipt.executed && receipt.status === 'completed',
        `trusted-R1-unexecuted-receipt:${receiptIndex}`);
      assert(Number.isSafeInteger(receipt.startSequence) && Number.isSafeInteger(receipt.endSequence)
        && receipt.startSequence < receipt.endSequence, `trusted-R1-receipt-window-invalid:${receiptIndex}`);
      const plannedCue = part === 0 ? episode.chain?.actionCue : episode.chain?.verificationCue;
      assert(samePlannedAction(plannedCue, receipt),
        `trusted-R1-action-plan-mismatch:${episodeIndex}:${part}`);
      const window: Observation[] = [];
      for (let sequence = receipt.startSequence; sequence <= receipt.endSequence; sequence++) {
        const frame = bySequence.get(sequence);
        assert(frame, `trusted-R1-receipt-frame-missing:${receiptIndex}:${sequence}`);
        window.push(frame);
      }
      const event: RealEvent = { version: 'RealEventV5',
        id: `${specification.sourceId}:${actualHashes.events.slice(0, 16)}:r1-${String(receiptIndex + 1).padStart(3, '0')}`,
        cue: cueFor(receipt.action, window[0]!), frames: structuredClone(window),
        trackedIds: publicTrackedIds(window, receipt), bodyResult: structuredClone(receipt),
        provenance: 'executed-real-body', complete: true };
      validateEvent(event);
      reconstructed.push(event);
    }
  }
  assert(reconstructed.length === specification.expected.bodyResults,
    'trusted-R1-reconstruction-cardinality-mismatch');
  const audit: TrustedRawR1SourceAuditV1 = { version: 'TrustedRawR1SourceAuditV1', passed: true,
    sourceId: specification.sourceId, sourceDirectory: source, sourceFileSha256: actualHashes,
    integrityBoundary: specification.integrityBoundary,
    raw: { frames: frames.length, firstSequence: frames[0]!.sequence,
      lastSequence: frames.at(-1)!.sequence, bodyResults: bodyResults.length,
      interactionAttempts: interactionAttempts.length, protocolEpisodes: protocol.foundation.length,
      realEventRecords: 0, explicitHierarchyContinuityRecords: 0 },
    reconstruction: { r1Atoms: reconstructed.length, r2ContinuousEvents: 0, r2aPatterns: 0,
      r2aRelations: 0, reconstructedEventSha256: reconstructed.map(value => sha(value)),
      armFieldsConsumed: 0, comparisonFieldsConsumed: 0, expectedResultFieldsConsumed: 0,
      legacySnapshotInputsConsumed: 0,
      acceptedSourceFiles: [specification.files.frames.filename, specification.files.events.filename,
        specification.files.protocol.filename],
      continuityQualification: 'R1-only-new-continuous-capture-required' } };
  return { audit: Object.freeze(audit), events: Object.freeze(reconstructed) };
}

function assertOutputOutsideSource(sourceDirectory: string, outputDirectory: string): void {
  const source = resolve(sourceDirectory), output = resolve(outputDirectory);
  const fromSource = relative(source, output), fromOutput = relative(output, source);
  assert(fromSource !== '' && fromSource !== '.' && fromOutput !== '' && fromOutput !== '.',
    'trusted-R1-rebuild-output-must-differ-from-source');
  assert(fromSource.startsWith('..') || resolve(source, fromSource) !== output,
    'trusted-R1-rebuild-output-must-not-be-inside-source');
  assert(fromOutput.startsWith('..'), 'trusted-R1-rebuild-output-must-not-contain-source');
}

export async function rebuildTrustedRawR1BaselineV1(sourceDirectory: string,
  outputDirectory: string, specification: TrustedRawR1SourceSpecificationV1):
Promise<TrustedDistributedR1RebuildAuditV1> {
  assertOutputOutsideSource(sourceDirectory, outputDirectory);
  const reconstruction = await reconstructTrustedRawR1SourceV1(sourceDirectory, specification);
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  for (const event of reconstruction.events) memory.observe(event);
  const snapshot = memory.snapshot();
  assert(snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
    'trusted-R1-rebuild-produced-incompatible-snapshot');
  assert(snapshot.seenEventIds.length === reconstruction.events.length
    && snapshot.annotations.length === reconstruction.events.length,
  'trusted-R1-rebuild-R1-cardinality-mismatch');
  assert(snapshot.r2.events.length === 0 && snapshot.r2.pending.length === 0,
    'trusted-R1-only-source-must-not-produce-R2');
  assert(snapshot.r2a.patterns.length === 0 && snapshot.r2a.relations.length === 0,
    'trusted-R1-only-source-must-not-produce-R2A');
  const rawEventHashes = new Map(reconstruction.events.map(value => [value.id, sha(value)]));
  assert(snapshot.annotations.every(value => value.r1Record.eventSha256 === rawEventHashes.get(value.eventId)),
    'trusted-R1-rebuild-event-hash-not-bound-to-physical-record');

  const output = resolve(outputDirectory);
  await mkdir(dirname(output), { recursive: true });
  try { await access(output); throw new Error('trusted-R1-rebuild-output-already-exists'); }
  catch (error) {
    if (error instanceof Error && error.message === 'trusted-R1-rebuild-output-already-exists') throw error;
  }
  await mkdir(output, { recursive: false });
  const sourceEventsSha256 = sha(reconstruction.events.map(value => sha(value)));
  const distributedG6Provenance = createDistributedG6ProvenanceV1({
    version: 'DistributedG6ExperienceProvenanceV1', producer: 'trusted-r1-rebuild-v1',
    producerIdentitySha256: DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1,
    sourceId: specification.sourceId, sourceEventsSha256,
  });
  const pointer = await saveExperienceBundleV1(output, snapshot, {
    actions: reconstruction.events.length, eventCount: reconstruction.events.length,
    writes: snapshot.writes, distributedG6Provenance }, new ControlHabitWeightsV1());
  validateDistributedG6ProvenanceV1(pointer.distributedG6Provenance);
  assert(pointer.distributedG6Provenance.producer === 'trusted-r1-rebuild-v1'
    && pointer.distributedG6Provenance.sourceId === specification.sourceId
    && pointer.distributedG6Provenance.sourceEventsSha256 === sourceEventsSha256,
  'trusted-R1-rebuild-pointer-provenance-mismatch');
  const pointerPath = resolve(output, 'EXPERIENCE_LATEST.json');
  const snapshotPath = resolve(output, pointer.filename);
  const audit: TrustedDistributedR1RebuildAuditV1 = { version: 'TrustedDistributedR1RebuildAuditV1',
    passed: true, source: reconstruction.audit,
    output: { directory: output, pointerPath, pointerSha256: await fileSha(pointerPath), snapshotPath,
      snapshotFileSha256: await fileSha(snapshotPath), snapshotCanonicalSha256: sha(snapshot),
      snapshotVersion: snapshot.version, r1Atoms: snapshot.seenEventIds.length,
      r2ContinuousEvents: 0, r2aPatterns: 0, r2aRelations: 0 },
    nextStep: 'capture-32-real-continuous-events-across-8-layouts' };
  await saveJson(resolve(output, 'TRUSTED_SOURCE_AUDIT.json'), reconstruction.audit);
  await saveJson(resolve(output, 'REBUILD_AUDIT.json'), audit);
  return audit;
}

export async function rebuildTrustedAttempt018R1BaselineV1(sourceDirectory: string,
  outputDirectory: string): Promise<TrustedDistributedR1RebuildAuditV1> {
  return rebuildTrustedRawR1BaselineV1(sourceDirectory, outputDirectory,
    TRUSTED_ATTEMPT_018_SOURCE_V1);
}
