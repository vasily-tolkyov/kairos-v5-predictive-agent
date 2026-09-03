import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import prismarineBlock from 'prismarine-block';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import type { Action, Observation, RealEvent } from '../src/contracts.js';
import type { MemoryObservationReceipt } from '../src/memory.js';
import { exactPublicBlockHit, publicBlockRaycastV1,
  publicBlockSelectionShapesV1 } from '../src/body.js';
import { publicLayoutContextId } from '../src/public-context.js';
import { relativePublicFeatures } from '../src/events.js';
import {
  MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1,
  applyMinecraftFixtureCommandBatchLiveV1,
  assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1,
  executeMinecraftMultilevelGuidedEpisodeLiveV1,
  minecraftMultilevelGuidedFixtureCommandsLiveV1,
  minecraftMultilevelGuidedFixtureBotPositionLiveV1,
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedFixtureInitialViewLiveV1,
  minecraftMultilevelGuidedPublicReferenceIdLiveV1,
  minecraftMultilevelGuidedPoseWindowSettledLiveV1,
  minecraftMultilevelGuidedStagingTeleportCommandLiveV1,
  minecraftMultilevelGuidedFixtureReadinessLiveV1,
  minecraftMultilevelGuidedVocabularyPanelLiveV1,
  minecraftMultilevelGuidedTrainingPlanIdentityLiveV1,
  minecraftMultilevelGuidedTrainingPlanLiveV1,
  type MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  type PreparedMinecraftMultilevelGuidedFixtureLiveV1,
} from '../src/evaluation/minecraft-multilevel-guided-training-live-v1.js';
import { HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1,
  materializeTrainingEpisodeLiveV1, minecraftHierarchicalMultilevelPlanLiveV1 }
  from '../src/evaluation/minecraft-hierarchical-multilevel-goal-chain-live-v1.js';

interface TestRaycastIterator {
  intersect(shapes: readonly number[][], position: Vec3): { face: number; pos: Vec3 } | null;
  next(): { x: number; y: number; z: number } | null;
}

const { RaycastIterator } = createRequire(import.meta.url)('prismarine-world/src/iterators.js') as {
  RaycastIterator: new (from: Vec3, direction: Vec3, range: number) => TestRaycastIterator;
};

