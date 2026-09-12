import { createRequire } from 'node:module';
import type { Bot } from 'mineflayer';
import type { Block } from 'prismarine-block';
import { Vec3 } from 'vec3';
import { sampleVisualTexture, textureAtlas } from './retina.js';

type V = [number, number, number];
type UV = [number, number];
type Vertex = { point: V; uv: UV };
type Triangle = { vertices: [Vertex, Vertex, Vertex]; tinted: boolean };
type Layer = { distance: number; color: readonly number[]; alpha: number; targetId: string };
export type OpticalHit = Omit<Layer, 'alpha'>;
const require = createRequire(import.meta.url);
const tints = require('minecraft-data')('1.21.4').tints;
const models = new Map<number | string, Triangle[]>();
const sub = (a: readonly number[], b: readonly number[]): V => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Face winding/UV conventions follow the installed block-model assets, also
// consumed by prismarine-viewer. Collision boxes are never optical geometry.
const faces: Record<string, { normal: V; corners: [number, number, number, number, number][] }> = {
  up: { normal: [0, 1, 0], corners: [[0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [0, 1, 0, 0, 0], [1, 1, 0, 1, 0]] },
  down: { normal: [0, -1, 0], corners: [[1, 0, 1, 0, 1], [0, 0, 1, 1, 1], [1, 0, 0, 0, 0], [0, 0, 0, 1, 0]] },
  east: { normal: [1, 0, 0], corners: [[1, 1, 1, 0, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]] },
  west: { normal: [-1, 0, 0], corners: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1]] },
  north: { normal: [0, 0, -1], corners: [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [1, 1, 0, 0, 0], [0, 1, 0, 1, 0]] },
  south: { normal: [0, 0, 1], corners: [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [0, 1, 1, 0, 0], [1, 1, 1, 1, 0]] },
};
function matches(condition: any, properties: Record<string, unknown>): boolean {
  if (!condition) return true;
  if (typeof condition === 'string') condition = Object.fromEntries(condition.split(',').map(part => part.split('=')));
  return Object.entries(condition).every(([key, value]) => key === 'OR'
    ? (value as any[]).some(item => matches(item, properties)) : key === 'AND'
      ? (value as any[]).every(item => matches(item, properties))
      : String(value).split('|').includes(String(properties[key])));
}
function variants(block: Block): any[] {
  const state = textureAtlas().states[block.name]; if (!state) return [];
  const properties = block.getProperties();
  const select = (value: any) => Array.isArray(value) ? value[0] : value;
  if (state.variants) return [select(Object.entries(state.variants).find(([key]) => matches(key, properties))?.[1])].filter(Boolean);
  return (state.multipart ?? []).filter((part: any) => matches(part.when, properties)).map((part: any) => select(part.apply));
}
function rotate(point: V, axis: number, degrees: number, origin: V, rescale = false): V {
  const p = sub(point, origin), a = (axis + 1) % 3, b = (axis + 2) % 3;
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const scale = rescale ? 1 / Math.cos(angle) : 1;
  const x = p[a]!, y = p[b]!; p[a] = (c * x - s * y) * scale; p[b] = (s * x + c * y) * scale;
  return p.map((value, i) => value + origin[i]!) as V;
}
function triangles(vertices: Vertex[], tinted: boolean): Triangle[] {
  return [[0, 1, 2], [2, 1, 3]].map(indices => ({ tinted, vertices: indices.map(i => vertices[i]!) as Triangle['vertices'] }));
}
function modelTriangles(block: Block): Triangle[] {
  const key = block.stateId ?? `${block.name}:${JSON.stringify(block.getProperties())}`;
  const cached = models.get(key); if (cached) return cached;
  const result: Triangle[] = [];
  for (const variant of variants(block)) for (const element of variant.model?.elements ?? []) {
    for (const [face, settings] of Object.entries(element.faces) as [string, any][]) {
      const definition = faces[face], uv = settings.texture; if (!definition || !uv) continue;
      const vertices = definition.corners.map(corner => {
        let point = corner.slice(0, 3).map((upper, axis) => upper ? element.to[axis] : element.from[axis]) as V;
        if (element.rotation) {
          const r = element.rotation; point = rotate(point, ['x', 'y', 'z'].indexOf(r.axis), r.angle, r.origin, r.rescale);
        }
        // Block-state rotations apply around the model centre.
        for (const axis of [2, 1, 0]) if (variant[['x', 'y', 'z'][axis]!])
          point = rotate(point, axis, -variant[['x', 'y', 'z'][axis]!], [8, 8, 8]);
        const angle = (settings.rotation ?? 0) * Math.PI / 180, c = Math.cos(angle), s = -Math.sin(angle);
        const u = (corner[3] - .5) * c - (corner[4] - .5) * s + .5,
          v = (corner[3] - .5) * s + (corner[4] - .5) * c + .5;
        return { point: point.map(value => value / 16) as V, uv: [uv.u + u * uv.su, uv.v + v * uv.sv] as UV };
      });
      result.push(...triangles(vertices, settings.tintindex === 0));
    }
  }
  models.set(key, result); return result;
}
function tint(block: Block, fluid: boolean): V {
  // These are renderer materials/biome colors, never agent features or rules.
  const biome = (block.biome as unknown as { name?: string })?.name ?? '';
  const kind = fluid ? 'water' : block.name === 'redstone_wire' ? 'redstone'
    : ['birch_leaves', 'spruce_leaves', 'lily_pad'].includes(block.name) ? 'constant'
      : block.name.includes('leaves') || block.name === 'vine' ? 'foliage' : 'grass';
  const key = kind === 'redstone' ? String(block.getProperties().power) : kind === 'constant' ? block.name : biome;
  const definition = tints[kind], rgb = definition.data.find((row: any) => row.keys.map(String).includes(key))?.color ?? definition.default;
  return [(rgb >> 16 & 255) / 255, (rgb >> 8 & 255) / 255, (rgb & 255) / 255];
}
function intersect(triangle: Triangle, origin: V, direction: V, range: number): { distance: number; uv: UV } | null {
  const [a, b, c] = triangle.vertices, edge1 = sub(b.point, a.point), edge2 = sub(c.point, a.point);
  const p = cross(direction, edge2), determinant = dot(edge1, p); if (Math.abs(determinant) < 1e-10) return null;
  const delta = sub(origin, a.point), u = dot(delta, p) / determinant;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(delta, edge1), v = dot(direction, q) / determinant;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = dot(edge2, q) / determinant; if (distance < 1e-6 || distance > range) return null;
  return { distance, uv: [0, 1].map(i => a.uv[i]! * (1 - u - v) + b.uv[i]! * u + c.uv[i]! * v) as UV };
}

