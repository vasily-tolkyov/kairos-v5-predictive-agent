import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Action, ActionCue, BodyResult, Observation, PublicChange, RealEvent } from '../contracts.js';
import type { ActionObservationScopeV1 } from '../control/contracts.js';
import { ExperienceMediaStore } from '../core/learning/experience-store.js';
import { R2_CONFIG } from '../core/config.js';
import { eventPathGeometry, rawGeometryDistance } from '../core/learning/path-projector.js';
import { DistanceEmbedding } from '../distance-embedding.js';
import { actionObservationTrackedIdsV1, cueFor, cueIdentity, eventRows, validateEvent } from '../events.js';
import { PhysicalMemory, type MemoryObservationReceipt, type MemorySnapshot } from '../memory.js';
import { canonical, fileSha, sha } from '../util.js';
import { MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1 } from './minecraft-multilevel-guided-training-live-v1.js';

/** Sealed inputs from the only 256-event live guided-training run. */
export const MINECRAFT_MULTILEVEL_RUN003_RAW_INPUTS_V1 = Object.freeze({
  events: Object.freeze({ filename: 'events.jsonl',
    sha256: '76fde5654195c1562a827daa24dbfaf1f7e2606240071cfd1c7b368268e6bdcc' }),
  frames: Object.freeze({ filename: 'frames.jsonl',
    sha256: 'cbd404178cb2d82b80b5c877e26fcc33ed54a5874659c77927d4f7660ae58159' }),
});

interface JsonLineRecord { readonly kind: string; readonly value: unknown }
interface GuidedTimelineRowV1 {
  readonly action: Action;
  readonly changes: readonly PublicChange[];
  readonly contextId: string;
  readonly eventId: string;
  readonly observationWindow: readonly [number, number];
  readonly receipt: MemoryObservationReceipt;
  readonly scope: ActionObservationScopeV1;
  readonly episode: { readonly mode: string; readonly half: string; readonly episode: number };
}

const PAIRED_FAMILIES = Object.freeze({
  'look-plus-15': ['look-plus-15-acquire', 'look-plus-15-away'],
  'look-minus-15': ['look-minus-15-acquire', 'look-minus-15-away'],
  'move-forward': ['forward-reduce-distance', 'forward-blocked'],
  'move-left': ['left-clear', 'left-blocked'],
  'move-right': ['right-clear', 'right-blocked'],
  'jump-forward': ['jump-forward-clear-one-block', 'jump-forward-blocked-low-roof-high-obstacle'],
  'interact-stone-button': ['interact-wired-button-opens-iron-door',
    'interact-visible-disconnected-button-no-door-change'],
} satisfies Readonly<Record<keyof typeof MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1,
  readonly [string, string]>>);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function readJsonLines(path: string): Promise<readonly JsonLineRecord[]> {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean)
    .map(line => JSON.parse(line) as JsonLineRecord);
}

function changeMultiset(changes: readonly PublicChange[]): readonly string[] {
  return changes.map(change => canonical(change)).sort();
}

type NumericPoint = ArrayLike<number>;

function distance(left: NumericPoint, right: NumericPoint): number {
  const deltas: number[] = [];
  for (let index = 0; index < left.length; index += 1) deltas.push(left[index]! - right[index]!);
  return Math.hypot(...deltas);
}

function componentSizes(points: readonly NumericPoint[], radius: number, multiplier = 1): readonly number[] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) { const next = parent[index]!; parent[index] = root; index = next; }
    return root;
  };
  const join = (left: number, right: number): void => {
    const a = find(left), b = find(right); if (a !== b) parent[b] = a;
  };
  for (let left = 0; left < points.length; left += 1) for (let right = left + 1; right < points.length; right += 1) {
    if (distance(points[left]!, points[right]!) * multiplier <= radius * (1 + 1e-12)) join(left, right);
  }
  const sizes = new Map<number, number>();
  for (let index = 0; index < points.length; index += 1) {
    const root = find(index); sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  return [...sizes.values()].sort((left, right) => right - left);
}

