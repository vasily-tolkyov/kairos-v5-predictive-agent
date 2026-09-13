import type { PublicValue } from './contracts.js';
import { hull, type NumericRange, type NumericRanges } from './numeric-ranges.js';

export type SensoryState = Readonly<Record<string, PublicValue>>;
export type MeasuredTarget = readonly [string, PublicValue, PublicValue];
interface Sample { input: SensoryState; targets: Record<string, readonly [PublicValue, PublicValue]>;
  errors: Record<string, number>; externalErrors?: Record<string, number>; serial: number }
interface Leaf { kind: 'leaf'; numeric: boolean; absolute: boolean; value: PublicValue; loss: number;
  rows: readonly Sample[];
  samples: number; calibrated: number; accuracy: number; error: number; progress: number;
  errorRadius: number | null; externalErrorRadius: number | null;
  externalCalibrated: number; externalAccuracy: number;
  bounds?: { delta: NumericRange; absolute: NumericRange } }
interface Branch { kind: 'branch'; key: string; threshold: PublicValue; numeric: boolean;
  lower: number; upper: number; categories: readonly PublicValue[]; left: Tree; right: Tree }
type Tree = Leaf | Branch;
type TreeShape = null | { kind: 'branch'; key: string; threshold: PublicValue; numeric: boolean;
  left: TreeShape; right: TreeShape };
interface Circuit { samples: Sample[]; writes: number }
export interface ContextualReadoutSnapshot { version: 'ContextualReadout1' | 'ContextualReadout2'; capacity: number;
  circuits: [string, Circuit][]; structures?: [string, [string, TreeShape][]][] }
export interface ConditionalValue { value: PublicValue; absolute: boolean; supported: boolean;
  samples: number; accuracy: number; error: number; progress: number; dependencies: readonly string[];
  externalCalibrated: number; externalAccuracy: number;
  /** Calibration of the separate regression readout in every possible local region. */
  externalSupported: boolean; externalErrorRadius: number | null;
  bounds?: { delta: NumericRange; absolute: NumericRange } }

const tolerance = (a: PublicValue, b: PublicValue) => typeof a === 'number' && typeof b === 'number'
  ? .025 + .075 * Math.max(1, Math.abs(b - a)) : 0;
const goesLeft = (value: PublicValue, split: Pick<Branch, 'numeric' | 'threshold'>) => split.numeric
  ? typeof value === 'number' && value <= Number(split.threshold) : Object.is(value, split.threshold);
