import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Compute } from '../src/compute.js';
import { restoreExperience, V5Runtime, type ExperiencePointer } from '../src/runtime.js';
import { canonical, sha } from '../src/util.js';
import { canonicalStreamSha256, type SegmentedCanonicalManifestV1 } from '../src/util-stream.js';
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

function testConfig(segmentThresholdBytes: number): Configuration {
  return { version: 'KairosV5PhysicalControlConfigV2',
    minecraft: { version: '1.21.4', host: '127.0.0.1', port: 0, username: 'synthetic',
      java: 'unused', serverJar: 'unused' },
    actionBudget: 8, initializationEvents: 128, control,
    viewer: { enabled: false, host: '127.0.0.1', port: 0, dashboardPort: 0 },
    stateRoot: 'state', evidenceRoot: 'evidence', runtimeRoot: 'runtime',
    evidence: { snapshotEveryEvents: 4, attentionRecordEveryWindows: 5, attentionScoreEpsilon: .1,
      segmentThresholdBytes },
  } as Configuration;
}

async function saveOneEventBundle(directory: string, segmentThresholdBytes: number) {
  const compute = new Compute();
  let runtime: V5Runtime | null = null;
  try {
    const body = new SyntheticBody(() => {});
    await body.ready();
    runtime = new V5Runtime(body as unknown as MinecraftBody, testConfig(segmentThresholdBytes),
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
  const text = await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8');
  return JSON.parse(text) as ExperiencePointer;
}

async function readManifest(directory: string, pointer: ExperiencePointer)
  : Promise<SegmentedCanonicalManifestV1> {
  const text = await readFile(resolve(directory, pointer.filename), 'utf8');
  return JSON.parse(text) as SegmentedCanonicalManifestV1;
}

test('above the threshold the snapshot persists segmented and restores byte-identically', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-segmented-roundtrip-'));
  let compute2: Compute | null = null;
  try {
    const pointer = await saveOneEventBundle(directory, 1024);
    assert(pointer.manifestSha256 !== undefined, 'a 1 KiB threshold forces the segmented format');
    const manifest = await readManifest(directory, pointer);
    assert.equal(manifest.format, 'KairosV5SegmentedSnapshotV1');
    assert.equal(manifest.sha256, pointer.sha256);
    assert.equal(manifest.eventCount, pointer.eventCount);
    assert(manifest.segments.length > 5, 'top-level shards');
    // Every segment file is exactly canonical(snapshot[key]) + newline.
    const stem = pointer.filename.replace(/\.json$/, '');
    const restoredSnapshot = {} as Record<string, unknown>;
    for (const segment of manifest.segments) {
      const text = await readFile(resolve(directory, `${stem}.segments`, segment.filename), 'utf8');
      assert.equal(Buffer.byteLength(text, 'utf8'), segment.bytes);
      assert.equal(sha(JSON.parse(text)), segment.sha256);
      restoredSnapshot[segment.name] = JSON.parse(text);
    }
    // The reassembled object hashes to the pointer identity, no big string needed.
    assert.equal(canonicalStreamSha256(restoredSnapshot), pointer.sha256);
    // Segments concatenate to the exact single-file canonical byte stream.
    const glue = (index: number, name: string) => (index === 0 ? '{' : ',') + JSON.stringify(name) + ':';
    const reassembled = manifest.segments
      .map((segment, index) => glue(index, segment.name)
        + segmentTextSync(directory, stem, segment.filename).replace(/\n$/, ''))
      .join('') + '}';
    assert.equal(reassembled, canonical(restoredSnapshot));

    // Full restore through the production gate into a fresh worker.
    compute2 = new Compute();
    const restored = await restoreExperience(compute2, resolve(directory, 'EXPERIENCE_LATEST.json'));
    assert(restored !== null);
    assert.equal(restored.snapshot.seenEventIds.length, pointer.eventCount);
    const status = await compute2.call<{ writes: number }>('status');
    assert.equal(status.writes, (restored.snapshot as KairosV5DistributedPhysicalMemoryV3).writes);
  } finally {
    if (compute2) await compute2.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function segmentTextSync(directory: string, stem: string, filename: string): string {
  return readFileSync(resolve(directory, `${stem}.segments`, filename), 'utf8');
}

test('at or below the threshold the snapshot stays a single canonical file', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-segmented-below-'));
  try {
    const pointer = await saveOneEventBundle(directory, 256 * 1024 * 1024);
    assert.equal(pointer.manifestSha256, undefined, 'no manifest for a single-file snapshot');
    const written = await readFile(resolve(directory, pointer.filename), 'utf8');
    assert.equal(sha(JSON.parse(written)), pointer.sha256);
    assert.equal(written, canonical(JSON.parse(written)) + '\n', 'exactly the legacy file shape');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a truncated or corrupted segment fails the restore loudly; nothing looks half-written', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-segmented-corrupt-'));
  let compute2: Compute | null = null;
  try {
    const pointer = await saveOneEventBundle(directory, 1024);
    const manifest = await readManifest(directory, pointer);
    const stem = pointer.filename.replace(/\.json$/, '');
    const victim = resolve(directory, `${stem}.segments`, manifest.segments[0]!.filename);
    const original = await readFile(victim, 'utf8');
    await writeFile(victim, original.slice(0, -2) + '"', 'utf8');
    compute2 = new Compute();
    await assert.rejects(() => restoreExperience(compute2!, resolve(directory, 'EXPERIENCE_LATEST.json')),
      /snapshot-segment-invalid/);
    await compute2.close(); compute2 = null;

    // A missing segment is an equally loud failure.
    await writeFile(victim, original, 'utf8');
    const missing = resolve(directory, `${stem}.segments`, manifest.segments[1]!.filename);
    await rm(missing);
    compute2 = new Compute();
    await assert.rejects(() => restoreExperience(compute2!, resolve(directory, 'EXPERIENCE_LATEST.json')),
      /ENOENT/);
  } finally {
    if (compute2) await compute2.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a pointer naming a manifest where a single file stands is rejected fail-closed', async () => {
  const directory = await mkdtemp(resolve(process.cwd(), '.tmp-segmented-mismatch-'));
  try {
    const pointer = await saveOneEventBundle(directory, 256 * 1024 * 1024);
    assert.equal(pointer.manifestSha256, undefined);
    const doctored = { ...pointer, manifestSha256: '0'.repeat(64) };
    await writeFile(resolve(directory, 'EXPERIENCE_LATEST.json'), JSON.stringify(doctored), 'utf8');
    const compute2 = new Compute();
    try {
      await assert.rejects(() => restoreExperience(compute2, resolve(directory, 'EXPERIENCE_LATEST.json')),
        /experience-manifest-mismatch/);
    } finally { await compute2.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
