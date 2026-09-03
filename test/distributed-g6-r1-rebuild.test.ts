import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ActionCue, BodyResult, Observation } from '../src/contracts.js';
import { rebuildTrustedRawR1BaselineV1, reconstructTrustedRawR1SourceV1,
  type TrustedRawR1SourceSpecificationV1 }
  from '../src/evaluation/rebuild-minecraft-distributed-g6-r1-baseline-v1.js';
import { auditTrustedR1RebuildHistoryV1 }
  from '../src/evaluation/minecraft-distributed-g6-live-v1.js';
import { fileSha } from '../src/util.js';

const look: ActionCue = { kind: 'look', parameters: { yawDeltaDegrees: 15,
  pitchDeltaDegrees: 0 }, targetRole: null };
const observe: ActionCue = { kind: 'observe', parameters: { ticks: 5 }, targetRole: null };

function frame(sequence: number): Observation {
  return { sequence, activeSeconds: sequence * .05, contextId: `public-layout-${Math.ceil(sequence / 4)}`,
    objects: [], targetId: null, self: { position: [0, 64, 0], yaw: Math.ceil(sequence / 2) % 2,
      pitch: 0, properties: { onGround: true } } };
}

function receipt(cue: ActionCue, startSequence: number, endSequence: number): BodyResult {
  return { action: { kind: cue.kind as BodyResult['action']['kind'], parameters: cue.parameters },
    executed: true, status: 'completed', startSequence, endSequence,
    terminationReason: cue.kind === 'observe' ? 'no-effect-window-complete' : 'stable' };
}

async function fixture(directory: string, sequences = [1, 2, 3, 4, 5, 6, 7, 8],
  receipts: readonly BodyResult[] = [receipt(look, 1, 2), receipt(observe, 3, 4),
    receipt(look, 5, 6), receipt(observe, 7, 8)]) {
  const framesPath = resolve(directory, 'frames.jsonl'), eventsPath = resolve(directory, 'events.jsonl');
  const protocolPath = resolve(directory, 'RUN_PROTOCOL.json');
  await writeFile(framesPath, sequences.map(sequence => JSON.stringify({ kind: 'frame',
    value: frame(sequence) })).join('\n') + '\n');
  await writeFile(eventsPath, receipts.map(value => JSON.stringify({ kind: 'body-result', value }))
    .join('\n') + '\n');
  await writeFile(protocolPath, JSON.stringify({ foundation: [0, 1].map(index => ({
    arm: `must-not-be-consumed-${index}`, expectedResult: `must-not-be-consumed-${index}`,
    comparison: `must-not-be-consumed-${index}`,
    chain: { actionCue: look, verificationCue: observe } })) }));
  const specification: TrustedRawR1SourceSpecificationV1 = {
    version: 'TrustedRawR1SourceSpecificationV1', sourceId: 'mini-raw-R1-source',
    files: { frames: { filename: 'frames.jsonl', sha256: await fileSha(framesPath) },
      events: { filename: 'events.jsonl', sha256: await fileSha(eventsPath) },
      protocol: { filename: 'RUN_PROTOCOL.json', sha256: await fileSha(protocolPath) } },
    expected: { frameCount: sequences.length, firstSequence: sequences[0]!,
      lastSequence: sequences.at(-1)!, protocolEpisodes: 2, bodyResults: receipts.length,
      interactionAttempts: 0 },
    integrityBoundary: 'hashes-frozen-at-rebuild-time-not-a-contemporaneous-capture-manifest',
  };
  return { specification, framesPath, eventsPath };
}

test('trusted raw receipts rebuild only independent R1 atoms and explicitly leave R2/R2A empty', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.distributed-r1-rebuild-'));
  try {
    const source = resolve(root, 'source'); const output = resolve(root, 'output');
    await import('node:fs/promises').then(fs => fs.mkdir(source));
    const { specification } = await fixture(source);
    const reconstruction = await reconstructTrustedRawR1SourceV1(source, specification);
    assert.equal(reconstruction.events.length, 4);
    assert.ok(reconstruction.events.every(event => event.hierarchyContinuity === undefined));
    assert.equal(JSON.stringify(reconstruction.events).includes('must-not-be-consumed'), false);
    assert.deepEqual(reconstruction.audit.reconstruction, {
      r1Atoms: 4, r2ContinuousEvents: 0, r2aPatterns: 0, r2aRelations: 0,
      reconstructedEventSha256: reconstruction.audit.reconstruction.reconstructedEventSha256,
      armFieldsConsumed: 0, comparisonFieldsConsumed: 0, expectedResultFieldsConsumed: 0,
      legacySnapshotInputsConsumed: 0,
      acceptedSourceFiles: ['frames.jsonl', 'events.jsonl', 'RUN_PROTOCOL.json'],
      continuityQualification: 'R1-only-new-continuous-capture-required',
    });
    const audit = await rebuildTrustedRawR1BaselineV1(source, output, specification);
    assert.equal(audit.output.r1Atoms, 4);
    assert.equal(audit.output.r2ContinuousEvents, 0);
    assert.equal(audit.output.r2aPatterns, 0);
    assert.equal(audit.output.r2aRelations, 0);
    assert.equal(audit.nextStep, 'capture-32-real-continuous-events-across-8-layouts');
    const history = await auditTrustedR1RebuildHistoryV1(resolve(output, 'REBUILD_AUDIT.json'),
      specification);
    assert.equal(history.verified, true);
    assert.equal(history.replayableR1Candidates, 4);
    assert.equal(history.replayableContinuousR2Events, 0);
    assert.equal(history.verificationScope, 'trusted-R1-rebuild-audit');
    const snapshot = JSON.parse(await readFile(audit.output.snapshotPath, 'utf8'));
    assert.equal(JSON.stringify(snapshot).includes('must-not-be-consumed'), false);
    assert.equal(snapshot.seenEventIds.length, 4);
    assert.equal(snapshot.r2.events.length, 0);
    assert.equal(snapshot.r2a.patterns.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('raw R1 reconstruction rejects a changed file before parsing it', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.distributed-r1-hash-'));
  try {
    const { specification, framesPath } = await fixture(root);
    await writeFile(framesPath, await readFile(framesPath, 'utf8') + '\n');
    await assert.rejects(reconstructTrustedRawR1SourceV1(root, specification),
      /trusted-R1-source-hash-mismatch:frames/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('raw R1 reconstruction rejects a frame gap even under a newly frozen file hash', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.distributed-r1-gap-'));
  try {
    const { specification } = await fixture(root, [1, 2, 4, 5, 6, 7, 8, 9]);
    await assert.rejects(reconstructTrustedRawR1SourceV1(root, specification), /trusted-R1-frame-gap/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('raw R1 reconstruction rejects a receipt whose action differs from the protocol cue', async () => {
  const root = await mkdtemp(resolve(process.cwd(), '.distributed-r1-receipt-'));
  try {
    const wrong = receipt({ kind: 'move', parameters: { direction: 'forward', ticks: 4 },
      targetRole: null }, 1, 2);
    const { specification } = await fixture(root, undefined,
      [wrong, receipt(observe, 3, 4), receipt(look, 5, 6), receipt(observe, 7, 8)]);
    await assert.rejects(reconstructTrustedRawR1SourceV1(root, specification),
      /trusted-R1-action-plan-mismatch:0:0/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
