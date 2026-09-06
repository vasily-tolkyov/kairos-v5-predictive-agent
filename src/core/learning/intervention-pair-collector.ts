import { assert, canonical, sha } from '../../util.js';
import { interventionPairIdentityV1, type InterventionArmKindV1 } from './intervention-agenda.js';

export interface TrustedInterventionWindowV1 {
  readonly version: 'TrustedInterventionWindowV1';
  readonly source: 'trusted-real-event-window';
  readonly eventId: string;
  readonly contextId: string;
  /** Opaque physical identity of the pre-action R2 prefix. */
  readonly physicalPrefixId: string;
  /** Opaque identity of the exact next action. */
  readonly exactActionIdentity: string;
  /** Only physically decoded factor states may be supplied. */
  readonly factorStates: readonly { readonly factorId: string; readonly state: 'active' | 'inactive' | 'unknown' }[];
  readonly terminalAttractorSignature: string;
}

export interface InterventionPairCandidateV1 {
  readonly version: 'InterventionPairCandidateV1';
  readonly pairId: string;
  readonly combinationId: string;
  readonly factorIds: readonly string[];
  readonly arm: InterventionArmKindV1;
  readonly baselineEventId: string;
  readonly interventionEventId: string;
  readonly contextId: string;
  readonly physicalPrefixId: string;
  readonly exactActionIdentity: string;
  readonly samePrefix: true;
  readonly sameAction: true;
  readonly onlyPlannedFactorsChanged: true;
  readonly terminalAttractorSignatures: readonly [string, string];
}

export interface InterventionPairCollectorStateV1 {
  readonly version: 'InterventionPairCollectorStateV1';
  readonly windows: readonly TrustedInterventionWindowV1[];
  readonly emittedPairIds: readonly string[];
}

function sortedStates(value: TrustedInterventionWindowV1): readonly { readonly factorId: string; readonly state: 'active' | 'inactive' | 'unknown' }[] {
  const seen = new Set<string>();
  return value.factorStates.slice().sort((a, b) => a.factorId.localeCompare(b.factorId, 'en')).map(state => {
    assert(state.factorId.length > 0 && !seen.has(state.factorId), 'intervention-window-factor-duplicate');
    seen.add(state.factorId); return { ...state };
  });
}

function armFor(states: readonly { readonly factorId: string; readonly state: 'active' | 'inactive' | 'unknown' }[], factors: readonly string[]): InterventionArmKindV1 | null {
  if (states.some(state => state.state === 'unknown') || factors.length !== 2) return null;
  const active = new Set(states.filter(state => state.state === 'active').map(state => state.factorId));
  if (active.size === 0) return 'baseline';
  if (active.size === 2 && factors.every(id => active.has(id))) return 'q+r';
  if (active.size === 1 && active.has(factors[0]!)) return 'q-only';
  if (active.size === 1 && active.has(factors[1]!)) return 'r-only';
  return null;
}

/**
 * Collects matched intervention candidates from completed real windows.  It
 * derives the four-arm code and matching predicate from opaque physical
 * state, so callers cannot submit a scorer-selected outcome or a mismatched
 * prefix.  It does not execute anything or grade a relation.
 */
export class InterventionPairCollectorV1 {
  readonly #windows = new Map<string, TrustedInterventionWindowV1>();
  readonly #emitted = new Set<string>();

