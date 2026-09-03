import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditDistributedGateIdentityV1, computeDistributedProductionSourceIdentityV1,
  type DistributedNeutralGateEvidenceManifestV1, type DistributedNeutralGateStatusV1,
  type DistributedProductionSourceIdentityV1 }
  from '../src/evaluation/minecraft-distributed-g6-live-v1.js';
import { fileSha } from '../src/util.js';

test('gate audit binds every passed gate evidence file to the declared current source identity', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.distributed-gate-identity-'));
  try {
    await mkdir(resolve(root, 'evidence'));
    const current: DistributedProductionSourceIdentityV1 = { version: 'DistributedProductionSourceIdentityV1',
      entrypoints: ['src/main.ts'], files: [{ path: 'src/main.ts', sha256: '1'.repeat(64) }],
      sha256: '2'.repeat(64) };
    const gateIds = ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'] as const;
    const manifestGates: Record<string, { evidence: { ref: string; path: string; sha256: string }[] }> = {};
    for (const id of gateIds) {
      const path = resolve(root, 'evidence', `${id}.json`); await writeFile(path, JSON.stringify({ id, passed: true }));
      manifestGates[id] = { evidence: [{ ref: `${id}.json`, path: `evidence/${id}.json`,
        sha256: await fileSha(path) }] };
    }
    const manifest: DistributedNeutralGateEvidenceManifestV1 = {
      version: 'DistributedNeutralGateEvidenceManifestV1', sourceIdentitySha256: current.sha256,
      gates: manifestGates as unknown as DistributedNeutralGateEvidenceManifestV1['gates'],
    };
    const manifestPath = resolve(root, 'MANIFEST.json'); await writeFile(manifestPath, JSON.stringify(manifest));
    const status: DistributedNeutralGateStatusV1 = { version: 'DistributedNeutralGateStatusV1',
      sourceIdentitySha256: current.sha256, evidenceManifestSha256: await fileSha(manifestPath),
      gates: Object.fromEntries(gateIds.map(id => [id, { passed: true,
        evidenceRefs: [`${id}.json`] }])) as unknown as DistributedNeutralGateStatusV1['gates'] };
    const audit = await auditDistributedGateIdentityV1(root, status, manifestPath, current);
    assert.equal(audit.passed, true);
    assert.equal(audit.verifiedEvidenceRefs.length, 6);
    await writeFile(resolve(root, 'evidence', 'G3.json'), JSON.stringify({ id: 'G3', passed: false }));
    const changedEvidence = await auditDistributedGateIdentityV1(root, status, manifestPath, current);
    assert.equal(changedEvidence.passed, false);
    assert.ok(changedEvidence.blockers.includes('distributed-gate-evidence-hash-mismatch:G3.json'));
    const wrong = await auditDistributedGateIdentityV1(root,
      { ...status, sourceIdentitySha256: '3'.repeat(64) }, manifestPath, current);
    assert.equal(wrong.passed, false);
    assert.ok(wrong.blockers.includes(
      'distributed-gate-source-identity-does-not-match-current-production-closure'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('production identity follows the actual G6 runtime dependency closure', async () => {
  const identity = await computeDistributedProductionSourceIdentityV1(resolve('.'));
  const paths = new Set(identity.files.map(value => value.path));
  assert.ok(paths.has('src/main.ts'));
  assert.ok(paths.has('src/worker.ts'));
  assert.ok(paths.has('src/distributed-hierarchical-memory.ts'));
  assert.ok(paths.has('src/control/controller.ts'));
  assert.ok(paths.has('kairos.config.json'));
  assert.ok(paths.has('package-lock.json'));
  assert.match(identity.sha256, /^[a-f0-9]{64}$/);
});
