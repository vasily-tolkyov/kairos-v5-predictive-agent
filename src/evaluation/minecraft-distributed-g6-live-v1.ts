import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { BodyResult, Observation, RealEvent } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import { startDashboard } from '../dashboard.js';
import { DistributedHierarchicalPhysicalMemoryV1,
  DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  type KairosV5DistributedPhysicalMemoryV3 } from '../distributed-hierarchical-memory.js';
import type { GroundedGoalV1 } from '../control/contracts.js';
import { ControlHabitWeightsV1 } from '../control/habit.js';
import { DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1,
  DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1,
  restoreExperience, validateDistributedG6ProvenanceV1, V5Runtime,
  type DistributedG6ExperienceProvenanceV1, type ExperiencePointer } from '../runtime.js';
import { Services, type Configuration } from '../services.js';
import { startLoopbackMineflayerViewerV1 } from '../viewer.mjs';
import { DistributedPhysicalMedium3DV1 } from '../core/physics/distributed-physical-medium.js';
import { prepareGuidedNoteFixtureLiveV1,
  type GuidedMinecraftLayoutV1 } from './minecraft-note-fixture-v1.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import { realEventHierarchyContinuityV1, validateEvent } from '../events.js';
import { reconstructTrustedRawR1SourceV1, TRUSTED_ATTEMPT_018_SOURCE_V1,
  type TrustedDistributedR1RebuildAuditV1, type TrustedRawR1SourceSpecificationV1 }
  from './rebuild-minecraft-distributed-g6-r1-baseline-v1.js';

export const MINECRAFT_DISTRIBUTED_G6_LIVE_V1 =
  'MinecraftDistributedPhysicalMediumG6LiveV1' as const;

export interface DistributedNeutralGateStatusV1 {
  readonly version: 'DistributedNeutralGateStatusV1';
  readonly sourceIdentitySha256: string;
  readonly evidenceManifestSha256: string;
  readonly gates: Readonly<Record<'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5', {
    readonly passed: boolean;
    readonly evidenceRefs: readonly string[];
  }>>;
}

export interface DistributedProductionSourceIdentityV1 {
  readonly version: 'DistributedProductionSourceIdentityV1';
  readonly entrypoints: readonly string[];
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  readonly sha256: string;
}

export interface DistributedNeutralGateEvidenceManifestV1 {
  readonly version: 'DistributedNeutralGateEvidenceManifestV1';
  readonly sourceIdentitySha256: string;
  readonly gates: Readonly<Record<'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5', {
    readonly evidence: readonly { readonly ref: string; readonly path: string; readonly sha256: string }[];
  }>>;
}

export interface DistributedGateIdentityAuditV1 {
  readonly version: 'DistributedGateIdentityAuditV1';
  readonly passed: boolean;
  readonly currentSourceIdentitySha256: string;
  readonly declaredSourceIdentitySha256: string;
  readonly evidenceManifestPath: string;
  readonly evidenceManifestSha256: string;
  readonly verifiedEvidenceRefs: readonly string[];
  readonly blockers: readonly string[];
}

export interface DistributedG6BaselineProvenanceAuditV1 {
  readonly version: 'DistributedG6BaselineProvenanceAuditV1';
  readonly present: boolean;
  readonly valid: boolean;
  readonly producer: DistributedG6ExperienceProvenanceV1['producer'] | null;
  readonly sourceId: string | null;
  readonly sourceEventsSha256: string | null;
  readonly blockers: readonly string[];
}

export interface TrustedHistoryContinuityAuditV1 {
  readonly version: 'TrustedHistoryContinuityAuditV1';
  readonly sourcePath: string;
  readonly executedBodyResults: number;
  readonly realEventRecords: number;
  readonly recordsWithExplicitHierarchyContinuity: number;
  readonly invalidRealEventRecords: number;
  readonly duplicateRealEventRecords: number;
  readonly unmatchedExecutedBodyResults: number;
  readonly replayableR1Candidates: number;
  readonly replayableContinuousR2Events: number;
  readonly sourceEventsSha256: string;
  readonly expectedSourceEventsSha256: string | null;
  readonly verified: boolean;
  readonly verificationScope: 'trusted-R1-rebuild-audit' | 'embedded-real-events'
    | 'trusted-R1-plus-embedded-real-events' | 'receipt-inventory-only' | 'invalid';
  readonly conclusion: 'R1-only' | 'continuous-evidence-present';
  readonly reason: string;
}

export interface DistributedG6BaselineAuditV1 {
  readonly version: 'DistributedG6BaselineAuditV1';
  readonly compatibleSnapshot: boolean;
  readonly deterministicRestore: boolean;
  readonly r1EventCount: number;
  readonly completeR2EventCount: number;
  readonly multiAtomR2EventCount: number;
  readonly noteZeroToOneR2Count: number;
  readonly noteOneToTwoR2Count: number;
  readonly predictiveStablePatternCount: number;
  readonly interventionSupportedRelationCount: number;
  readonly activeNoteOnePatternCount: number;
  readonly activeNoteTwoPatternCount: number;
  readonly activeLookConditionRelationCount: number;
  readonly readyForFrozenHeldout: boolean;
  readonly blockers: readonly string[];
}

export interface DistributedG6PreflightV1 {
  readonly version: 'DistributedG6PreflightV1';
  readonly passed: boolean;
  readonly gateStatus: DistributedNeutralGateStatusV1;
  readonly history: TrustedHistoryContinuityAuditV1 | null;
  readonly gateIdentity: DistributedGateIdentityAuditV1;
  readonly baselineProvenance: DistributedG6BaselineProvenanceAuditV1;
  readonly baseline: DistributedG6BaselineAuditV1;
  readonly nextStep: 'run-four-frozen-heldouts' | 'capture-minimum-continuous-experience'
    | 'complete-neutral-gates' | 'provide-compatible-distributed-baseline'
    | 'provide-verified-trusted-history' | 'provide-provenance-bound-baseline';
  readonly minimumCapture: null | {
    readonly realLayouts: 8;
    readonly completeContinuousEvents: 32;
    readonly atomsPerEvent: '3-or-4';
    readonly resetBetweenEvents: true;
    readonly scoringLabelsWrittenToMedium: 0;
    readonly note: string;
  };
}