function distribution(values: readonly number[], threshold: number): Readonly<Record<string, number | null>> {
  if (values.length === 0) return { count: 0, minimum: null, median: null, mean: null, maximum: null,
    atOrBelowBasinRadius: 0, fractionAtOrBelowBasinRadius: 0 };
  const ordered = [...values].sort((left, right) => left - right);
  const atOrBelow = ordered.filter(value => value <= threshold * (1 + 1e-12)).length;
  return { count: ordered.length, minimum: ordered[0]!, median: ordered[Math.floor(ordered.length / 2)]!,
    mean: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
    maximum: ordered.at(-1)!, atOrBelowBasinRadius: atOrBelow,
    fractionAtOrBelowBasinRadius: atOrBelow / ordered.length };
}

function pairDistances(left: readonly NumericPoint[], right: readonly NumericPoint[],
  sameSet: boolean): readonly number[] {
  const result: number[] = [];
  for (let a = 0; a < left.length; a += 1) for (let b = sameSet ? a + 1 : 0; b < right.length; b += 1) {
    result.push(distance(left[a]!, right[b]!));
  }
  return result;
}

function multiply(matrix: readonly Float64Array[], vector: Float64Array): Float64Array {
  return Float64Array.from(matrix, row => row.reduce((sum, value, index) => sum + value * vector[index]!, 0));
}

function dot(left: Float64Array, right: Float64Array): number {
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0);
}

/** Exact evaluation-only copy of the production fit target construction. */
function classicalMdsTargets(distances: readonly Float64Array[]): readonly (readonly number[])[] {
  const n = distances.length, rowMeans = new Float64Array(n); let grandMean = 0;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1)
      rowMeans[row] = rowMeans[row]! + distances[row]![column]! ** 2;
    rowMeans[row] = rowMeans[row]! / n; grandMean += rowMeans[row]!;
  }
  grandMean /= n;
  const gram = Array.from({ length: n }, (_, row) => Float64Array.from({ length: n }, (_, column) =>
    -0.5 * (distances[row]![column]! ** 2 - rowMeans[row]! - rowMeans[column]! + grandMean)));
  const eigenvectors: Float64Array[] = [], eigenvalues: number[] = [];
  for (let component = 0; component < 3; component += 1) {
    let vector = Float64Array.from({ length: n }, (_, index) => Math.sin((index + 1) * (component + 1) * 1.618));
    for (let iteration = 0; iteration < 160; iteration += 1) {
      const next = multiply(gram, vector);
      for (const previous of eigenvectors) {
        const projection = dot(next, previous);
        for (let index = 0; index < n; index += 1)
          next[index] = next[index]! - projection * previous[index]!;
      }
      const magnitude = Math.sqrt(dot(next, next)); if (magnitude <= 1e-12) break;
      for (let index = 0; index < n; index += 1) next[index] = next[index]! / magnitude;
      vector = new Float64Array(next);
    }
    eigenvectors.push(vector); eigenvalues.push(Math.max(0, dot(vector, multiply(gram, vector))));
  }
  return Array.from({ length: n }, (_, index) => [
    eigenvectors[0]![index]! * Math.sqrt(eigenvalues[0]!),
    eigenvectors[1]![index]! * Math.sqrt(eigenvalues[1]!),
    eigenvectors[2]![index]! * Math.sqrt(eigenvalues[2]!),
  ]);
}

export interface MinecraftMultilevelRun003ReconstructionV1 {
  readonly events: readonly RealEvent[];
  readonly timeline: readonly GuidedTimelineRowV1[];
  readonly inputAudit: Readonly<Record<string, { readonly filename: string; readonly sha256: string;
    readonly bytes: number }>>;
  readonly frameCount: number;
  readonly eventFrameCount: number;
  readonly exactBodyReceiptMatches: number;
  readonly exactChangeMultisetMatches: number;
}

