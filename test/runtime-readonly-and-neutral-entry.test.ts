import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PhysicalMemory } from '../src/memory.js';
import { ControlHabitWeightsV1 } from '../src/control/habit.js';
import { dashboardPayload } from '../src/dashboard.js';
import type { V5Runtime } from '../src/runtime.js';

test('dashboard payload is a defensive projection and cannot mutate runtime-owned values', () => {
  const snapshot = new PhysicalMemory().snapshot();
  const runtimeState = { nested: { value: 3 } };
  const controlField = { sites: [{ activation: .7 }], dependencies: [] };
  const habits = new ControlHabitWeightsV1().exportCheckpoint();
  const runtime = {
    snapshotForDisplay: snapshot,
    controlFieldForDisplay: controlField,
    habitCheckpointForDisplay: habits,
    display: () => runtimeState,
  } as unknown as V5Runtime;

  const payload = dashboardPayload(runtime) as {
    runtime: { nested: { value: number } };
    controlFields: { sites: { activation: number }[] };
    media: { r1: { pages: unknown[] } };
  };
  payload.runtime.nested.value = 99;
  payload.controlFields.sites[0]!.activation = 0;
  payload.media.r1.pages.push({});

  assert.equal(runtimeState.nested.value, 3);
  assert.equal(controlField.sites[0]!.activation, .7);
  assert.equal(snapshot.store.r1.pages.length, 0);
});

test('runtime display getters clone owned snapshots at the boundary', async () => {
  const source = await readFile(resolve('src/runtime.ts'), 'utf8');
  assert.match(source, /get snapshotForDisplay\(\)[\s\S]*?structuredClone\(this\.#lastSnapshot\)/);
  assert.match(source, /get controlFieldForDisplay\(\)[\s\S]*?structuredClone\(snapshot\)/);
  assert.match(source, /display\(\): unknown \{[\s\S]*?return structuredClone\(\{/);
});

test('default production entry stops after initialization and requires an external grounded goal', async () => {
  const source = await readFile(resolve('src/main.ts'), 'utf8');
  assert.equal(source.includes('iron_door'), false);
  assert.equal(source.includes('changeVisibleCondition'), false);
  assert.equal(source.includes('continuedExploration'), false);
  assert.equal(source.includes('runtime.runGoal('), false);
  assert.match(source, /services\.start\('empty'\)/);
  assert.match(source, /structured-goal-required/);
  assert.match(source, /acceptedVersion: 'GroundedGoalV1'/);
});
