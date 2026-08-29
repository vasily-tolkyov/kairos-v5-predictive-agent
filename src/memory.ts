import type { ActionCue, DesiredChange, Observation, Prediction, PublicChange, RealEvent } from './contracts.js';
import type { R1TraceSnapshot, RawExperience, Vec3 } from './core/contracts.js';
import { emptyFirewallRejections, emptyLeakageAudit, ObservationGate } from './core/firewall.js';
import { ExperienceMediaStore } from './core/learning/experience-store.js';
import { PathProjector, pathInitialTangent, r1RouteSignature } from './core/learning/path-projector.js';
import { DeterministicTokenFieldEncoder } from './core/learning/token-field.js';
import { OpenCausalFactorR2A } from './core/learning/open-causal-factor-r2a.js';
import { ActionConditionedRuleQuery } from './core/learning/action-conditioned-rule-query.js';
import { PredictionClone, transportTraceSnapshot } from './core/prediction/prediction-clone.js';
import { SplitMix64 } from './core/random.js';
import { R1_CONFIG } from './core/config.js';
import { DistanceEmbedding, type EmbeddingState } from './distance-embedding.js';
import { cueIdentity, eventRows, relativePublicFeatures, validateEvent } from './events.js';
import { assert, canonical, sha } from './util.js';

interface TraceAnnotation {
  readonly eventId: string; readonly anchorId: string; readonly pageId: string; readonly traceId: string;
  readonly cue: ActionCue; readonly context: ReturnType<typeof relativePublicFeatures>; readonly contextId: string;
  readonly r2Coordinate: readonly number[];
  /** Local public readout labels belong to real R1 kernels, not an external outcome template. */
  readonly kernelChanges: readonly (readonly PublicChange[])[];
}
export interface MemorySnapshot {
  readonly version: 'KairosV5Memory'; readonly activeSeconds: number;
  readonly eventMap: EmbeddingState | null; readonly contextKeys: readonly string[];
  readonly projector: ReturnType<PathProjector['exportState']> | null;
  readonly tokenEncoder: ReturnType<DeterministicTokenFieldEncoder['exportState']> | null;
  readonly store: ReturnType<ExperienceMediaStore['exportCheckpointState']>;
  readonly r2a: ReturnType<OpenCausalFactorR2A['exportState']> | null;
  readonly annotations: readonly TraceAnnotation[];
  readonly pendingInitialization: readonly RealEvent[];
  readonly seenEventIds: readonly string[];
  readonly writes: number;
}