/** A per-frame renderer: shared geometry is cached by actual block state;
 * fluid boundaries and blocks are cached only for this frame. No old scene is
 * kept after the world changes. It is an asset-based RGBD approximation, not
 * the native client: lighting, underwater fog and animated models are absent. */
export function frameOptics(world: Bot['world']) {
  const fluids = new Map<string, Triangle[]>(), blocks = new Map<string, Block | null>();
  const getBlock = (position: Vec3) => {
    const key = position.toString(); if (!blocks.has(key)) blocks.set(key, world.getBlock(position));
    return blocks.get(key)!;
  };
  function liquid(block: Block): Triangle[] {
    const key = block.position.toString(); if (fluids.has(key)) return fluids.get(key)!;
    const uv = variants(block)[0]?.model?.textures?.particle; if (!uv) return [];
    const heights: number[] = [];
    // Surface-height convention matches the installed renderer. Crucially,
    // internal fluid faces are absent, including when the eye is submerged.
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
      const at = block.position.offset(x, 0, z), sample = getBlock(at);
      const level = Number(sample?.getProperties().level);
      heights.push(sample?.type !== block.type ? 1 / 9 : getBlock(at.offset(0, 1, 0))?.type === block.type ? 1
        : level === 0 ? 8 / 9 : ((level >= 8 ? 8 : 7 - level) + 1) / 9);
    }
    const corners = [[0, 1, 3, 4], [1, 2, 4, 5], [3, 4, 6, 7], [4, 5, 7, 8]].map(indices => Math.max(...indices.map(i => heights[i]!)));
    const result: Triangle[] = [];
    for (const { normal, corners: face } of Object.values(faces)) {
      const neighbor = getBlock(block.position.offset(...normal));
      if (!neighbor || neighbor.type === block.type) continue;
      result.push(...triangles(face.map(p => ({ point: [p[0], p[1] ? corners[p[2] * 2 + p[0]]! : 0, p[2]],
        uv: [uv.u + p[3] * uv.su, uv.v + p[4] * uv.sv] })), block.name === 'water'));
    }
    fluids.set(key, result); return result;
  }
  return (from: Vec3, direction: Vec3, range: number, entity?: OpticalHit | null): OpticalHit | null => {
    const layers: Layer[] = [], ray: V = [direction.x, direction.y, direction.z];
    world.raycast(from, direction, Math.min(range, entity?.distance ?? range), ((block: Block) => {
      const isFluid = block.name === 'water' || block.name === 'lava';
      const geometry = isFluid ? liquid(block) : modelTriangles(block);
      if (!geometry.length) return false;
      const origin: V = [from.x - block.position.x, from.y - block.position.y, from.z - block.position.z];
      const colorTint = geometry.some(triangle => triangle.tinted) ? tint(block, isFluid) : [1, 1, 1], local: Layer[] = [];
      for (const triangle of geometry) {
        const hit = intersect(triangle, origin, ray, Math.min(range, entity?.distance ?? range)); if (!hit) continue;
        const texel = sampleVisualTexture(...hit.uv); if (texel[3] < .1) continue;
        local.push({ distance: hit.distance, alpha: texel[3], targetId: `block:${block.position.x},${block.position.y},${block.position.z}`,
          color: texel.slice(0, 3).map((value, i) => value * (triangle.tinted ? colorTint[i]! : 1)) });
      }
      local.sort((a, b) => a.distance - b.distance);
      for (const layer of local) {
        if (layers.some(value => value.targetId === layer.targetId && Math.abs(value.distance - layer.distance) < 1e-6)) continue;
        layers.push(layer); if (layer.alpha >= 1) return true;
      }
      return false;
    }) as (block: Block) => boolean);
    if (entity && entity.distance <= range) layers.push({ ...entity, alpha: 1 });
    layers.sort((a, b) => a.distance - b.distance); if (!layers.length) return null;
    const color = [0, 0, 0]; let transmission = 1;
    for (const layer of layers) {
      for (let c = 0; c < 3; c++) color[c]! += transmission * layer.alpha * layer.color[c]!;
      transmission *= 1 - layer.alpha; if (transmission < 1e-6) break;
    }
    return { distance: layers[0]!.distance, targetId: layers[0]!.targetId, color };
  };
}