export interface DistributedG6HeldoutCaseV1 {
  readonly caseId: string;
  readonly layout: GuidedMinecraftLayoutV1;
  readonly yawOffsetDegrees: -15 | 0 | 15;
  readonly actionBudget: 20;
}

export const DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1: readonly DistributedG6HeldoutCaseV1[] =
  Object.freeze([
    { caseId: 'distributed-g6-note-two-south-plus',
      layout: { id: 'distributed-g6-south', originX: 420, originZ: 420,
        side: 'south', markerVariant: 0 }, yawOffsetDegrees: -15, actionBudget: 20 },
    { caseId: 'distributed-g6-note-two-east-minus',
      layout: { id: 'distributed-g6-east', originX: 444, originZ: 420,
        side: 'east', markerVariant: 1 }, yawOffsetDegrees: 15, actionBudget: 20 },
    { caseId: 'distributed-g6-note-two-north-aligned',
      layout: { id: 'distributed-g6-north', originX: 420, originZ: 444,
        side: 'north', markerVariant: 2 }, yawOffsetDegrees: 0, actionBudget: 20 },
    { caseId: 'distributed-g6-note-two-west-plus',
      layout: { id: 'distributed-g6-west', originX: 444, originZ: 444,
        side: 'west', markerVariant: 3 }, yawOffsetDegrees: -15, actionBudget: 20 },
  ] as const);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrapRecordedValue(value: unknown): unknown {
  if (isObject(value) && typeof value.caseId === 'string' && Object.hasOwn(value, 'value'))
    return value.value;
  return value;
}

function bodyResult(value: unknown): BodyResult | null {
  const candidate = unwrapRecordedValue(value);
  if (!isObject(candidate) || !isObject(candidate.action)
    || typeof candidate.action.kind !== 'string' || typeof candidate.executed !== 'boolean'
    || typeof candidate.status !== 'string' || !Number.isSafeInteger(candidate.startSequence)
    || !Number.isSafeInteger(candidate.endSequence)) return null;
  return candidate as unknown as BodyResult;
}

function realEvent(value: unknown): RealEvent | null {
  const candidate = unwrapRecordedValue(value);
  if (!isObject(candidate) || (candidate.version !== 'RealEventV5' && candidate.version !== 'RealEventV6')) return null;
  try { validateEvent(candidate as unknown as RealEvent); return candidate as unknown as RealEvent; }
  catch { return null; }
}

function continuityMatchesPublicEvent(event: RealEvent): boolean {
  const continuity = event.hierarchyContinuity;
  if (!continuity) return false;
  const { hierarchyContinuity: _continuity, ...withoutContinuity } = event;
  try {
    return canonical(realEventHierarchyContinuityV1(withoutContinuity, continuity.sessionId,
      continuity.boundaryBefore)) === canonical(continuity);
  } catch { return false; }
}

/**
 * This audit deliberately refuses to infer a causal/continuous R2 chain from
 * adjacent body results alone.  A valid chain needs the public dependency and
 * continuity evidence stored by the real event producer.
 */
export async function auditTrustedHistoryContinuityV1(sourcePath: string,
  expectedSourceEventsSha256: string | null = null):
  Promise<TrustedHistoryContinuityAuditV1> {
  await access(sourcePath);
  const sourceEventsSha256 = await fileSha(sourcePath);
  let executedBodyResults = 0, realEventRecords = 0, recordsWithExplicitHierarchyContinuity = 0;
  let invalidRealEventRecords = 0, duplicateRealEventRecords = 0;
  const executedReceiptHashes = new Set<string>(), eventReceiptHashes = new Set<string>();
  const seenEventIds = new Map<string, string>();
  const replayableEvents: RealEvent[] = [];
  const input = createReadStream(sourcePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as { kind?: unknown; value?: unknown };
    if (record.kind === 'body-result') {
      const receipt = bodyResult(record.value);
      if (receipt?.executed) { executedBodyResults++; executedReceiptHashes.add(sha(receipt)); }
      continue;
    }
    if (record.kind !== 'real-event') continue;
    realEventRecords++;
    const candidate = realEvent(record.value);
    if (!candidate || !candidate.complete || !candidate.hierarchyContinuity
      || !continuityMatchesPublicEvent(candidate)) { invalidRealEventRecords++; continue; }
    recordsWithExplicitHierarchyContinuity++;
    const identity = sha(candidate), earlier = seenEventIds.get(candidate.id);
    if (earlier !== undefined) {
      if (earlier === identity) duplicateRealEventRecords++;
      else invalidRealEventRecords++;
      continue;
    }
    seenEventIds.set(candidate.id, identity);
    if (candidate.bodyResult?.executed) eventReceiptHashes.add(sha(candidate.bodyResult));
    replayableEvents.push(candidate);
  }
  const unmatchedExecutedBodyResults = [...executedReceiptHashes]
    .filter(identity => !eventReceiptHashes.has(identity)).length;
  let replayableContinuousR2Events = 0;
  const open = new Map<string, { count: number; lastSequence: number }>();
  for (const event of replayableEvents) {
    const continuity = event.hierarchyContinuity!;
    const key = `${continuity.sessionId}\u0000${continuity.continuityEpochId}`;
    const first = event.frames[0]!.sequence, last = event.frames.at(-1)!.sequence;
    let chain = open.get(key);
    if (continuity.boundaryBefore !== 'continuous') chain = undefined;
    if (chain && (first < chain.lastSequence || first > chain.lastSequence + 1)) chain = undefined;
    chain = { count: (chain?.count ?? 0) + 1, lastSequence: last };
    if (continuity.processStatusAfter === 'publicly-resolved') {
      if (chain.count >= 2) replayableContinuousR2Events++;
      open.delete(key);
    } else if (continuity.processStatusAfter === 'observation-insufficient') open.delete(key);
    else open.set(key, chain);
  }
  const hashVerified = expectedSourceEventsSha256 !== null
    && sourceEventsSha256 === expectedSourceEventsSha256;
  const verified = hashVerified && invalidRealEventRecords === 0
    && replayableEvents.length > 0 && unmatchedExecutedBodyResults === 0;
  const verificationScope: TrustedHistoryContinuityAuditV1['verificationScope'] = verified
    ? 'embedded-real-events' : executedBodyResults > 0 && realEventRecords === 0
      ? 'receipt-inventory-only' : 'invalid';
  return Object.freeze({ version: 'TrustedHistoryContinuityAuditV1', sourcePath,
    executedBodyResults, realEventRecords, recordsWithExplicitHierarchyContinuity,
    invalidRealEventRecords, duplicateRealEventRecords, unmatchedExecutedBodyResults,
    replayableR1Candidates: replayableEvents.length, replayableContinuousR2Events,
    sourceEventsSha256, expectedSourceEventsSha256, verified, verificationScope,
    conclusion: replayableContinuousR2Events > 0 ? 'continuous-evidence-present' : 'R1-only',
    reason: !hashVerified ? 'history-source-hash-is-missing-or-mismatched'
      : invalidRealEventRecords > 0 ? 'one-or-more-real-events-failed-public-continuity-validation'
        : unmatchedExecutedBodyResults > 0 ? 'one-or-more-executed-receipts-have-no-matching-real-event'
          : replayableContinuousR2Events > 0 ? 'verified-explicit-public-continuity-is-present'
            : 'action-adjacency-without-a-verified-multi-atom-chain-cannot-be-promoted-to-R2',
  });
}