const cellKey = (position: { x: number; y: number; z: number }) =>
  `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;

function testWorld(blocks: readonly Block[]): Parameters<typeof publicBlockRaycastV1>[0] {
  const byPosition = new Map(blocks.map(block => [cellKey(block.position), block]));
  return { raycast: (...args: unknown[]) => {
    const matcher = args[3] as (block: Block, iterator: TestRaycastIterator) => boolean;
    const iterator = new RaycastIterator(args[0] as Vec3, args[1] as Vec3, args[2] as number);
    let cell: { x: number; y: number; z: number } | null = args[0] as Vec3;
    while (cell) {
      const block = byPosition.get(cellKey(cell));
      if (block && matcher(block, iterator)) return block;
      cell = iterator.next();
    }
    return null;
  } } as unknown as Parameters<typeof publicBlockRaycastV1>[0];
}

const rayDirection = (yaw: number, pitch: number) =>
  new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));

const TestBlock = prismarineBlock('1.21.4');

function fixtureBlocks(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1): readonly Block[] {
  const blocks = new Map<string, Block>();
  const set = (x: number, y: number, z: number, specification: string) => {
    const key = cellKey({ x, y, z });
    if (specification === 'air') { blocks.delete(key); return; }
    const block = TestBlock.fromString(specification, 0);
    block.position = new Vec3(x, y, z);
    blocks.set(key, block);
  };
  for (const command of minecraftMultilevelGuidedFixtureCommandsLiveV1(
    episode, 'KairosTest').commands) {
    const setblock = /^setblock (-?\d+) (-?\d+) (-?\d+) minecraft:(\S+)$/.exec(command);
    if (setblock) {
      set(Number(setblock[1]), Number(setblock[2]), Number(setblock[3]), setblock[4]!);
      continue;
    }
    const fill = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) minecraft:(\S+)$/.exec(command);
    if (!fill || fill[7] === 'air') continue;
    for (let x = Number(fill[1]); x <= Number(fill[4]); x++)
      for (let y = Number(fill[2]); y <= Number(fill[5]); y++)
        for (let z = Number(fill[3]); z <= Number(fill[6]); z++) set(x, y, z, fill[7]!);
  }
  return [...blocks.values()];
}

function staticPublicFixture(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1) {
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
  const position = new Vec3(...minecraftMultilevelGuidedFixtureBotPositionLiveV1(episode, geometry));
  const eye = position.offset(0, 1.62, 0);
  const view = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
  const world = testWorld(fixtureBlocks(episode));
  const visible = new Map<string, Block>();
  for (let h = -4; h <= 4; h++) for (let v = -3; v <= 3; v++) {
    const block = publicBlockRaycastV1(world, eye,
      rayDirection(view.yaw + h * .14, view.pitch + v * .16), 8);
    if (block) visible.set(`block:${block.position.x},${block.position.y},${block.position.z}`, block);
  }
  const cursor = publicBlockRaycastV1(world, eye, rayDirection(view.yaw, view.pitch), 4.5);
  if (cursor) visible.set(`block:${cursor.position.x},${cursor.position.y},${cursor.position.z}`, cursor);
  const objects = [...visible.entries()].map(([id, block]) => ({ id, type: block.name,
    relativePosition: [block.position.x + .5 - position.x, block.position.y + .5 - position.y,
      block.position.z + .5 - position.z] as [number, number, number],
    properties: { ...block.getProperties() } }));
  const targetId = cursor
    ? `block:${cursor.position.x},${cursor.position.y},${cursor.position.z}` : null;
  const contextId = publicLayoutContextId('minecraft:overworld', objects);
  const observation: Observation = { sequence: 1, activeSeconds: 0,
    self: { position: [position.x, position.y, position.z], yaw: view.yaw, pitch: view.pitch,
      properties: { onGround: true, health: 20, food: 20, selectedSlot: 0,
        heldItem: null, velocityX: 0, velocityY: 0, velocityZ: 0 } },
    objects, targetId, contextId };
  return { geometry, ids: new Set(visible.keys()), objects, targetId, contextId, observation };
}

test('public ray selection repairs the 1.21.4 zero-collision button without seeing through it', () => {
  const Block = prismarineBlock('1.21.4');
  const button = Block.fromString('stone_button[face=wall,facing=north,powered=false]', 0);
  button.position = new Vec3(0, 64, 1);
  const stone = Block.fromString('stone', 0); stone.position = new Vec3(0, 64, 2);
  assert.deepEqual(button.shapes, [], 'dependency red case: a visible button has no collision shape');
  assert.deepEqual(publicBlockSelectionShapesV1(button), [[5 / 16, 6 / 16, 14 / 16,
    11 / 16, 10 / 16, 1]]);

  const world = testWorld([button, stone]);
  const hit = publicBlockRaycastV1(world, new Vec3(.5, 64.5, 0), new Vec3(0, 0, 1), 4.5);
  assert.equal(hit, button, 'the nearest visible empty-collision block must occlude the farther solid block');
  assert.deepEqual(exactPublicBlockHit(hit!),
    { direction: new Vec3(0, 0, -1), cursor: new Vec3(.5, .5, 14 / 16) });
  const miss = publicBlockRaycastV1(world, new Vec3(.1, 64.5, 0), new Vec3(0, 0, 1), 4.5);
  assert.equal(miss, stone, 'a ray outside the narrow button outline must still reach the backing block');
});

test('the stale-frame staging barrier rotates at the current safe pose, not the unbuilt fixture pose', () => {
  const command = minecraftMultilevelGuidedStagingTeleportCommandLiveV1(
    'KairosTest', [1000.5, -60, 1000.5], { yaw: Math.PI / 2, pitch: 0 });
  assert.equal(command, 'tp KairosTest 1000.5 -60 1000.5 90 0');
  assert.equal(command.includes('1040.5 64 1040.5'), false);
});

test('fixture view hits the exact narrow button outline in all four orientations', () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  const seen = new Set<string>();
  for (const episode of plan.filter(item => item.episode < 128
    && item.mode === 'interact-visible-disconnected-button-no-door-change')) {
    if (seen.has(episode.layout.facing)) continue;
    seen.add(episode.layout.facing);
    const fixture = staticPublicFixture(episode);
    assert.equal(fixture.targetId, fixture.geometry.buttonId,
      `exact outline center missed ${episode.layout.facing} wall button`);
  }
  assert.deepEqual([...seen].sort(), ['east', 'north', 'south', 'west']);
});

test('all modes have a real public preflight and eight public layouts in each half', () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  for (const mode of MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1) {
    const episodes = plan.filter(item => item.mode === mode);
    const facings = new Set<string>();
    for (const episode of episodes.filter(item => item.episode < 128)) {
      if (facings.has(episode.layout.facing)) continue;
      facings.add(episode.layout.facing);
      const fixture = staticPublicFixture(episode);
      if (mode.startsWith('look-') || mode.startsWith('interact-')) {
        assert(fixture.ids.has(fixture.geometry.buttonId), `${mode}:${episode.layout.facing}:button`);
        if (mode.endsWith('-acquire')) assert.notEqual(fixture.targetId, fixture.geometry.buttonId);
        else assert.equal(fixture.targetId, fixture.geometry.buttonId);
      }
      if (mode.startsWith('interact-'))
        assert(fixture.ids.has(fixture.geometry.doorId), `${mode}:${episode.layout.facing}:door`);
      if (!mode.startsWith('look-') && !mode.startsWith('interact-')) {
        const referenceId = minecraftMultilevelGuidedPublicReferenceIdLiveV1(
          episode, fixture.geometry, fixture.observation);
        assert(referenceId && fixture.ids.has(referenceId),
          `${mode}:${episode.layout.facing}:public-reference`);
      }
    }
    assert.equal(facings.size, 4, `${mode}:cardinal-preflight`);
    for (const half of ['first-128-calibration', 'second-128-consolidation'] as const) {
      const contexts = new Set(episodes.filter(item => item.half === half)
        .map(item => staticPublicFixture(item).contextId));
      assert.equal(contexts.size, 8, `${mode}:${half}:public-contexts`);
    }
  }
});

test('hierarchical profile rays see the effect proxy and complete heldout material vocabulary', () => {
  const calibration = minecraftHierarchicalMultilevelPlanLiveV1().foundation.slice(0, 64);
  const maximumVisible = new Map<string, number>();
  for (const specification of calibration) {
    const episode = materializeTrainingEpisodeLiveV1(specification);
    const fixture = staticPublicFixture(episode);
    const referenceId = minecraftMultilevelGuidedPublicReferenceIdLiveV1(
      episode, fixture.geometry, fixture.observation);
    if (!episode.mode.startsWith('look-') && !episode.mode.startsWith('interact-'))
      assert(referenceId && fixture.ids.has(referenceId),
        `${episode.mode}:${episode.layout.facing}:hierarchical-public-reference`);
    if (!episode.mode.startsWith('look-') && !episode.mode.startsWith('interact-')
      && !episode.mode.startsWith('left-') && !episode.mode.startsWith('right-')) {
      const reference = minecraftMultilevelGuidedVocabularyPanelLiveV1(episode.layout).proxyButton;
      assert(fixture.ids.has(`block:${reference.join(',')}`),
        `${episode.mode}:${episode.layout.facing}:effect-proxy:${fixture.objects
          .filter(value => value.type !== 'smooth_stone').map(value => `${value.type}@${value.id}`).join('|')}`);
    }
    if (episode.mode.startsWith('left-') || episode.mode.startsWith('right-')) {
      const centralTop = `block:${fixture.geometry.oneBlockObstacle[0]},65,${fixture.geometry.oneBlockObstacle[2]}`;
      assert(fixture.ids.has(centralTop), `${episode.mode}:${episode.layout.facing}:central-obstacle`);
    }
    if (specification.representationProfile.calibrationVocabularyPanel) {
      const bars = fixture.objects.filter(value => value.type === 'iron_bars').length;
      const bricks = fixture.objects.filter(value => value.type === 'stone_bricks').length;
      maximumVisible.set('iron_bars', Math.max(maximumVisible.get('iron_bars') ?? 0, bars));
      maximumVisible.set('stone_bricks', Math.max(maximumVisible.get('stone_bricks') ?? 0, bricks));
      const material = specification.representationProfile.crosshairVocabularyMaterial!;
      assert((material === 'iron_bars' ? bars : bricks) >= (material === 'iron_bars' ? 15 : 12),
        `${episode.mode}:${episode.layout.facing}:${material}:${bars}:${bricks}`);
      const target = fixture.objects.find(value => value.id === fixture.targetId);
      assert.equal(target?.type, specification.representationProfile.crosshairVocabularyMaterial);
    }
  }
  assert((maximumVisible.get('iron_bars') ?? 0) >= 15);
  assert((maximumVisible.get('stone_bricks') ?? 0) >= 12);
});

test('hierarchical side-clear calibration starts from the neutral public view', () => {
  const episodes = minecraftHierarchicalMultilevelPlanLiveV1().foundation
    .filter(value => value.layout.split === 'calibration'
      && (value.arm === 'left-clear' || value.arm === 'right-clear'))
    .map(materializeTrainingEpisodeLiveV1);
  assert.equal(episodes.length, 8);
  for (const episode of episodes) {
    const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
    const view = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
    assert.equal(view.yaw, geometry.yaw);
    assert.equal(view.pitch, 0);
    const fixture = staticPublicFixture(episode);
    const referenceId = minecraftMultilevelGuidedPublicReferenceIdLiveV1(
      episode, fixture.geometry, fixture.observation);
    assert(referenceId && fixture.ids.has(referenceId));
  }
});

test('first-128 public conditions retain a discriminator for every preregistered contrast', () => {
  const calibration = minecraftHierarchicalMultilevelPlanLiveV1().foundation.slice(0, 64);
  const rows = calibration.map(specification => ({ specification,
    row: relativePublicFeatures(staticPublicFixture(
      materializeTrainingEpisodeLiveV1(specification)).observation) }));
  const keys = [...new Set(rows.flatMap(value => Object.keys(value.row)))];
  const energy = (key: string) => rows.reduce((sum, value) => sum + (value.row[key] ?? 0) ** 2, 0);
  const active = new Set(keys.sort((left, right) => energy(right) - energy(left)
    || left.localeCompare(right)).slice(0, 256));
  for (const comparison of HIERARCHICAL_MULTILEVEL_COMPARISONS_LIVE_V1) {
    const target = rows.filter(value => value.specification.arm === comparison.targetArm);
    const contrast = new Map(rows.filter(value => value.specification.arm === comparison.contrastArm)
      .map(value => [value.specification.layout.id, value.row]));
    const isDiscriminator = (key: string) => {
      const differences = target.map(value => (value.row[key] ?? 0)
        - (contrast.get(value.specification.layout.id)?.[key] ?? 0));
      return differences.every(value => Math.abs(value) > 1e-9)
        && (differences.every(value => value > 0) || differences.every(value => value < 0));
    };
    const discriminators = [...active].filter(isDiscriminator);
    const allDiscriminators = keys.filter(isDiscriminator);
    assert(discriminators.length > 0,
      `${comparison.id}:all=${allDiscriminators.slice(0, 12).join('|')}`);
  }
});

test('live curriculum is exactly 16 modes x 16 one-action episodes with a hard 128 boundary', () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  assert.equal(plan.length, 256);
  assert.equal(plan.filter(item => item.half === 'first-128-calibration').length, 128);
  assert.equal(plan.filter(item => item.half === 'second-128-consolidation').length, 128);
  assert.equal(new Set(plan.map(item => item.layout.id)).size, 16);
  const firstLayouts = new Set(plan.slice(0, 128).map(item => item.layout.id));
  const secondLayouts = new Set(plan.slice(128).map(item => item.layout.id));
  assert.equal([...firstLayouts].some(id => secondLayouts.has(id)), false);
  for (const mode of MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1) {
    const episodes = plan.filter(item => item.mode === mode);
    assert.equal(episodes.length, 16, mode);
    assert.equal(episodes.filter(item => item.episode < 128).length, 8, mode);
    assert.equal(episodes.filter(item => item.episode >= 128).length, 8, mode);
    assert.equal(new Set(episodes.map(item => item.layout.id)).size, 16, mode);
  }
  assert.deepEqual(Object.fromEntries(['look', 'move', 'jump', 'interact', 'observe', 'wait']
    .map(kind => [kind, plan.filter(item => item.action.kind === kind).length])),
  { look: 64, move: 96, jump: 32, interact: 32, observe: 16, wait: 16 });
  assert(plan.every(item => item.reset === 'before-this-episode-only'
    && item.fullSolutionDisclosed === false && !('actions' in item)));
  assert.equal(minecraftMultilevelGuidedTrainingPlanIdentityLiveV1(),
    minecraftMultilevelGuidedTrainingPlanIdentityLiveV1());
});

test('fixture commands stay in the static server boundary and encode a command-block-free persistent latch', () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  const wired = plan.find(item => item.mode === 'interact-wired-button-opens-iron-door')!;
  const disconnected = plan.find(item => item.mode
    === 'interact-visible-disconnected-button-no-door-change')!;
  const blockedJump = plan.find(item => item.mode
    === 'jump-forward-blocked-low-roof-high-obstacle')!;
  const wiredBatch = minecraftMultilevelGuidedFixtureCommandsLiveV1(wired, 'KairosTest');
  const seen: string[] = [];
  applyMinecraftFixtureCommandBatchLiveV1({ command: command => seen.push(command) }, wiredBatch);
  assert.deepEqual(seen, wiredBatch.commands);
  assert.equal(wiredBatch.commands[1], 'kill @e[type=minecraft:item]',
    'fixture reset must remove container drops before the public action window begins');
  assert.equal(wiredBatch.commands.filter(command => command === 'kill @e[type=minecraft:item]').length, 1);
  assert(wiredBatch.commands.some(command => command.includes('stone_button')));
  assert(wiredBatch.commands.some(command => command.includes('dropper')
    && command.includes('{Items:[{Slot:0b,id:"minecraft:cobblestone",count:1}]}')),
  'the persistent latch must begin with exactly one real item in a dropper');
  assert(wiredBatch.commands.some(command => command.includes('barrel')),
    'the persistent latch must store the dispensed item in a comparator-readable container');
  assert(wiredBatch.commands.some(command => command.includes('comparator')));
  assert(wiredBatch.commands.some(command => command.includes('repeater')),
    'the comparator output must turn through a directional repeater before the door');
  assert(wiredBatch.commands.some(command => command.includes('redstone_wire')));
  assert.equal(wiredBatch.commands.filter(command => command.includes('iron_door')).length, 2);
  const floorIndex = wiredBatch.commands.findIndex(command => /^fill .* 63 .* minecraft:smooth_stone$/.test(command));
  const finalTeleportIndex = wiredBatch.commands.findIndex(command => command.startsWith('tp KairosTest '));
  assert(floorIndex >= 0 && finalTeleportIndex > floorIndex,
    'the fixture floor must be built before the final-pose teleport');
  assert.equal(wiredBatch.commands.at(-1)?.split(/\s+/).length, 7,
    'the before-action tp must set xyz+yaw+pitch without a client look action');
  assert(wiredBatch.commands.every(command => !/command_block|^execute\b|^function\b|^schedule\b/i.test(command)));
  assert.throws(() => applyMinecraftFixtureCommandBatchLiveV1({ command: () => undefined }, {
    ...wiredBatch, commands: ['kill @e'],
  }), /command-outside-static-fixture-boundary/);
  assert.throws(() => applyMinecraftFixtureCommandBatchLiveV1({ command: () => undefined }, {
    ...wiredBatch, commands: ['kill @e[type=minecraft:player]'],
  }), /command-outside-static-fixture-boundary/);

  const disconnectedCommands = minecraftMultilevelGuidedFixtureCommandsLiveV1(
    disconnected, 'KairosTest').commands;
  assert(disconnectedCommands.some(command => command.includes('stone_button')));
  assert(disconnectedCommands.some(command => command.includes('iron_door')));
  assert.equal(disconnectedCommands.some(command => command.includes('comparator')), false);
  assert.equal(disconnectedCommands.some(command => command.includes('redstone_wire')), false);

  const jumpGeometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(blockedJump.layout);
  const jumpCommands = minecraftMultilevelGuidedFixtureCommandsLiveV1(blockedJump, 'KairosTest').commands;
  assert(jumpCommands.some(command => command.includes(jumpGeometry.lowRoof.join(' '))));
  assert(jumpGeometry.highObstacle.every(position =>
    jumpCommands.some(command => command.includes(position.join(' ')))));
  const blockedContextBlocks = new Set(plan.filter(item => item.episode < 128
    && item.mode === 'forward-blocked').map(item => {
    const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(item.layout);
    const prefix = `setblock ${geometry.oneBlockObstacle.join(' ')} minecraft:`;
    const command = minecraftMultilevelGuidedFixtureCommandsLiveV1(item, 'KairosTest').commands
      .find(value => value.startsWith(prefix));
    assert(command); return command.slice(prefix.length).split('[')[0]!;
  }));
  assert.equal(blockedContextBlocks.size, 8,
    'the public blocking obstacle itself must provide eight real contexts per half');

  const wiredReady = minecraftMultilevelGuidedFixtureReadinessLiveV1(wired);
  const oppositeFacing = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;
  const rightFacing = { north: 'east', south: 'west', east: 'south', west: 'north' } as const;
  assert(wiredReady.present.some(value => value.name === 'stone_button'
    && value.properties?.face === 'wall'
    && value.properties.facing !== wired.layout.facing));
  assert(wiredReady.present.some(value => value.name === 'comparator'
    && value.properties?.facing === oppositeFacing[wired.layout.facing]
    && value.properties.mode === 'compare'));
  assert(wiredReady.present.some(value => value.name === 'dropper'
    && value.properties?.facing === wired.layout.facing && value.properties.triggered === false));
  assert(wiredReady.present.some(value => value.name === 'barrel'
    && value.properties?.facing === wired.layout.facing && value.properties.open === false));
  assert(wiredReady.present.filter(value => value.name === 'iron_door').every(value =>
    value.properties?.facing === wired.layout.facing && value.properties.hinge === 'left'));
  assert.equal(wiredReady.present.filter(value => value.name === 'redstone_wire').length, 1);
  assert.equal(wiredReady.present.filter(value => value.name === 'repeater').length, 1);
  assert.equal(wiredReady.present.find(value => value.name === 'repeater')?.properties?.delay, '1');
  assert.equal(wiredReady.present.find(value => value.name === 'repeater')?.properties?.facing,
    oppositeFacing[rightFacing[wired.layout.facing]]);
  const wire = prismarineBlock('1.21.4').fromString(
    'redstone_wire[east=none,north=none,power=0,south=none,west=none]', 0);
  assert.equal(wire.getProperties().power, '0');
  assert(wiredReady.present.filter(value => value.name === 'redstone_wire')
    .every(value => value.properties?.power === wire.getProperties().power));
  const passive = plan.find(item => item.mode === 'wait-no-relevant-change'
    && item.layout.id === wired.layout.id)!;
  const passiveReady = minecraftMultilevelGuidedFixtureReadinessLiveV1(passive);
  for (const stale of wiredReady.present.filter(value =>
    ['stone_button', 'dropper', 'barrel', 'comparator', 'redstone_wire',
      'repeater', 'iron_door'].includes(value.name)))
    assert(passiveReady.empty.some(position => position.join(',') === stale.position.join(',')),
      `reset barrier does not require stale ${stale.name} to be empty`);
});

test('fixture pose barrier rejects a stale matching frame and requires a stable post-command window', () => {
  const episode = minecraftMultilevelGuidedTrainingPlanLiveV1()[0]!;
  const fixture = staticPublicFixture(episode);
  const expectedPosition = minecraftMultilevelGuidedFixtureBotPositionLiveV1(episode, fixture.geometry);
  const expectedView = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, fixture.geometry);
  const frame = (sequence: number, onGround = true, yaw = expectedView.yaw): Observation => ({
    ...structuredClone(fixture.observation), sequence,
    self: { ...structuredClone(fixture.observation.self), yaw,
      properties: { ...structuredClone(fixture.observation.self.properties), onGround } },
  });

  assert.equal(minecraftMultilevelGuidedPoseWindowSettledLiveV1(
    [frame(10)], 10, expectedPosition, expectedView), false,
  'a matching pose from before the command cannot acknowledge the reset');
  assert.equal(minecraftMultilevelGuidedPoseWindowSettledLiveV1(
    [frame(11), frame(12), frame(13, false), frame(14), frame(15)],
    10, expectedPosition, expectedView), false,
  'a real airborne teleport frame must reset the settlement window');
  assert.equal(minecraftMultilevelGuidedPoseWindowSettledLiveV1(
    [frame(11), frame(12), frame(13), frame(14), frame(15)],
    10, expectedPosition, expectedView), true);
  assert.equal(minecraftMultilevelGuidedPoseWindowSettledLiveV1(
    [frame(11), frame(12), frame(13), frame(14), frame(15, true, expectedView.yaw + .2)],
    10, expectedPosition, expectedView), false);
});

function publicFrame(sequence: number, fixture: PreparedMinecraftMultilevelGuidedFixtureLiveV1,
  doorOpen: boolean): Observation {
  return { sequence, activeSeconds: sequence * .05, contextId: `mock-context-${sequence}`,
    targetId: fixture.buttonId,
    self: { position: fixture.geometry.bot, yaw: fixture.geometry.yaw, pitch: -.2,
      properties: { onGround: true, heldItem: null, velocityX: 0, velocityY: 0, velocityZ: 0 } },
    objects: [
      { id: fixture.buttonId!, type: 'stone_button', relativePosition: [0, .5, 3],
        properties: { powered: false } },
      { id: fixture.doorId!, type: 'iron_door', relativePosition: [2, .5, 7],
        properties: { open: doorOpen, half: 'lower' } },
      { id: fixture.referenceId, type: 'copper_bulb', relativePosition: [-3, .5, 5],
        properties: { lit: false, powered: false } },
    ] };
}

function wiredFixture(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1):
PreparedMinecraftMultilevelGuidedFixtureLiveV1 {
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
  const fixture = { geometry, observation: null as unknown as Observation,
    buttonId: geometry.buttonId, doorId: geometry.doorId, referenceId: geometry.referenceId };
  return { ...fixture, observation: publicFrame(1, fixture, false) };
}

function wiredEvent(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  fixture: PreparedMinecraftMultilevelGuidedFixtureLiveV1): RealEvent {
  const action: Action = { kind: 'interact', parameters: {}, targetId: fixture.buttonId! };
  return { version: 'RealEventV5', id: 'mock-wired-event',
    cue: { kind: 'interact', parameters: {}, targetRole: 'stone_button' },
    frames: [publicFrame(1, fixture, false), publicFrame(2, fixture, true)],
    trackedIds: ['self', fixture.buttonId!, fixture.doorId!], bodyResult: { action,
      executed: true, status: 'completed', startSequence: 1, endSequence: 2,
      terminationReason: 'stable' }, provenance: 'executed-real-body', complete: true };
}

test('one episode makes exactly one body call, supplies the public door scope, checks outcome, and writes once', async () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  const episode = plan.find(item => item.mode === 'interact-wired-button-opens-iron-door')!;
  const fixture = wiredFixture(episode), event = wiredEvent(episode, fixture);
  let bodyCalls = 0, memoryCalls = 0, receivedScope: unknown = null;
  const receipt: MemoryObservationReceipt = { status: 'initialization-buffer', writes: 0,
    buffered: 1, mapSha256: null, representationRejection: null };
  const result = await executeMinecraftMultilevelGuidedEpisodeLiveV1(episode, fixture, {
    execute: async (_action, scope) => { bodyCalls++; receivedScope = scope;
      return { result: { executed: true }, event }; },
  }, { observe: async observed => { memoryCalls++; assert.equal(observed, event); return receipt; } });
  assert.equal(bodyCalls, 1);
  assert.equal(memoryCalls, 1);
  assert.deepEqual(receivedScope, { version: 'ActionObservationScopeV1',
    referencedPublicObjectIds: [fixture.doorId] });
  assert.equal(result.event, event);
  assert.equal(result.receipt, receipt);
});

test('outcome checks reject a disconnected visible button that changes the door', () => {
  const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
  const wired = plan.find(item => item.mode === 'interact-wired-button-opens-iron-door')!;
  const disconnected = plan.find(item => item.mode
    === 'interact-visible-disconnected-button-no-door-change'
    && item.layout.id === wired.layout.id)!;
  const fixture = wiredFixture(disconnected), event = wiredEvent(disconnected, fixture);
  assert.throws(() => assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(
    disconnected, fixture, event), /guided-disconnected-button-changed-door/);
});

test('side-clear outcome keeps the real public trend when the obstacle leaves the camera fan', () => {
  const episode = minecraftMultilevelGuidedTrainingPlanLiveV1()
    .find(item => item.mode === 'left-clear' && item.layout.facing === 'north')!;
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
  const referenceId = `block:${geometry.oneBlockObstacle[0]},65,${geometry.oneBlockObstacle[2]}`;
  const frame = (sequence: number, lateral: number, referenceRight: number | null): Observation => ({
    sequence, activeSeconds: sequence * .05, contextId: `side-clear-${sequence}`, targetId: null,
    self: { position: [geometry.bot[0] + geometry.right[0] * lateral, 64,
      geometry.bot[2] + geometry.right[1] * lateral], yaw: geometry.yaw, pitch: 0,
    properties: { onGround: true, velocityX: 0, velocityY: 0, velocityZ: 0 } },
    objects: referenceRight === null ? [] : [{ id: referenceId, type: 'iron_bars',
      relativePosition: [geometry.right[0] * referenceRight, 1.5,
        geometry.right[1] * referenceRight - 1], properties: {} }],
  });
  const action = structuredClone(episode.action);
  const event: RealEvent = { version: 'RealEventV5', id: 'side-clear-camera-exit',
    cue: { kind: action.kind, parameters: structuredClone(action.parameters), targetRole: null },
    frames: [frame(1, 0, 0), frame(2, -.6, .6), frame(3, -1.1, null)],
    trackedIds: ['self', referenceId], bodyResult: { action, executed: true, status: 'completed',
      startSequence: 1, endSequence: 3, terminationReason: 'stable' },
    provenance: 'executed-real-body', complete: true };
  const fixture: PreparedMinecraftMultilevelGuidedFixtureLiveV1 = { geometry,
    observation: event.frames[0]!, buttonId: null, doorId: null, referenceId };
  assert.doesNotThrow(() => assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(
    episode, fixture, event));
  const wrongDirection = { ...event, id: 'side-clear-wrong-direction', frames: [
    frame(1, 0, 0), frame(2, .6, -.6), frame(3, 1.1, null)] };
  assert.throws(() => assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(
    episode, fixture, wrongDirection), /guided-left-clear-did-not-open-forward-corridor/);
});
