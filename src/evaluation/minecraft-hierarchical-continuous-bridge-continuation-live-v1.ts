import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { MinecraftBody } from '../body.js';
import { Compute } from '../compute.js';
import { rebuildHierarchicalUpperLayersV1,
  HIERARCHICAL_MEMORY_SEMANTICS_V1,
  HIERARCHICAL_MEMORY_VERSION_V1,
  type HierarchicalMemorySnapshotV1 } from '../hierarchical-memory.js';
import { Services, type Configuration } from '../services.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';
import {
  auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1,
  minecraftHierarchicalContinuousBridgeCurriculumLiveV1,
  runMinecraftHierarchicalContinuousBridgeCurriculumLiveV1,
  type ContinuousBridgeFixtureCommandPortLiveV1,
} from './minecraft-hierarchical-continuous-bridge-curriculum-live-v1.js';
import { minecraftMultilevelGuidedGlobalCommandsLiveV1 }
  from './minecraft-multilevel-guided-training-live-v1.js';
import { minecraftHierarchicalMultilevelQualificationGateLiveV1,
  type MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1,
  type MinecraftHierarchicalMultilevelQualificationResultLiveV1,
} from './minecraft-hierarchical-multilevel-goal-chain-live-v1.js';

export const MINECRAFT_HIERARCHICAL_CONTINUOUS_BRIDGE_CONTINUATION_LIVE_V1 =
  'MinecraftHierarchicalContinuousBridgeContinuationLiveV1' as const;

