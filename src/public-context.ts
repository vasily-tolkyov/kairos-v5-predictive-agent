import type { PublicObject } from './contracts.js';
import { assert, canonical, sha } from './util.js';
import { KAIROS_V5_CONTEXT_VERSION } from './core/compatibility.js';

/** Evidence provenance only; never a feature, a rule label, or a model input. */
export const PUBLIC_LAYOUT_SEMANTICS = KAIROS_V5_CONTEXT_VERSION;

export function publicLayoutContextId(dimension: string, visibleObjects: readonly PublicObject[]): string {
  const quantize = (value: number): number => {
    assert(Number.isFinite(value), 'non-finite-public-layout-coordinate');
    return Number((Math.round(value / .25) * .25).toFixed(6));
  };
  const blocks = visibleObjects.filter(object => object.id.startsWith('block:'))
    .map(object => {
      assert(object.relativePosition.every(Number.isFinite), 'non-finite-public-layout-coordinate');
      return object;
    }).filter(object => Math.hypot(...object.relativePosition) <= 8)
    .map(object => ({ type: object.type, relativePosition: object.relativePosition.map(quantize),
      publicProperties: object.properties }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
  // No absolute block IDs, world/run ID, body state, clock, cursor, or invented face field.
  return `${PUBLIC_LAYOUT_SEMANTICS}:${sha({ version: PUBLIC_LAYOUT_SEMANTICS, dimension,
    localPublicLayoutRadius: 8, blocks })}`;
}