function summary(rows: readonly Sample[], key: string): { leaf: Leaf; loss: number; calibrationLoss: number } {
  const numeric = rows.every(row => row.targets[key]!.every(v => typeof v === 'number'));
  const estimate = (absolute: boolean) => {
    const values = rows.map(row => numeric ? Number(row.targets[key]![1])
      - (absolute ? 0 : Number(row.targets[key]![0])) : row.targets[key]![1]);
    const value: PublicValue = numeric ? values.reduce<number>((sum, v) => sum + Number(v), 0) / values.length
      : [...new Set(values)].sort((a, b) => values.filter(v => Object.is(v, b)).length
        - values.filter(v => Object.is(v, a)).length)[0]!;
    const loss = values.reduce<number>((sum, v) => sum + (numeric
      ? (Number(v) - Number(value)) ** 2 : Number(!Object.is(v, value))), 0);
    return { value, loss, absolute };
  };
  const delta = estimate(!numeric), absolute = estimate(true);
  const fit = absolute.loss + 1e-10 < delta.loss ? absolute : delta;
  // Confidence concerns recent predictions in this region. Early errors from
  // an obsolete partition remain in the evidence, but cannot permanently
  // disqualify a subsequently stable response. Outcome bounds still use ALL
  // retained observations, including the latest contradictory measurement.
  const calibratedRows = rows.filter(row => Object.hasOwn(row.errors, key)).slice(-32);
  const errors = calibratedRows.map(row => row.errors[key]!);
  const externalRows = rows.filter(row => row.externalErrors?.[key] !== undefined);
  const allExternal = externalRows.map(row => row.externalErrors![key]!);
  const external = allExternal.slice(-32);
  // Scores are stored in tolerance units, while prediction ranges use the
  // observable's units. Use the recent 90th-percentile measured residual,
  // not the tolerance itself. An isolated obsolete forecast must not inflate
  // a now stable response indefinitely; ALL retained outcomes remain in the
  // envelope below. This empirical radius is not a coverage guarantee.
  // A clipped score is only a lower bound and cannot supply a finite radius.
  const residualRadius = (samples: readonly Sample[], external: boolean): number | null => {
    if (!numeric) return 0;
    if (!samples.length) return null;
    const residuals = samples.map(row => {
      const error = (external ? row.externalErrors! : row.errors)[key]!;
      const [before, after] = row.targets[key]!;
      return error < 0 || error >= 20 ? Infinity : error * tolerance(before, after);
    }).sort((a, b) => a - b);
    const radius = residuals[Math.ceil(.9 * residuals.length) - 1]!;
    return Number.isFinite(radius) ? radius : null;
  };
  const errorRadius = residualRadius(calibratedRows, false);
  const externalErrorRadius = residualRadius(externalRows.slice(-32), true);
  const envelope = (ranges: NumericRange[]): NumericRange => {
    const range = hull(ranges), margin = errorRadius ?? 0;
    return [range[0] - margin, range[1] + margin];
  };
  const mean = (vs: readonly number[]) => vs.reduce((s, v) => s + v, 0) / Math.max(1, vs.length);
  const half = Math.floor(errors.length / 2);
  const externalAccuracy = mean(external.map(error => Number(error <= 1)));
  // Split gains compare a parent with its two children over the SAME sample
  // mass. Independently clipping each child's history would double-count its
  // weight and can suppress a real conditional effect altogether.
  const splitAccuracy = mean(allExternal.map(error => Number(error <= 1)));
  return { loss: fit.loss, calibrationLoss: allExternal.length * splitAccuracy * (1 - splitAccuracy),
    leaf: { kind: 'leaf', numeric, ...fit, rows, samples: rows.length,
    calibrated: errors.length, accuracy: mean(errors.map(v => Number(v <= 1))), error: mean(errors),
    progress: errors.length >= 8 ? Math.max(0, mean(errors.slice(0, half)) - mean(errors.slice(half))) : 0,
    externalCalibrated: external.length, externalAccuracy, errorRadius, externalErrorRadius,
    ...(numeric ? { bounds: { delta: envelope(rows.map(row => {
      const [a, b] = row.targets[key]!; return [Number(b) - Number(a), Number(b) - Number(a)]; })),
      absolute: envelope(rows.map(row => [Number(row.targets[key]![1]), Number(row.targets[key]![1])])) } } : {}) } };
}

/** Partitions are induced from measured response differences. No action name,
 * object class, task, world identity or desired outcome enters this learner.
 * Calibration uses predictions made BEFORE each sample was learned. */