const DISTRIBUTED_PRODUCTION_ENTRYPOINTS_V1 = Object.freeze([
  'src/main.ts', 'src/worker.ts',
  'src/evaluation/minecraft-distributed-g6-live-v1.ts',
  'src/evaluation/minecraft-distributed-g6-continuous-capture-v1.ts',
  'src/evaluation/rebuild-minecraft-distributed-g6-r1-baseline-v1.ts',
  'scripts/run-minecraft-distributed-g6-live-v1.mjs',
  'scripts/run-minecraft-distributed-g6-continuous-capture-v1.mjs',
  'scripts/rebuild-minecraft-distributed-g6-r1-baseline-v1.mjs',
] as const);

function portablePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

async function resolveLocalImportV1(fromPath: string, specifier: string): Promise<string> {
  const unresolved = resolve(dirname(fromPath), specifier);
  const candidates = specifier.endsWith('.js')
    ? [unresolved.slice(0, -3) + '.ts', unresolved]
    : specifier.endsWith('.mjs') || specifier.endsWith('.ts') ? [unresolved]
      : [unresolved + '.ts', unresolved + '.mjs', resolve(unresolved, 'index.ts')];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* try next exact local candidate */ }
  }
  throw new Error(`distributed-source-local-import-missing:${fromPath}:${specifier}`);
}

/** Identity of the production path which can create/query the distributed memory and run G6. */
export async function computeDistributedProductionSourceIdentityV1(projectRoot = resolve('.')):
Promise<DistributedProductionSourceIdentityV1> {
  const root = resolve(projectRoot), queue = DISTRIBUTED_PRODUCTION_ENTRYPOINTS_V1.map(path => resolve(root, path));
  const seen = new Set<string>();
  while (queue.length > 0) {
    const path = resolve(queue.shift()!);
    const rel = portablePath(root, path);
    assert(rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel),
      `distributed-source-dependency-escaped-project:${path}`);
    if (seen.has(path)) continue;
    await access(path); seen.add(path);
    // Script entrypoints are part of the identity, but their imports point at
    // generated dist/ files.  Traversing those artifacts would make the gate
    // depend on build output rather than the frozen source closure.
    if (rel.startsWith('scripts/')) continue;
    const text = await readFile(path, 'utf8');
    const imports = [...text.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map(match => match[1]!);
    for (const specifier of imports) queue.push(await resolveLocalImportV1(path, specifier));
  }
  for (const path of ['kairos.config.json', 'package-lock.json']) {
    const absolute = resolve(root, path); await access(absolute); seen.add(absolute);
  }
  const files = await Promise.all([...seen].sort((left, right) => portablePath(root, left)
    .localeCompare(portablePath(root, right), 'en')).map(async path => ({ path: portablePath(root, path),
      sha256: await fileSha(path) })));
  const identity = { version: 'DistributedProductionSourceIdentityV1' as const,
    entrypoints: DISTRIBUTED_PRODUCTION_ENTRYPOINTS_V1, files };
  return Object.freeze({ ...identity, sha256: sha(identity) });
}

/** Verify both the current production closure and every evidence file named by a passed gate. */
export async function auditDistributedGateIdentityV1(projectRoot: string,
  gateStatus: DistributedNeutralGateStatusV1, evidenceManifestPath: string,
  currentSourceIdentity?: DistributedProductionSourceIdentityV1): Promise<DistributedGateIdentityAuditV1> {
  const blockers: string[] = [], verifiedEvidenceRefs: string[] = [];
  const current = currentSourceIdentity ?? await computeDistributedProductionSourceIdentityV1(projectRoot);
  const manifestPath = resolve(evidenceManifestPath);
  let manifest: DistributedNeutralGateEvidenceManifestV1 | null = null;
  let evidenceManifestSha256 = '';
  try {
    evidenceManifestSha256 = await fileSha(manifestPath);
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (isObject(parsed) && parsed.version === 'DistributedNeutralGateEvidenceManifestV1')
      manifest = parsed as unknown as DistributedNeutralGateEvidenceManifestV1;
    else blockers.push('distributed-gate-evidence-manifest-version-invalid');
  } catch { blockers.push('distributed-gate-evidence-manifest-unreadable'); }
  if (current.sha256 !== gateStatus.sourceIdentitySha256)
    blockers.push('distributed-gate-source-identity-does-not-match-current-production-closure');
  if (gateStatus.evidenceManifestSha256 !== evidenceManifestSha256)
    blockers.push('distributed-gate-evidence-manifest-hash-mismatch');
  if (manifest && manifest.sourceIdentitySha256 !== current.sha256)
    blockers.push('distributed-gate-manifest-bound-to-different-source-identity');
  if (manifest) for (const gateId of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'] as const) {
    const declared = gateStatus.gates[gateId];
    if (!declared?.passed) continue;
    const records = manifest.gates?.[gateId]?.evidence ?? [];
    const refs = records.map(value => value.ref);
    if (new Set(refs).size !== refs.length || canonical([...refs].sort())
      !== canonical([...declared.evidenceRefs].sort())) {
      blockers.push(`distributed-gate-evidence-reference-mismatch:${gateId}`); continue;
    }
    for (const record of records) {
      const evidencePath = resolve(dirname(manifestPath), record.path);
      const rel = relative(dirname(manifestPath), evidencePath);
      if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        || isAbsolute(rel)) { blockers.push(`distributed-gate-evidence-path-escaped:${record.ref}`); continue; }
      try {
        if (await fileSha(evidencePath) !== record.sha256)
          blockers.push(`distributed-gate-evidence-hash-mismatch:${record.ref}`);
        else verifiedEvidenceRefs.push(record.ref);
      } catch { blockers.push(`distributed-gate-evidence-unreadable:${record.ref}`); }
    }
  }
  return Object.freeze({ version: 'DistributedGateIdentityAuditV1', passed: blockers.length === 0,
    currentSourceIdentitySha256: current.sha256,
    declaredSourceIdentitySha256: gateStatus.sourceIdentitySha256,
    evidenceManifestPath: manifestPath, evidenceManifestSha256,
    verifiedEvidenceRefs: Object.freeze(verifiedEvidenceRefs.sort()), blockers: Object.freeze(blockers) });
}