class ContinuationFixtureCommandsLiveV1 implements ContinuousBridgeFixtureCommandPortLiveV1 {
  #count = 0;
  readonly #forced = new Set<string>();
  constructor(readonly services: Services) {}
  command(command: string): void { this.services.command(command); this.#count++; }
  ensureLoaded(originX: number, originZ: number): boolean {
    const command = `forceload add ${originX - 16} ${originZ - 16} ${originX + 16} ${originZ + 16}`;
    if (this.#forced.has(command)) return false;
    this.command(command); this.#forced.add(command); return true;
  }
  get count(): number { return this.#count; }
}

async function closeStreams(streams: readonly ReturnType<typeof createWriteStream>[]) {
  await Promise.all(streams.map(stream => new Promise<void>((done, reject) => {
    stream.once('error', reject); stream.end(done);
  })));
}

type SourceGateFilesLiveV1 = {
  readonly snapshotPath: string;
  readonly probesPath: string;
  readonly gateEvidencePath: string;
  readonly gateResultPath: string;
  readonly roleAuditPath: string;
  readonly protocolPath: string;
};

type LegacyHierarchicalMemoryV10AuditSnapshot = Omit<HierarchicalMemorySnapshotV1,
  'version' | 'hierarchy' | 'r2a'> & {
  readonly version: 'KairosV5HierarchicalMemoryV10';
  readonly hierarchy: string;
  readonly r2a: unknown;
};

async function verifySourceGate(sourceDirectory: string): Promise<{
  readonly frozen: LegacyHierarchicalMemoryV10AuditSnapshot;
  readonly gateEvidence: MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1;
  readonly gateResult: MinecraftHierarchicalMultilevelQualificationResultLiveV1;
  readonly files: SourceGateFilesLiveV1;
  readonly fileSha256: Readonly<Record<keyof SourceGateFilesLiveV1, string>>;
}> {
  const files: SourceGateFilesLiveV1 = {
    snapshotPath: resolve(sourceDirectory, 'REBUILT_ROLE_BOUND_HIERARCHICAL_EXPERIENCE.json'),
    probesPath: resolve(sourceDirectory, 'GATE_D_PROBES.json'),
    gateEvidencePath: resolve(sourceDirectory, 'GATE_D_EVIDENCE.json'),
    gateResultPath: resolve(sourceDirectory, 'GATE_D_RESULT.json'),
    roleAuditPath: resolve(sourceDirectory, 'ROLE_BINDING_REBUILD_AUDIT.json'),
    protocolPath: resolve(sourceDirectory, 'RUN_PROTOCOL.json'),
  };
  const parse = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
  const [frozen, gateEvidence, gateResult, roleAudit] = await Promise.all([
    parse<LegacyHierarchicalMemoryV10AuditSnapshot>(files.snapshotPath),
    parse<MinecraftHierarchicalMultilevelQualificationEvidenceLiveV1>(files.gateEvidencePath),
    parse<MinecraftHierarchicalMultilevelQualificationResultLiveV1>(files.gateResultPath),
    parse<{ readonly physicalSectionsUnchanged?: boolean; readonly rebuiltSnapshotSha256?: string }>(
      files.roleAuditPath),
  ]);
  assert(frozen.version === 'KairosV5HierarchicalMemoryV10'
    && frozen.hierarchy
      === 'R1-atom-with-public-transition-compatibility-and-audit_R2-continuous-event-corridor_R2A-branch-indexed-stable-pattern_R3-current-query'
    && frozen.annotations.length === 368 && frozen.writes === 368
    && frozen.r2Store.events.length === 168,
  'continuous-bridge-source-is-not-V10-368-168');
  assert(roleAudit.physicalSectionsUnchanged === true
    && roleAudit.rebuiltSnapshotSha256 === sha(frozen),
  'continuous-bridge-role-binding-rebuild-not-verified');
  const recomputed = minecraftHierarchicalMultilevelQualificationGateLiveV1(gateEvidence);
  assert(canonical(recomputed) === canonical(gateResult) && !gateResult.passed
    && gateEvidence.queryChangedSnapshot === false,
  'continuous-bridge-source-gate-is-not-sealed-failure');
  assert(gateResult.failures.length > 0 && gateResult.failures.every(value =>
    value.startsWith('production-arm-unqualified:')
      || value.startsWith('contrast-arm-unqualified:')
      || value.startsWith('factor-transition-bridge-unqualified:')),
  'continuous-bridge-source-gate-failure-not-remediable-by-foundation');
  const fileSha256 = Object.fromEntries(await Promise.all(
    Object.entries(files).map(async ([key, path]) => [key, await fileSha(path)])),
  ) as Readonly<Record<keyof SourceGateFilesLiveV1, string>>;
  return { frozen, gateEvidence, gateResult, files, fileSha256 };
}

export interface MinecraftHierarchicalContinuousBridgeContinuationResultLiveV1 {
  readonly version: typeof MINECRAFT_HIERARCHICAL_CONTINUOUS_BRIDGE_CONTINUATION_LIVE_V1;
  readonly passed: boolean;
  readonly sourceSnapshotSha256: string;
  readonly finalSnapshotSha256: string;
  readonly finalR1Atoms: number;
  readonly finalR2Events: number;
  readonly realTrainingActions: number;
  readonly heldoutActions: 0;
  readonly gateQueriesDuringMinecraftConnection: 0;
}

/**
 * Continue only the missing guided local-transition foundation.  It never
 * runs a qualification query or a heldout goal while Minecraft is connected.
 */
export async function runMinecraftHierarchicalContinuousBridgeContinuationLiveV1(
  config: Configuration, evidenceDirectory: string, sourceDirectory: string,
): Promise<MinecraftHierarchicalContinuousBridgeContinuationResultLiveV1> {
  assert(isAbsolute(evidenceDirectory) && isAbsolute(sourceDirectory),
    'continuous-bridge-paths-must-be-absolute');
  await mkdir(evidenceDirectory);
  const source = await verifySourceGate(sourceDirectory);
  // The historical R2/R2A and intervention ledger were produced by the
  // retired immediate-result semantics.  Preserve them as source audit files,
  // but rebuild the new upper hierarchy solely from immutable R1 facts.
  const legacySource = structuredClone(source.frozen);
  const cleanSourceInput: HierarchicalMemorySnapshotV1 = {
    ...legacySource,
    version: HIERARCHICAL_MEMORY_VERSION_V1,
    hierarchy: HIERARCHICAL_MEMORY_SEMANTICS_V1,
    // V10 R2/R2A state is audit-only.  The immutable R1 ledger below is the
    // sole source of the new V11 upper layers.
    r2a: null,
    hierarchyInterventionLedger: [],
  };
  const rebuiltUpper = rebuildHierarchicalUpperLayersV1(cleanSourceInput);
  const runSource: HierarchicalMemorySnapshotV1 = {
    ...cleanSourceInput, r2Store: rebuiltUpper.r2Store, r2a: rebuiltUpper.r2a,
  };
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  const planAudit = auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(plan);
  await saveJson(resolve(evidenceDirectory, 'RUN_PROTOCOL.json'), { version:
    MINECRAFT_HIERARCHICAL_CONTINUOUS_BRIDGE_CONTINUATION_LIVE_V1,
  sourceDirectory, historicalSourceSnapshotSha256: sha(source.frozen),
  sourceSnapshotSha256: sha(runSource), oldUpperLayerInterventionsReplayed: 0,
  sourceGateResult: source.gateResult,
  curriculum: plan, curriculumAudit: planAudit, heldoutActions: 0,
  gateQueriesDuringMinecraftConnection: 0 });
  await saveJson(resolve(evidenceDirectory, 'SOURCE_CHECKPOINT_MANIFEST.json'), {
    version: 'ContinuousBridgeSourceCheckpointManifestV1', sourceDirectory,
    files: source.files, fileSha256: source.fileSha256,
    historicalSourceSnapshotCanonicalSha256: sha(source.frozen),
    cleanRebuiltSourceSnapshotCanonicalSha256: sha(runSource),
    ignoredHistoricalInterventionLedgerRecords: source.frozen.hierarchyInterventionLedger.length,
    sourceGateResult: source.gateResult,
  });
  await saveJson(resolve(evidenceDirectory, 'CLEAN_REBUILT_SOURCE_HIERARCHICAL_EXPERIENCE.json'),
    runSource);
  const events = createWriteStream(resolve(evidenceDirectory, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidenceDirectory, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown): void => {
    (kind === 'frame' ? frames : events).write(canonical({ kind, value }) + '\n');
  };
  const services = new Services(config, resolve(config.runtimeRoot,
    `hierarchical-continuous-bridge-${Date.now()}`), evidenceDirectory);
  let body: MinecraftBody | null = null;
  let compute: Compute | null = null;
  try {
    await services.start('empty');
    const commands = new ContinuationFixtureCommandsLiveV1(services);
    for (const command of minecraftMultilevelGuidedGlobalCommandsLiveV1().commands)
      commands.command(command);
    body = new MinecraftBody({ ...config.minecraft,
      worldId: 'hierarchical-continuous-bridge-training-v1',
      sessionId: 'hierarchical-continuous-bridge-training-v1',
      activeSecondsOffset: runSource.activeSeconds }, record);
    await body.ready(); await body.waitTicks(20);
    compute = new Compute(); await compute.call('restore', runSource);
    assert(await compute.call<string>('hash') === sha(runSource),
      'continuous-bridge-source-worker-restore-mismatch');
    const execution = await runMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(
      compute, body, commands);
    const finalSnapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
    assert(execution.audit.passed && finalSnapshot.annotations.length === 772
      && finalSnapshot.writes === 772 && finalSnapshot.r2Store.events.length === 312,
    'continuous-bridge-final-snapshot-cardinality-invalid');
    await saveJson(resolve(evidenceDirectory, 'CONTINUOUS_BRIDGE_EXECUTION.json'), execution);
    const frozenPath = resolve(evidenceDirectory,
      'POST_CURRICULUM_FROZEN_HIERARCHICAL_EXPERIENCE.json');
    await saveJson(frozenPath, finalSnapshot);
    const sourceFileShaAfter = Object.fromEntries(await Promise.all(Object.entries(source.files)
      .map(async ([key, path]) => [key, await fileSha(path)])));
    assert(canonical(sourceFileShaAfter) === canonical(source.fileSha256),
      'continuous-bridge-source-checkpoint-mutated');
    const result: MinecraftHierarchicalContinuousBridgeContinuationResultLiveV1 = Object.freeze({
      version: MINECRAFT_HIERARCHICAL_CONTINUOUS_BRIDGE_CONTINUATION_LIVE_V1,
      passed: true, sourceSnapshotSha256: sha(runSource),
      finalSnapshotSha256: sha(finalSnapshot), finalR1Atoms: 772, finalR2Events: 312,
      realTrainingActions: 404, heldoutActions: 0, gateQueriesDuringMinecraftConnection: 0 });
    await saveJson(resolve(evidenceDirectory, 'POST_CURRICULUM_FREEZE_MANIFEST.json'), {
      version: 'PostCurriculumFreezeManifestV1', result,
      finalSnapshotFileSha256: await fileSha(frozenPath),
      finalSnapshotCanonicalSha256: sha(finalSnapshot), sourceFileShaBefore: source.fileSha256,
      sourceFileShaAfter, commandCount: commands.count, servicesConnectedDuringGate: false,
    });
    await saveJson(resolve(evidenceDirectory, 'RESULT.json'), result);
    return result;
  } catch (error) {
    await saveJson(resolve(evidenceDirectory, 'RUN_FAILURE.json'), {
      version: 'ContinuousBridgeContinuationFailureV1',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    throw error;
  } finally {
    await body?.close().catch(() => undefined);
    await compute?.close().catch(() => undefined);
    await services.stop().catch(() => undefined);
    await closeStreams([events, frames]);
  }
}
