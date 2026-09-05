import type { PublicValue } from '../../contracts.js';
import { assert, canonical, sha } from '../../util.js';
import type { DistributedEpisodeV1, DistributedMediumSnapshotV1,
  DistributedTraceFootprintV1 } from '../physics/distributed-physical-contracts.js';
import { DistributedPhysicalMedium3DV1 } from '../physics/distributed-physical-medium.js';
import type { DistributedMediumWritePortV1, DistributedSiteDriveV1 } from './distributed-r1-contracts.js';
import type { DistributedR2AtomV1, DistributedR2BoundaryBeforeV1,
  DistributedR2CloseReceiptV1, DistributedR2CompleteReasonV1,
  DistributedR2ContinuityStateV2, DistributedR2ContinuousEventV1,
  DistributedPublicSignalOccurrenceV1, DistributedR2IngestReceiptV1,
  DistributedR2InterruptReasonV1 } from './distributed-r2-contracts.js';
import { SparseInterlayerProjectionV1 } from './sparse-interlayer-projection.js';

const DEFAULT_R2_PROJECTION_SEED = 0x5232444953543031n;

function parseSeed(value: string): bigint {
  assert(/^0x[0-9a-f]+$/i.test(value), 'distributed-R2-invalid-seed');
  return BigInt(value);
}

const PUBLIC_SIGNAL_SEPARATOR = '.';

function encodedPublicSignalV1(channel: string, value: unknown): string {
  return `${sha({ version: 'DistributedPublicChannelV1', channel })}${PUBLIC_SIGNAL_SEPARATOR}`
    + sha({ version: 'DistributedPublicValueWithinChannelV1', channel, value });
}

/** Recover only an opaque observation-channel identity.  It is used to tell
 * "a different value was observed" from "this factor was not visible"; it
 * is never decoded into a semantic condition or a physical coordinate. */
export function distributedPublicSignalChannelIdV1(signalId: string): string {
  if (/^[0-9a-f]{64}\.[0-9a-f]{64}$/i.test(signalId)) return signalId.slice(0, 64);
  // Neutral tests use q:on/q:off rather than hashed public signals.  Treat the
  // prefix as their opaque sensor channel without teaching the learner what q
  // means.  A signal with no explicit value delimiter is its own channel.
  const delimiter = signalId.lastIndexOf(':');
  return delimiter > 0 ? signalId.slice(0, delimiter) : signalId;
}

/** Public-value identity used only as an opaque afferent lookup key. */
export function distributedPublicSignalOccurrencesV1(values: Readonly<Record<string, number>>,
  pulseOrdinal = 0): readonly DistributedPublicSignalOccurrenceV1[] {
  const resolution = (property: string): number | null => {
    if (property === 'self/pitch') return Math.PI / 12;
    if (property.endsWith('/relativeDistance') || property.includes('/egocentric/')
      || property.startsWith('crosshair/egocentric/')) return .25;
    if (/velocity(?:[XYZ]|\.(?:forward|right|up))$/.test(property)) return .05;
    return null;
  };
  const result: DistributedPublicSignalOccurrenceV1[] = [];
  const channels = Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right, 'en'));
  for (const [channelOrdinal, [channelProperty, channelValue]] of channels.entries()) {
    const step = resolution(channelProperty);
    if (step === null) {
      const channel = channelProperty.includes('=')
        ? channelProperty.slice(0, channelProperty.indexOf('=')) : channelProperty;
      result.push({ signalId: encodedPublicSignalV1(channel, { property: channelProperty,
        categoricalValue: Number(channelValue.toFixed(12)) }), pulseOrdinal, channelOrdinal,
      receptorOrdinal: 0 });
      continue;
    }
    const position = channelValue / step, base = Math.floor(position);
    let receptorOrdinal = 0;
    for (let bin = base - 1; bin <= base + 2; bin++) {
      if (Math.exp(-.5 * (position - bin) ** 2) < .1) continue;
      result.push({ signalId: encodedPublicSignalV1(channelProperty, { populationBin: bin }),
        pulseOrdinal, channelOrdinal, receptorOrdinal });
      receptorOrdinal++;
    }
  }
  const seen = new Set<string>();
  return result.filter(value => !seen.has(value.signalId) && !!seen.add(value.signalId));
}

/** Public-value identity used only as an opaque afferent lookup key. */
export function distributedPublicSignalIdsV1(values: Readonly<Record<string, number>>): readonly string[] {
  return distributedPublicSignalOccurrencesV1(values).map(value => value.signalId);
}

/** A lossless public-value variant used by neutral fixtures and future R3 input. */
export function distributedOpaquePublicSignalV1(subject: string, property: string, value: PublicValue): string {
  return encodedPublicSignalV1(`${subject}/${property}`, canonical(value));
}

