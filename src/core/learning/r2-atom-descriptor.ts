import { FORMAL_EVALUATION } from '../config.js';
import type { Vec3 } from '../contracts.js';
import { add3, norm3, scale3, sub3 } from '../vector.js';

export const R2_ATOM_DESCRIPTOR_VERSION_V2 = 'FrozenR1EventPathDescriptorV2' as const;

function resampleByArc(points: readonly Vec3[], count: number): readonly Vec3[] {
  if (points.length < 2 || count < 2) throw new RangeError('R2 atom descriptor requires a path');
  const cumulative = new Float64Array(points.length);
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += norm3(sub3(points[index]!, points[index - 1]!));
    cumulative[index] = total;
  }
  if (total <= 1e-12) throw new RangeError('R2 atom descriptor requires a nonzero observed event arc');
  const sampled: Vec3[] = [];
  let segment = 1;
  for (let sample = 0; sample < count; sample++) {
    const target = total * sample / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment]! < target) segment++;
    const before = segment - 1, span = cumulative[segment]! - cumulative[before]!;
    const mix = span <= 1e-12 ? 0 : (target - cumulative[before]!) / span;
    sampled.push(add3(points[before]!, scale3(sub3(points[segment]!, points[before]!), mix)));
  }
  return sampled;
}

/**
 * Versioned, label-free descriptor for one already-frozen R1 event path.
 * The absolute position inside R1 is retained: unlike a Minecraft/world
 * translation, an R1 displacement is part of the learned public event
 * description and may encode an action cue or a stable observed state. Axes
 * are not rotated because their directions encode distinct transitions.
 * Only monotone arc resampling is treated as a nuisance. No world coordinate,
 * goal, result label, or old PathProjector state enters.
 */
export function r2AtomDescriptorV2(points: readonly Vec3[],
  sampleCount = FORMAL_EVALUATION.pathSamples): Float64Array {
  if (!points[0]) throw new RangeError('R2 atom descriptor path cannot be empty');
  const sampled = resampleByArc(points, sampleCount);
  const flattened = new Float64Array(sampleCount * 3);
  sampled.forEach((point, index) => flattened.set(point, index * 3));
  return flattened;
}
