import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { frameOptics } from '../src/adapters/minecraft/optics.js';
import { publicBlockRaycastV1 } from '../src/body.js';

const require = createRequire(import.meta.url), Block = require('prismarine-block')('1.21.4'),
  data = require('minecraft-data')('1.21.4'), { RaycastIterator } = require('prismarine-world/src/iterators.js');
// Optical apparatus with actual installed model/state data; not autonomous
// experience and not a substitute for the separate native server apparatus.
function fixture() {
  const cells = new Map<string, any>();
  const block = (name: string, x: number, y: number, z: number) => {
    const value = Block.fromStateId(data.blocksByName[name].defaultState, 0); value.position = new Vec3(x, y, z); return value;
  };
  const world = {
    getBlock: (position: Vec3) => cells.get(position.floored().toString()) ?? block('air', Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)),
    raycast: (from: Vec3, direction: Vec3, range: number, matcher: any) => {
      const iterator = new RaycastIterator(from, direction, range); let at = from;
      while (at) { const cell = world.getBlock(new Vec3(at.x, at.y, at.z)); if (matcher(cell, iterator)) return cell; at = iterator.next(); }
      return null;
    },
  };
  const set = (name: string, x: number, y: number, z: number) => cells.set(new Vec3(x, y, z).toString(), block(name, x, y, z));
  return { set, world: world as unknown as Bot['world'], cast: () => frameOptics(world as unknown as Bot['world']) };
}

test('liquid visual interfaces exist without collision and do not bind the solid behind them', () => {
  const f = fixture(); f.set('stone', 0, -2, 0); f.set('water', 0, -1, 0);
  const eye = new Vec3(.5, 1, .5), ray = new Vec3(0, -1, 0);
  const optical = f.cast()(eye, ray, 8), physical = publicBlockRaycastV1(f.world, eye, ray, 8);
  assert(optical); assert(Math.abs(optical.distance - (1 + 1 / 9)) < 1e-6);
  assert.equal(optical.targetId, 'block:0,-1,0'); assert.equal(physical!.name, 'stone');
  assert(optical.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  f.set('stone', 0, 0, 0); const covered = f.cast()(eye, ray, 8);
  f.set('air', 0, -1, 0); assert.deepEqual(f.cast()(eye, ray, 8), covered, 'hidden liquid must not alter any measured color/depth');
});

test('a submerged ray meets the external liquid surface, not a fabricated face at the eye or a voxel seam', () => {
  const f = fixture(); f.set('water', 0, -2, 0); f.set('water', 0, -1, 0);
  const optical = f.cast()(new Vec3(.5, -1.5, .5), new Vec3(0, 1, 0), 8);
  assert(optical); assert.equal(optical.targetId, 'block:0,-1,0');
  assert(Math.abs(optical.distance - (1.5 - 1 / 9)) < 1e-6);
  f.set('lava', 0, -2, 0); f.set('lava', 0, -1, 0);
  const lava = f.cast()(new Vec3(.5, -1.5, .5), new Vec3(0, 1, 0), 8);
  assert(lava); assert.notDeepEqual(lava.color, optical.color);
});

test('noncolliding crossed plant models retain both visible texels and transparent gaps', () => {
  const f = fixture(); f.set('short_grass', 0, 0, 0);
  const cast = f.cast(); let visible = 0, gaps = 0;
  for (let y = .1; y < .95; y += .05) for (let x = .1; x < .95; x += .05) {
    const hit = cast(new Vec3(x, y, 2), new Vec3(0, 0, -1), 3);
    if (hit) { visible++; assert.equal(hit.targetId, 'block:0,0,0'); } else gaps++;
  }
  assert(visible > 0); assert(gaps > 0);
  assert.equal(publicBlockRaycastV1(f.world, new Vec3(.5, .5, 2), new Vec3(0, 0, -1), 3), null);
});

test('ordinary rotated and multipart assets remain visible and opaque blocks occlude entity silhouettes', () => {
  for (const name of ['oak_stairs', 'oak_fence', 'stone']) {
    const f = fixture(); f.set(name, 0, 0, 0);
    const hit = f.cast()(new Vec3(.5, .25, 2), new Vec3(0, 0, -1), 3,
      { distance: 2.5, color: [1, 0, 1], targetId: 'entity:7' });
    assert(hit); assert.equal(hit.targetId, 'block:0,0,0', name);
  }
});