function dependencyConnected(left: DistributedR2AtomV1, right: DistributedR2AtomV1): boolean {
  const leftIds = new Set(left.dependencies.map(value => value.dependencyId));
  if (right.dependencies.some(value => leftIds.has(value.dependencyId))) return true;
  const leftFacts = new Set(left.dependencies.map(value => `${value.subject}/${value.property}`));
  return right.dependencies.some(value => leftFacts.has(`${value.subject}/${value.property}`));
}

export function assessDistributedR2ContinuityV1(left: DistributedR2AtomV1,
  right: DistributedR2AtomV1): { readonly continuous: boolean; readonly reason: string } {
  if (left.sessionId !== right.sessionId) return { continuous: false, reason: 'session-changed' };
  if (left.continuityEpochId !== right.continuityEpochId)
    return { continuous: false, reason: 'continuity-epoch-changed' };
  if (right.startedAt < left.endedAt || right.startFrameSequence < left.endFrameSequence)
    return { continuous: false, reason: 'real-order-overlapped-or-reversed' };
  if (!dependencyConnected(left, right)) return { continuous: false, reason: 'public-dependency-disconnected' };
  return { continuous: true, reason: 'public-continuity-evidence' };
}

/**
 * R2 owns a second, independent distributed medium.  It receives complete R1
 * population footprints as opaque physical assemblies and writes only after
 * a real multi-atom process closes.
 */
export class DistributedR2ContinuityStoreV1 {
  readonly medium: DistributedPhysicalMedium3DV1;
  readonly #projection: SparseInterlayerProjectionV1;
  #pending: DistributedR2AtomV1[] = [];
  readonly #events: DistributedR2ContinuousEventV1[] = [];
  readonly #r1Active: (footprint: DistributedTraceFootprintV1) => boolean;
  readonly #encodingGainProvider: () => number;

