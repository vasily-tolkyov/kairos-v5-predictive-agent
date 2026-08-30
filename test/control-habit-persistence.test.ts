import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PhysicalMemory } from '../src/memory.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { dashboardPayload } from '../src/dashboard.js';
import { restoreExperience, saveExperienceBundleV1, type ExperiencePointer, type V5Runtime } from '../src/runtime.js';
import { saveJson, sha } from '../src/util.js';
import { PUBLIC_LAYOUT_SEMANTICS } from '../src/public-context.js';
import type { Compute } from '../src/compute.js';

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(resolve(process.cwd(), '.tmp-control-habit-persistence-'));
}

function learnedHabit(): ControlHabitWeightsV1 {
  const habit = new ControlHabitWeightsV1();
  habit.recordDispatch({ operation: 'predict-branch', relationsFromRecent: [] });
  const sequence = habit.recordDispatch({ operation: 'execute', relationsFromRecent: ['same-node'] });
  habit.applyTrustedRealActionOutcome({ source: 'trusted-real-executed-action', dispatchSequence: sequence,
    residualReduction: .75, predictionViolation: null });
  habit.advanceActiveTime(37.5); return habit;
}

test('event-32 bundle atomically names deterministic physical and habit checkpoints', async () => {
  const directory = await temporaryDirectory();
  try {
    const empty = new PhysicalMemory().snapshot();
    const snapshot = { ...empty, seenEventIds: Array.from({ length: 32 }, (_value, index) => `real-event-${index + 1}`) };
    const habit = learnedHabit();
    const pointer = await saveExperienceBundleV1(directory, snapshot,
      { actions: 4, eventCount: 32, writes: 0 }, habit);
    assert.equal(pointer.filename, 'experience-0032.json');
    assert.equal(pointer.habitFilename, 'control-habit-0032.json');
    const current = JSON.parse(await readFile(resolve(directory, 'EXPERIENCE_LATEST.json'), 'utf8')) as ExperiencePointer;
    const habitCheckpoint = JSON.parse(await readFile(resolve(directory, current.habitFilename!), 'utf8')) as unknown;
    assert.equal(current.habitSha256, sha(habitCheckpoint));
    assert.equal(ControlHabitWeightsV1.restore(habitCheckpoint).exportDeterministicJson(), habit.exportDeterministicJson());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('restoring a paired pointer preserves habit checkpoint byte semantics', async () => {
  const directory = await temporaryDirectory();
  try {
    const snapshot = new PhysicalMemory().snapshot(), habit = learnedHabit();
    await saveExperienceBundleV1(directory, snapshot, { actions: 0, eventCount: 0, writes: 0 }, habit);
    let restoredPhysical: unknown;
    const compute = { call: async (operation: string, value: unknown) => {
      assert.equal(operation, 'restore'); restoredPhysical = value; return undefined;
    } } as unknown as Compute;
    const restored = await restoreExperience(compute, resolve(directory, 'EXPERIENCE_LATEST.json'));
    assert(restored); assert.equal(sha(restoredPhysical), sha(snapshot));
    assert.equal(restored.habit.exportDeterministicJson(), habit.exportDeterministicJson());
    assert.equal(restored.habitPath, resolve(directory, 'control-habit-0000.json'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('legacy experience pointer without habit fields restores a zero habit', async () => {
  const directory = await temporaryDirectory();
  try {
    const snapshot = new PhysicalMemory().snapshot(), filename = 'experience-0000.json';
    await saveJson(resolve(directory, filename), snapshot);
    const pointer: ExperiencePointer = { runtimeVersion: 'KairosV5PhysicalControlRuntimeV1',
      sourceContextVersion: PUBLIC_LAYOUT_SEMANTICS, filename, sha256: sha(snapshot),
      actions: 0, eventCount: 0, writes: 0 };
    const pointerPath = resolve(directory, 'EXPERIENCE_LATEST.json'); await saveJson(pointerPath, pointer);
    const compute = { call: async () => undefined } as unknown as Compute;
    const restored = await restoreExperience(compute, pointerPath);
    assert(restored); assert.equal(restored.habitPath, null);
    assert.equal(restored.habit.exportDeterministicJson(), new ControlHabitWeightsV1().exportDeterministicJson());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('viewer projection is read-only for nonsemantic habits', () => {
  const habit = learnedHabit(), before = habit.exportDeterministicJson();
  const runtime = { snapshotForDisplay: null, controlFieldForDisplay: { sites: [], dependencies: [] },
    habitCheckpointForDisplay: habit.exportCheckpoint(), display: () => ({ controlHabits: habit.exportCheckpoint() }) } as unknown as V5Runtime;
  const first = dashboardPayload(runtime), second = dashboardPayload(runtime);
  assert.deepEqual(first, second); assert.equal(habit.exportDeterministicJson(), before);
  assert.equal(JSON.stringify(first).includes('predict-branch'), true);
});