export async function reconstructMinecraftMultilevelRun003V1(sourceDirectory: string):
Promise<MinecraftMultilevelRun003ReconstructionV1> {
  const inputAudit: Record<string, { filename: string; sha256: string; bytes: number }> = {};
  for (const [name, identity] of Object.entries(MINECRAFT_MULTILEVEL_RUN003_RAW_INPUTS_V1)) {
    const path = resolve(sourceDirectory, identity.filename);
    const [actual, metadata] = await Promise.all([fileSha(path), stat(path)]);
    invariant(actual === identity.sha256, `run003-input-identity-mismatch:${name}:${actual}`);
    inputAudit[name] = { ...identity, bytes: metadata.size };
  }
  const frameRecords = await readJsonLines(resolve(sourceDirectory,
    MINECRAFT_MULTILEVEL_RUN003_RAW_INPUTS_V1.frames.filename));
  const observations = new Map<number, Observation>();
  for (const record of frameRecords) if (record.kind === 'frame') {
    const frame = record.value as Observation;
    invariant(!observations.has(frame.sequence), `run003-duplicate-frame:${frame.sequence}`);
    observations.set(frame.sequence, frame);
  }
  const eventRecords = await readJsonLines(resolve(sourceDirectory,
    MINECRAFT_MULTILEVEL_RUN003_RAW_INPUTS_V1.events.filename));
  const timeline = eventRecords.filter(record => record.kind === 'multilevel-guided-training-event')
    .map(record => record.value as GuidedTimelineRowV1);
  const bodyResults = eventRecords.filter(record => record.kind === 'body-result')
    .map(record => record.value as BodyResult);
  invariant(timeline.length === 256, `run003-guided-event-count:${timeline.length}`);
  invariant(new Set(timeline.map(row => row.eventId)).size === 256, 'run003-duplicate-event-id');
  let eventFrameCount = 0, exactBodyReceiptMatches = 0, exactChangeMultisetMatches = 0;
  const events = timeline.map((row): RealEvent => {
    const [start, end] = row.observationWindow;
    const frames: Observation[] = [];
    for (let sequence = start; sequence <= end; sequence += 1) {
      const frame = observations.get(sequence);
      invariant(frame, `run003-missing-event-frame:${row.eventId}:${sequence}`); frames.push(frame);
    }
    eventFrameCount += frames.length;
    invariant(frames[0]!.contextId === row.contextId, `run003-context-mismatch:${row.eventId}`);
    const receipts = bodyResults.filter(receipt => receipt.startSequence === start && receipt.endSequence === end
      && canonical(receipt.action) === canonical(row.action));
    invariant(receipts.length === 1, `run003-body-receipt-count:${row.eventId}:${receipts.length}`);
    exactBodyReceiptMatches += 1;
    const action = structuredClone(row.action);
    const event: RealEvent = { version: 'RealEventV5', id: row.eventId, cue: cueFor(action, frames[0]!), frames,
      trackedIds: actionObservationTrackedIdsV1(action.targetId, row.scope, [], frames),
      bodyResult: structuredClone(receipts[0]!), provenance: 'executed-real-body', complete: true };
    validateEvent(event);
    const actual = changeMultiset(eventRows(event).changes.flat()), expected = changeMultiset(row.changes);
    invariant(canonical(actual) === canonical(expected), `run003-public-change-multiset-mismatch:${row.eventId}`);
    exactChangeMultisetMatches += 1;
    return event;
  });
  for (let index = 1; index < events.length; index += 1) {
    invariant(events[index]!.frames[0]!.activeSeconds > events[index - 1]!.frames.at(-1)!.activeSeconds,
      `run003-event-time-order:${events[index]!.id}`);
  }
  return { events, timeline, inputAudit, frameCount: observations.size, eventFrameCount,
    exactBodyReceiptMatches, exactChangeMultisetMatches };
}