/** Revalidate the fixed raw source and the independent R1-only output named by its audit. */
export async function auditTrustedR1RebuildHistoryV1(auditPath: string,
  specification: TrustedRawR1SourceSpecificationV1 = TRUSTED_ATTEMPT_018_SOURCE_V1):
Promise<TrustedHistoryContinuityAuditV1> {
  const resolvedAudit = resolve(auditPath);
  const parsed: unknown = JSON.parse(await readFile(resolvedAudit, 'utf8'));
  assert(isObject(parsed) && parsed.version === 'TrustedDistributedR1RebuildAuditV1'
    && parsed.passed === true, 'trusted-R1-rebuild-audit-invalid');
  const audit = parsed as unknown as TrustedDistributedR1RebuildAuditV1;
  assert(audit.source.sourceId === specification.sourceId,
    'trusted-R1-rebuild-audit-source-id-mismatch');
  const reconstruction = await reconstructTrustedRawR1SourceV1(audit.source.sourceDirectory,
    specification);
  assert(canonical(reconstruction.audit.sourceFileSha256) === canonical(audit.source.sourceFileSha256)
    && canonical(reconstruction.audit.reconstruction.reconstructedEventSha256)
      === canonical(audit.source.reconstruction.reconstructedEventSha256),
  'trusted-R1-rebuild-audit-source-reconstruction-mismatch');
  assert(await fileSha(audit.output.pointerPath) === audit.output.pointerSha256,
    'trusted-R1-rebuild-pointer-file-hash-mismatch');
  assert(await fileSha(audit.output.snapshotPath) === audit.output.snapshotFileSha256,
    'trusted-R1-rebuild-snapshot-file-hash-mismatch');
  const snapshotRelative = relative(resolve(audit.output.directory), resolve(audit.output.snapshotPath));
  assert(resolve(audit.output.pointerPath) === resolve(audit.output.directory, 'EXPERIENCE_LATEST.json')
    && snapshotRelative !== '..' && !snapshotRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(snapshotRelative),
  'trusted-R1-rebuild-output-path-contract-invalid');
  const pointer = JSON.parse(await readFile(audit.output.pointerPath, 'utf8')) as ExperiencePointer;
  assert(pointer.runtimeVersion === 'KairosV5DistributedPhysicalRuntimeV1'
    && typeof pointer.filename === 'string' && basename(pointer.filename) === pointer.filename
    && resolve(dirname(audit.output.pointerPath), pointer.filename) === resolve(audit.output.snapshotPath),
  'trusted-R1-rebuild-pointer-contract-invalid');
  const snapshot: unknown = JSON.parse(await readFile(audit.output.snapshotPath, 'utf8'));
  assert(isObject(snapshot) && snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
    'trusted-R1-rebuild-snapshot-is-not-distributed-v2');
  const distributed = snapshot as unknown as KairosV5DistributedPhysicalMemoryV3;
  assert(sha(distributed) === audit.output.snapshotCanonicalSha256
    && sha(distributed) === pointer.sha256, 'trusted-R1-rebuild-snapshot-canonical-hash-mismatch');
  assert(distributed.seenEventIds.length === reconstruction.events.length
    && pointer.eventCount === reconstruction.events.length && pointer.actions === reconstruction.events.length
    && pointer.writes === distributed.writes
    && audit.output.r1Atoms === reconstruction.events.length
    && audit.output.r2ContinuousEvents === 0 && audit.output.r2aPatterns === 0
    && audit.output.r2aRelations === 0
    && distributed.r2.events.length === 0 && distributed.r2.pending.length === 0
    && distributed.r2a.patterns.length === 0 && distributed.r2a.relations.length === 0,
  'trusted-R1-rebuild-output-is-not-R1-only');
  const expectedEvents = new Map(reconstruction.events.map(event => [event.id, sha(event)]));
  assert(distributed.annotations.length === expectedEvents.size
    && distributed.annotations.every(annotation => annotation.r1Record.eventSha256
      === expectedEvents.get(annotation.eventId)), 'trusted-R1-rebuild-output-event-binding-mismatch');
  return Object.freeze({ version: 'TrustedHistoryContinuityAuditV1', sourcePath: resolvedAudit,
    executedBodyResults: reconstruction.events.length, realEventRecords: reconstruction.events.length,
    recordsWithExplicitHierarchyContinuity: 0, invalidRealEventRecords: 0,
    duplicateRealEventRecords: 0, unmatchedExecutedBodyResults: 0,
    replayableR1Candidates: reconstruction.events.length, replayableContinuousR2Events: 0,
    sourceEventsSha256: await fileSha(resolvedAudit), expectedSourceEventsSha256: await fileSha(resolvedAudit),
    verified: true, verificationScope: 'trusted-R1-rebuild-audit', conclusion: 'R1-only',
    reason: `${specification.sourceId}-rebuild-proves-exactly-${reconstruction.events.length}`
      + '-R1-atoms-and-zero-R2-R2A;-new-continuous-capture-required' });
}

