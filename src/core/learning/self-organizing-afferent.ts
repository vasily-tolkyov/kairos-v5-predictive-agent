import type { ActionCue, Observation, PublicChange, PublicValue, RealEvent } from '../../contracts.js';
import { eventLocalCurrentPublicStateV1, eventRows,
  type EventLocalPublicRoleBindingV1 } from '../../events.js';
import { assert, canonical, sha } from '../../util.js';
import { SplitMix64 } from '../random.js';
import type {
  AfferentPublicChannelReadoutV1,
  AfferentPublicStateReadoutV1,
  AfferentSignalDescriptorV1,
  AfferentBindingStateV1,
  DistributedMediumWritePortV1,
  DistributedSiteDriveV1,
  R1DistributedEpisodeV1,
  R1SparseFieldPulseV1,
  ReadOnlyAfferentLookupV1,
  SelfOrganizingAfferentStateV1,
  SelfOrganizingProjectionResultV1,
} from './distributed-r1-contracts.js';

const CANDIDATE_COUNT = 32;
const WINNER_COUNT = 8;
const ALLOCATION_SALT = 0x9e3779b97f4a7c15n;

interface SignalDriveV1 {
  readonly signalId: string;
  readonly intensity: number;
  readonly descriptor: AfferentSignalDescriptorV1;
  /** Position of the public sensor channel within this real pulse.  This is
   * the only ordering input used while a previously unseen afferent is
   * allocated; the opaque identity hash remains lookup-only. */
  readonly channelOrdinal: number;
  /** Position within an overlapping receptor population for one channel. */
  readonly receptorOrdinal: number;
}

interface SignalPulseV1 {
  readonly signals: readonly SignalDriveV1[];
  readonly dwellSeconds: number;
}

function signalId(descriptor: AfferentSignalDescriptorV1): string {
  return sha({ version: 'AfferentSignalIdentityV1', ...descriptor });
}

function continuousResolution(property: string): number | null {
  if (property === 'yaw' || property === 'pitch') return Math.PI / 12;
  if (/^velocity(?:[XYZ]|\.(?:forward|right|up))$/.test(property)) return 0.05;
  if (property === 'relativeDistance' || property.startsWith('displacement.')) return 0.25;
  return null;
}

function categoricalSignal(source: AfferentSignalDescriptorV1['source'], channel: string,
  property: string | null, value: PublicValue, channelOrdinal: number,
  receptorOrdinal = 0): SignalDriveV1 {
  const descriptor: AfferentSignalDescriptorV1 = { source, channel, publicProperty: property,
    populationBin: null, categoricalValue: canonical(value) };
  return { signalId: signalId(descriptor), intensity: 1, descriptor,
    channelOrdinal, receptorOrdinal };
}

/**
 * Continuous public values use an overlapping population code.  The bins are
 * input identities only: their eventual physical locations are chosen by the
 * medium's local competition.
 */
function publicValueSignals(channel: string, property: string, value: PublicValue,
  channelOrdinal: number): readonly SignalDriveV1[] {
  if (typeof value !== 'number') return [categoricalSignal('public-state', channel,
    property, value, channelOrdinal)];
  assert(Number.isFinite(value), 'afferent-non-finite-public-value');
  const resolution = continuousResolution(property);
  if (resolution === null) return [categoricalSignal('public-state', channel,
    property, value, channelOrdinal)];
  const position = value / resolution;
  const base = Math.floor(position);
  const signals: SignalDriveV1[] = [];
  for (let bin = base - 1; bin <= base + 2; bin += 1) {
    const intensity = Math.exp(-0.5 * Math.pow(position - bin, 2));
    if (intensity < 0.1) continue;
    const descriptor: AfferentSignalDescriptorV1 = { source: 'public-state', channel,
      publicProperty: property, populationBin: bin, categoricalValue: null };
    signals.push({ signalId: signalId(descriptor), intensity, descriptor,
      channelOrdinal, receptorOrdinal: signals.length });
  }
  // Constant population mass prevents a continuous dimension from dominating
  // categorical public changes merely because it activates several overlapping
  // receptors.  Overlap still carries metric similarity through the bins.
  const total = signals.reduce((sum, signal) => sum + signal.intensity, 0);
  return signals.map(value => ({ ...value, intensity: value.intensity / total }));
}