export function matches(change: PublicChange, desired: DesiredChange): boolean {
  if (desired.subject && change.subject !== desired.subject && !change.subject.startsWith(desired.subject + '#')) return false;
  if (desired.property && change.property !== desired.property) return false;
  if (desired.value !== undefined && change.after !== desired.value) return false;
  if (desired.direction === 'increase') return typeof change.before === 'number' && typeof change.after === 'number' && change.after > change.before;
  if (desired.direction === 'decrease') return typeof change.before === 'number' && typeof change.after === 'number' && change.after < change.before;
  if (desired.direction === 'unchanged') return change.before === change.after;
  return desired.direction !== 'change' || change.before !== change.after;
}
export interface ReadoutBoundary {
  readonly kernelOffset: number;
  /** Inclusive original-kernel boundary. Hypothetical actions have no observed prefix. */
  readonly observedThroughOriginalKernelIndex: number | null;
}
export function readVisitedRegions(snapshot: R1TraceSnapshot, trajectory: readonly Vec3[],
  annotations: readonly (readonly PublicChange[])[], boundary: ReadoutBoundary = { kernelOffset: 0, observedThroughOriginalKernelIndex: null }
): { readout: Prediction['samples'][number]['readout']; reason: string | null } {
  assert(Number.isInteger(boundary.kernelOffset) && boundary.kernelOffset >= 0
    && (boundary.observedThroughOriginalKernelIndex === null || Number.isInteger(boundary.observedThroughOriginalKernelIndex)
      && boundary.observedThroughOriginalKernelIndex >= 0), 'invalid-readout-boundary');
  const readout: Array<Prediction['samples'][number]['readout'][number]> = [];
  const visited = new Set<number>(); let collision = false;
  trajectory.forEach((position, sampleStep) => {
    if (sampleStep === 0) return;
    const local = snapshot.kernels.map((kernel, kernelIndex) => ({ kernelIndex, kernel,
      distance: Math.hypot(...position.map((value, axis) => value - kernel.center[axis]!)) }))
      .filter(item => item.distance <= item.kernel.sigma * .25 && item.kernel.coefficient < -1e-7)
      .sort((a, b) => a.distance - b.distance);
    const nearest = local[0]; if (!nearest) return;
    // Competing concrete values at indistinguishable locations are uncertainty, never label completion.
    const sameLocation = local.filter(item => Math.abs(item.distance - nearest.distance) < 1e-6);
    const values = new Map<string, unknown>();
    for (const item of sameLocation) for (const change of annotations[item.kernelIndex] ?? []) {
      const key = `${change.subject}/${change.property}`;
      if (values.has(key) && values.get(key) !== change.after) collision = true;
      values.set(key, change.after);
    }
    if (collision || visited.has(nearest.kernelIndex)) return;
    visited.add(nearest.kernelIndex);
    const originalKernelIndex = boundary.kernelOffset + nearest.kernelIndex;
    // Keep observed kernels in the ambiguity comparison and in the physical simulation.
    // Only their already-observed labels lose eligibility as a future result.
    if (boundary.observedThroughOriginalKernelIndex !== null && originalKernelIndex <= boundary.observedThroughOriginalKernelIndex) return;
    const changes = annotations[nearest.kernelIndex] ?? [];
    if (changes.length > 0) readout.push({ sampleStep, kernelIndex: nearest.kernelIndex, originalKernelIndex, distance: nearest.distance,
      potential: nearest.kernel.coefficient * Math.exp(-.5 * (nearest.distance / nearest.kernel.sigma) ** 2), changes });
  });
  return { readout: collision ? [] : readout,
    reason: collision ? 'indistinguishable-local-outcomes' : readout.length === 0 ? 'random-trajectory-did-not-reach-readout' : null };
}

export class PhysicalMemory {
  #store = new ExperienceMediaStore();
  #map: DistanceEmbedding | null = null;
  #projector = new PathProjector();
  #encoder = new DeterministicTokenFieldEncoder();
  #r2a = new OpenCausalFactorR2A(this.#encoder);
  #contextKeys: string[] = [];
  #annotations: TraceAnnotation[] = [];
  #pending: RealEvent[] = [];
  #seen = new Set<string>();
  #activeSeconds = 0;
  #writes = 0;
  readonly #audit = emptyLeakageAudit();
  readonly #rejections = emptyFirewallRejections();
  readonly #gate = new ObservationGate(this.#audit, this.#rejections);
  readonly #query = new ActionConditionedRuleQuery();
  readonly #clone = new PredictionClone(this.#audit, this.#rejections);