export function combineTrustedHistoryAuditsV1(r1: TrustedHistoryContinuityAuditV1,
  continuous: TrustedHistoryContinuityAuditV1): TrustedHistoryContinuityAuditV1 {
  const verified = r1.verified && continuous.verified
    && r1.verificationScope === 'trusted-R1-rebuild-audit'
    && continuous.verificationScope === 'embedded-real-events';
  return Object.freeze({ version: 'TrustedHistoryContinuityAuditV1',
    sourcePath: `${r1.sourcePath}|${continuous.sourcePath}`,
    executedBodyResults: r1.executedBodyResults + continuous.executedBodyResults,
    realEventRecords: r1.realEventRecords + continuous.realEventRecords,
    recordsWithExplicitHierarchyContinuity: continuous.recordsWithExplicitHierarchyContinuity,
    invalidRealEventRecords: r1.invalidRealEventRecords + continuous.invalidRealEventRecords,
    duplicateRealEventRecords: r1.duplicateRealEventRecords + continuous.duplicateRealEventRecords,
    unmatchedExecutedBodyResults: r1.unmatchedExecutedBodyResults + continuous.unmatchedExecutedBodyResults,
    replayableR1Candidates: r1.replayableR1Candidates + continuous.replayableR1Candidates,
    replayableContinuousR2Events: continuous.replayableContinuousR2Events,
    sourceEventsSha256: sha([r1.sourceEventsSha256, continuous.sourceEventsSha256]),
    expectedSourceEventsSha256: sha([r1.expectedSourceEventsSha256, continuous.expectedSourceEventsSha256]),
    verified, verificationScope: verified ? 'trusted-R1-plus-embedded-real-events' : 'invalid',
    conclusion: continuous.replayableContinuousR2Events > 0 ? 'continuous-evidence-present' : 'R1-only',
    reason: verified ? 'verified-R1-rebuild-and-explicit-continuous-real-events'
      : 'R1-and-continuous-history-components-did-not-both-verify' });
}

function noteTransition(event: KairosV5DistributedPhysicalMemoryV3['r2']['events'][number],
  before: string, after: string): boolean {
  return (event.processChanges ?? event.terminalChanges).some(change => change.property === 'note'
    && String(change.before) === before && String(change.after) === after);
}

function gradeAtLeastPredictive(grade: string): boolean {
  return grade === 'predictive-stable' || grade === 'causal-hypothesis'
    || grade === 'intervention-supported';
}

function missingBaselineProvenanceAuditV1(): DistributedG6BaselineProvenanceAuditV1 {
  return Object.freeze({ version: 'DistributedG6BaselineProvenanceAuditV1', present: false,
    valid: false, producer: null, sourceId: null, sourceEventsSha256: null,
    blockers: Object.freeze(['distributed-g6-baseline-provenance-missing']) });
}

/**
 * Verify that a frozen G6 pointer was produced by one of the two bounded
 * baseline producers.  A self-consistent snapshot hash alone is insufficient:
 * it does not say which source event stream or producer contract created it.
 */
export function auditDistributedG6BaselineProvenanceV1(pointer: ExperiencePointer | null):
DistributedG6BaselineProvenanceAuditV1 {
  const provenance = pointer?.distributedG6Provenance;
  if (provenance === undefined) return missingBaselineProvenanceAuditV1();
  const blockers: string[] = [];
  try { validateDistributedG6ProvenanceV1(provenance); }
  catch (error) {
    blockers.push(error instanceof Error ? error.message : 'distributed-g6-baseline-provenance-invalid');
  }
  if (provenance.producer === 'trusted-r1-rebuild-v1') {
    if (provenance.producerIdentitySha256 !== DISTRIBUTED_G6_R1_REBUILD_PRODUCER_IDENTITY_V1)
      blockers.push('distributed-g6-r1-rebuild-producer-identity-mismatch');
    if (provenance.sourceId !== TRUSTED_ATTEMPT_018_SOURCE_V1.sourceId)
      blockers.push('distributed-g6-r1-rebuild-source-id-mismatch');
  } else if (provenance.producer === 'continuous-capture-v1') {
    if (provenance.producerIdentitySha256 !== DISTRIBUTED_G6_CONTINUOUS_CAPTURE_PRODUCER_IDENTITY_V1)
      blockers.push('distributed-g6-continuous-capture-producer-identity-mismatch');
    // Capture sourceId is a deterministic commitment over its plan and source
    // pointer, rather than a semantic label.
    if (!/^[a-f0-9]{64}$/.test(provenance.sourceId))
      blockers.push('distributed-g6-continuous-capture-source-id-invalid');
  }
  return Object.freeze({ version: 'DistributedG6BaselineProvenanceAuditV1', present: true,
    valid: blockers.length === 0, producer: provenance.producer, sourceId: provenance.sourceId,
    sourceEventsSha256: provenance.sourceEventsSha256, blockers: Object.freeze([...new Set(blockers)]) });
}