export interface MinecraftMultilevelRun003ReplayAuditV1 {
  readonly version: 'MinecraftMultilevelRun003ReplayAuditV1';
  readonly inputAudit: MinecraftMultilevelRun003ReconstructionV1['inputAudit'];
  readonly frameCount: number;
  readonly eventFrameCount: number;
  readonly exactBodyReceiptMatches: number;
  readonly exactChangeMultisetMatches: number;
  readonly exactMemoryReceiptMatches: number;
  readonly writes: number;
  readonly mapSha256: string;
  readonly snapshotSha256: string;
  readonly restoreCanonicalEqual: boolean;
  readonly projectorResolution: unknown;
  readonly legacyEquivalenceScale: number | null;
  readonly basinAlignedEquivalenceScale: number | null;
  readonly basinAlignedScaleMultiplierFromActual: number | null;
  readonly calibrationComponentsAtActualScale: readonly number[];
  readonly calibrationComponentsAtBasinAlignedScale: readonly number[];
  readonly physicalR2BasinSizes: readonly number[];
  readonly r2a: Readonly<Record<string, number>>;
  readonly coreCues: Readonly<Record<string, unknown>>;
}

export function auditMinecraftMultilevelRun003SnapshotV1(snapshot: MemorySnapshot,
  reconstruction: MinecraftMultilevelRun003ReconstructionV1,
  exactMemoryReceiptMatches: number): MinecraftMultilevelRun003ReplayAuditV1 {
  invariant(snapshot.eventMap && snapshot.projector && snapshot.r2a, 'run003-replay-not-initialized');
  const r2a = snapshot.r2a;
  const store = new ExperienceMediaStore(snapshot.store);
  const basinKeys = new Map<string, readonly string[]>();
  for (const visit of snapshot.store.coactivations) {
    const basin = store.resolveActiveR2Basin(visit.coactivationId);
    invariant(basin, `run003-r2-visit-unresolved:${visit.coactivationId}`);
    basinKeys.set(canonical([...basin.memberVisitIds].sort()), basin.memberVisitIds);
  }
  const physicalR2BasinSizes = [...basinKeys.values()].map(value => value.length)
    .sort((left, right) => right - left);
  const visitByAnchor = new Map(snapshot.store.coactivations.map(visit => [visit.experienceAnchorId, visit]));
  const annotationByEvent = new Map(snapshot.annotations.map(annotation => [annotation.eventId, annotation]));
  const basinKeyByEvent = new Map<string, string>();
  for (const annotation of snapshot.annotations) {
    const visit = visitByAnchor.get(annotation.anchorId);
    invariant(visit, `run003-annotation-visit-missing:${annotation.eventId}`);
    const basin = store.resolveActiveR2Basin(visit.coactivationId);
    invariant(basin, `run003-annotation-basin-missing:${annotation.eventId}`);
    basinKeyByEvent.set(annotation.eventId, canonical([...basin.memberVisitIds].sort()));
  }
  const production = r2a.hyperedges.filter(edge => edge.factorIds.length === 1
    ? edge.state === 'stable' : edge.state === 'minimal-under-tested-interventions');
  const radius = R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale;
  const coreCues: Record<string, unknown> = Object.fromEntries(Object.entries(
    MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1)
    .map(([name, cue]) => {
      const [firstMode, secondMode] = PAIRED_FAMILIES[name as keyof typeof PAIRED_FAMILIES];
      const firstRows = reconstruction.timeline.filter(row => row.episode.mode === firstMode);
      const secondRows = reconstruction.timeline.filter(row => row.episode.mode === secondMode);
      const firstCoordinates = firstRows.map(row => annotationByEvent.get(row.eventId)?.r2Coordinate)
        .filter((value): value is readonly number[] => value !== undefined);
      const secondCoordinates = secondRows.map(row => annotationByEvent.get(row.eventId)?.r2Coordinate)
        .filter((value): value is readonly number[] => value !== undefined);
      const firstBasins = [...new Set(firstRows.map(row => basinKeyByEvent.get(row.eventId)))].filter(Boolean);
      const secondBasins = [...new Set(secondRows.map(row => basinKeyByEvent.get(row.eventId)))].filter(Boolean);
      const sharedBasins = firstBasins.filter(value => secondBasins.includes(value));
      const cueKey = cueIdentity(cue as ActionCue);
      const cueEdges = r2a.hyperedges.filter(edge => edge.interventionKey === cueKey);
      const factorIds = new Set(cueEdges.flatMap(edge => edge.factorIds));
      const factors = r2a.factorNodes.filter(node => factorIds.has(node.factorId));
      return [name, { cueIdentity: cueKey, firstMode, secondMode, firstEvents: firstRows.length,
        secondEvents: secondRows.length, firstBasinCount: firstBasins.length,
        secondBasinCount: secondBasins.length, sharedBasinCount: sharedBasins.length,
        pairedOutcomeFamiliesMerged: sharedBasins.length > 0,
        withinFirstDistances: distribution(pairDistances(firstCoordinates, firstCoordinates, true), radius),
        withinSecondDistances: distribution(pairDistances(secondCoordinates, secondCoordinates, true), radius),
        betweenFamilyDistances: distribution(pairDistances(firstCoordinates, secondCoordinates, false), radius),
        edgeCount: cueEdges.length, productionRelationIds: production.filter(edge => edge.interventionKey === cueKey)
          .map(edge => edge.hyperedgeId).sort(),
        edgeStates: Object.fromEntries([...new Set(cueEdges.map(edge => edge.state))].sort()
          .map(state => [state, cueEdges.filter(edge => edge.state === state).length])),
        factorCount: factors.length, factorStates: Object.fromEntries([...new Set(factors.map(node => node.state))]
          .sort().map(state => [state, factors.filter(node => node.state === state).length])),
        maximumFactorSupport: Math.max(0, ...factors.map(node => node.supportStrength)),
        maximumFactorContextCount: Math.max(0, ...factors.map(node => node.sourceContextIds.length)),
        maximumFactorSelectionGain: Math.max(0, ...factors.map(node => node.r2SelectionGain)),
      }];
    }));
  const resolution = snapshot.projector.resolution;
  const variation = resolution.equivalentVariationMaximum;
  const legacyEquivalenceScale = variation === 0 ? null : R2_CONFIG.kernelWidth / variation;
  const basinEquivalenceCap = variation === 0 ? null : radius / variation;
  const basinAlignedEquivalenceScale = basinEquivalenceCap === null
    ? resolution.boundaryLimitedScale
    : resolution.boundaryLimitedScale === null ? basinEquivalenceCap
      : Math.min(basinEquivalenceCap, resolution.boundaryLimitedScale);
  const multiplier = basinAlignedEquivalenceScale === null ? null
    : basinAlignedEquivalenceScale / resolution.outputScale;
  const calibrationCoordinates = snapshot.annotations.slice(0, 128).map(value => value.r2Coordinate);
  const eventMap = new DistanceEmbedding(snapshot.eventMap);
  const geometryByEvent = new Map(reconstruction.events.map(event => [event.id, eventPathGeometry(
    eventRows(event).rows.map(row => new Float64Array(eventMap.encode(row).coordinate)))]));
  const calibrationGeometries = reconstruction.events.slice(0, 128).map(event => geometryByEvent.get(event.id)!);
  const rawDistanceMatrix = calibrationGeometries.map(left => Float64Array.from(calibrationGeometries,
    right => rawGeometryDistance(left, right)));
  const mdsTargets = classicalMdsTargets(rawDistanceMatrix);
  const mdsTargetByEvent = new Map(reconstruction.events.slice(0, 128)
    .map((event, index) => [event.id, mdsTargets[index]!] as const));
  for (const [name, metrics] of Object.entries(coreCues)) {
    const value = metrics as Record<string, unknown>;
    const firstMode = value.firstMode as string, secondMode = value.secondMode as string;
    const firstRows = reconstruction.timeline.filter(row => row.episode.mode === firstMode);
    const secondRows = reconstruction.timeline.filter(row => row.episode.mode === secondMode);
    const firstGeometry = firstRows.map(row => geometryByEvent.get(row.eventId)!);
    const secondGeometry = secondRows.map(row => geometryByEvent.get(row.eventId)!);
    const firstTargets = firstRows.map(row => mdsTargetByEvent.get(row.eventId))
      .filter((point): point is readonly number[] => point !== undefined);
    const secondTargets = secondRows.map(row => mdsTargetByEvent.get(row.eventId))
      .filter((point): point is readonly number[] => point !== undefined);
    value.rawEventGeometryDistances = {
      withinFirst: distribution(pairDistances(firstGeometry, firstGeometry, true), radius),
      withinSecond: distribution(pairDistances(secondGeometry, secondGeometry, true), radius),
      betweenFamilies: distribution(pairDistances(firstGeometry, secondGeometry, false), radius),
    };
    value.classicalMdsCalibrationTargetDistances = {
      firstCalibrationEvents: firstTargets.length, secondCalibrationEvents: secondTargets.length,
      withinFirst: distribution(pairDistances(firstTargets, firstTargets, true), radius),
      withinSecond: distribution(pairDistances(secondTargets, secondTargets, true), radius),
      betweenFamilies: distribution(pairDistances(firstTargets, secondTargets, false), radius),
    };
    coreCues[name] = value;
  }
  const restored = PhysicalMemory.restore(snapshot);
  return { version: 'MinecraftMultilevelRun003ReplayAuditV1', inputAudit: reconstruction.inputAudit,
    frameCount: reconstruction.frameCount, eventFrameCount: reconstruction.eventFrameCount,
    exactBodyReceiptMatches: reconstruction.exactBodyReceiptMatches,
    exactChangeMultisetMatches: reconstruction.exactChangeMultisetMatches,
    exactMemoryReceiptMatches, writes: snapshot.writes, mapSha256: sha(snapshot.eventMap),
    snapshotSha256: sha(snapshot), restoreCanonicalEqual: canonical(restored.snapshot()) === canonical(snapshot),
    projectorResolution: structuredClone(resolution), legacyEquivalenceScale,
    basinAlignedEquivalenceScale, basinAlignedScaleMultiplierFromActual: multiplier,
    calibrationComponentsAtActualScale: componentSizes(calibrationCoordinates, radius),
    calibrationComponentsAtBasinAlignedScale: componentSizes(calibrationCoordinates, radius, multiplier ?? 1),
    physicalR2BasinSizes,
    r2a: { eventSummaries: snapshot.r2a.eventSummaries.length, factorNodes: snapshot.r2a.factorNodes.length,
      stableFactorNodes: snapshot.r2a.factorNodes.filter(node => node.state === 'stable').length,
      hyperedges: snapshot.r2a.hyperedges.length, productionHyperedges: production.length,
      provisionalHyperedges: snapshot.r2a.hyperedges.filter(edge => edge.state === 'provisional').length,
      unresolvedCompositeHyperedges: snapshot.r2a.hyperedges.filter(edge => edge.state === 'unresolved-composite').length },
    coreCues };
}

export async function replayMinecraftMultilevelRun003V1(sourceDirectory: string,
  onProgress?: (completed: number) => void): Promise<{ readonly snapshot: MemorySnapshot;
    readonly audit: MinecraftMultilevelRun003ReplayAuditV1 }> {
  const reconstruction = await reconstructMinecraftMultilevelRun003V1(sourceDirectory);
  const memory = new PhysicalMemory(); let exactMemoryReceiptMatches = 0;
  for (let index = 0; index < reconstruction.events.length; index += 1) {
    const receipt = memory.observe(reconstruction.events[index]!);
    invariant(canonical(receipt) === canonical(reconstruction.timeline[index]!.receipt),
      `run003-memory-receipt-mismatch:${index + 1}`);
    exactMemoryReceiptMatches += 1;
    if ((index + 1) % 32 === 0) onProgress?.(index + 1);
  }
  const snapshot = memory.snapshot();
  return { snapshot, audit: auditMinecraftMultilevelRun003SnapshotV1(snapshot, reconstruction,
    exactMemoryReceiptMatches) };
}