export class ContextualReadout {
  #circuits = new Map<string, Circuit>();
  #trees = new Map<string, Map<string, Tree>>();
  // Derived query summaries have no learning authority. Only nonempty real
  // categorical cohorts are cached, so each leaf has at most rows.length
  // entries; replaced tree leaves and their caches are garbage-collectable.
  #conditionalLeaves = new WeakMap<Leaf, Map<string, Leaf>>();
  #matching = new WeakMap<SensoryState, Map<string, readonly Sample[]>>();
  #recallBounds = new Map<string, Record<string, [number, number]>>();
  constructor(readonly capacity = 192) {
    if (!Number.isSafeInteger(capacity) || capacity < 32 || capacity > 2048) throw new Error('invalid-context-capacity');
  }
  #fit(rows: readonly Sample[], key: string, depth = 0): Tree {
    const base = summary(rows, key);
    if (rows.length < 16 || depth >= 6 || base.loss < 1e-8) return base.leaf;
    let best: { split: Omit<Branch, 'left' | 'right'>; left: Sample[]; right: Sample[]; gain: number } | null = null;
    const keys = [...new Set(rows.flatMap(row => Object.keys(row.input)))].sort();
    for (const feature of keys) {
      // A missing measurement has no observed side of this partition. It
      // remains retained evidence, but cannot erase the dependency or be
      // assigned to the convenient complement of a category.
      const observed = rows.filter(row => Object.hasOwn(row.input, feature));
      const values = [...new Set(observed.map(row => row.input[feature]!))];
      if (values.length < 2) continue;
      const compared = observed.length === rows.length ? base : summary(observed, key);
      if (compared.loss < 1e-8) continue;
      const numeric = values.every(value => typeof value === 'number');
      if (numeric) values.sort((a, b) => Number(a) - Number(b));
      // A split belongs between measured values. Placing it on an observed
      // value lets ordinary floating-point prediction error switch a known
      // context to the other branch (for example 2 -> 2.0000000000000004).
      const boundaries = numeric ? values.slice(0, -1).map((value, i) => Number(value) + (Number(values[i + 1]) - Number(value)) / 2) : values;
      const candidates = boundaries.filter((_, i) => i % Math.max(1, Math.ceil(boundaries.length / 12)) === 0);
      for (const threshold of candidates) {
        const split = { kind: 'branch' as const, key: feature, threshold, numeric,
          lower: numeric ? Number(values[0]) : 0, upper: numeric ? Number(values.at(-1)) : 0,
          categories: numeric ? [] : values };
        const left: Sample[] = [], right: Sample[] = [];
        for (const row of observed) (goesLeft(row.input[feature]!, split) ? left : right).push(row);
        if (left.length < 6 || right.length < 6) continue;
        const a = summary(left, key), b = summary(right, key);
        // Equal mean effects may have very different reliability. A region
        // with unpredictable outcomes cannot borrow another region's score.
        const gain = observed.length / rows.length * (1 - (a.loss + b.loss) / compared.loss + (compared.calibrationLoss > 1e-8
          ? 1 - (a.calibrationLoss + b.calibrationLoss) / compared.calibrationLoss : 0));
        if (gain > (best?.gain ?? 0) + .06) best = { split, left, right, gain };
      }
    }
    return best ? { ...best.split, left: this.#fit(best.left, key, depth + 1),
      right: this.#fit(best.right, key, depth + 1) } : base.leaf;
  }
  #rebuild(id: string): void {
    const samples = this.#circuits.get(id)!.samples;
    const keys = [...new Set(samples.flatMap(row => Object.keys(row.targets)))];
    this.#trees.set(id, new Map(keys.map(key => [key, this.#fit(samples.filter(row => key in row.targets), key)])));
  }
  #refresh(tree: Tree | TreeShape, rows: readonly Sample[], key: string): Tree {
    // Every new observation immediately refreshes outcomes, uncertainty and
    // prequential calibration. Only the costly search for NEW splits is
    // periodic. An old accurate mean cannot hide a fresh contradiction.
    if (!tree || tree.kind === 'leaf') return summary(rows, key).leaf;
    const observed = rows.filter(row => Object.hasOwn(row.input, tree.key)
      && (!tree.numeric || typeof row.input[tree.key] === 'number'));
    if (!observed.length) return summary(rows, key).leaf;
    const left = observed.filter(row => goesLeft(row.input[tree.key]!, tree)), right = observed.filter(row => !goesLeft(row.input[tree.key]!, tree));
    if (!left.length) return this.#refresh(tree.right, right, key);
    if (!right.length) return this.#refresh(tree.left, left, key);
    const values = tree.numeric ? observed.map(row => Number(row.input[tree.key])) : [0];
    return { kind: 'branch', key: tree.key, threshold: tree.threshold, numeric: tree.numeric,
      lower: Math.min(...values), upper: Math.max(...values),
      categories: tree.numeric ? [] : [...new Set(observed.map(row => row.input[tree.key]!))],
      left: this.#refresh(tree.left, left, key), right: this.#refresh(tree.right, right, key) };
  }
  #refreshCircuit(id: string, shapes: ReadonlyMap<string, Tree | TreeShape>): void {
    const samples = this.#circuits.get(id)!.samples, keys = [...new Set(samples.flatMap(row => Object.keys(row.targets)))];
    this.#trees.set(id, new Map(keys.map(key => [key, this.#refresh(shapes.get(key) ?? null,
      samples.filter(row => key in row.targets), key)])));
  }
  read(id: string, key: string, input: SensoryState, bounds: NumericRanges = {}): ConditionalValue | null {
    const root = this.#trees.get(id)?.get(key);
    if (!root) return null;
    const dependencies = new Set<string>();
    let outside = false;
    const visit = (tree: Tree, categories: readonly (readonly [string, PublicValue])[] = [],
      numericDomain?: string): Leaf[] => {
      if (tree.kind === 'leaf') {
        // A newly observed category may share a response leaf with an older
        // one. Its own real pre-update errors must earn support; merely
        // entering the observed set cannot inherit its sibling's count.
        if (!categories.length) return [tree];
        const identity = JSON.stringify(categories), cached = this.#conditionalLeaves.get(tree)?.get(identity);
        if (cached) return [cached];
        const rows = tree.rows.filter(row => categories.every(([feature, value]) =>
          Object.hasOwn(row.input, feature) && Object.is(row.input[feature], value)));
        if (!rows.length) { outside = true; return [tree]; }
        const local = rows.length === tree.rows.length ? tree : summary(rows, key).leaf;
        if (!outside) {
          const cohorts = this.#conditionalLeaves.get(tree) ?? new Map<string, Leaf>();
          cohorts.set(identity, local); this.#conditionalLeaves.set(tree, cohorts);
        }
        return [local];
      }
      dependencies.add(tree.key);
      const value = input[tree.key];
      if (!Object.hasOwn(input, tree.key) || value === undefined) {
        outside = true;
        return [...visit(tree.left, categories, numericDomain), ...visit(tree.right, categories, numericDomain)];
      }
      const range = bounds[tree.key];
      // The domain covers measured values with machine roundoff allowance,
      // not an arbitrary physical 0.1-unit extrapolation at every split.
      const roundoff = 8 * Number.EPSILON * Math.max(1, Math.abs(tree.lower), Math.abs(tree.upper));
      // Consecutive thresholds on one numeric coordinate partition its already
      // observed hull. Rechecking each child's sample extrema would reject
      // ordinary interpolation in the gap between two bracketing samples.
      // A different dependency starts a separately observed local hull.
      const checkDomain = numericDomain !== tree.key;
      const nextDomain = tree.numeric ? tree.key : undefined;
      if (tree.numeric && range) {
        if (range.length !== 2 || !range.every(Number.isFinite) || range[0] > range[1] || typeof value !== 'number'
          || value < range[0] - roundoff || value > range[1] + roundoff) outside = true;
        if (checkDomain && (range[0] < tree.lower - roundoff || range[1] > tree.upper + roundoff)) outside = true;
        if (range[0] <= Number(tree.threshold) && range[1] > Number(tree.threshold))
          return [...visit(tree.left, categories, nextDomain), ...visit(tree.right, categories, nextDomain)];
      }
      if (tree.numeric && (typeof value !== 'number' || !Number.isFinite(value)
        || checkDomain && (value < tree.lower - roundoff || value > tree.upper + roundoff))) outside = true;
      if (!tree.numeric && (!tree.categories.some(observed => Object.is(observed, value)) || range)) outside = true;
      return visit(goesLeft(value, tree) ? tree.left : tree.right,
        tree.numeric ? categories : [...categories, [tree.key, value]], nextDomain);
    };
    const leaves = visit(root), first = leaves[0]!;
    const same = leaves.every(leaf => leaf.absolute === first.absolute && (leaf.numeric && first.numeric
      ? Math.abs(Number(leaf.value) - Number(first.value)) <= .025 : Object.is(leaf.value, first.value)));
    if (!same) return null; // Missing context never selects a convenient outcome.
    return { value: first.value, absolute: first.absolute,
      supported: !outside && leaves.every(leaf => leaf.calibrated >= 8 && leaf.accuracy >= .8
        && leaf.errorRadius !== null
        && (leaf.numeric ? Math.sqrt(leaf.loss / leaf.samples) <= .05 : leaf.loss / leaf.samples <= .05)),
      samples: Math.min(...leaves.map(leaf => leaf.samples)), accuracy: Math.min(...leaves.map(leaf => leaf.accuracy)),
      error: Math.max(...leaves.map(leaf => leaf.error)), progress: Math.max(...leaves.map(leaf => leaf.progress)),
      externalCalibrated: Math.min(...leaves.map(leaf => leaf.externalCalibrated)),
      externalAccuracy: Math.min(...leaves.map(leaf => leaf.externalAccuracy)),
      externalSupported: !outside && leaves.every(leaf => leaf.externalCalibrated >= 8
        && leaf.externalAccuracy >= .8 && leaf.externalErrorRadius !== null),
      externalErrorRadius: leaves.some(leaf => leaf.externalErrorRadius === null) ? null
        : Math.max(...leaves.map(leaf => leaf.externalErrorRadius!)),
      dependencies: [...dependencies], ...(first.bounds ? { bounds: {
        delta: hull(leaves.map(leaf => leaf.bounds!.delta)), absolute: hull(leaves.map(leaf => leaf.bounds!.absolute)) } } : {}) };
  }
  counterexample(id: string, key: string, input: SensoryState, value: PublicValue, absolute: boolean):
    { value: PublicValue; absolute: boolean } | null {
    const circuit = this.#circuits.get(id);
    if (!circuit) return null;
    let byCircuit = this.#matching.get(input);
    if (!byCircuit) { byCircuit = new Map(); this.#matching.set(input, byCircuit); }
    let matching = byCircuit.get(id);
    if (!matching) {
      matching = [...circuit.samples].reverse().filter(row => row.serial >= circuit.writes - 64
        && Object.entries(row.input).every(([k, observed]) => {
        const current = input[k];
        return typeof observed === 'number' && typeof current === 'number'
          ? Math.abs(observed - current) <= .025 + .01 * Math.abs(observed) : Object.is(observed, current);
        }) && Object.keys(input).every(k => Object.hasOwn(row.input, k)));
      byCircuit.set(id, matching);
    }
    const row = matching.find(row => row.targets[key]);
    if (!row) return null;
    const [before, after] = row.targets[key]!;
    const numeric = typeof before === 'number' && typeof after === 'number' && typeof value === 'number';
    const predicted = numeric ? value + (absolute ? 0 : before) : value;
    const contradicted = numeric ? Math.abs(Number(predicted) - after) > tolerance(before, after) : !Object.is(predicted, after);
    return contradicted ? { value: numeric ? after - before : after, absolute: !numeric } : null;
  }
  /** Retrieve one joint measured response for an analogical probe. Proximity
   * is not predictive support, and independently averaged outcomes are not
   * stitched into a physical episode that never occurred. */
  recall(id: string, input: SensoryState, requestedTargets: readonly string[] = []):
    { input: SensoryState; targets: Readonly<Sample['targets']>; distance: number } | null {
    const circuit = this.#circuits.get(id); if (!circuit) return null;
    let bounds = this.#recallBounds.get(id);
    if (!bounds) {
      bounds = {};
      for (const row of circuit.samples) for (const [key, value] of Object.entries(row.input)) if (typeof value === 'number') {
        const range = bounds[key] ?? [value, value]; bounds[key] = [Math.min(range[0], value), Math.max(range[1], value)];
      }
      this.#recallBounds.set(id, bounds);
    }
    let best: { row: Sample; distance: number; measured: number } | null = null;
    for (const row of circuit.samples) {
      // The nearest overall scene may never have measured the channel being
      // asked about. Prefer actual coverage, then contextual proximity. Only
      // presence is queried: the desired outcome never selects the witness.
      const measured = requestedTargets.filter(key => Object.hasOwn(row.targets, key)).length;
      const keys = new Set([...Object.keys(input), ...Object.keys(row.input)]); let error = 0;
      for (const key of keys) {
        const a = input[key], b = row.input[key], range = bounds[key];
        error += typeof a === 'number' && typeof b === 'number'
          ? Math.min(4, Math.abs(a - b) / Math.max(.1, range ? range[1] - range[0] : .1)) ** 2
          : Number(!Object.is(a, b));
      }
      const distance = error / Math.max(1, keys.size);
      if (!best || measured > best.measured || measured === best.measured && (distance < best.distance - 1e-12
        || Math.abs(distance - best.distance) <= 1e-12 && row.serial > best.row.serial))
        best = { row, distance, measured };
    }
    return best ? { input: best.row.input, targets: best.row.targets, distance: best.distance } : null;
  }
  observe(id: string, input: SensoryState, targets: readonly MeasuredTarget[], externalErrors?: Record<string, number>): void {
    if (!targets.length) return;
    if ([...Object.values(input), ...targets.flatMap(([, a, b]) => [a, b]), ...Object.values(externalErrors ?? {})]
      .some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error('non-finite-context-measurement');
    this.#matching = new WeakMap();
    this.#recallBounds.delete(id);
    const circuit = this.#circuits.get(id) ?? { samples: [], writes: 0 };
    const errors: Record<string, number> = {};
    for (const [key, before, after] of targets) {
      const prior = this.read(id, key, input);
      if (!prior) continue;
      const numeric = typeof before === 'number' && typeof after === 'number' && typeof prior.value === 'number';
      const predicted = numeric ? Number(prior.value) + (prior.absolute ? 0 : before) : prior.value;
      errors[key] = numeric ? Math.min(20, Math.abs(Number(predicted) - after) / tolerance(before, after))
        : Object.is(predicted, after) ? 0 : 2;
    }
    circuit.samples.push({ input: structuredClone(input), targets: Object.fromEntries(targets.map(([k, a, b]) => [k, [a, b]])),
      errors, ...(externalErrors ? { externalErrors: { ...externalErrors } } : {}), serial: ++circuit.writes });
    this.#circuits.set(id, circuit);
    if (circuit.samples.length > this.capacity) {
      // Protect sparsely encountered response contexts. The oldest row in the
      // most populated learned region is expendable before an unrehearsed one.
      const informative = [...(this.#trees.get(id)?.values() ?? [])].filter(t => t.kind === 'branch').slice(0, 8);
      const path = (tree: Tree, row: Sample): string => tree.kind === 'leaf' ? '' :
        (goesLeft(row.input[tree.key] ?? null, tree) ? '0' + path(tree.left, row) : '1' + path(tree.right, row));
      const groups = new Map<string, Sample[]>();
      for (const row of circuit.samples) {
        const identity = informative.map(tree => path(tree, row)).join('/');
        const group = groups.get(identity) ?? []; group.push(row); groups.set(identity, group);
      }
      const largest = [...groups.values()].sort((a, b) => b.length - a.length || a[0]!.serial - b[0]!.serial)[0]!;
      circuit.samples.splice(circuit.samples.indexOf(largest[0]!), 1);
    }
    // Full split induction can take longer than the real sampling interval.
    // Reuse its partition between bounded structural updates; all retained
    // measurements still participate in the refreshed leaf statistics.
    if (circuit.writes <= 16 || circuit.writes % 16 === 0) this.#rebuild(id);
    else this.#refreshCircuit(id, this.#trees.get(id) ?? new Map());
  }
  keys(id: string): readonly string[] { return [...(this.#trees.get(id)?.keys() ?? [])]; }
  snapshot(): ContextualReadoutSnapshot {
    const shape = (tree: Tree): TreeShape => tree.kind === 'leaf' ? null : { kind: 'branch', key: tree.key,
      threshold: tree.threshold, numeric: tree.numeric, left: shape(tree.left), right: shape(tree.right) };
    return structuredClone({ version: 'ContextualReadout2', capacity: this.capacity, circuits: [...this.#circuits],
      structures: [...this.#trees].map(([id, trees]) => [id, [...trees].map(([key, tree]) => [key, shape(tree)])]) });
  }
  static restore(state: ContextualReadoutSnapshot): ContextualReadout {
    if (!['ContextualReadout1', 'ContextualReadout2'].includes(state.version)) throw new Error('contextual-readout-version-mismatch');
    const model = new ContextualReadout(state.capacity);
    const structures = new Map(state.structures ?? []);
    const validShape = (shape: TreeShape, depth = 0): boolean => shape === null || Boolean(shape && depth < 6
      && shape.kind === 'branch' && typeof shape.key === 'string' && shape.key.length
      && typeof shape.numeric === 'boolean' && (shape.numeric ? typeof shape.threshold === 'number' && Number.isFinite(shape.threshold)
        : shape.threshold === null || ['string', 'boolean'].includes(typeof shape.threshold)
          || typeof shape.threshold === 'number' && Number.isFinite(shape.threshold))
      && validShape(shape.left, depth + 1) && validShape(shape.right, depth + 1));
    if (state.version === 'ContextualReadout2' && (!state.structures || structures.size !== state.circuits.length
      || structures.size !== state.structures.length || state.structures.some(([, rows]) =>
        new Set(rows.map(([key]) => key)).size !== rows.length || rows.some(([, shape]) => !validShape(shape)))))
      throw new Error('invalid-contextual-structure-checkpoint');
    for (const [id, circuit] of structuredClone(state.circuits)) {
      if (model.#circuits.has(id) || !Number.isSafeInteger(circuit.writes) || circuit.writes < 1
        || circuit.samples.length > state.capacity || !circuit.samples.length
        || circuit.samples.some(row => !Number.isSafeInteger(row.serial) || row.serial < 1 || row.serial > circuit.writes
          || [...Object.values(row.input), ...Object.values(row.targets).flat(), ...Object.values(row.errors), ...Object.values(row.externalErrors ?? {})]
            .some(v => typeof v === 'number' && !Number.isFinite(v)))) throw new Error('invalid-contextual-snapshot');
      model.#circuits.set(id, circuit);
      if (state.version === 'ContextualReadout1') model.#rebuild(id);
      else {
        const shape = structures.get(id), keys = [...new Set(circuit.samples.flatMap(row => Object.keys(row.targets)))];
        if (!shape || keys.length !== shape.length || keys.some(key => !shape.some(([name]) => name === key)))
          throw new Error('contextual-structure-does-not-match-observed-targets');
        model.#refreshCircuit(id, new Map(shape));
      }
    }
    return model;
  }
}