/** Structural and physical preflight only; it never trains or mutates a snapshot. */
export function auditDistributedG6BaselineV1(snapshot: unknown):
  DistributedG6BaselineAuditV1 {
  const blockers: string[] = [];
  const compatibleSnapshot = isObject(snapshot)
    && snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3;
  if (!compatibleSnapshot) return Object.freeze({ version: 'DistributedG6BaselineAuditV1',
    compatibleSnapshot: false, deterministicRestore: false, r1EventCount: 0,
    completeR2EventCount: 0, multiAtomR2EventCount: 0, noteZeroToOneR2Count: 0,
    noteOneToTwoR2Count: 0, predictiveStablePatternCount: 0,
    interventionSupportedRelationCount: 0, activeNoteOnePatternCount: 0,
    activeNoteTwoPatternCount: 0, activeLookConditionRelationCount: 0,
    readyForFrozenHeldout: false, blockers: Object.freeze([
      'snapshot-version-is-not-distributed-v2',
      'distributed-snapshot-did-not-restore-byte-equivalently',
    ]) });
  const distributed = snapshot as unknown as KairosV5DistributedPhysicalMemoryV3;
  let deterministicRestore = false;
  try {
    const before = sha(distributed);
    const restored = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(distributed));
    deterministicRestore = sha(restored.snapshot()) === before && sha(distributed) === before;
  } catch { deterministicRestore = false; }
  if (!deterministicRestore) blockers.push('distributed-snapshot-did-not-restore-byte-equivalently');
  const complete = distributed.r2.events.filter(event => event.completion === 'complete'
    && event.learningEligible && event.physicalFootprint !== null);
  const multiAtom = complete.filter(event => event.atomIds.length >= 2);
  const zeroToOne = complete.filter(event => noteTransition(event, '0', '1'));
  const oneToTwo = complete.filter(event => noteTransition(event, '1', '2'));
  const stablePatterns = distributed.r2a.patterns.filter(pattern => gradeAtLeastPredictive(pattern.grade));
  const interventionRelations = distributed.r2a.relations.filter(relation =>
    relation.grade === 'intervention-supported');
  const r1Medium = DistributedPhysicalMedium3DV1.fromSnapshot(distributed.r1Medium);
  const r2Medium = DistributedPhysicalMedium3DV1.fromSnapshot(distributed.r2Medium);
  const r2aMedium = DistributedPhysicalMedium3DV1.fromSnapshot(distributed.r2a.medium);
  const annotations = new Map(distributed.annotations.map(value => [value.eventId, value]));
  const physicallyActiveEvent = (event: typeof complete[number]) => Boolean(event.physicalFootprint
    && r2Medium.isFootprintActive(event.physicalFootprint)
    && event.sourceR1Footprints?.length === event.sourceEventIds.length
    && event.sourceR1Footprints.every(footprint => r1Medium.isFootprintActive(footprint)));
  const physicallyActiveProductionRelation = (patternId: string) => interventionRelations.some(relation =>
    relation.patternId === patternId
    && relation.physicalTraceIds.some(id => r2aMedium.isFootprintActive(id)));
  const activeNotePatterns = (before: string, after: string) => stablePatterns.filter(pattern => {
    const members = pattern.memberR2EventIds.map(id => complete.find(event => event.eventId === id))
      .filter((value): value is typeof complete[number] => Boolean(value));
    const memberHasTransition = members.some(event => noteTransition(event, before, after));
    const physicalPattern = pattern.physicalTraceIds.some(id => r2aMedium.isFootprintActive(id));
    return memberHasTransition && physicalPattern && physicallyActiveProductionRelation(pattern.patternId)
      && members.some(physicallyActiveEvent);
  });
  const activeNoteOnePatterns = activeNotePatterns('0', '1');
  const activeNoteTwoPatterns = activeNotePatterns('1', '2');
  const activeLookConditionRelations = interventionRelations.filter(relation => {
    if (!relation.physicalTraceIds.some(id => r2aMedium.isFootprintActive(id))) return false;
    const pattern = stablePatterns.find(value => value.patternId === relation.patternId);
    if (!pattern) return false;
    return pattern.memberR2EventIds.some(id => {
      const event = complete.find(value => value.eventId === id);
      return event?.sourceEventIds.some(sourceId => annotations.get(sourceId)?.cue.kind === 'look') ?? false;
    });
  });
  if (distributed.seenEventIds.length < 128) blockers.push('distributed-R1-has-fewer-than-128-real-events');
  if (multiAtom.length < 8) blockers.push('fewer-than-eight-complete-multi-R1-R2-events');
  if (zeroToOne.length === 0) blockers.push('missing-real-note-0-to-1-continuous-event');
  if (oneToTwo.length === 0) blockers.push('missing-real-note-1-to-2-continuous-event');
  if (activeNoteOnePatterns.length === 0) blockers.push('missing-active-predictive-note-1-pattern');
  if (activeNoteTwoPatterns.length === 0) blockers.push('missing-active-predictive-note-2-pattern');
  if (activeLookConditionRelations.length === 0)
    blockers.push('missing-active-intervention-supported-look-condition');
  return Object.freeze({ version: 'DistributedG6BaselineAuditV1', compatibleSnapshot,
    deterministicRestore, r1EventCount: distributed.seenEventIds.length,
    completeR2EventCount: complete.length, multiAtomR2EventCount: multiAtom.length,
    noteZeroToOneR2Count: zeroToOne.length, noteOneToTwoR2Count: oneToTwo.length,
    predictiveStablePatternCount: stablePatterns.length,
    interventionSupportedRelationCount: interventionRelations.length,
    activeNoteOnePatternCount: activeNoteOnePatterns.length,
    activeNoteTwoPatternCount: activeNoteTwoPatterns.length,
    activeLookConditionRelationCount: activeLookConditionRelations.length,
    readyForFrozenHeldout: blockers.length === 0, blockers: Object.freeze(blockers) });
}

export function distributedG6PreflightV1(gateStatus: DistributedNeutralGateStatusV1,
  snapshot: KairosV5DistributedPhysicalMemoryV3,
  history: TrustedHistoryContinuityAuditV1 | null,
  gateIdentity: DistributedGateIdentityAuditV1,
  baselineProvenance: DistributedG6BaselineProvenanceAuditV1 = missingBaselineProvenanceAuditV1()): DistributedG6PreflightV1 {
  const gatePassed = (['G0', 'G1', 'G2', 'G3', 'G4', 'G5'] as const)
    .every(id => gateStatus.gates[id]?.passed === true && gateStatus.gates[id].evidenceRefs.length > 0)
    && gateIdentity.passed;
  const baseline = auditDistributedG6BaselineV1(snapshot);
  const historyPassed = history?.verified === true
    && history.replayableR1Candidates >= baseline.r1EventCount
    && history.replayableContinuousR2Events >= baseline.completeR2EventCount;
  const passed = gatePassed && historyPassed && baseline.readyForFrozenHeldout
    && baselineProvenance.valid;
  const nextStep: DistributedG6PreflightV1['nextStep'] = !gatePassed ? 'complete-neutral-gates'
    : !historyPassed ? 'provide-verified-trusted-history'
      : !baseline.compatibleSnapshot ? 'provide-compatible-distributed-baseline'
        : !baseline.readyForFrozenHeldout ? 'capture-minimum-continuous-experience'
          : !baselineProvenance.valid ? 'provide-provenance-bound-baseline'
            : 'run-four-frozen-heldouts';
  const minimumCapture = nextStep === 'capture-minimum-continuous-experience' ? {
    realLayouts: 8 as const, completeContinuousEvents: 32 as const,
    atomsPerEvent: '3-or-4' as const, resetBetweenEvents: true as const,
    scoringLabelsWrittenToMedium: 0 as const,
    note: 'Guide complete look/interact/interact/observe-style processes and matched public contrasts; '
      + 'store only real frames, receipts and public continuity. Heldout receives only note=2.',
  } : null;
  return Object.freeze({ version: 'DistributedG6PreflightV1', passed, gateStatus,
    history, gateIdentity, baselineProvenance, baseline, nextStep, minimumCapture });
}