  constructor(medium?: DistributedPhysicalMedium3DV1, seed = DEFAULT_R2_PROJECTION_SEED,
    state?: DistributedR2ContinuityStateV2,
    r1Active: (footprint: DistributedTraceFootprintV1) => boolean = footprint =>
      footprint.siteIds.length > 0 && footprint.supportMass > 0,
    encodingGainProvider: () => number = () => 1) {
    this.medium = medium ?? new DistributedPhysicalMedium3DV1({ name: 'R2', seedHex: '5232' });
    this.#r1Active = r1Active;
    this.#encodingGainProvider = encodingGainProvider;
    if (state) {
      assert(state.version === 'DistributedR2ContinuityStateV2'
        && parseSeed(state.projection.seedHex) === seed,
      'distributed-R2-state-version-or-seed-mismatch');
      assert(state.mediumSnapshotSha256 === sha(this.medium.snapshot()), 'distributed-R2-medium-state-mismatch');
    }
    this.#projection = new SparseInterlayerProjectionV1(this.medium,
      { projectionId: 'R1-site-to-R2-sparse-fibre', seed }, state?.projection);
    if (state) {
      this.#pending = [...structuredClone(state.pending)];
      this.#events.push(...structuredClone(state.events));
    }
  }

  static restore(mediumSnapshot: DistributedMediumSnapshotV1, state: DistributedR2ContinuityStateV2,
    r1Active?: (footprint: DistributedTraceFootprintV1) => boolean,
    encodingGainProvider: () => number = () => 1):
  DistributedR2ContinuityStoreV1 {
    const medium = DistributedPhysicalMedium3DV1.fromSnapshot(mediumSnapshot);
    return new DistributedR2ContinuityStoreV1(medium, parseSeed(state.projection.seedHex), state,
      r1Active, encodingGainProvider);
  }

  get pendingAtomCount(): number { return this.#pending.length; }
  get committedEventCount(): number { return this.#events.length; }

  #sourceNeighborhoods(atom: DistributedR2AtomV1): readonly {
    readonly sourceSiteId: number; readonly neighborSiteIds: readonly number[];
  }[] {
    const graph = new Map<number, Set<number>>();
    for (const reference of atom.r1Footprint.bondReferences) {
      // A directed reference records temporal order, not spatial proximity.
      // Only the symmetric local bond from the R1 footprint may seed the
      // source-neighbourhood projection into R2.  Feeding a directed edge
      // here would make a later successor look like a same-time neighbour and
      // collapse otherwise distinct event populations.
      if (reference.kind !== 'local') continue;
      const from = graph.get(reference.fromSiteId) ?? new Set<number>();
      const to = graph.get(reference.toSiteId) ?? new Set<number>();
      from.add(reference.toSiteId); to.add(reference.fromSiteId);
      graph.set(reference.fromSiteId, from); graph.set(reference.toSiteId, to);
    }
    return [...graph].sort(([left], [right]) => left - right).map(([sourceSiteId, neighbors]) => ({
      sourceSiteId, neighborSiteIds: [...neighbors].sort((left, right) => left - right),
    }));
  }

  #physicalEpisode(atoms: readonly DistributedR2AtomV1[], traceId: string): {
    readonly episode: DistributedEpisodeV1;
    readonly atomPulseRanges: DistributedR2ContinuousEventV1['atomPulseRanges'];
  } {
    const pulses: DistributedEpisodeV1['pulses'][number][] = [];
    const atomPulseRanges: DistributedR2ContinuousEventV1['atomPulseRanges'][number][] = [];
    const eventStartedAt = atoms[0]!.startedAt;
    atoms.forEach((atom, atomIndex) => {
      assert(atom.r1Topology.pulses.length > 0, 'R2-cannot-project-empty-R1-topology');
      const startPulseIndex = pulses.length;
      const duration = Math.max(0, atom.endedAt - atom.startedAt);
      const sourceNeighborhoods = this.#sourceNeighborhoods(atom);
      atom.r1Topology.pulses.forEach((sourceDrives, pulseIndex) => {
        // Exact intra-atom dwell was not retained by the R1 topology contract;
        // only the observed atom interval and original pulse order are used.
        const withinAtom = duration * pulseIndex / Math.max(1, atom.r1Topology.pulses.length);
        pulses.push(this.#projection.projectPulse({
          pulseId: `${traceId}:atom:${atomIndex}:pulse:${pulseIndex}`,
          offset: atom.startedAt - eventStartedAt + withinAtom,
          drives: sourceDrives,
          sourceNeighborhoods,
        }));
      });
      atomPulseRanges.push({ atomId: atom.atomId, startPulseIndex,
        endPulseIndexExclusive: pulses.length });
    });
    return { episode: { version: 'DistributedEpisodeV1', traceId,
      provenance: 'trusted-real-event', pulses }, atomPulseRanges };
  }

  ingest(atom: DistributedR2AtomV1, boundaryBefore: DistributedR2BoundaryBeforeV1): DistributedR2IngestReceiptV1 {
    assert(atom.version === 'DistributedR2AtomV1', 'invalid-distributed-R2-atom');
    let closedBefore: DistributedR2CloseReceiptV1 | null = null;
    if (boundaryBefore !== 'continuous' && this.#pending.length > 0)
      closedBefore = this.interrupt(boundaryBefore === 'gap' ? 'continuity-gap'
        : boundaryBefore === 'external-takeover' ? 'external-takeover' : 'continuity-reset');
    if (this.#pending.length > 0) {
      const assessment = assessDistributedR2ContinuityV1(this.#pending.at(-1)!, atom);
      if (!assessment.continuous) {
        closedBefore = assessment.reason === 'public-dependency-disconnected'
          ? this.close('public-dependency-ended')
          : this.interrupt(assessment.reason === 'session-changed' ? 'session-ended' : 'continuity-reset');
      }
    }
    this.#pending.push(structuredClone(atom));
    return { version: 'DistributedR2IngestReceiptV1', pendingAtomCount: this.#pending.length, closedBefore };
  }

  close(reason: DistributedR2CompleteReasonV1): DistributedR2CloseReceiptV1 {
    return this.#close('complete', reason);
  }

  interrupt(reason: DistributedR2InterruptReasonV1): DistributedR2CloseReceiptV1 {
    return this.#close('censored', reason);
  }

  #close(completion: 'complete' | 'censored', reason: DistributedR2ContinuousEventV1['boundaryReason']):
  DistributedR2CloseReceiptV1 {
    if (this.#pending.length === 0) return { version: 'DistributedR2CloseReceiptV1', status: 'none' };
    const atoms = this.#pending; this.#pending = [];
    if (atoms.length < 2) return { version: 'DistributedR2CloseReceiptV1', status: 'singleton-rejected',
      atomId: atoms[0]!.atomId, completion, boundaryReason: reason };
    const eventId = sha({ version: 'DistributedR2ContinuousEventIdentityV1',
      atoms: atoms.map(value => value.atomId), completion, reason });
    const patternSha256 = sha({ version: 'DistributedR2OrderedPatternV1',
      orderedEpisodePatternIds: atoms.map(value => value.episodePatternSha256) });
    const learningEligible = completion === 'complete';
    if (learningEligible) assert(atoms.every(atom => this.#r1Active(atom.r1Footprint)),
    'R2-continuous-event-cannot-launder-inactive-R1-physical-support');
    const projected = learningEligible ? this.#physicalEpisode(atoms, `r2-${eventId}`) : null;
    const encodingGain = this.#encodingGainProvider();
    if (!Number.isFinite(encodingGain) || encodingGain < 0.75 || encodingGain > 1.5)
      throw new RangeError('distributed-R2-encoding-gain-out-of-law-bounds');
    const footprint: DistributedTraceFootprintV1 | null = projected
      ? this.medium.applyEpisodeWithEncodingGain === undefined
        ? this.medium.applyEpisode(projected.episode, 1)
        : this.medium.applyEpisodeWithEncodingGain(projected.episode, 1, encodingGain)
      : null;
    const event: DistributedR2ContinuousEventV1 = { version: 'DistributedR2ContinuousEventV1', eventId,
      atomIds: atoms.map(value => value.atomId), sourceEventIds: atoms.map(value => value.sourceEventId),
      sourceR1Footprints: atoms.map(value => structuredClone(value.r1Footprint)),
      orderedExperienceIdentities: atoms.map(value => value.exactExperienceIdentity),
      orderedEpisodePatternIds: atoms.map(value => value.episodePatternSha256),
      dependencyIds: [...new Set(atoms.flatMap(value => value.dependencies.map(item => item.dependencyId)))].sort(),
      contextIds: [...new Set(atoms.map(value => value.contextId))].sort(), completion,
      boundaryReason: reason, learningEligible, physicalFootprint: footprint,
      processChanges: structuredClone(atoms.flatMap(value => value.publicChanges)),
      terminalChanges: structuredClone(atoms.at(-1)!.publicChanges),
      beforePublicSignals: [...atoms[0]!.beforePublicSignals],
      beforeSignalTimeline: atoms.map(value => [...value.beforePublicSignals]),
      beforePublicSignalOccurrences: atoms[0]!.beforePublicSignalOccurrences.map(value => ({ ...value,
        pulseOrdinal: 0 })),
      beforeSignalTimelineOccurrences: atoms.map((value, pulseOrdinal) =>
        value.beforePublicSignalOccurrences.map(occurrence => ({ ...occurrence, pulseOrdinal }))),
      physicalPulseSiteIds: projected?.episode.pulses.map(pulse => pulse.drives
        .map(value => value.siteId)) ?? [],
      // Preserve the actual inter-layer amplitudes.  The site-id projection
      // above is retained as a compact compatibility readout, while R2A and
      // restored events consume this weighted stream whenever present.
      physicalPulseDrives: projected?.episode.pulses.map(pulse => pulse.drives
        .map((value): DistributedSiteDriveV1 => ({ ...value }))) ?? [],
      atomPulseRanges: projected?.atomPulseRanges ?? [],
      patternSha256 };
    this.#events.push(event);
    return { version: 'DistributedR2CloseReceiptV1', status: 'committed', event: structuredClone(event) };
  }

  events(options: { readonly learningEligibleOnly?: boolean } = {}): readonly DistributedR2ContinuousEventV1[] {
    return this.#events.filter(value => !options.learningEligibleOnly || value.learningEligible)
      .map(value => structuredClone(value));
  }

  isEventActive(eventId: string): boolean {
    const event = this.#events.find(value => value.eventId === eventId);
    return !!event?.physicalFootprint && !!event.sourceR1Footprints?.length
      && event.sourceR1Footprints.every(value => this.#r1Active(value))
      && this.medium.isFootprintActive(event.physicalFootprint);
  }

  /** Existing afferent sites for the open real prefix. This query never allocates. */
  currentPrefixSeedSites(): readonly number[] {
    return [...new Set(this.currentPrefixSeedDrives().map(value => value.siteId))]
      .sort((left, right) => left - right);
  }

  /**
   * Weighted counterpart of the legacy site-id readout.  R2A prediction can
   * retain the actual R1→R2 fibre amplitudes until it reaches the protected
   * Clone boundary; callers that only need membership may continue using the
   * compact `currentPrefixSeedSites()` view above.
   */
  currentPrefixSeedDrives(): readonly DistributedSiteDriveV1[] {
    const atom = this.#pending.at(-1); if (!atom) return [];
    const terminal = atom.r1Topology.pulses.at(-1) ?? [];
    return this.#projection.lookupPulse(terminal).map(value => ({ ...value }));
  }

  recover(elapsed: number): void { this.medium.recover(elapsed); }

  snapshot(): DistributedR2ContinuityStateV2 {
    return { version: 'DistributedR2ContinuityStateV2', projection: this.#projection.snapshot(),
      pending: structuredClone(this.#pending),
      events: structuredClone(this.#events), mediumSnapshotSha256: sha(this.medium.snapshot()) };
  }
}

export type DistributedR2MediumPortV1 = DistributedMediumWritePortV1;
