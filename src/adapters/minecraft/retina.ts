import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { VisualSensation } from '../../perception.js';
import type { XYZ } from '../../contracts.js';

const require = createRequire(import.meta.url);
let atlas: { width: number; height: number; data: Uint8Array } | null = null;
let states: Record<string, any> | null = null;
const colors = new Map<string, readonly number[]>();
const viewerRoot = dirname(require.resolve('prismarine-viewer/package.json'));
type Pixels = { width: number; height: number; data: Uint8Array };

function readPixels(path: string): Pixels {
  const png = readFileSync(path);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('invalid-retina-texture-png');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), type = png[25]!, bits = png[24]!;
  if (!(type === 3 ? [1, 2, 4, 8].includes(bits) : [2, 6].includes(type) && bits === 8)
    || png[28] !== 0) throw new Error('unsupported-retina-texture-png');
  const channels = type === 3 ? 1 : type === 6 ? 4 : 3, chunks: Buffer[] = [];
  let palette: Buffer | undefined, alpha: Buffer | undefined;
  for (let offset = 8; offset < png.length;) {
    const count = png.readUInt32BE(offset), kind = png.subarray(offset + 4, offset + 8).toString();
    if (kind === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + count));
    if (kind === 'PLTE') palette = png.subarray(offset + 8, offset + 8 + count);
    if (kind === 'tRNS') alpha = png.subarray(offset + 8, offset + 8 + count);
    offset += count + 12;
  }
  const packed = inflateSync(Buffer.concat(chunks)), data = new Uint8Array(width * height * 4);
  const stride = Math.ceil(width * channels * bits / 8), rows = new Uint8Array(height * stride);
  const bytesPerPixel = Math.max(1, channels * bits / 8);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= bytesPerPixel ? rows[i - bytesPerPixel]! : 0,
        b = y ? rows[i - stride]! : 0, c = y && x >= bytesPerPixel ? rows[i - stride - bytesPerPixel]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predictor === undefined) throw new Error('invalid-retina-png-filter');
      rows[i] = (packed[y * (stride + 1) + 1 + x]! + predictor) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    if (type === 3) {
      if (!palette) throw new Error('retina-png-palette-missing');
      const x = i % width, y = Math.floor(i / width), shift = 8 - bits - x * bits % 8;
      const entry = rows[y * stride + Math.floor(x * bits / 8)]! >> shift & (1 << bits) - 1;
      for (let c = 0; c < 3; c++) data[i * 4 + c] = palette[entry * 3 + c]!;
      data[i * 4 + 3] = alpha?.[entry] ?? 255; continue;
    }
    for (let c = 0; c < 3; c++) data[i * 4 + c] = rows[i * channels + c]!;
    data[i * 4 + 3] = channels === 4 ? rows[i * channels + 3]! : 255;
  }
  return { width, height, data };
}

// Installed visual assets supply RGB. Names stay within this renderer and
// never become arbitrary identity colors or learned semantic inputs.
export function textureAtlas() {
  if (atlas && states) return { atlas, states };
  states = JSON.parse(readFileSync(resolve(viewerRoot, 'public/blocksStates/1.21.4.json'), 'utf8'));
  atlas = readPixels(resolve(viewerRoot, 'public/textures/1.21.4.png'));
  return { atlas, states: states! };
}

/** Optical texels retain transparency; averaging a cutout into a solid color
 * would turn the gaps in foliage and panes into invented occluders. */
export function sampleVisualTexture(u: number, v: number): readonly [number, number, number, number] {
  const { atlas } = textureAtlas();
  const x = Math.min(atlas.width - 1, Math.max(0, Math.floor(u * atlas.width))),
    y = Math.min(atlas.height - 1, Math.max(0, Math.floor(v * atlas.height)));
  const i = (y * atlas.width + x) * 4;
  return [atlas.data[i]! / 255, atlas.data[i + 1]! / 255, atlas.data[i + 2]! / 255, atlas.data[i + 3]! / 255];
}