function noteTwoGoal(caseId: string, controlId: string): GroundedGoalV1 {
  return { version: 'GroundedGoalV1', id: `distributed-g6-note-two:${caseId}`, expression: {
    kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: 'public-note-is-two',
      subject: { kind: 'public-object', id: controlId, expectedType: 'note_block' },
      observable: 'properties.note', comparator: 'equals', target: '2' } } };
}

function noteValue(observation: Observation, controlId: string): string | null {
  const value = observation.objects.find(object => object.id === controlId)?.properties.note;
  return value === undefined || value === null ? null : String(value);
}

async function waitForUniqueNote(body: MinecraftBody, expected: string, ticks: number) {
  let first: number | null = null, id: string | null = null;
  for (let count = 0; count < 200; count++) {
    const observation = body.latest();
    const notes = observation.objects.filter(value => value.type === 'note_block');
    if (notes.length === 1 && String(notes[0]!.properties.note) === expected
      && (id === null || id === notes[0]!.id)) {
      first ??= observation.sequence; id ??= notes[0]!.id;
      if (observation.sequence - first >= ticks) return { controlId: id,
        firstSequence: first, confirmationSequence: observation.sequence };
    } else { first = null; id = null; }
    await body.waitTicks(1);
  }
  throw new Error('distributed-g6-unique-note-readiness-timeout');
}

async function baselineFiles(pointerPath: string) {
  const pointer = JSON.parse(await readFile(pointerPath, 'utf8')) as ExperiencePointer;
  const snapshotPath = resolve(dirname(pointerPath), pointer.filename);
  const habitPath = pointer.habitFilename ? resolve(dirname(pointerPath), pointer.habitFilename) : null;
  return { pointer, snapshotPath, habitPath, hashes: { pointer: await fileSha(pointerPath),
    snapshot: await fileSha(snapshotPath), habit: habitPath ? await fileSha(habitPath) : null } };
}

export interface MinecraftDistributedG6LiveResultV1 {
  readonly version: typeof MINECRAFT_DISTRIBUTED_G6_LIVE_V1;
  readonly status: 'preflight-blocked' | 'preflight-ready' | 'short-chain-passed' | 'short-chain-failed';
  readonly preflight: DistributedG6PreflightV1;
  readonly frozenSnapshotSha256: string;
  readonly heldouts: readonly { readonly caseId: string; readonly status: string;
    readonly actions: number; readonly noteVerifiedTwice: boolean;
    readonly onlyGroundedGoalInjected: true; readonly frozenBaselineUnchanged: boolean }[];
  readonly shortChainPassed: boolean;
  readonly multilevelUnlocked: boolean;
}

export interface MinecraftDistributedG6LiveOptionsV1 {
  readonly experiencePointerPath: string;
  readonly gateStatus: DistributedNeutralGateStatusV1;
  readonly gateIdentity: DistributedGateIdentityAuditV1;
  readonly history: TrustedHistoryContinuityAuditV1 | null;
  readonly preflightOnly?: boolean;
}

export function distributedG6MultilevelGateV1(shortChainResult: Pick<MinecraftDistributedG6LiveResultV1,
  'shortChainPassed' | 'heldouts'>) {
  const unlocked = shortChainResult.shortChainPassed && shortChainResult.heldouts.length === 4
    && shortChainResult.heldouts.every(value => value.status === 'goal-verified'
      && value.noteVerifiedTwice && value.frozenBaselineUnchanged);
  return Object.freeze({ version: 'DistributedG6MultilevelGateV1' as const, unlocked,
    prerequisiteResultSha256: sha(shortChainResult),
    prerequisite: 'distributed-note-two-short-chain-4-of-4' as const });
}

/**
 * Runs exactly one frozen four-layout batch.  Fixture setup occurs before goal
 * injection.  After injection the evaluator supplies no action, subgoal,
 * condition label or expected sequence to the controller.
 */
