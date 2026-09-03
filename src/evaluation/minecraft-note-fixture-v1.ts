import { Vec3 } from 'vec3';
import type { Observation } from '../contracts.js';
import { MinecraftBody } from '../body.js';
import { Services } from '../services.js';
import { assert } from '../util.js';

export type FixtureSideV1 = 'north' | 'south' | 'east' | 'west';

export interface GuidedMinecraftLayoutV1 {
  readonly id: string;
  readonly originX: number;
  readonly originZ: number;
  readonly side: FixtureSideV1;
  readonly markerVariant: 0 | 1 | 2 | 3;
}

export interface FixtureGeometryV1 {
  readonly backing: readonly [number, number, number];
  readonly control: readonly [number, number, number];
  readonly bot: readonly [number, number, number];
  readonly targetYaw: number;
  readonly targetPitch: number;
  readonly facing: FixtureSideV1;
  readonly markerCommands: readonly string[];
}

const sideVector = (side: FixtureSideV1): readonly [number, number] => side === 'south' ? [0, 1]
  : side === 'north' ? [0, -1] : side === 'east' ? [1, 0] : [-1, 0];
const oppositeSide = (side: FixtureSideV1): FixtureSideV1 => side === 'south' ? 'north'
  : side === 'north' ? 'south' : side === 'east' ? 'west' : 'east';

export function guidedFixtureGeometryV1(layout: GuidedMinecraftLayoutV1): FixtureGeometryV1 {
  const [sx, sz] = sideVector(layout.side), rx = sz, rz = -sx;
  const backing = [layout.originX, 65, layout.originZ] as const;
  const control = [layout.originX + sx, 65, layout.originZ + sz] as const;
  const bot = [layout.originX + .5 + sx * 4, 64, layout.originZ + .5 + sz * 4] as const;
  const dx = control[0] + .5 - bot[0], dy = control[1] + .5 - (bot[1] + 1.62), dz = control[2] + .5 - bot[2];
  const horizontal = Math.hypot(dx, dz);
  const targetYaw = Math.atan2(-dx, -dz), targetPitch = Math.atan2(dy, horizontal);
  const distances = layout.markerVariant === 0 ? [2, -2]
    : layout.markerVariant === 1 ? [3, -2]
      : layout.markerVariant === 2 ? [2, -3] : [3, -3];
  const types = layout.markerVariant === 1 || layout.markerVariant === 3
    ? ['oak_planks', 'quartz_block'] : ['quartz_block', 'oak_planks'];
  const markerCommands = distances.map((distance, index) =>
    `setblock ${layout.originX + rx * distance - sx} 65 ${layout.originZ + rz * distance - sz} minecraft:${types[index]}`);
  return { backing, control, bot, targetYaw, targetPitch,
    facing: oppositeSide(layout.side), markerCommands };
}

function publicObject(observation: Observation, type: string) {
  const objects = observation.objects.filter(object => object.type === type);
  assert(objects.length === 1, `expected-one-public-${type}:${objects.length}`);
  return objects[0]!;
}

/**
 * Neutral real note-block fixture.  It only prepares public world state before
 * goal injection and has no controller, memory or expected-action dependency.
 */
export async function prepareGuidedNoteFixtureLiveV1(services: Services, body: MinecraftBody,
  layout: GuidedMinecraftLayoutV1, initialNote: number, yawOffsetDegrees: number,
  options: { readonly neutralMarkers?: 'visible' | 'absent'; readonly clearRadius?: number } = {}):
  Promise<{ observation: Observation; controlId: string }> {
  assert(Number.isSafeInteger(initialNote) && initialNote >= 0 && initialNote <= 24,
    'invalid-guided-note-fixture-value');
  assert(options.clearRadius === undefined || Number.isSafeInteger(options.clearRadius)
    && options.clearRadius >= 4 && options.clearRadius <= 32,
  'invalid-guided-note-fixture-clear-radius');
  const geometry = guidedFixtureGeometryV1(layout);
  const clearRadius = options.clearRadius ?? 4;
  const minX = layout.originX - clearRadius, maxX = layout.originX + clearRadius;
  const minZ = layout.originZ - clearRadius, maxZ = layout.originZ + clearRadius;
  services.command(`fill ${minX} 64 ${minZ} ${maxX} 69 ${maxZ} air`);
  services.command(`fill ${minX} 63 ${minZ} ${maxX} 63 ${maxZ} minecraft:smooth_stone`);
  services.command(`setblock ${geometry.backing.join(' ')} minecraft:redstone_lamp[lit=false]`);
  services.command(`setblock ${geometry.control.join(' ')} minecraft:note_block[instrument=harp,note=${initialNote},powered=false]`);
  if (options.neutralMarkers !== 'absent') for (const command of geometry.markerCommands) services.command(command);
  services.command(`tp ${body.bot.username} ${geometry.bot.join(' ')} 0 0`);
  await body.waitTicks(6);
  let controlBlock = body.bot.blockAt(new Vec3(...geometry.control));
  for (let ticks = 0; controlBlock?.name !== 'note_block' && ticks < 40; ticks++) {
    await body.waitTicks(1); controlBlock = body.bot.blockAt(new Vec3(...geometry.control));
  }
  assert(controlBlock?.name === 'note_block' && controlBlock.shapes.length > 0,
    'fixture-control-block-shape-unavailable');
  const shape = controlBlock.shapes[0]!;
  const target = new Vec3(geometry.control[0] + (shape[0]! + shape[3]!) / 2,
    geometry.control[1] + (shape[1]! + shape[4]!) / 2,
    geometry.control[2] + (shape[2]! + shape[5]!) / 2);
  const eye = body.bot.entity.position.offset(0, 1.62, 0), delta = target.minus(eye);
  const shapeYaw = Math.atan2(-delta.x, -delta.z);
  const shapePitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
  await body.bot.look(shapeYaw + yawOffsetDegrees * Math.PI / 180, shapePitch, true);
  await body.waitTicks(3);
  const observation = body.latest(), control = publicObject(observation, 'note_block');
  if (yawOffsetDegrees === 0)
    assert(observation.targetId === control.id, 'fixture-aim-did-not-bind-public-control');
  return { observation, controlId: control.id };
}