/** Only the renderer can see block names/states. Its result contains RGB only. */
export function visibleSurfaceColor(name: string, properties: Record<string, unknown>, face: number): readonly number[] {
  const { atlas, states } = textureAtlas(), definition = states[name];
  const variant = Object.entries(definition?.variants ?? {}).find(([condition]) => !condition
    || condition.split(',').every(pair => { const [key, value] = pair.split('='); return String(properties[key!]) === value; }))?.[1] as any;
  const model = (Array.isArray(variant) ? variant[0] : variant)?.model
    ?? definition?.multipart?.[0]?.apply?.model;
  const side = ['down', 'up', 'north', 'south', 'west', 'east'][face];
  const uv = model?.textures?.[side!] ?? model?.textures?.all ?? model?.textures?.particle
    ?? Object.values(model?.textures ?? {})[0] as any;
  if (!uv || typeof uv.u !== 'number') return [.5, .5, .5];
  const key = JSON.stringify(uv); if (colors.has(key)) return colors.get(key)!;
  const sum = [0, 0, 0]; let count = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const ix = Math.min(atlas.width - 1, Math.max(0, Math.floor((uv.u + uv.su * (x + .5) / 8) * atlas.width)));
    const iy = Math.min(atlas.height - 1, Math.max(0, Math.floor((uv.v + uv.sv * (y + .5) / 8) * atlas.height)));
    const i = (iy * atlas.width + ix) * 4; if (atlas.data[i + 3]! < 128) continue;
    for (let c = 0; c < 3; c++) sum[c]! += atlas.data[i + c]! / 255;
    count++;
  }
  const result = sum.map(value => Math.round(value / Math.max(1, count) * 255) / 255);
  colors.set(key, result); return result;
}

const iconColors = new Map<string, XYZ | null>();
function imageColor(path: string): XYZ | null {
  if (iconColors.has(path)) return iconColors.get(path)!;
  if (!existsSync(path)) { iconColors.set(path, null); return null; }
  const { data } = readPixels(path), total = [0, 0, 0]; let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255; weight += alpha;
    for (let channel = 0; channel < 3; channel++) total[channel]! += data[i + channel]! / 255 * alpha;
  }
  const color = weight ? total.map(value => Math.round(value / weight * 255) / 255) as unknown as XYZ : null;
  iconColors.set(path, color); return color;
}
/** Visible item icons, including non-block items, use their installed texture. */
export function visibleItemColor(name: string): readonly [number, number, number] | null {
  const icon = /^[a-z0-9_]+$/.test(name) ? imageColor(resolve(viewerRoot, 'public/textures/1.21.4/items', name + '.png')) : null;
  if (icon) return icon;
  if (textureAtlas().states[name]) return visibleSurfaceColor(name, {}, 1) as XYZ;
  return null;
}

let entityModels: Record<string, { textures?: { default?: string } }> | null = null;
export function visibleEntityColor(name: string, droppedItemName?: string): XYZ | null {
  if (['item', 'Item', 'item_stack'].includes(name)) return droppedItemName ? visibleItemColor(droppedItemName) : null;
  if (!/^[a-z0-9_]+$/.test(name)) return null;
  entityModels ??= JSON.parse(readFileSync(resolve(viewerRoot, 'viewer/lib/entity/entities.json'), 'utf8'));
  const texture = entityModels![name]?.textures?.default;
  const described = texture ? imageColor(resolve(viewerRoot, 'public', texture.replace('textures/', 'textures/1.21.4/') + '.png')) : null;
  if (described) return described;
  // Some catalogue entries describe profession/variant overlays but omit the
  // installed base image. Resolve only the entity's own conventional base
  // paths; do not choose an arbitrary variant or invent an identity color.
  const base = resolve(viewerRoot, 'public/textures/1.21.4/entity');
  return imageColor(resolve(base, name, name + '.png')) ?? imageColor(resolve(base, name + '.png'));
}

/** Geometric silhouette approximation for the current low-resolution sensor.
 * Entity identities never leave the body-side renderer. This uses physical
 * bounds, not animated client meshes; unknown textures remain unsupported. */
export function rayBoxDistance(origin: XYZ, direction: XYZ, lower: XYZ, upper: XYZ, range: number): number | null {
  let near = 0, far = range;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]!) < 1e-12) {
      if (origin[axis]! < lower[axis]! || origin[axis]! > upper[axis]!) return null;
    } else {
      const a = (lower[axis]! - origin[axis]!) / direction[axis]!, b = (upper[axis]! - origin[axis]!) / direction[axis]!;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

export function captureRetina(yaw: number, pitch: number,
  raycast: (yaw: number, pitch: number, range: number) => { distance: number; color: readonly number[] } | null): VisualSensation {
  const width = 25, height = 19, horizontalFov = 1.4, verticalFov = 1.08, range = 8, samples: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const hit = raycast(yaw + (.5 - x / (width - 1)) * horizontalFov,
      pitch + (.5 - y / (height - 1)) * verticalFov, range);
    samples.push(...(hit?.color ?? [0, 0, 0]), hit ? Math.round(hit.distance * 1000) / 1000 : -1);
  }
  return { version: 'AnonymousRGBD1', width, height, horizontalFov, verticalFov, range, depthResolution: .001, samples };
}