function cueSignals(cue: ActionCue): readonly SignalDriveV1[] {
  // Component populations preserve similarity between related body commands.
  // One simultaneously learned whole-cue population preserves the exact
  // conjunction, so shared `kind`/`target-role` receptors cannot route an
  // explicitly different parameterized action down the wrong continuation.
  // Its identity only looks up an already self-organised binding; it never
  // chooses a coordinate or supplies an outcome.
  const signals = [categoricalSignal('cue', 'exact-cue', null, canonical(cue), 0),
    categoricalSignal('cue', 'kind', null, cue.kind, 1),
    categoricalSignal('cue', 'target-role', null, cue.targetRole, 2)];
  for (const [key, value] of Object.entries(cue.parameters).sort(([left], [right]) =>
    left.localeCompare(right, 'en'))) signals.push(categoricalSignal('cue', `parameter/${key}`,
      null, value, signals.length));
  return signals;
}

function channelKey(change: Pick<PublicChange, 'subject' | 'property'>): string {
  return `${change.subject}/${change.property}`;
}

function stateSignals(state: ReadonlyMap<string, { readonly subject: string; readonly property: string;
  readonly value: PublicValue }>): readonly SignalDriveV1[] {
  const result: SignalDriveV1[] = [];
  const orderedChannels = [...state.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
  for (const [channelOrdinal, [channel, entry]] of orderedChannels.entries()) {
    // The property is already part of the population identity.  Adding a
    // second generic "channel present" population made opposite terminal
    // values share half their sites and recreated the old resolution collapse.
    result.push(...publicValueSignals(`value/${channel}`, entry.property, entry.value, channelOrdinal));
  }
  return result;
}

function measuredState(entries: Readonly<Record<string,
  Readonly<Record<string, PublicValue>>>>): Map<string, {
    subject: string; property: string; value: PublicValue }> {
  const result = new Map<string, { subject: string; property: string; value: PublicValue }>();
  for (const [subject, properties] of Object.entries(entries).sort(([left], [right]) =>
    left.localeCompare(right, 'en'))) {
    for (const [property, value] of Object.entries(properties).sort(([left], [right]) =>
      left.localeCompare(right, 'en'))) {
      result.set(`${subject}/${property}`, { subject, property, value });
    }
  }
  return result;
}

function mergeSignalDrives(signals: readonly SignalDriveV1[]): readonly SignalDriveV1[] {
  const values = new Map<string, SignalDriveV1>();
  for (const signal of signals) {
    const previous = values.get(signal.signalId);
    if (previous !== undefined && canonical(previous.descriptor) !== canonical(signal.descriptor)) {
      throw new Error(`afferent-signal-descriptor-mismatch:${signal.signalId}`);
    }
    if (previous !== undefined) {
      assert(previous.channelOrdinal === signal.channelOrdinal
        && previous.receptorOrdinal === signal.receptorOrdinal,
      'afferent-signal-sensor-ordinal-mismatch');
    }
    if (previous === undefined || signal.intensity > previous.intensity) values.set(signal.signalId, signal);
  }
  const ordered = [...values.values()].sort((left, right) => left.channelOrdinal - right.channelOrdinal
    || left.receptorOrdinal - right.receptorOrdinal);
  for (let index = 1; index < ordered.length; index++) {
    const left = ordered[index - 1]!, right = ordered[index]!;
    assert(left.channelOrdinal !== right.channelOrdinal
      || left.receptorOrdinal !== right.receptorOrdinal,
    'afferent-duplicate-public-sensor-ordinal');
  }
  return ordered;
}

function eventSignalPulses(event: RealEvent): readonly SignalPulseV1[] {
  const rows = eventRows(event);
  // Only true public state transitions become distinct pulses.  A completed
  // no-effect window is represented by residence in one unchanged state.
  // No before/after pair, pairwise conjunction, or whole-event sequence is
  // converted into a new afferent identity: order exists only in pulse time
  // and in the directed physical bonds learned between successive pulses.
  const waves = rows.measurementChanges.map(wave => wave.filter(change =>
    !Object.is(change.before, change.after)));
  const actualChanges = waves.flat();

  const state = new Map<string, { subject: string; property: string; value: PublicValue }>();
  for (const change of actualChanges) {
    const key = channelKey(change);
    if (!state.has(key)) state.set(key, { subject: change.subject, property: change.property,
      value: change.before });
  }
  if (state.size === 0) state.set('event/change-within-observed-window', {
    subject: 'event', property: 'change-within-observed-window', value: false,
  });

  // Reality presents the pre-action public state first, then the efference
  // copy of the exact body action, then the observed consequence.  Keeping
  // this order is essential: prediction seeds current perception followed by
  // a candidate action, so the learned directed channel must have the same
  // causal time orientation.  The pre-action state is deliberately limited
  // to properties that actually participate in this closed event; unrelated
  // scene conditions remain R2A's job.
  const physicalStep = 0.04;
  const pulses: SignalPulseV1[] = [{ signals: mergeSignalDrives(stateSignals(state)),
    dwellSeconds: physicalStep }, { signals: mergeSignalDrives(cueSignals(event.cue)),
    dwellSeconds: physicalStep }];
  const changedObservationIndexes = waves.flatMap((wave, observationIndex) =>
    wave.length > 0 ? [observationIndex] : []);
  const eventStart = event.frames[0]!.activeSeconds;
  const eventEnd = event.frames.at(-1)!.activeSeconds;
  const firstTransitionAt = changedObservationIndexes.length > 0
    ? event.frames[changedObservationIndexes[0]!]!.activeSeconds : eventEnd;
  // A completed no-effect action still has a real post-action observation.
  // Reusing the same population after the cue learns action -> unchanged
  // state without inventing a displacement or a semantic result label.
  if (changedObservationIndexes.length === 0) pulses.push({ signals: mergeSignalDrives(stateSignals(state)),
    dwellSeconds: Number(Math.max(physicalStep, firstTransitionAt - eventStart).toFixed(9)) });
  changedObservationIndexes.forEach((observationIndex, index) => {
    const orderedWave = [...waves[observationIndex]!].sort((left, right) =>
      channelKey(left).localeCompare(channelKey(right), 'en'));
    for (const change of orderedWave) state.set(channelKey(change), {
      subject: change.subject, property: change.property, value: change.after,
    });
    const observedAt = event.frames[observationIndex]!.activeSeconds;
    const nextAt = index + 1 < changedObservationIndexes.length
      ? event.frames[changedObservationIndexes[index + 1]!]!.activeSeconds : eventEnd;
    pulses.push({ signals: mergeSignalDrives(stateSignals(state)),
      dwellSeconds: Number(Math.max(physicalStep, nextAt - observedAt).toFixed(9)) });
  });
  // A scoped property is still a real observation when its value does not
  // change during the action window.  Keep the direct action target's
  // terminal state in the final population so a stable false (or true)
  // result remains physically decodable alongside any other changed field.
  const targetId = event.bodyResult?.action.targetId;
  if (targetId !== undefined && targetId !== null) {
    const terminal = rows.measurementStates.at(-1);
    const targetRole = rows.roles[targetId];
    if (terminal !== undefined && targetRole !== undefined) {
      for (const [property, value] of Object.entries(terminal[targetRole] ?? {})) {
        const key = channelKey({ subject: targetRole, property });
        if (!state.has(key)) state.set(key, { subject: targetRole, property,
          value: value as PublicValue });
      }
      const finalSignals = mergeSignalDrives(stateSignals(state));
      const last = pulses.at(-1);
      if (last !== undefined) {
        pulses[pulses.length - 1] = { signals: finalSignals, dwellSeconds: last.dwellSeconds };
      }
    }
  }
  return pulses;
}

function parseSeed(value: string): bigint {
  assert(/^0x[0-9a-f]+$/i.test(value), 'afferent-invalid-seed');
  return BigInt(value);
}

function wavesWithActualPublicChange(event: RealEvent): number {
  return eventRows(event).measurementChanges.filter(wave => wave.some(change =>
    !Object.is(change.before, change.after))).length;
}

const MIN_READOUT_OVERLAP = 0.5;
const CATEGORICAL_AMBIGUITY_RATIO = 0.75;
const CONTINUOUS_RELATIVE_MASS_FLOOR = 0.09;

interface BindingPhysicalOverlapV1 {
  readonly binding: AfferentBindingStateV1;
  readonly descriptor: AfferentSignalDescriptorV1;
  readonly overlap: number;
  readonly activationMass: number;
}

function parseCategoricalPublicValue(encoded: string): PublicValue {
  const value: unknown = JSON.parse(encoded);
  assert(value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string', 'afferent-invalid-categorical-public-value');
  if (typeof value === 'number') assert(Number.isFinite(value),
    'afferent-non-finite-categorical-public-value');
  return value;
}

function unknownChannel(channel: string, property: string, overlap: number,
  competingOverlap: number, reason: AfferentPublicChannelReadoutV1['reason']):
AfferentPublicChannelReadoutV1 {
  return { channel, property, status: reason === 'ambiguous-physical-overlap'
    ? 'ambiguous' : 'unknown', encoding: 'unknown', overlap, competingOverlap, reason };
}

function decodePublicChannel(channel: string,
  candidates: readonly BindingPhysicalOverlapV1[]): AfferentPublicChannelReadoutV1 {
  const property = candidates[0]!.descriptor.publicProperty!;
  const categorical = candidates.filter(candidate => candidate.descriptor.categoricalValue !== null);
  const continuous = candidates.filter(candidate => candidate.descriptor.populationBin !== null);
  if (categorical.length > 0 && continuous.length > 0) {
    return unknownChannel(channel, property,
      Math.max(...candidates.map(candidate => candidate.overlap)), 0,
      'ambiguous-physical-overlap');
  }
  if (categorical.length > 0) {
    const ranked = [...categorical].sort((left, right) =>
      right.activationMass - left.activationMass
      || right.overlap - left.overlap
      || left.binding.signalId.localeCompare(right.binding.signalId, 'en'));
    const top = ranked[0]!;
    const second = ranked[1];
    if (top.overlap < MIN_READOUT_OVERLAP) {
      return unknownChannel(channel, property, top.overlap, second?.overlap ?? 0,
        'insufficient-physical-overlap');
    }
    if (second !== undefined && second.overlap >= MIN_READOUT_OVERLAP
      && second.activationMass >= top.activationMass * CATEGORICAL_AMBIGUITY_RATIO) {
      return unknownChannel(channel, property, top.overlap, second.overlap,
        'ambiguous-physical-overlap');
    }
    return { channel, property, status: 'decoded', encoding: 'categorical',
      overlap: top.overlap, competingOverlap: second?.overlap ?? 0,
      reason: 'decoded-categorical',
      value: parseCategoricalPublicValue(top.descriptor.categoricalValue!) };
  }

  const eligible = continuous.filter(candidate => candidate.overlap >= MIN_READOUT_OVERLAP);
  if (eligible.length === 0) {
    const top = [...continuous].sort((left, right) => right.overlap - left.overlap)[0]!;
    return unknownChannel(channel, property, top.overlap, 0,
      'insufficient-physical-overlap');
  }
  const resolution = continuousResolution(property);
  assert(resolution !== null, 'afferent-continuous-descriptor-resolution-missing');
  const maximumMass = Math.max(...eligible.map(candidate => candidate.activationMass));
  const population = eligible.filter(candidate => candidate.activationMass
    >= maximumMass * CONTINUOUS_RELATIVE_MASS_FLOOR).sort((left, right) =>
    left.descriptor.populationBin! - right.descriptor.populationBin!);
  if (population.some((candidate, index) => index > 0
    && candidate.descriptor.populationBin! - population[index - 1]!.descriptor.populationBin! > 1)) {
    return unknownChannel(channel, property,
      Math.max(...population.map(candidate => candidate.overlap)), 0,
      'ambiguous-physical-overlap');
  }
  const totalMass = population.reduce((sum, candidate) => sum + candidate.activationMass, 0);
  assert(totalMass > 0, 'afferent-continuous-readout-zero-mass');
  let estimatedBin = population.reduce((sum, candidate) =>
    sum + candidate.descriptor.populationBin! * candidate.activationMass, 0) / totalMass;
  // The overlapping Gaussian code preserves the source position in the ratio
  // of any adjacent receptor pair: p=b+1/2+ln(m[b+1]/m[b]). This recovers the
  // encoded sensor value without consulting an event outcome or semantic map.
  const adjacentPairs = population.slice(1).map((right, index) => ({
    left: population[index]!, right,
    reliability: Math.min(population[index]!.activationMass, right.activationMass),
  })).filter(pair => pair.right.descriptor.populationBin!
    - pair.left.descriptor.populationBin! === 1)
    .sort((left, right) => right.reliability - left.reliability);
  const strongestPair = adjacentPairs[0];
  if (strongestPair !== undefined && strongestPair.left.activationMass > 0
    && strongestPair.right.activationMass > 0) {
    const ratioEstimate = strongestPair.left.descriptor.populationBin! + 0.5
      + Math.log(strongestPair.right.activationMass / strongestPair.left.activationMass);
    if (Number.isFinite(ratioEstimate)) estimatedBin = ratioEstimate;
  }
  const estimate = resolution * estimatedBin;
  const firstBin = population[0]!.descriptor.populationBin!;
  const lastBin = population.at(-1)!.descriptor.populationBin!;
  return { channel, property, status: 'decoded', encoding: 'continuous',
    overlap: Math.max(...population.map(candidate => candidate.overlap)), competingOverlap: 0,
    reason: 'decoded-continuous', continuous: { resolution, estimate,
      lowerBound: Math.max(firstBin - 0.5, estimatedBin - 0.5) * resolution,
      upperBound: Math.min(lastBin + 0.5, estimatedBin + 0.5) * resolution,
      populationBins: population.map(candidate => ({ bin: candidate.descriptor.populationBin!,
        overlap: candidate.overlap, activationMass: candidate.activationMass })) } };
}

/**
 * Learns only afferent bindings.  It does not contain a coordinate function,
 * distance embedding, semantic map, or physical update rule.
 */
export class SelfOrganizingAfferentProjectionV1 {
  readonly #seed: bigint;
  #allocationSequence: number;
  readonly #bindings = new Map<string, AfferentBindingStateV1>();
  readonly #terminalOutcomeChannels = new Set<string>();

  constructor(seed: bigint = 0x534f415246463031n,
    state?: SelfOrganizingAfferentStateV1) {
    if (state) {
      assert(state.version === 'SelfOrganizingAfferentStateV1', 'afferent-state-version-mismatch');
      assert(parseSeed(state.seedHex) === seed, 'afferent-seed-mismatch');
      assert(Number.isSafeInteger(state.allocationSequence) && state.allocationSequence >= 0,
        'afferent-invalid-allocation-sequence');
      this.#seed = seed;
      this.#allocationSequence = state.allocationSequence;
      for (const binding of state.bindings) {
        assert(binding.siteIds.length === WINNER_COUNT
          && new Set(binding.siteIds).size === WINNER_COUNT, 'afferent-invalid-restored-binding');
        assert(!this.#bindings.has(binding.signalId), 'afferent-duplicate-restored-signal');
        if (binding.descriptor !== undefined) {
          assert(signalId(binding.descriptor) === binding.signalId,
            'afferent-restored-descriptor-identity-mismatch');
        }
        this.#bindings.set(binding.signalId, { ...binding, siteIds: [...binding.siteIds],
          ...(binding.descriptor === undefined ? {} : { descriptor: { ...binding.descriptor } }) });
      }
      for (const channel of state.terminalOutcomeChannels ?? []) {
        assert(channel.length > 0 && !this.#terminalOutcomeChannels.has(channel),
          'afferent-invalid-restored-terminal-outcome-channel');
        this.#terminalOutcomeChannels.add(channel);
      }
    } else {
      this.#seed = seed;
      this.#allocationSequence = 0;
    }
  }

  static restore(state: SelfOrganizingAfferentStateV1):
  SelfOrganizingAfferentProjectionV1 {
    return new SelfOrganizingAfferentProjectionV1(parseSeed(state.seedHex), state);
  }

  #randomForNextBinding(): () => number {
    const random = new SplitMix64(this.#seed ^ (BigInt(this.#allocationSequence + 1) * ALLOCATION_SALT));
    return () => random.uniform();
  }

  #ensureBinding(signal: SignalDriveV1, medium: DistributedMediumWritePortV1): {
    readonly binding: AfferentBindingStateV1; readonly allocated: boolean } {
    const existing = this.#bindings.get(signal.signalId);
    if (existing) {
      if (existing.descriptor !== undefined) {
        assert(canonical(existing.descriptor) === canonical(signal.descriptor),
          'afferent-existing-descriptor-mismatch');
      }
      return { binding: existing, allocated: false };
    }
    const random = this.#randomForNextBinding();
    // Pick one previously unbound seed without assigning it a meaning, then
    // let the physical lattice expose a connected local candidate patch.
    // Randomly scattered candidates produced disconnected "anchors" whose
    // apparent identity existed only in the binding table.
    const seed = medium.allocateSites(1, random);
    const candidates = medium.allocateSitesNear(seed, CANDIDATE_COUNT, random);
    assert(candidates.length === CANDIDATE_COUNT && new Set(candidates).size === CANDIDATE_COUNT,
      'afferent-medium-returned-invalid-candidates');
    const winners = medium.competeForSites(candidates, WINNER_COUNT, random);
    assert(winners.length === WINNER_COUNT && new Set(winners).size === WINNER_COUNT
      && winners.every(siteId => candidates.includes(siteId)), 'afferent-medium-returned-invalid-winners');
    medium.bindSites(signal.signalId, winners);
    const binding: AfferentBindingStateV1 = { signalId: signal.signalId, siteIds: [...winners],
      observationCount: 0, descriptor: { ...signal.descriptor } };
    this.#bindings.set(signal.signalId, binding);
    this.#allocationSequence += 1;
    return { binding, allocated: true };
  }

  #lookupSignals(signals: readonly SignalDriveV1[], unresolvedRoles: readonly string[] = []):
  ReadOnlyAfferentLookupV1 {
    const siteIds = new Set<number>();
    const drives = new Map<number, number>();
    let unresolvedSignalCount = 0;
    for (const signal of mergeSignalDrives(signals)) {
      const binding = this.#bindings.get(signal.signalId);
      if (!binding) { unresolvedSignalCount += 1; continue; }
      binding.siteIds.forEach(siteId => {
        siteIds.add(siteId);
        drives.set(siteId, Math.max(drives.get(siteId) ?? 0, signal.intensity));
      });
    }
    const orderedSiteIds = [...siteIds].sort((left, right) => left - right);
    const orderedDrives = orderedSiteIds.map(siteId => ({ siteId, intensity: drives.get(siteId)! }));
    // Keep the historical object shape for categorical/unit lookups.  A
    // weighted field is emitted only when it carries information that would be
    // lost by the compatibility id-only view.
    const weighted = orderedDrives.some(value => value.intensity !== 1);
    return { version: 'ReadOnlyAfferentLookupV1', siteIds: orderedSiteIds,
      ...(weighted ? { drives: orderedDrives } : {}), unresolvedSignalCount,
      unresolvedRoles: [...new Set(unresolvedRoles)].sort((left, right) => left.localeCompare(right, 'en')) };
  }

  /** Resolve the exact candidate action only through already learned cue bindings. */
  lookupActionCue(cue: ActionCue): ReadOnlyAfferentLookupV1 {
    return this.#lookupSignals(cueSignals(cue));
  }

  /**
   * Resolve a real current observation in an event-local public frame.  This
   * path is pure: unknown public roles or signal values remain unresolved and
   * cannot allocate, reinforce, or move an afferent binding.
   */
  lookupCurrentObservation(observation: Observation,
    roleBindings: readonly EventLocalPublicRoleBindingV1[]): ReadOnlyAfferentLookupV1 {
    const current = eventLocalCurrentPublicStateV1(observation, roleBindings);
    const state = new Map(current.values.map(value => [`${value.subjectRole}/${value.property}`,
      { subject: value.subjectRole, property: value.property, value: value.value }] as const));
    return this.#lookupSignals(stateSignals(state), current.unresolvedRoles);
  }

  /**
   * Decode only what the supplied physical population actually overlaps.
   * This is the inverse of learned afferent bindings, not an event-log lookup:
   * event ids, historical outcomes and world coordinates are unavailable here.
   */
  readPublicState(drives: readonly DistributedSiteDriveV1[]): AfferentPublicStateReadoutV1 {
    const active = new Map<number, number>();
    for (const drive of drives) {
      assert(Number.isSafeInteger(drive.siteId) && drive.siteId >= 0,
        'afferent-readout-invalid-site-id');
      assert(Number.isFinite(drive.intensity), 'afferent-readout-non-finite-intensity');
      if (drive.intensity <= 0) continue;
      active.set(drive.siteId, Math.max(active.get(drive.siteId) ?? 0, drive.intensity));
    }

    const allBoundSites = new Set<number>();
    let legacyDescriptorUnavailable = false;
    const byChannel = new Map<string, BindingPhysicalOverlapV1[]>();
    for (const binding of this.#bindings.values()) {
      binding.siteIds.forEach(siteId => allBoundSites.add(siteId));
      const activeSites = binding.siteIds.filter(siteId => active.has(siteId));
      if (activeSites.length === 0) continue;
      if (binding.descriptor === undefined) {
        legacyDescriptorUnavailable = true;
        continue;
      }
      if (binding.descriptor.source !== 'public-state') continue;
      assert(binding.descriptor.publicProperty !== null,
        'afferent-public-descriptor-property-missing');
      const overlap = activeSites.length / binding.siteIds.length;
      const activationMass = activeSites.reduce((sum, siteId) => sum + active.get(siteId)!, 0)
        / binding.siteIds.length;
      const candidates = byChannel.get(binding.descriptor.channel) ?? [];
      candidates.push({ binding, descriptor: binding.descriptor, overlap, activationMass });
      byChannel.set(binding.descriptor.channel, candidates);
    }

    const channels = [...byChannel].sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([channel, candidates]) => decodePublicChannel(channel, candidates));
    const unmatchedSiteIds = [...active.keys()].filter(siteId => !allBoundSites.has(siteId))
      .sort((left, right) => left - right);
    const status: AfferentPublicStateReadoutV1['status'] = channels.some(channel =>
      channel.status === 'ambiguous') ? 'ambiguous'
      : channels.length === 0 ? 'unknown'
      : channels.every(channel => channel.status === 'decoded') ? 'decoded'
      : channels.some(channel => channel.status === 'decoded') ? 'partial' : 'unknown';
    return { version: 'AfferentPublicStateReadoutV1', status, channels,
      unmatchedSiteIds, legacyDescriptorUnavailable };
  }

  projectEvent(event: RealEvent, medium: DistributedMediumWritePortV1): SelfOrganizingProjectionResultV1 {
    const rows = eventRows(event);
    const signalPulses = eventSignalPulses(event);
    const uniqueSignals = new Map<string, { readonly signal: SignalDriveV1;
      readonly pulseOrdinal: number }>();
    for (const [pulseOrdinal, pulse] of signalPulses.entries()) for (const signal of pulse.signals) {
      const previous = uniqueSignals.get(signal.signalId);
      if (previous !== undefined && canonical(previous.signal.descriptor) !== canonical(signal.descriptor)) {
        throw new Error(`afferent-signal-descriptor-mismatch:${signal.signalId}`);
      }
      if (previous === undefined) uniqueSignals.set(signal.signalId, { signal, pulseOrdinal });
    }
    let newlyAllocatedSignalCount = 0;
    const newlyAllocatedSignalIds: string[] = [];
    for (const { signal } of [...uniqueSignals.values()].sort((left, right) =>
      left.pulseOrdinal - right.pulseOrdinal
      || left.signal.channelOrdinal - right.signal.channelOrdinal
      || left.signal.receptorOrdinal - right.signal.receptorOrdinal)) {
      const ensured = this.#ensureBinding(signal, medium);
      if (ensured.allocated) {
        newlyAllocatedSignalCount += 1;
        newlyAllocatedSignalIds.push(signal.signalId);
      }
      const next = { ...ensured.binding, observationCount: ensured.binding.observationCount + 1 };
      this.#bindings.set(signal.signalId, next);
    }
    const pulses: R1SparseFieldPulseV1[] = signalPulses.map((pulse, ordinal) => {
      const drives = new Map<number, number>();
      for (const signal of pulse.signals) {
        const binding = this.#bindings.get(signal.signalId)!;
        for (const siteId of binding.siteIds) drives.set(siteId,
          Math.max(drives.get(siteId) ?? 0, signal.intensity));
      }
      return { version: 'R1SparseFieldPulseV1', ordinal, dwellSeconds: pulse.dwellSeconds,
        drives: [...drives].sort(([left], [right]) => left - right)
          .map(([siteId, intensity]): DistributedSiteDriveV1 => ({ siteId, intensity })) };
    });
    assert(pulses.length >= 2 && pulses.every(pulse => pulse.drives.length > 0),
      'afferent-empty-distributed-episode');
    const eventSha256 = sha(event);
    const patternSha256 = sha(signalPulses.map(pulse => pulse.signals));
    const episode: R1DistributedEpisodeV1 = { version: 'R1DistributedEpisodeV1', eventId: event.id,
      eventSha256, pulses, patternSha256, sourceFrameCount: event.frames.length,
      retainedTransitionWaveCount: wavesWithActualPublicChange(event) };
    for (const change of rows.measurementChanges.flat()) {
      if (!Object.is(change.before, change.after)) this.#terminalOutcomeChannels.add(channelKey(change));
    }
    return { version: 'SelfOrganizingProjectionResultV1', episode,
      newlyAllocatedSignalCount, newlyAllocatedSignalIds,
      reusedSignalCount: uniqueSignals.size - newlyAllocatedSignalCount };
  }

  snapshot(): SelfOrganizingAfferentStateV1 {
    return { version: 'SelfOrganizingAfferentStateV1', seedHex: `0x${this.#seed.toString(16)}`,
      allocationSequence: this.#allocationSequence,
      terminalOutcomeChannels: [...this.#terminalOutcomeChannels]
        .sort((left, right) => left.localeCompare(right, 'en')),
      bindings: [...this.#bindings.values()].sort((left, right) =>
        left.signalId.localeCompare(right.signalId, 'en')).map(binding => ({ ...binding,
          siteIds: [...binding.siteIds], ...(binding.descriptor === undefined ? {}
            : { descriptor: { ...binding.descriptor } }) })) };
  }
}
