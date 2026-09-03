import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadConfiguration } from '../dist/src/services.js';
import { auditDistributedGateIdentityV1, auditTrustedHistoryContinuityV1,
  auditTrustedR1RebuildHistoryV1, combineTrustedHistoryAuditsV1,
  runMinecraftDistributedG6LiveV1 } from
  '../dist/src/evaluation/minecraft-distributed-g6-live-v1.js';

// Required:
//   KAIROS_DISTRIBUTED_G6_EXPERIENCE_POINTER=<absolute new V1 CURRENT pointer>
//   KAIROS_DISTRIBUTED_G6_NEUTRAL_GATES=<absolute DistributedNeutralGateStatusV1 JSON>
//   KAIROS_DISTRIBUTED_G6_GATE_EVIDENCE_MANIFEST=<absolute gate evidence manifest JSON>
//   KAIROS_DISTRIBUTED_G6_TRUSTED_R1_REBUILD_AUDIT=<absolute REBUILD_AUDIT.json>
//   KAIROS_DISTRIBUTED_G6_EVIDENCE_NAME=g6-note-two-short-chain-attempt-NNN
// Optional only after the missing continuous-capture runner has produced it:
//   KAIROS_DISTRIBUTED_G6_CONTINUOUS_HISTORY_EVENTS=<absolute wrapped real events JSONL>
//   KAIROS_DISTRIBUTED_G6_CONTINUOUS_HISTORY_SHA256=<frozen SHA-256 of that JSONL>
// Default is preflight-only. Set KAIROS_DISTRIBUTED_G6_MODE=live only after
// the emitted G6_PREFLIGHT.json passes. The script never trains a baseline.

const project = resolve(import.meta.dirname, '..');
process.chdir(project);

function requiredAbsolute(name) {
  const value = process.env[name];
  if (!value || !isAbsolute(value)) throw new Error(`${name}-absolute-path-required`);
  return value;
}

const pointer = requiredAbsolute('KAIROS_DISTRIBUTED_G6_EXPERIENCE_POINTER');
const gatesPath = requiredAbsolute('KAIROS_DISTRIBUTED_G6_NEUTRAL_GATES');
const gateManifestPath = requiredAbsolute('KAIROS_DISTRIBUTED_G6_GATE_EVIDENCE_MANIFEST');
const r1RebuildAuditPath = requiredAbsolute('KAIROS_DISTRIBUTED_G6_TRUSTED_R1_REBUILD_AUDIT');
const evidenceName = process.env.KAIROS_DISTRIBUTED_G6_EVIDENCE_NAME;
if (!/^g6-note-two-short-chain-attempt-[0-9]{3}$/.test(evidenceName ?? ''))
  throw new Error('KAIROS_DISTRIBUTED_G6_EVIDENCE_NAME-invalid');
const evidenceRoot = resolve(project, 'evidence', 'distributed-physical-medium-v1');
const evidence = resolve(evidenceRoot, evidenceName);
if (relative(evidenceRoot, evidence).startsWith('..')) throw new Error('g6-evidence-path-escaped-root');

const gateStatus = JSON.parse(await readFile(gatesPath, 'utf8'));
if (gateStatus?.version !== 'DistributedNeutralGateStatusV1')
  throw new Error('distributed-neutral-gate-status-v1-required');
const gateIdentity = await auditDistributedGateIdentityV1(project, gateStatus, gateManifestPath);
const r1History = await auditTrustedR1RebuildHistoryV1(r1RebuildAuditPath);
const continuousHistoryPath = process.env.KAIROS_DISTRIBUTED_G6_CONTINUOUS_HISTORY_EVENTS;
const continuousHistorySha256 = process.env.KAIROS_DISTRIBUTED_G6_CONTINUOUS_HISTORY_SHA256;
if ((continuousHistoryPath === undefined) !== (continuousHistorySha256 === undefined))
  throw new Error('distributed-G6-continuous-history-path-and-sha-required-together');
if (continuousHistorySha256 !== undefined && !/^[a-f0-9]{64}$/.test(continuousHistorySha256))
  throw new Error('distributed-G6-continuous-history-sha256-invalid');
const history = continuousHistoryPath
  ? combineTrustedHistoryAuditsV1(r1History, await auditTrustedHistoryContinuityV1(requiredAbsolute(
    'KAIROS_DISTRIBUTED_G6_CONTINUOUS_HISTORY_EVENTS'), continuousHistorySha256)) : r1History;
const config = await loadConfiguration();
const result = await runMinecraftDistributedG6LiveV1(config, evidence, {
  experiencePointerPath: pointer,
  gateStatus,
  gateIdentity,
  history,
  preflightOnly: process.env.KAIROS_DISTRIBUTED_G6_MODE !== 'live',
});
console.log(JSON.stringify(result));
if (result.status === 'preflight-blocked' || result.status === 'short-chain-failed') process.exitCode = 2;