  add(value: TrustedInterventionWindowV1): readonly InterventionPairCandidateV1[] {
    assert(value.version === 'TrustedInterventionWindowV1'
      && value.source === 'trusted-real-event-window'
      && value.eventId.length > 0 && value.contextId.length > 0
      && value.physicalPrefixId.length > 0 && value.exactActionIdentity.length > 0
      && value.terminalAttractorSignature.length > 0, 'intervention-window-invalid');
    assert(!this.#windows.has(value.eventId), 'intervention-window-duplicate');
    const states = sortedStates(value);
    assert(states.length === 2, 'intervention-window-requires-two-factors');
    const factorIds = states.map(state => state.factorId);
    const arm = armFor(states, factorIds);
    assert(arm !== null, 'intervention-window-factor-state-invalid');
    const stored = { ...structuredClone(value), factorStates: states };
    this.#windows.set(value.eventId, stored);
    const group = [...this.#windows.values()].filter(other => other.eventId !== value.eventId
      && other.contextId === value.contextId
      && other.physicalPrefixId === value.physicalPrefixId
      && other.exactActionIdentity === value.exactActionIdentity);
    const results: InterventionPairCandidateV1[] = [];
    for (const other of group) {
      const prior = other.eventId.localeCompare(value.eventId, 'en') < 0 ? other : value;
      const next = prior === other ? value : other;
      const priorStates = new Map(prior.factorStates.map(state => [state.factorId, state.state]));
      const nextStates = new Map(next.factorStates.map(state => [state.factorId, state.state]));
      if (canonical([...priorStates.keys()].sort()) !== canonical([...nextStates.keys()].sort())) continue;
      const changed = factorIds.filter(id => priorStates.get(id) !== nextStates.get(id));
      if (changed.length === 0 || changed.length > 2) continue;
      // A factorial arm is paired against the all-inactive baseline.  This
      // keeps nuisance channels matched and leaves the physical branch as a
      // measured output, rather than a supplied success flag.
      const baseline = armFor(prior.factorStates, factorIds) === 'baseline' ? prior
        : armFor(next.factorStates, factorIds) === 'baseline' ? next : null;
      if (!baseline || baseline.eventId === next.eventId) continue;
      const intervention = baseline.eventId === prior.eventId ? next : prior;
      const interventionArm = armFor(intervention.factorStates, factorIds);
      if (!interventionArm || interventionArm === 'baseline') continue;
      const pairId = interventionPairIdentityV1(sha({ physicalPrefixId: value.physicalPrefixId,
        exactActionIdentity: value.exactActionIdentity, factorIds }), interventionArm,
        baseline.eventId, intervention.eventId);
      if (this.#emitted.has(pairId)) continue;
      this.#emitted.add(pairId);
      results.push({ version: 'InterventionPairCandidateV1', pairId,
        combinationId: sha({ physicalPrefixId: value.physicalPrefixId,
          exactActionIdentity: value.exactActionIdentity, factorIds }), factorIds,
        arm: interventionArm, baselineEventId: baseline.eventId,
        interventionEventId: intervention.eventId, contextId: value.contextId,
        physicalPrefixId: value.physicalPrefixId, exactActionIdentity: value.exactActionIdentity,
        samePrefix: true, sameAction: true, onlyPlannedFactorsChanged: true,
        terminalAttractorSignatures: [baseline.terminalAttractorSignature,
          intervention.terminalAttractorSignature] });
    }
    return results.sort((a, b) => a.pairId.localeCompare(b.pairId, 'en')).map(value => structuredClone(value));
  }

  snapshot(): InterventionPairCollectorStateV1 {
    return { version: 'InterventionPairCollectorStateV1',
      windows: [...this.#windows.values()].sort((a, b) => a.eventId.localeCompare(b.eventId, 'en'))
        .map(value => structuredClone(value)), emittedPairIds: [...this.#emitted].sort() };
  }

  /** Used by the memory owner to ensure grading only consumes a pair emitted
   * by this collector, never an independently fabricated arm. */
  hasPair(pairId: string): boolean { return this.#emitted.has(pairId); }

  static restore(state: InterventionPairCollectorStateV1): InterventionPairCollectorV1 {
    assert(state.version === 'InterventionPairCollectorStateV1', 'intervention-pair-state-invalid');
    const collector = new InterventionPairCollectorV1();
    for (const value of state.windows) collector.#windows.set(value.eventId, structuredClone(value));
    for (const value of state.emittedPairIds) collector.#emitted.add(value);
    return collector;
  }
}
