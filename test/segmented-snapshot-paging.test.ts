import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Compute } from '../src/compute.js';
import { restoreExperience, V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { canonical, sha } from '../src/util.js';
import { canonicalStreamSha256, writeSegmentedCanonicalFileSync,
  type CanonicalPagedNodeV1, type SegmentedCanonicalManifestV1 } from '../src/util-stream.js';
import type { Configuration } from '../src/services.js';
import type { MinecraftBody } from '../src/body.js';
import type { JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import type { KairosV5DistributedPhysicalMemoryV3 } from '../src/distributed-hierarchical-memory.js';
import { SyntheticBody } from './synthetic-body.js';

const control: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 20260831, branchCapacity: 8, stepSize: .02,
  noiseSigma: .01, maximumIntegrationSteps: 500, winnerThreshold: .65, winnerMargin: .10,
  winnerPersistenceSteps: 20, inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

function testConfig(segmentThresholdBytes: number, segmentLimitBytes: number,
  segmentPageLimitBytes: number): Configuration {
  return { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 8, initializationEvents: 128, control,
    viewer: { enabled: false, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
    evidence: { snapshotEveryEvents: 4, attentionRecordEveryWindows: 5, attentionScoreEpsilon: .1,
      segmentThresholdBytes, segmentLimitBytes, segmentPageLimitBytes },
  } as Configuration;
}

async function saveOneEventBundle(directory: string, segmentThresholdBytes: number,
  segmentLimitBytes: number, segmentPageLimitBytes: number): Promise<ExperiencePointer> {
  const compute = new Compute();
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    runtime = new V5Runtime(body as unknown as MinecraftBody,
      testConfig(segmentThresholdBytes, segmentLimitBytes, segmentPageLimitBytes),
      directory, () => {}, { compute, mediaStatistics: false });
    const offer = runtime.listActionOffers(body.latest())[0]!;
    const result = await runtime.executeOffer(offer,
      { version: 'ActionObservationScopeV1', referencedPublicObjectIds: [] });
    assert.equal(result.executed, true);
    await runtime.save();
  } finally {
    if (runtime) await runtime.close();
    await compute.close();
  }
  return JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
}

function syntheticSnapshot(entries: number, entryWidth: number): Record<string, unknown> {
  return { version: 'KairosV5SegmentedPagingTestV1', seenEventIds: ['event-1'], writes: 1,
    big: Array.from({ length: entries }, (_unused, index) =>
      `entry-${String(index).padStart(4, '0')}-${'x'.repeat(entryWidth)}`),
    bigObject: Object.fromEntries(Array.from({ length: entries }, (_unused, index) =>
      [`key${String(index).padStart(4, '0')}`, { value: index, padding: 'y'.repeat(entryWidth) }])),
    nested: { deep: Array.from({ length: entries },
      (_unused, index) => ({ index, block: 'z'.repeat(entryWidth * 4) })) },
    small: ['kept'] };
}

/** Independent reassembly walk used to check the writer's page tree. */
async function readTree(directory: string, stem: string, node: CanonicalPagedNodeV1): Promise<unknown> {
  if (node.kind === 'leaf') {
    return JSON.parse(await readFile(resolve(directory, `${stem}.segments`, node.filename), 'utf8'));
  }
  if (node.kind === 'array') {
    const merged: unknown[] = [];
    for (const { count, child } of node.children) {
      const value = await readTree(directory, stem, child);
      if (child.kind === 'leaf') merged.push(...value as unknown[]);
      else { assert.equal(count, 1); merged.push(value); }
    }
    return merged;
  }
  const merged: Record<string, unknown> = {};
  for (const { keys, child } of node.children) {
    const value = await readTree(directory, stem, child);
    if (child.kind === 'leaf') Object.assign(merged, value as Record<string, unknown>);
    else { assert.equal(keys.length, 1); merged[keys[0]!] = value; }
  }
  return merged;
}

test('an oversized section becomes a recursive page tree with unchanged canonical identity', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-paged-unit-'));
  try {
    const snapshot = syntheticSnapshot(200, 60);
    const { manifest } = writeSegmentedCanonicalFileSync(directory, 'experience-0001.json',
      snapshot as never, { segmentLimitBytes: 2048, pageLimitBytes: 512 });
    assert.equal(manifest.sha256, sha(snapshot), 'full-stream identity is the single-file hash');
    const paged = manifest.segments.filter(segment => segment.paged !== undefined);
    assert(paged.length >= 2, 'array and object sections both paged');
    for (const segment of paged) {
      const reassembled = await readTree(directory, 'experience-0001', segment.paged!);
      assert.equal(canonicalStreamSha256(reassembled), segment.sha256);
      assert.equal(canonical(reassembled), canonical((snapshot as never)[segment.name]),
        'the page tree reproduces the exact canonical section');
    }
    const small = manifest.segments.find(segment => segment.name === 'small')!;
    assert.equal(small.paged, undefined, 'small sections stay single-file');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('oversized primitives fail closed at both levels', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-paged-element-'));
  try {
    const hugeElement = { version: 'KairosV5SegmentedPagingTestV1', seenEventIds: ['e'], writes: 1,
      big: ['x'.repeat(8192)] };
    assert.throws(() => writeSegmentedCanonicalFileSync(directory, 'experience-0001.json',
      hugeElement as never, { segmentLimitBytes: 2048, pageLimitBytes: 512 }),
    /snapshot-page-element-exceeds-restore-limit/);
    const primitive = { version: 'KairosV5SegmentedPagingTestV1', seenEventIds: ['e'], writes: 1,
      big: 'x'.repeat(8192) };
    assert.throws(() => writeSegmentedCanonicalFileSync(directory, 'experience-0002.json',
      primitive as never, { segmentLimitBytes: 2048, pageLimitBytes: 512 }),
    /snapshot-segment-not-pageable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a paged snapshot restores through the production gate; page corruption fails loudly', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-paged-restore-'));
  let compute2: Compute | null = null;
  try {
    const pointer = await saveOneEventBundle(directory, 1024, 8192, 16384);
    assert(pointer.manifestSha256 !== undefined, 'forced segmented');
    const manifestText = await readFile(resolve(directory, pointer.filename), 'utf8');
    const manifest = JSON.parse(manifestText) as SegmentedCanonicalManifestV1;
    const paged = manifest.segments.filter(segment => segment.paged !== undefined);
    assert(paged.length > 0, 'at least one section paged at these limits');
    compute2 = new Compute();
    const restored = await restoreExperience(compute2, resolve(directory, 'EXPERIENCE_LATEST.json'));
    assert(restored !== null);
    assert.equal(restored.snapshot.seenEventIds.length, pointer.eventCount);
    const status = await compute2.call<{ writes: number }>('status');
    assert.equal(status.writes, (restored.snapshot as KairosV5DistributedPhysicalMemoryV3).writes);
    await compute2.close(); compute2 = null;

    // Corrupt one leaf: loud failure, not a silent partial read.
    const firstLeaf = (node: CanonicalPagedNodeV1): CanonicalPagedNodeV1 & { kind: 'leaf' } =>
      node.kind === 'leaf' ? node : firstLeaf(node.children[0]!.child);
    const leaf = firstLeaf(paged[0]!.paged!);
    const stem = pointer.filename.replace(/\.json$/, '');
    const leafPath = resolve(directory, `${stem}.segments`, leaf.filename);
    const original = await readFile(leafPath, 'utf8');
    await writeFile(leafPath, original.slice(0, -3) + '"\n', 'utf8');
    compute2 = new Compute();
    await assert.rejects(() => restoreExperience(compute2!, resolve(directory, 'EXPERIENCE_LATEST.json')),
      /snapshot-page-invalid/);
    await compute2.close(); compute2 = null;

    // A missing leaf is equally loud.
    await rm(leafPath);
    compute2 = new Compute();
    await assert.rejects(() => restoreExperience(compute2!, resolve(directory, 'EXPERIENCE_LATEST.json')),
      /ENOENT/);
  } finally {
    if (compute2) await compute2.close();
    await rm(directory, { recursive: true, force: true });
  }
});