export async function runMinecraftDistributedG6LiveV1(config: Configuration, evidence: string,
  options: MinecraftDistributedG6LiveOptionsV1): Promise<MinecraftDistributedG6LiveResultV1> {
  await mkdir(dirname(evidence), { recursive: true });
  await mkdir(evidence, { recursive: false });
  const source = await baselineFiles(options.experiencePointerPath);
  const rawSnapshot: unknown = JSON.parse(await readFile(source.snapshotPath, 'utf8'));
  const baselineProvenance = auditDistributedG6BaselineProvenanceV1(source.pointer);
  const preflight = distributedG6PreflightV1(options.gateStatus,
    rawSnapshot as KairosV5DistributedPhysicalMemoryV3, options.history,
    options.gateIdentity, baselineProvenance);
  await saveJson(resolve(evidence, 'G6_PREFLIGHT.json'), preflight);
  await saveJson(resolve(evidence, 'FROZEN_BASELINE_IDENTITY.json'), {
    pointerPath: options.experiencePointerPath,
    snapshotVersion: isObject(rawSnapshot) ? rawSnapshot.version ?? null : null,
    snapshotSha256: sha(rawSnapshot), sourceFileHashes: source.hashes,
    trustedHistoryVerified: options.history?.verified === true,
    trustedHistoryVerificationScope: options.history?.verificationScope ?? null,
    sourceBoundR1Records: isObject(rawSnapshot) && Array.isArray(rawSnapshot.annotations)
      ? rawSnapshot.annotations.filter(annotation => isObject(annotation) && isObject(annotation.r1Record)
        && typeof annotation.r1Record.eventSha256 === 'string').length : null,
    continuityQualification: isObject(rawSnapshot) && isObject(rawSnapshot.r2)
      && Array.isArray(rawSnapshot.r2.events) && rawSnapshot.r2.events.length === 0
      ? 'R1-only-new-continuous-capture-required' : 'contains-verified-continuous-events',
  });
  if (!preflight.passed || options.preflightOnly) {
    const result: MinecraftDistributedG6LiveResultV1 = { version: MINECRAFT_DISTRIBUTED_G6_LIVE_V1,
      status: preflight.passed ? 'preflight-ready' : 'preflight-blocked', preflight,
      frozenSnapshotSha256: sha(rawSnapshot), heldouts: [],
      shortChainPassed: false, multilevelUnlocked: false };
    await saveJson(resolve(evidence, 'RESULT.json'), result);
    return result;
  }
  assert(preflight.baseline.compatibleSnapshot,
    'distributed-g6-preflight-passed-with-incompatible-snapshot');
  const snapshot = rawSnapshot as KairosV5DistributedPhysicalMemoryV3;
  const services = new Services(config, resolve(config.runtimeRoot,
    `distributed-g6-note-short-chain-${Date.now()}`), evidence);
  const heldouts: MinecraftDistributedG6LiveResultV1['heldouts'][number][] = [];
  try {
    await services.start('empty');
    services.command('gamerule spawnRadius 0'); services.command('gamerule doDaylightCycle false');
    services.command('gamerule doWeatherCycle false'); services.command('gamerule doMobSpawning false');
    services.command('time set noon'); services.command('forceload add 400 400 464 464');
    for (const heldout of DISTRIBUTED_G6_NOTE_TWO_HELDOUTS_V1) {
      const caseEvidence = resolve(evidence, heldout.caseId); await mkdir(caseEvidence);
      const eventStream = createWriteStream(resolve(caseEvidence, 'events.jsonl'), { flags: 'wx' });
      const frameStream = createWriteStream(resolve(caseEvidence, 'frames.jsonl'), { flags: 'wx' });
      const record = (kind: string, value: unknown): void => {
        (kind === 'frame' ? frameStream : eventStream).write(canonical({ kind, value }) + '\n');
      };
      const compute = new Compute();
      const restored = await restoreExperience(compute, options.experiencePointerPath);
      assert(restored && restored.snapshot.version === DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
        'distributed-g6-baseline-restore-failed');
      assert(canonical(restored.habit.exportCheckpoint())
        === canonical(new ControlHabitWeightsV1().exportCheckpoint()),
      'distributed-g6-heldout-requires-empty-habit-weights');
      const body = new MinecraftBody({ ...config.minecraft, worldId: heldout.caseId,
        sessionId: heldout.caseId, activeSecondsOffset: snapshot.activeSeconds }, record);
      let runtime: V5Runtime | null = null;
      let viewer: Awaited<ReturnType<typeof startLoopbackMineflayerViewerV1>> | null = null;
      let dashboard: Server | null = null;
      try {
        await body.ready();
        await prepareGuidedNoteFixtureLiveV1(services, body, heldout.layout, 0,
          heldout.yawOffsetDegrees, { clearRadius: 10 });
        const readiness = await waitForUniqueNote(body, '0', 5);
        const goal = noteTwoGoal(heldout.caseId, readiness.controlId);
        runtime = new V5Runtime(body, { ...config, actionBudget: heldout.actionBudget }, caseEvidence,
          record, { compute, restoredExperience: restored });
        if (config.viewer.enabled) {
          viewer = await startLoopbackMineflayerViewerV1(body.bot, { host: config.viewer.host,
            port: config.viewer.port, firstPerson: true, viewDistance: 3 });
          dashboard = await startDashboard(runtime, config.viewer.dashboardPort);
          record('viewer-endpoint', { firstPerson: viewer.url,
            dashboard: `http://${config.viewer.host}:${config.viewer.dashboardPort}/`, readOnly: true });
        }
        record('distributed-g6-goal-injection', { goal,
          injectedControlSequence: null, injectedSubgoals: 0, injectedActionHints: 0 });
        const run = await runtime.runGoal(goal);
        const first = body.latest(); await body.waitTicks(5); const second = body.latest();
        const noteVerifiedTwice = noteValue(first, readiness.controlId) === '2'
          && noteValue(second, readiness.controlId) === '2';
        await runtime.save();
        const currentHashes = { pointer: await fileSha(options.experiencePointerPath),
          snapshot: await fileSha(source.snapshotPath),
          habit: source.habitPath ? await fileSha(source.habitPath) : null };
        const frozenBaselineUnchanged = canonical(currentHashes) === canonical(source.hashes);
        heldouts.push({ caseId: heldout.caseId, status: run.status, actions: run.actions,
          noteVerifiedTwice, onlyGroundedGoalInjected: true, frozenBaselineUnchanged });
      } finally {
        await viewer?.close();
        if (dashboard) await new Promise<void>(done => dashboard!.close(() => done()));
        if (runtime) await runtime.close(); else { await body.close(); await compute.close(); }
        await Promise.all([new Promise<void>(done => eventStream.end(done)),
          new Promise<void>(done => frameStream.end(done))]);
      }
    }
  } finally { await services.stop(); }
  const shortChainPassed = heldouts.length === 4 && heldouts.every(value =>
    value.status === 'goal-verified' && value.noteVerifiedTwice && value.frozenBaselineUnchanged);
  const result: MinecraftDistributedG6LiveResultV1 = { version: MINECRAFT_DISTRIBUTED_G6_LIVE_V1,
    status: shortChainPassed ? 'short-chain-passed' : 'short-chain-failed', preflight,
    frozenSnapshotSha256: sha(snapshot), heldouts: Object.freeze(heldouts), shortChainPassed,
    // A future 12-layout entry must consume this result, never bypass it.
    multilevelUnlocked: shortChainPassed };
  await saveJson(resolve(evidence, 'RESULT.json'), result);
  await saveJson(resolve(evidence, 'MULTILEVEL_GATE.json'), distributedG6MultilevelGateV1(result));
  return result;
}