  get ready(): boolean { return this.#map !== null; }
  get writes(): number { return this.#writes; }
  get bufferedEvents(): number { return this.#pending.length; }
  get mapSha256(): string | null { return this.#map ? sha(this.#map.state) : null; }
  advanceTo(activeSeconds: number): void {
    assert(Number.isFinite(activeSeconds) && activeSeconds >= this.#activeSeconds, 'active-observation-time-reversed');
    if (this.ready) { const elapsed = activeSeconds - this.#store.logicalTime;
      this.#store.recoverAll(elapsed); this.#r2a.recover(elapsed, true); }
    this.#activeSeconds = activeSeconds;
  }
  observe(event: RealEvent): { status: string; writes: number; buffered: number; mapSha256: string | null } {
    validateEvent(event); assert(!this.#seen.has(event.id), 'real-event-already-observed');
    const end = event.frames.at(-1)!.activeSeconds;
    assert(end >= this.#activeSeconds, 'event-arrived-after-time-was-advanced-past-it');
    if (!this.ready) {
      this.#pending.push(structuredClone(event)); this.#seen.add(event.id); this.#activeSeconds = end;
      if (this.#pending.length === 128) this.#initialize(this.#pending);
    } else { this.advanceTo(end); this.#deposit(event); this.#seen.add(event.id); }
    return { status: this.ready ? 'real-event-deposited' : 'initialization-buffer', writes: this.#writes,
      buffered: this.bufferedEvents, mapSha256: this.mapSha256 };
  }
  #initialize(events: readonly RealEvent[]): void {
    assert(this.#map === null && events.length === 128, 'single-128-real-event-initialization-only');
    const series = events.map(eventRows);
    const embedding = DistanceEmbedding.fit(series.flatMap(value => value.rows));
    let maxGap = 0;
    for (const event of series) {
      const points = event.rows.map(row => embedding.encode(row).coordinate);
      for (let i = 1; i < points.length; i++) maxGap = Math.max(maxGap, Math.hypot(...points[i]!.map((v, j) => v - points[i - 1]![j]!)));
    }
    assert(maxGap > 1e-12, 'event-map-collapsed');
    // Scale is derived once from real adjacent observations and the existing R1 kernel width.
    // No extra samples are inserted. Unseen events exceeding this scale are reported, not interpolated.
    this.#map = new DistanceEmbedding({ ...embedding.state, scale: R1_CONFIG.kernelWidth * .4 / maxGap });
    const contexts = events.map(event => relativePublicFeatures(event.frames[0]!));
    const keys = [...new Set(contexts.flatMap(row => Object.keys(row)))];
    // Slots are calibrated public features, not hashed meanings or world-to-R1 coordinates.
    this.#contextKeys = keys.sort((a, b) => {
      const energy = (key: string) => contexts.reduce((s, row) => s + (row[key] ?? 0) ** 2, 0);
      return energy(b) - energy(a) || a.localeCompare(b);
    }).slice(0, 256);
    const admitted = events.map(event => this.#gate.admit(this.#raw(event)));
    this.#projector.fit(admitted);
    this.#encoder.fit(admitted.map(value => value.perception())); this.#encoder.freeze();
    this.#r2a = new OpenCausalFactorR2A(this.#encoder);
    for (const event of events) {
      const elapsed = event.frames.at(-1)!.activeSeconds - this.#store.logicalTime;
      this.#store.recoverAll(elapsed); this.#r2a.recover(elapsed, true); this.#deposit(event);
    }
    this.#pending = [];
  }
  #perception(observation: Observation): Float64Array {
    const row = relativePublicFeatures(observation);
    return Float64Array.from({ length: 256 }, (_, i) => row[this.#contextKeys[i] ?? ''] ?? 0);
  }
  #raw(event: RealEvent): RawExperience {
    assert(this.#map, 'map-not-frozen');
    const encoded = eventRows(event).rows.map(row => this.#map!.encode(row));
    const trajectory = encoded.map(point => new Float64Array(point.coordinate));
    for (let i = 1; i < trajectory.length; i++) assert(Math.hypot(...trajectory[i]!.map((v, j) => v - trajectory[i - 1]![j]!)) <= .06 + 1e-9,
      'new-event-map-sampling-disconnected');
    assert(encoded.every(row => row.unknownKeys.length === 0), 'new-event-has-unrepresented-public-features');
    const tangent = pathInitialTangent(trajectory); assert(tangent, 'event-map-has-no-observed-progress');
    return { trajectory, perception: this.#perception(event.frames[0]!),
      r1State: { position: trajectory[0]!, velocity: tangent, causalPrefix: trajectory.slice(0, 2),
        observedAt: event.frames.at(-1)!.activeSeconds, numericAttributes: new Float64Array() },
      provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true,
        containsSimulatorPrivate: false, containsFutureObservation: false, containsSemanticRuleOrResult: false } };
  }
  #deposit(event: RealEvent): void {
    const raw = this.#raw(event), trusted = this.#gate.admit(raw);
    const anchorId = `experience-anchor-${this.#store.nextEventNumber.toString().padStart(6, '0')}`;
    const ticket = this.#r2a.freezeCandidatePool({ anchorId, eventNumber: this.#store.nextEventNumber,
      observedAt: this.#store.logicalTime, perception: raw.perception, interventionKey: cueIdentity(event.cue),
      sourceContextId: event.frames[0]!.contextId, sourceContextIdentityVersion: 'CausalEvidenceContextIdV2',
      // Never let an object discovered later in the event enter before-event candidate retrieval.
      publicR1Signature: sha(relativePublicFeatures(event.frames[0]!)) });
    const r2Coordinate = this.#projector.projectTrustedPath(trusted);
    const receipt = this.#store.writeEvent(trusted, r1RouteSignature(raw.trajectory), r2Coordinate, anchorId, 1, 'current-model-time');
    this.#r2a.commitOutcome(ticket, { r2Coordinate, r2PageId: receipt.r2PageId, r2VisitId: receipt.coactivationId,
      trustedActualObservation: true, r1Trace: { pageId: receipt.r1PageId, traceId: receipt.r1TraceId } }, this.#store.logicalTime);
    this.#annotations.push({ eventId: event.id, anchorId, pageId: receipt.r1PageId, traceId: receipt.r1TraceId,
      cue: structuredClone(event.cue), context: relativePublicFeatures(event.frames[0]!), contextId: event.frames[0]!.contextId,
      r2Coordinate: [...r2Coordinate], kernelChanges: eventRows(event).changes });
    this.#writes++;
  }
  #active(annotation: TraceAnnotation): boolean {
    return this.#store.r1.isTraceActive(annotation.pageId, annotation.traceId)
      && this.#store.coactivations().some(value => value.experienceAnchorId === annotation.anchorId && value.currentStrength > 0)
      && this.#store.r2.sampleBasins(this.#store.r2PageId, new Float64Array(annotation.r2Coordinate), 1).some(basin => basin.depth > 1e-7);
  }
  #prepared(cue: ActionCue, observation: Observation) {
    const eligible = this.#annotations.filter(a => cueIdentity(a.cue) === cueIdentity(cue));
    const causal = this.#r2a.evaluate(this.#perception(observation), new Set(eligible.map(a => a.anchorId)));
    return this.#query.query(this.#store.r2, this.#store.r2PageId,
      eligible.map(a => ({ pageId: a.pageId, traceId: a.traceId, experienceAnchorId: a.anchorId })),
      this.#store.coactivations(), trace => this.#store.r1.isTraceActive(trace.pageId, trace.traceId), causal);
  }
  recall(desired: DesiredChange, observation: Observation, offset = 0): unknown {
    if (!this.ready) return { kind: 'historical-observation', candidates: [], unknown: 'physical-initialization-not-ready', buffered: this.bufferedEvents };
    const current = relativePublicFeatures(observation);
    const candidates = this.#annotations.filter(a => this.#active(a) && a.kernelChanges.flat().some(c => matches(c, desired)));
    return { kind: 'historical-observation', total: candidates.length, offset, nextOffset: offset + 2 < candidates.length ? offset + 2 : null,
      candidates: candidates.slice(offset, offset + 2).map(a => {
      // The action is already conditioned on. Preserve its whole candidate distribution,
      // then bind this history to its own trace contributions, never to the action average.
      const prepared = this.#prepared(a.cue, observation);
      const relations = this.#r2a.productionRelationsForAudit();
      const contributions = prepared.query.contributions
        .filter(c => c.r1Trace.pageId === a.pageId && c.r1Trace.traceId === a.traceId)
        .map(c => ({ ...c, matchedRelations: c.matchedRelationIds.flatMap(relationId => {
          const matches = prepared.query.r3Matches.filter(match => match.relationId === relationId);
          return (matches.length ? matches : [null]).map(match => ({ ...match, relationId,
            state: relations.find(edge => edge.hyperedgeId === relationId)?.state ?? 'unknown' }));
        }) }));
      const different = Object.entries(a.context).filter(([key, value]) => current[key] !== value).map(([property, historical]) =>
        ({ property, historical, current: current[property] ?? 'unknown', necessaryCondition: false }));
      const matching = a.kernelChanges.flat().filter(c => matches(c, desired));
      const occurred = this.#store.coactivations().find(c => c.experienceAnchorId === a.anchorId
        && c.r1Trace.pageId === a.pageId && c.r1Trace.traceId === a.traceId);
      return { eventId: a.eventId, action: a.cue, actualObserved: matching, actualObservedScope: 'matching-historical-changes',
        // Old annotations have event-local indices, not absolute frame numbers. Do not infer missing times.
        historicalOccurrence: { endActiveSeconds: occurred?.observedAt ?? null, observationSequence: null },
        observedBefore: a.context, currentDifferences: different, r1: { pageId: a.pageId, traceId: a.traceId }, r2: a.r2Coordinate,
        currentApplicability: { scope: 'this-historical-trace-in-full-action-query', calibratedProbability: false, contributions },
        actionAggregateSupport: prepared.evidence, r2a: relations.filter(edge => edge.interventionKey === cueIdentity(a.cue)),
        unknown: ['observed-context-is-not-proof-of-necessity', ...(contributions.every(c => c.matchedRelationIds.length === 0)
          ? ['historical-only-no-current-R2A-support'] : [])] };
    }) };
  }
  predict(cue: ActionCue, observation: Observation, options: { seeds?: number; steps?: number; prefix?: RealEvent } = {}): Prediction {
    const kind = options.prefix ? 'factual-prediction' as const : 'hypothetical-prediction' as const;
    const empty = (reason: string, evidence: unknown = null): Prediction => ({ kind, support: 0, calibratedProbability: false,
      samples: [], evidence, unknown: [reason], mapSha256: this.mapSha256 });
    if (!this.ready) return empty('physical-initialization-not-ready');
    const prepared = this.#prepared(cue, observation);
    if (prepared.evidence.querySpecificR2aApplicability <= 0) return empty('no-current-physical-R2A-condition', prepared.evidence);
    let source: Vec3 | null = null;
    if (options.prefix) {
      validateEvent(options.prefix);
      assert(this.#map, 'event-map-missing');
      const points = eventRows(options.prefix).rows.map(row => this.#map!.encode(row));
      if (points.some(point => point.unknownKeys.length > 0)) return empty('unrepresented-factual-prefix', prepared.evidence);
      source = new Float64Array(points.at(-1)!.coordinate);
    }
    const samples: Array<Prediction['samples'][number]> = [];
    for (let seed = 0; seed < (options.seeds ?? 24); seed++) {
      const random = new SplitMix64(BigInt(seed + 1)); let draw = random.uniform();
      let selected = prepared.query.contributions.at(-1)!;
      for (const candidate of prepared.query.contributions) { draw -= candidate.weight; if (draw <= 0) { selected = candidate; break; } }
      const snapshot = this.#store.r1.traceSnapshot(selected.r1Trace.pageId, selected.r1Trace.traceId);
      if (!snapshot) continue;
      let actualSnapshot = snapshot;
      let kernelOffset = 0;
      if (source) {
        const nearest = snapshot.kernels.map((kernel, i) => ({ i, distance: Math.hypot(...source!.map((v, j) => v - kernel.center[j]!)) }))
          .sort((a, b) => a.distance - b.distance)[0];
        if (!nearest || nearest.distance > R1_CONFIG.kernelWidth * .25 || nearest.i >= snapshot.kernels.length - 1) continue;
        kernelOffset = nearest.i;
        actualSnapshot = { ...snapshot, kernels: snapshot.kernels.slice(kernelOffset) };
      }
      const centers = actualSnapshot.kernels.map(k => k.center), tangent = pathInitialTangent(centers);
      if (!tangent) continue;
      // A genuine prefix can select a locally aligned *remaining physical road*, not a historical result.
      // Clone still performs every isotropic proposal and Metropolis decision unchanged.
      const start = source ?? centers[0]!;
      const predicted = this.#clone.run(actualSnapshot, start, tangent, random, options.steps ?? 180);
      const annotation = this.#annotations.find(a => a.traceId === snapshot.traceId)!;
      const transported = transportTraceSnapshot(actualSnapshot, start, tangent)!;
      const readSnapshot = { ...actualSnapshot, kernels: actualSnapshot.kernels.map((kernel, i) => ({ ...kernel, center: transported[i]! })) };
      const read = readVisitedRegions(readSnapshot, predicted.positions, annotation.kernelChanges.slice(kernelOffset), {
        kernelOffset, observedThroughOriginalKernelIndex: source === null ? null : kernelOffset });
      samples.push({ seed, traceId: snapshot.traceId, pageId: snapshot.pageId, positions: predicted.positions.map(p => [...p]),
        readout: read.readout, reason: read.reason });
    }
    if (source !== null && samples.length === 0) return empty('factual-prefix-continuation-not-identifiable', prepared.evidence);
    return { kind, support: prepared.evidence.coreEvidenceSupport, calibratedProbability: false, samples,
      evidence: prepared, unknown: [...new Set(samples.flatMap(s => s.reason ? [s.reason] : []))], mapSha256: this.mapSha256 };
  }
  snapshot(): MemorySnapshot {
    return { version: 'KairosV5Memory', activeSeconds: this.#activeSeconds, eventMap: this.#map?.state ?? null,
      contextKeys: [...this.#contextKeys], projector: this.ready ? this.#projector.exportState() : null,
      tokenEncoder: this.ready ? this.#encoder.exportState() : null, store: this.#store.exportCheckpointState(),
      r2a: this.ready ? this.#r2a.exportState() : null, annotations: structuredClone(this.#annotations),
      pendingInitialization: structuredClone(this.#pending), seenEventIds: [...this.#seen], writes: this.#writes };
  }
  static restore(snapshot: MemorySnapshot): PhysicalMemory {
    assert(snapshot.version === 'KairosV5Memory', 'V5-rejects-legacy-experience');
    const memory = new PhysicalMemory(); memory.#activeSeconds = snapshot.activeSeconds;
    memory.#seen = new Set(snapshot.seenEventIds); memory.#writes = snapshot.writes;
    memory.#pending = structuredClone([...snapshot.pendingInitialization]);
    memory.#store = new ExperienceMediaStore(snapshot.store);
    memory.#annotations = structuredClone([...snapshot.annotations]); memory.#contextKeys = [...snapshot.contextKeys];
    if (snapshot.eventMap) {
      assert(snapshot.projector && snapshot.tokenEncoder && snapshot.r2a, 'incomplete-V5-map-snapshot');
      memory.#map = new DistanceEmbedding(snapshot.eventMap); memory.#projector = PathProjector.fromState(snapshot.projector);
      memory.#encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
      memory.#r2a = new OpenCausalFactorR2A(memory.#encoder, snapshot.r2a);
    }
    assert(canonical(memory.snapshot()) === canonical(snapshot), 'V5-snapshot-not-reproducible');
    return memory;
  }
  /** Test-only destructive ablation. The public worker protocol does not expose this method. */
  ablateForTest(medium: 'R1' | 'R2' | 'R2A'): void {
    if (medium === 'R1') this.#store.r1.recover(1e9);
    if (medium === 'R2') this.#store.r2.recover(1e9);
    if (medium === 'R2A') this.#r2a.recover(1e9, true);
  }
}
