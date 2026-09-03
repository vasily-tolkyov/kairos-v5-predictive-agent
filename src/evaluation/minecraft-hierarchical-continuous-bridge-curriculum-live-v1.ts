import { Vec3 } from 'vec3';
import type { Action, ActionCue, RealEvent } from '../contracts.js';
import { MinecraftBody, publicButtonSelectionShapeV1 } from '../body.js';
import { Compute } from '../compute.js';
import type { ActionObservationScopeV1 } from '../control/contracts.js';
import type { HierarchicalMemoryObservationReceiptV1,
  HierarchicalMemorySnapshotV1 } from '../hierarchical-memory.js';
import { DeterministicTokenFieldEncoder } from '../core/learning/token-field.js';
import type { R2AInterventionEvidenceV1, R2AInterventionProtocolV1 }
  from '../core/learning/r2a-stable-pattern.js';
import { cueIdentity, realEventHierarchyContinuityV1 } from '../events.js';
import { assert, canonical, sha } from '../util.js';
import { minecraftMultilevelGoalChainCasesV1 } from './minecraft-multilevel-goal-chain-v1.js';
import {
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedVocabularyPanelLiveV1,
  prepareMinecraftMultilevelGuidedFixtureLiveV1,
  type MinecraftFixtureCommandSinkLiveV1,
  type MinecraftMultilevelGuidedFixtureGeometryLiveV1,
  type MinecraftMultilevelGuidedRepresentationProfileLiveV1,
  type MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  type MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  type MinecraftMultilevelGuidedTrainingModeLiveV1,
} from './minecraft-multilevel-guided-training-live-v1.js';

/**
 * A preregistered, guided continuous-event supplement.  It is deliberately
 * separate from the frozen 368-R1 baseline plan: the supplement is only
 * allowed to run after that baseline fails its read-only production gate.
 *
 * Each fragment teaches one local transition.  No fragment contains a wired
 * button, an opening door, or the route-plus-interaction solution used by the
 * twelve heldout cases.
 */
export const HIERARCHICAL_CONTINUOUS_BRIDGE_CURRICULUM_LIVE_V1 =
  'MinecraftHierarchicalContinuousBridgeCurriculumLiveV1' as const;

export type ContinuousBridgeDirectionLiveV1 = 'left' | 'right';
export type ContinuousBridgePhaseLiveV1 = 'pattern-formation' | 'prospective-validation'
  | 'matched-intervention';
export type ContinuousBridgeFamilyLiveV1 =
  | 'look-plus-acquire-disconnected-interact'
  | 'look-minus-acquire-disconnected-interact'
  | 'forward-approach-disconnected-interact'
  | 'side-A-clear-then-forward-clear'
  | 'side-B-blocked-then-forward-blocked'
  | 'side-C-clear-then-forward-extension-blocked'
  | 'jump-clear-distance-progress'
  | 'jump-blocked-no-distance-progress';

export type ContinuousBridgeExpectedEffectLiveV1 =
  | 'crosshair-acquires-public-button'
  | 'disconnected-interaction-no-door-transition'
  | 'public-state-remains-observed'
  | 'distance-to-public-button-decreases'
  | 'lateral-clear-progress'
  | 'lateral-motion-blocked'
  | 'forward-progress'
  | 'forward-motion-blocked'
  | 'jump-forward-progress'
  | 'jump-forward-blocked';

export interface ContinuousBridgeAtomPlanLiveV1 {
  readonly ordinal: number;
  readonly cue: ActionCue;
  readonly expectedEffect: ContinuousBridgeExpectedEffectLiveV1;
}

export interface ContinuousBridgeFirstAtomTopologyLiveV1 {
  /** This describes only the collision topology swept by the first action. */
  readonly cueIdentity: string;
  readonly sweptVolume: 'look-ray' | 'forward-lane' | 'left-lane' | 'right-lane'
    | 'jump-forward-lane';
  readonly obstacleInSweptVolume: boolean;
  readonly expectedEffect: ContinuousBridgeExpectedEffectLiveV1;
}

export interface ContinuousBridgeMatchedInterventionLiveV1 {
  readonly comparison: 'left-A-vs-B' | 'left-A-vs-C' | 'right-A-vs-B'
    | 'right-A-vs-C' | 'jump-clear-vs-blocked';
  readonly pairId: string;
  readonly member: 'baseline' | 'intervention';
  readonly branchAtomIndex: 0 | 1;
  readonly exactNextActionIdentity: string;
}

export interface ContinuousBridgeFragmentLiveV1 {
  readonly version: 'ContinuousBridgeFragmentLiveV1';
  readonly fragmentId: string;
  readonly phase: ContinuousBridgePhaseLiveV1;
  readonly family: ContinuousBridgeFamilyLiveV1;
  readonly direction: ContinuousBridgeDirectionLiveV1 | null;
  readonly contextOrdinal: number;
  readonly layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1;
  readonly atoms: readonly ContinuousBridgeAtomPlanLiveV1[];
  readonly firstAtomTopology: ContinuousBridgeFirstAtomTopologyLiveV1;
  readonly matchedIntervention: ContinuousBridgeMatchedInterventionLiveV1 | null;
  /** An extension may block the second action but is outside the first action's swept volume. */
  readonly postFirstActionForwardExtension: 'open' | 'blocked' | 'not-applicable';
  readonly resetBeforeFragment: true;
  readonly continuousInsideFragment: true;
  readonly wiredDoorEffectPresent: false;
  readonly fullSolutionDisclosed: false;
}

export interface ContinuousBridgeCurriculumLiveV1 {
  readonly version: 'ContinuousBridgeCurriculumLiveV1';
  readonly seed: number;
  readonly sourceFrozenR1Atoms: 368;
  readonly sourceFrozenR2Events: 168;
  readonly formation: readonly ContinuousBridgeFragmentLiveV1[];
  readonly validations: readonly ContinuousBridgeFragmentLiveV1[];
  readonly interventions: readonly ContinuousBridgeFragmentLiveV1[];
  readonly fragments: readonly ContinuousBridgeFragmentLiveV1[];
  readonly appendedR1Atoms: 404;
  readonly appendedR2Events: 144;
  readonly expectedFinalR1Atoms: 772;
  readonly expectedFinalR2Events: 312;
  readonly fullSolutionTrainingFragments: 0;
}

const SEED = 0x52324143;
const CARDINALS = ['north', 'east', 'south', 'west'] as const;
const observeCue: ActionCue = Object.freeze({ kind: 'observe', parameters: { ticks: 5 },
  targetRole: null });
const disconnectedInteractCue: ActionCue = Object.freeze({ kind: 'interact', parameters: {},
  targetRole: 'stone_button' });

function shuffled<T>(input: readonly T[], seed: number): T[] {
  const result = [...input]; let state = seed >>> 0;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function cue(kind: ActionCue['kind'], parameters: ActionCue['parameters'],
  targetRole: string | null = null): ActionCue {
  return Object.freeze({ kind, parameters: Object.freeze({ ...parameters }), targetRole });
}

function layout(index: number, contextOrdinal: number,
  matchedContextKey: string): MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  assert(Number.isInteger(index) && index >= 0 && Number.isInteger(contextOrdinal)
    && contextOrdinal >= 0, 'continuous-bridge-layout-index-invalid');
  // This namespace is disjoint from both the 1040/1360 baseline and the
  // 400-series heldout fixtures.  Matched members share facing and marker
  // context, not an absolute world location.
  const column = index % 16, row = Math.floor(index / 16);
  const contextHash = [...matchedContextKey].reduce((sum, value) => sum + value.charCodeAt(0), 0);
  return Object.freeze({ id: `hierarchical-continuous-bridge-${String(index + 1).padStart(3, '0')}`,
    split: 'consolidation', replication: 1000 + index,
    originX: 3000 + column * 24, originZ: 3000 + row * 24,
    facing: CARDINALS[(contextOrdinal + contextHash) % CARDINALS.length]!,
    neutralMarkerMask: (contextOrdinal + contextHash) % 8 });
}

function topology(cueValue: ActionCue,
  sweptVolume: ContinuousBridgeFirstAtomTopologyLiveV1['sweptVolume'],
  obstacleInSweptVolume: boolean,
  expectedEffect: ContinuousBridgeExpectedEffectLiveV1,
): ContinuousBridgeFirstAtomTopologyLiveV1 {
  return Object.freeze({ cueIdentity: cueIdentity(cueValue), sweptVolume,
    obstacleInSweptVolume, expectedEffect });
}

function atom(ordinal: number, cueValue: ActionCue,
  expectedEffect: ContinuousBridgeExpectedEffectLiveV1): ContinuousBridgeAtomPlanLiveV1 {
  return Object.freeze({ ordinal, cue: structuredClone(cueValue), expectedEffect });
}

interface FragmentInput {
  readonly family: ContinuousBridgeFamilyLiveV1;
  readonly phase: ContinuousBridgePhaseLiveV1;
  readonly direction?: ContinuousBridgeDirectionLiveV1;
  readonly contextOrdinal: number;
  readonly contextKey: string;
  readonly atoms: readonly ContinuousBridgeAtomPlanLiveV1[];
  readonly firstAtomTopology: ContinuousBridgeFirstAtomTopologyLiveV1;
  readonly intervention?: ContinuousBridgeMatchedInterventionLiveV1;
  readonly forwardExtension?: 'open' | 'blocked';
}

function fragment(index: number, input: FragmentInput): ContinuousBridgeFragmentLiveV1 {
  assert(input.atoms.length === 2 || input.atoms.length === 3,
    'continuous-bridge-fragment-atom-count-invalid');
  assert(input.atoms.every((value, ordinal) => value.ordinal === ordinal),
    'continuous-bridge-fragment-atom-order-invalid');
  return Object.freeze({ version: 'ContinuousBridgeFragmentLiveV1',
    fragmentId: `continuous-bridge-${String(index + 1).padStart(3, '0')}`,
    phase: input.phase, family: input.family, direction: input.direction ?? null,
    contextOrdinal: input.contextOrdinal, layout: layout(index, input.contextOrdinal, input.contextKey),
    atoms: Object.freeze(input.atoms.map(value => Object.freeze(structuredClone(value)))),
    firstAtomTopology: Object.freeze(structuredClone(input.firstAtomTopology)),
    matchedIntervention: input.intervention ? Object.freeze({ ...input.intervention }) : null,
    postFirstActionForwardExtension: input.forwardExtension ?? 'not-applicable',
    resetBeforeFragment: true, continuousInsideFragment: true,
    wiredDoorEffectPresent: false, fullSolutionDisclosed: false });
}

function lookFragments(sign: 'plus' | 'minus'): FragmentInput[] {
  const look = cue('look', { yawDegrees: sign === 'plus' ? 15 : -15, pitchDegrees: 0 });
  return Array.from({ length: 8 }, (_unused, contextOrdinal) => ({
    family: `look-${sign}-acquire-disconnected-interact` as ContinuousBridgeFamilyLiveV1,
    phase: 'pattern-formation', contextOrdinal, contextKey: `look-${sign}:${contextOrdinal}`,
    atoms: [atom(0, look, 'crosshair-acquires-public-button'),
      atom(1, disconnectedInteractCue, 'disconnected-interaction-no-door-transition'),
      atom(2, observeCue, 'public-state-remains-observed')],
    firstAtomTopology: topology(look, 'look-ray', false, 'crosshair-acquires-public-button'),
  }));
}

function forwardFragments(): FragmentInput[] {
  const forward = cue('move', { direction: 'forward', ticks: 4 });
  return Array.from({ length: 8 }, (_unused, contextOrdinal) => ({
    family: 'forward-approach-disconnected-interact', phase: 'pattern-formation',
    contextOrdinal, contextKey: `forward-approach:${contextOrdinal}`,
    atoms: [atom(0, forward, 'distance-to-public-button-decreases'),
      atom(1, disconnectedInteractCue, 'disconnected-interaction-no-door-transition'),
      atom(2, observeCue, 'public-state-remains-observed')],
    firstAtomTopology: topology(forward, 'forward-lane', false,
      'distance-to-public-button-decreases'),
  }));
}

function sideAtoms(direction: ContinuousBridgeDirectionLiveV1,
  variant: 'A' | 'B' | 'C'): readonly ContinuousBridgeAtomPlanLiveV1[] {
  const side = cue('move', { direction, ticks: 4 });
  const forward = cue('move', { direction: 'forward', ticks: 4 });
  return [atom(0, side, variant === 'B' ? 'lateral-motion-blocked' : 'lateral-clear-progress'),
    atom(1, forward, variant === 'A' ? 'forward-progress' : 'forward-motion-blocked'),
    atom(2, observeCue, 'public-state-remains-observed')];
}

function sideTopology(direction: ContinuousBridgeDirectionLiveV1,
  variant: 'A' | 'B' | 'C'): ContinuousBridgeFirstAtomTopologyLiveV1 {
  const side = cue('move', { direction, ticks: 4 });
  return topology(side, direction === 'left' ? 'left-lane' : 'right-lane', variant === 'B',
    variant === 'B' ? 'lateral-motion-blocked' : 'lateral-clear-progress');
}

function sideInput(direction: ContinuousBridgeDirectionLiveV1, variant: 'A' | 'B' | 'C',
  phase: ContinuousBridgePhaseLiveV1, contextOrdinal: number, contextKey: string,
  intervention?: ContinuousBridgeMatchedInterventionLiveV1): FragmentInput {
  return { family: `side-${variant}-${variant === 'A' ? 'clear-then-forward-clear'
    : variant === 'B' ? 'blocked-then-forward-blocked'
      : 'clear-then-forward-extension-blocked'}` as ContinuousBridgeFamilyLiveV1,
    phase, direction, contextOrdinal, contextKey, atoms: sideAtoms(direction, variant),
    firstAtomTopology: sideTopology(direction, variant), intervention,
    forwardExtension: variant === 'A' ? 'open' : 'blocked' };
}

function sideFragments(direction: ContinuousBridgeDirectionLiveV1): FragmentInput[] {
  const formation = (['A', 'B', 'C'] as const).flatMap(variant =>
    Array.from({ length: 8 }, (_unused, contextOrdinal) => sideInput(direction, variant,
      'pattern-formation', contextOrdinal, `${direction}:formation:${contextOrdinal}`)));
  // Formation only establishes repeated outcome patterns and their candidate
  // factor split.  These later, independent layouts are the first evidence
  // allowed to validate that split prospectively; formation events are never
  // backfilled into the prediction grade.
  const validations = Array.from({ length: 2 }, (_unused, validationOrdinal) =>
    (['A', 'B', 'C'] as const).map(variant => sideInput(direction, variant,
      'prospective-validation', 16 + validationOrdinal,
      `${direction}:validation:${validationOrdinal}`))).flat();
  const interventions: FragmentInput[] = [];
  for (let pairIndex = 0; pairIndex < 4; pairIndex++) {
    const abPair = `${direction}-A-vs-B-${pairIndex}`;
    interventions.push(sideInput(direction, 'A', 'matched-intervention', 8 + pairIndex,
      abPair, { comparison: `${direction}-A-vs-B`, pairId: abPair, member: 'baseline',
        branchAtomIndex: 0, exactNextActionIdentity: cueIdentity(sideAtoms(direction, 'A')[0]!.cue) }),
    sideInput(direction, 'B', 'matched-intervention', 8 + pairIndex,
      abPair, { comparison: `${direction}-A-vs-B`, pairId: abPair, member: 'intervention',
        branchAtomIndex: 0, exactNextActionIdentity: cueIdentity(sideAtoms(direction, 'B')[0]!.cue) }));
    const acPair = `${direction}-A-vs-C-${pairIndex}`;
    interventions.push(sideInput(direction, 'A', 'matched-intervention', 12 + pairIndex,
      acPair, { comparison: `${direction}-A-vs-C`, pairId: acPair, member: 'baseline',
        branchAtomIndex: 1, exactNextActionIdentity: cueIdentity(sideAtoms(direction, 'A')[1]!.cue) }),
    sideInput(direction, 'C', 'matched-intervention', 12 + pairIndex,
      acPair, { comparison: `${direction}-A-vs-C`, pairId: acPair, member: 'intervention',
        branchAtomIndex: 1, exactNextActionIdentity: cueIdentity(sideAtoms(direction, 'C')[1]!.cue) }));
  }
  return [...formation, ...validations, ...interventions];
}

function jumpInput(variant: 'clear' | 'blocked', phase: ContinuousBridgePhaseLiveV1,
  contextOrdinal: number, contextKey: string,
  intervention?: ContinuousBridgeMatchedInterventionLiveV1): FragmentInput {
  const jump = cue('jump', { forward: true, ticks: 4 });
  const positive = variant === 'clear';
  return { family: positive ? 'jump-clear-distance-progress' : 'jump-blocked-no-distance-progress',
    phase, contextOrdinal, contextKey,
    atoms: [atom(0, jump, positive ? 'jump-forward-progress' : 'jump-forward-blocked'),
      atom(1, observeCue, 'public-state-remains-observed')],
    firstAtomTopology: topology(jump, 'jump-forward-lane', !positive,
      positive ? 'jump-forward-progress' : 'jump-forward-blocked'), intervention };
}

function jumpFragments(): FragmentInput[] {
  const result: FragmentInput[] = (['clear', 'blocked'] as const).flatMap(variant =>
    Array.from({ length: 8 }, (_unused, contextOrdinal) => jumpInput(variant,
      'pattern-formation', contextOrdinal, `jump:formation:${contextOrdinal}`)));
  for (let validationOrdinal = 0; validationOrdinal < 2; validationOrdinal++) {
    for (const variant of ['clear', 'blocked'] as const) result.push(jumpInput(variant,
      'prospective-validation', 16 + validationOrdinal,
      `jump:validation:${validationOrdinal}`));
  }
  for (let pairIndex = 0; pairIndex < 4; pairIndex++) {
    const pairId = `jump-clear-vs-blocked-${pairIndex}`;
    result.push(jumpInput('clear', 'matched-intervention', 8 + pairIndex, pairId,
      { comparison: 'jump-clear-vs-blocked', pairId, member: 'baseline', branchAtomIndex: 0,
        exactNextActionIdentity: cueIdentity(cue('jump', { forward: true, ticks: 4 })) }),
    jumpInput('blocked', 'matched-intervention', 8 + pairIndex, pairId,
      { comparison: 'jump-clear-vs-blocked', pairId, member: 'intervention', branchAtomIndex: 0,
        exactNextActionIdentity: cueIdentity(cue('jump', { forward: true, ticks: 4 })) }));
  }
  return result;
}

export function minecraftHierarchicalContinuousBridgeCurriculumLiveV1():
ContinuousBridgeCurriculumLiveV1 {
  const source = [...lookFragments('plus'), ...lookFragments('minus'), ...forwardFragments(),
    ...sideFragments('left'), ...sideFragments('right'), ...jumpFragments()];
  assert(source.length === 144, 'continuous-bridge-fragment-cardinality-invalid');
  const formationSource = source.filter(value => value.phase === 'pattern-formation');
  const validationSource = source.filter(value => value.phase === 'prospective-validation');
  const interventionSource = source.filter(value => value.phase === 'matched-intervention');
  assert(formationSource.length === 88 && validationSource.length === 16
    && interventionSource.length === 40,
    'continuous-bridge-phase-cardinality-invalid');
  let nextIndex = 0;
  const formation = shuffled(formationSource, SEED ^ 0x9e3779b9)
    .map(value => fragment(nextIndex++, value));
  const validations = shuffled(validationSource, SEED ^ 0xc2b2ae35)
    .map(value => fragment(nextIndex++, value));
  const interventionPairs = new Map<string, FragmentInput[]>();
  for (const value of interventionSource) {
    assert(value.intervention, 'continuous-bridge-intervention-metadata-missing');
    interventionPairs.set(value.intervention.pairId,
      [...(interventionPairs.get(value.intervention.pairId) ?? []), value]);
  }
  assert(interventionPairs.size === 20 && [...interventionPairs.values()].every(values =>
    values.length === 2 && values.some(value => value.intervention!.member === 'baseline')
      && values.some(value => value.intervention!.member === 'intervention')),
  'continuous-bridge-intervention-pair-plan-invalid');
  const interventions = shuffled([...interventionPairs.values()], SEED ^ 0x85ebca6b)
    .flatMap(values => [...values].sort((left, right) => left.intervention!.member === right.intervention!.member
      ? 0 : left.intervention!.member === 'baseline' ? -1 : 1))
    .map(value => fragment(nextIndex++, value));
  const fragments = [...formation, ...validations, ...interventions];
  const appendedR1Atoms = fragments.reduce((sum, value) => sum + value.atoms.length, 0);
  assert(appendedR1Atoms === 404, 'continuous-bridge-R1-cardinality-invalid');
  const result: ContinuousBridgeCurriculumLiveV1 = {
    version: 'ContinuousBridgeCurriculumLiveV1', seed: SEED,
    sourceFrozenR1Atoms: 368, sourceFrozenR2Events: 168,
    formation: Object.freeze(formation), validations: Object.freeze(validations),
    interventions: Object.freeze(interventions),
    fragments: Object.freeze(fragments), appendedR1Atoms: 404, appendedR2Events: 144,
    expectedFinalR1Atoms: 772, expectedFinalR2Events: 312,
    fullSolutionTrainingFragments: 0,
  };
  return Object.freeze(result);
}

export function minecraftHierarchicalContinuousBridgeCurriculumIdentityLiveV1(): string {
  return sha(minecraftHierarchicalContinuousBridgeCurriculumLiveV1());
}

export interface ContinuousBridgeCurriculumAuditLiveV1 {
  readonly fragmentCount: 144;
  readonly appendedR1Atoms: 404;
  readonly appendedR2Events: 144;
  readonly trainingHeldoutLayoutOverlap: 0;
  readonly wiredDoorEffectFragments: 0;
  readonly fullSolutionFragments: 0;
  readonly sideACFirstAtomTopologyMismatchCount: 0;
  readonly sideACR2CommonPrefixMismatchCount: 0;
  readonly passed: true;
}

export function auditMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(
  plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1(),
): ContinuousBridgeCurriculumAuditLiveV1 {
  const heldoutOrigins = new Set(minecraftMultilevelGoalChainCasesV1.map(value =>
    `${value.fixture.origin[0]},${value.fixture.origin[2]}`));
  const overlap = plan.fragments.filter(value => heldoutOrigins.has(
    `${value.layout.originX},${value.layout.originZ}`)).length;
  const wired = plan.fragments.filter(value => value.wiredDoorEffectPresent
    || value.atoms.some(item => item.expectedEffect.includes('open-door'))).length;
  const full = plan.fragments.filter(value => value.fullSolutionDisclosed).length;
  let topologyMismatch = 0, prefixMismatch = 0;
  for (const direction of ['left', 'right'] as const) {
    for (let contextOrdinal = 0; contextOrdinal < 8; contextOrdinal++) {
      const a = plan.formation.find(value => value.direction === direction
        && value.family === 'side-A-clear-then-forward-clear'
        && value.contextOrdinal === contextOrdinal);
      const c = plan.formation.find(value => value.direction === direction
        && value.family === 'side-C-clear-then-forward-extension-blocked'
        && value.contextOrdinal === contextOrdinal);
      assert(a && c, `continuous-bridge-side-A-C-pair-missing:${direction}:${contextOrdinal}`);
      if (canonical(a.firstAtomTopology) !== canonical(c.firstAtomTopology)) topologyMismatch++;
      if (cueIdentity(a.atoms[0]!.cue) !== cueIdentity(c.atoms[0]!.cue)
        || a.atoms[0]!.expectedEffect !== c.atoms[0]!.expectedEffect
        || cueIdentity(a.atoms[1]!.cue) !== cueIdentity(c.atoms[1]!.cue)) prefixMismatch++;
    }
  }
  assert(plan.fragments.length === 144 && plan.validations.length === 16
    && plan.appendedR1Atoms === 404 && plan.appendedR2Events === 144
    && plan.expectedFinalR1Atoms === 772 && plan.expectedFinalR2Events === 312,
  'continuous-bridge-audit-cardinality-invalid');
  assert(overlap === 0 && wired === 0 && full === 0 && topologyMismatch === 0
    && prefixMismatch === 0, 'continuous-bridge-audit-boundary-failed');
  return Object.freeze({ fragmentCount: 144, appendedR1Atoms: 404,
    appendedR2Events: 144, trainingHeldoutLayoutOverlap: 0,
    wiredDoorEffectFragments: 0, fullSolutionFragments: 0,
    sideACFirstAtomTopologyMismatchCount: 0,
    sideACR2CommonPrefixMismatchCount: 0, passed: true });
}

/**
 * The fixture adapter is intentionally narrow.  Fixture construction remains
 * outside memory and control; once prepared, this executor performs only real
 * MinecraftBody actions and the existing trusted hierarchical observe call.
 */
export interface PreparedContinuousBridgeFixtureLiveV1 {
  readonly actions: readonly Action[];
  readonly scopes: readonly ActionObservationScopeV1[];
  readonly fixtureCommandCountAtSeal: number;
  readonly currentFixtureCommandCount: () => number;
  readonly assertAtomOutcome: (atom: ContinuousBridgeAtomPlanLiveV1,
    event: RealEvent) => void;
}

export interface ContinuousBridgeFixtureCommandPortLiveV1
extends MinecraftFixtureCommandSinkLiveV1 {
  readonly count: number;
  ensureLoaded(originX: number, originZ: number): boolean;
}

export interface ContinuousBridgeExecutionLiveV1 {
  readonly fragmentId: string;
  readonly eventIds: readonly string[];
  readonly r2EventId: string;
  readonly orderedExperienceIdentities: readonly string[];
}

export interface ContinuousBridgeOpaqueRelationSelectionLiveV1 {
  readonly comparison: NonNullable<ContinuousBridgeMatchedInterventionLiveV1>['comparison'];
  readonly targetPatternId: string;
  readonly contrastPatternId: string;
  readonly relationId: string;
  readonly branchAtomIndex: 0 | 1;
  readonly exactNextActionIdentity: string;
  readonly changedFactorIds: readonly string[];
  readonly formationMatchedPairs: readonly {
    readonly targetEventId: string;
    readonly contrastEventId: string;
  }[];
}

export interface ContinuousBridgeCurriculumExecutionLiveV1 {
  readonly version: 'ContinuousBridgeCurriculumExecutionLiveV1';
  readonly planIdentity: string;
  readonly formation: readonly ContinuousBridgeExecutionLiveV1[];
  readonly validations: readonly ContinuousBridgeExecutionLiveV1[];
  readonly interventions: readonly ContinuousBridgeExecutionLiveV1[];
  readonly selections: readonly ContinuousBridgeOpaqueRelationSelectionLiveV1[];
  readonly protocols: readonly R2AInterventionProtocolV1[];
  readonly audit: ExecutedContinuousBridgeCurriculumAuditLiveV1;
}

export interface ExecutedContinuousBridgeCurriculumAuditLiveV1 {
  readonly version: 'ExecutedContinuousBridgeCurriculumAuditLiveV1';
  readonly executions: 144;
  readonly appendedR1Atoms: 404;
  readonly appendedR2Events: 144;
  readonly finalR1Atoms: 772;
  readonly finalR2Events: 312;
  readonly sideACFirstAtomPhysicalTopologyMismatchCount: 0;
  readonly wiredDoorOpeningChangeCount: 0;
  readonly passed: true;
}

function retag(event: RealEvent, sessionId: string, boundary: 'reset' | 'continuous'): RealEvent {
  const publicEvent = { ...event, hierarchyContinuity: undefined };
  return { ...publicEvent,
    hierarchyContinuity: realEventHierarchyContinuityV1(publicEvent, sessionId, boundary) };
}

const cardinalVector = (side: MinecraftMultilevelGuidedTrainingLayoutLiveV1['facing']):
readonly [number, number] => side === 'north' ? [0, -1] : side === 'south' ? [0, 1]
  : side === 'east' ? [1, 0] : [-1, 0];

const oppositeFacing = (side: MinecraftMultilevelGuidedTrainingLayoutLiveV1['facing']):
MinecraftMultilevelGuidedTrainingLayoutLiveV1['facing'] => side === 'north' ? 'south'
  : side === 'south' ? 'north' : side === 'east' ? 'west' : 'east';

function positionAt(fragmentPlan: ContinuousBridgeFragmentLiveV1, lateral: number,
  forwardDistance: number, y = 64): readonly [number, number, number] {
  const forward = cardinalVector(fragmentPlan.layout.facing);
  const right = [-forward[1], forward[0]] as const;
  return [fragmentPlan.layout.originX + right[0] * lateral + forward[0] * forwardDistance,
    y, fragmentPlan.layout.originZ + right[1] * lateral + forward[1] * forwardDistance];
}

function baseMode(fragmentPlan: ContinuousBridgeFragmentLiveV1):
MinecraftMultilevelGuidedTrainingModeLiveV1 {
  if (fragmentPlan.family === 'look-plus-acquire-disconnected-interact')
    return 'look-plus-15-acquire';
  if (fragmentPlan.family === 'look-minus-acquire-disconnected-interact')
    return 'look-minus-15-acquire';
  // The disconnected interaction fixture supplies a real, already aimed
  // button.  The first action remains the preregistered forward movement.
  if (fragmentPlan.family === 'forward-approach-disconnected-interact')
    return 'interact-visible-disconnected-button-no-door-change';
  if (fragmentPlan.family === 'jump-clear-distance-progress')
    return 'jump-forward-clear-one-block';
  if (fragmentPlan.family === 'jump-blocked-no-distance-progress')
    return 'jump-forward-blocked-low-roof-high-obstacle';
  if (fragmentPlan.direction === 'left') return fragmentPlan.family.startsWith('side-B-')
    ? 'left-blocked' : 'left-clear';
  assert(fragmentPlan.direction === 'right', 'continuous-bridge-side-direction-missing');
  return fragmentPlan.family.startsWith('side-B-') ? 'right-blocked' : 'right-clear';
}

function baseProfile(mode: MinecraftMultilevelGuidedTrainingModeLiveV1):
MinecraftMultilevelGuidedRepresentationProfileLiveV1 {
  const side = mode.startsWith('left-') || mode.startsWith('right-');
  const jump = mode.startsWith('jump-forward-');
  return { version: 'MinecraftMultilevelGuidedRepresentationProfileLiveV1',
    effectReference: side ? 'self-and-central-obstacle' : 'stone-button-proxy',
    mechanismMaterial: side ? 'stone_bricks' : jump ? 'smooth_stone' : null,
    calibrationVocabularyPanel: false, crosshairVocabularyMaterial: null };
}

function baseEpisode(fragmentPlan: ContinuousBridgeFragmentLiveV1):
MinecraftMultilevelGuidedTrainingEpisodeLiveV1 {
  const mode = baseMode(fragmentPlan);
  const action: Action = mode.startsWith('look-plus')
    ? { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } }
    : mode.startsWith('look-minus')
      ? { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } }
      : mode.startsWith('left-') ? { kind: 'move', parameters: { direction: 'left', ticks: 4 } }
        : mode.startsWith('right-') ? { kind: 'move', parameters: { direction: 'right', ticks: 4 } }
          : mode.startsWith('jump-') ? { kind: 'jump', parameters: { forward: true, ticks: 4 } }
            : { kind: 'interact', parameters: {},
              targetId: `${fragmentPlan.layout.id}:materialized-at-runtime` };
  return { version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1',
    episode: Number(fragmentPlan.fragmentId.match(/(\d+)$/)?.[1] ?? 0),
    half: 'second-128-consolidation', mode, layout: fragmentPlan.layout, action,
    reset: 'before-this-episode-only', fullSolutionDisclosed: false,
    representationProfile: baseProfile(mode) };
}

function objectAt(event: RealEvent, id: string) {
  return event.frames.flatMap(frame => frame.objects.filter(value => value.id === id));
}

function projected(event: RealEvent, axis: readonly [number, number]): number[] {
  const first = event.frames[0]!.self.position;
  return event.frames.map(frame => (frame.self.position[0] - first[0]) * axis[0]
    + (frame.self.position[2] - first[2]) * axis[1]);
}

function assertContinuousBridgeAtomOutcome(fragmentPlan: ContinuousBridgeFragmentLiveV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1, buttonId: string | null,
  atomPlan: ContinuousBridgeAtomPlanLiveV1, event: RealEvent): void {
  assert(event.frames.length >= 2, 'continuous-bridge-event-observation-window-incomplete');
  const first = event.frames[0]!, last = event.frames.at(-1)!;
  const forward = projected(event, geometry.forward), right = projected(event, geometry.right);
  switch (atomPlan.expectedEffect) {
    case 'crosshair-acquires-public-button':
      assert(buttonId && first.targetId !== buttonId && last.targetId === buttonId,
        'continuous-bridge-look-did-not-acquire-button'); break;
    case 'disconnected-interaction-no-door-transition': {
      assert(buttonId && first.targetId === buttonId,
        'continuous-bridge-disconnected-button-not-targeted');
      const doors = event.frames.flatMap(frame => frame.objects.filter(value =>
        value.type === 'iron_door'));
      assert(doors.every(value => value.properties.open !== true),
        'continuous-bridge-disconnected-interaction-opened-door'); break;
    }
    case 'public-state-remains-observed':
      assert(event.cue.kind === 'observe', 'continuous-bridge-verification-not-observe'); break;
    case 'distance-to-public-button-decreases': {
      assert(buttonId, 'continuous-bridge-approach-button-missing');
      const values = objectAt(event, buttonId);
      assert(values.length >= 2 && Math.hypot(...values.at(-1)!.relativePosition)
        < Math.hypot(...values[0]!.relativePosition) - .02,
      'continuous-bridge-forward-did-not-reduce-button-distance');
      assert(last.targetId === buttonId && Math.hypot(...values.at(-1)!.relativePosition) <= 4.5,
        'continuous-bridge-forward-did-not-establish-button-affordance'); break;
    }
    case 'lateral-clear-progress':
      assert(fragmentPlan.direction && (fragmentPlan.direction === 'left'
        ? Math.min(...right) < -.04 : Math.max(...right) > .04),
      'continuous-bridge-lateral-clear-progress-missing'); break;
    case 'lateral-motion-blocked':
      assert(Math.max(...right.map(Math.abs)) <= .26,
        'continuous-bridge-lateral-block-missing'); break;
    case 'forward-progress':
      assert(Math.max(...forward) > .04, 'continuous-bridge-forward-progress-missing'); break;
    case 'forward-motion-blocked':
      assert(Math.max(...forward.map(Math.abs)) <= .26,
        'continuous-bridge-forward-block-missing'); break;
    case 'jump-forward-progress': {
      const startY = first.self.position[1];
      assert(Math.max(...event.frames.map(frame => frame.self.position[1] - startY)) >= .5
        && Math.max(...forward) > .20, 'continuous-bridge-jump-progress-missing'); break;
    }
    case 'jump-forward-blocked': {
      const startY = first.self.position[1];
      assert(Math.max(...event.frames.map(frame => frame.self.position[1] - startY)) <= .35
        && Math.max(...forward.map(Math.abs)) <= .26,
      'continuous-bridge-jump-block-missing'); break;
    }
  }
}

/**
 * Prepare one real local mechanism.  The only custom geometry is C's wall
 * extension, placed outside the first lateral action's swept volume before
 * the fragment begins.  No fixture command is permitted between atoms.
 */
export async function prepareMinecraftHierarchicalContinuousBridgeFixtureLiveV1(
  commands: ContinuousBridgeFixtureCommandPortLiveV1, body: MinecraftBody,
  fragmentPlan: ContinuousBridgeFragmentLiveV1,
): Promise<PreparedContinuousBridgeFixtureLiveV1> {
  if (commands.ensureLoaded(fragmentPlan.layout.originX, fragmentPlan.layout.originZ))
    await body.waitTicks(20);
  const episode = baseEpisode(fragmentPlan);
  const fixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(commands, body, episode);
  if (fragmentPlan.direction) {
    // The reused side-action fixture uses narrow iron bars to keep a single
    // action visually observable. In a continuous fragment a blocked side
    // move can leave the body offset by ~0.2 blocks, after which it can slip
    // past that narrow shape. All A/B/C variants therefore share the same
    // full lower central obstacle: A clears it by a real side move, B remains
    // in the central lane, and C is blocked only by its lateral extension.
    // Keep the already-calibrated public iron-bar cap at y=65 as the event's
    // visible reference; changing that role's material would create a new R1
    // identity instead of merely fixing the collision geometry.
    const collisionPosition = positionAt(fragmentPlan, 0, 1, 64);
    commands.command(`setblock ${collisionPosition.join(' ')} minecraft:stone_bricks`);
    await body.waitTicks(4);
    const publicReferenceId = `block:${positionAt(fragmentPlan, 0, 1, 65).join(',')}`;
    assert(body.latest().objects.some(value => value.id === publicReferenceId
      && value.type === 'iron_bars'),
    'continuous-bridge-central-obstacle-reference-not-public');
  }
  if (fragmentPlan.family === 'side-C-clear-then-forward-extension-blocked') {
    assert(fragmentPlan.direction, 'continuous-bridge-C-direction-missing');
    const lateral = fragmentPlan.direction === 'left' ? -1 : 1;
    const extensionIds: string[] = [];
    for (const y of [64, 65]) {
      const position = positionAt(fragmentPlan, lateral, 1, y);
      commands.command(`setblock ${position.join(' ')} minecraft:stone_bricks`);
      extensionIds.push(`block:${position.join(',')}`);
    }
    await body.waitTicks(4);
    assert(extensionIds.some(id => body.latest().objects.some(value => value.id === id
      && value.type === 'stone_bricks')),
    'continuous-bridge-C-forward-extension-not-public-before-first-action');
  }
  let buttonId = fixture.buttonId ?? null;
  if (fragmentPlan.family === 'forward-approach-disconnected-interact') {
    // The reused single-action fixture only guaranteed that its lower button
    // was aimed at before movement. A real four-tick approach changes that
    // vertical ray and correctly leaves the target. Use the already-public,
    // disconnected proxy button at eye height and begin just outside reach.
    // The first real action still moves along the actual sight line; nothing
    // adjusts the pose or aim between the R1 atoms.
    const vocabulary = minecraftMultilevelGuidedVocabularyPanelLiveV1(fragmentPlan.layout);
    buttonId = `block:${vocabulary.proxyButton.join(',')}`;
    // This local lesson has one public interaction target. Keeping the lower
    // legacy button as a second same-type object would introduce an unrelated
    // cardinality feature that the frozen event map never represented.
    commands.command(`setblock ${fixture.geometry.button.join(' ')} air`);
    const forward = cardinalVector(fragmentPlan.layout.facing);
    const start = [fragmentPlan.layout.originX + .5 + forward[0] * 1.25, 64,
      fragmentPlan.layout.originZ + .5 + forward[1] * 1.25] as const;
    commands.command(`tp ${body.bot.username} ${start.join(' ')}`);
    await body.waitTicks(4);
    const facing = oppositeFacing(fragmentPlan.layout.facing);
    const outline = publicButtonSelectionShapeV1({ face: 'wall', facing, powered: false });
    assert(outline, 'continuous-bridge-forward-proxy-outline-missing');
    const target = new Vec3(vocabulary.proxyButton[0] + (outline[0] + outline[3]) / 2,
      vocabulary.proxyButton[1] + (outline[1] + outline[4]) / 2,
      vocabulary.proxyButton[2] + (outline[2] + outline[5]) / 2);
    await body.bot.lookAt(target, true);
    await body.waitTicks(3);
    const ready = body.latest();
    assert(Math.hypot(...ready.self.position.map((value, index) => value - start[index]!)) < .02,
      'continuous-bridge-forward-proxy-pose-not-stable');
    assert(ready.objects.some(value => value.id === buttonId && value.type === 'stone_button'),
      'continuous-bridge-forward-proxy-not-public');
  }
  const actions = fragmentPlan.atoms.map(atomPlan => atomPlan.cue.kind === 'interact'
    ? (assert(buttonId, 'continuous-bridge-interact-button-missing'),
      { kind: 'interact', parameters: {}, targetId: buttonId } as Action)
    : { kind: atomPlan.cue.kind, parameters: { ...atomPlan.cue.parameters } } as Action);
  const referenceIds = buttonId ? [buttonId] : [fixture.referenceId];
  const scopes = actions.map((): ActionObservationScopeV1 => ({
    version: 'ActionObservationScopeV1', referencedPublicObjectIds: referenceIds }));
  const fixtureCommandCountAtSeal = commands.count;
  return { actions: Object.freeze(actions), scopes: Object.freeze(scopes),
    fixtureCommandCountAtSeal, currentFixtureCommandCount: () => commands.count,
    assertAtomOutcome: (atomPlan, event) => assertContinuousBridgeAtomOutcome(
      fragmentPlan, fixture.geometry, buttonId, atomPlan, event) };
}

export async function executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1(
  compute: Compute, body: MinecraftBody, fragmentPlan: ContinuousBridgeFragmentLiveV1,
  prepared: PreparedContinuousBridgeFixtureLiveV1,
): Promise<ContinuousBridgeExecutionLiveV1> {
  assert(prepared.actions.length === fragmentPlan.atoms.length
    && prepared.scopes.length === fragmentPlan.atoms.length,
  `continuous-bridge-prepared-atom-cardinality:${fragmentPlan.fragmentId}`);
  assert(prepared.currentFixtureCommandCount() === prepared.fixtureCommandCountAtSeal,
    'continuous-bridge-fixture-not-sealed-before-first-action');
  const closedBodyEvents: RealEvent[] = [];
  for (let index = 0; index < fragmentPlan.atoms.length; index++) {
    const atomPlan = fragmentPlan.atoms[index]!, action = prepared.actions[index]!;
    assert(cueIdentity({ kind: action.kind, parameters: action.parameters,
      targetRole: atomPlan.cue.targetRole }) === cueIdentity(atomPlan.cue),
    `continuous-bridge-action-cue-mismatch:${fragmentPlan.fragmentId}:${index}`);
    const execution = await body.execute(action, prepared.scopes[index]!);
    assert(execution.result.executed && execution.event?.provenance === 'executed-real-body'
      && execution.event.complete,
    `continuous-bridge-real-action-failed:${fragmentPlan.fragmentId}:${index}`);
    prepared.assertAtomOutcome(atomPlan, execution.event);
    assert(prepared.currentFixtureCommandCount() === prepared.fixtureCommandCountAtSeal,
      'continuous-bridge-fixture-mutated-inside-fragment');
    closedBodyEvents.push(execution.event);
  }
  // A curriculum fragment is one real macro-process made from several R1
  // atoms. Depositing each atom before executing the next one let a variable
  // amount of physical computation elapse in the still-running Minecraft
  // world. Those fully captured but action-external frames could then make an
  // otherwise continuous fragment appear to have an R2 observation gap.
  // Close all real body windows first; only then replay the immutable atoms to
  // memory in their real order. This changes neither an R1 fact nor the strict
  // R2 gap rule, and is specific to guided collection rather than planning.
  const events = closedBodyEvents.map((event, index) =>
    retag(event, body.session.id, index === 0 ? 'reset' : 'continuous'));
  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    const receipt = await compute.call<HierarchicalMemoryObservationReceiptV1>('observe', event);
    assert(receipt.representationRejection === null,
      `continuous-bridge-event-unrepresented:${fragmentPlan.fragmentId}:${index}`);
  }
  const snapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
  const eventIds = events.map(value => value.id);
  const matches = snapshot.r2Store.events.filter(value => value.completion === 'complete'
    && canonical(value.sourceEventIds) === canonical(eventIds));
  assert(matches.length === 1 && matches[0]!.atomIds.length === fragmentPlan.atoms.length
    && matches[0]!.learningEligible && matches[0]!.physicalStatus === 'deposited',
  `continuous-bridge-exact-R2-event-missing:${fragmentPlan.fragmentId}:${matches.length}`);
  return Object.freeze({ fragmentId: fragmentPlan.fragmentId,
    eventIds: Object.freeze(eventIds), r2EventId: matches[0]!.eventId,
    orderedExperienceIdentities: Object.freeze(events.map(value => cueIdentity(value.cue))) });
}

function comparisonMembers(plan: ContinuousBridgeCurriculumLiveV1,
  comparison: ContinuousBridgeMatchedInterventionLiveV1['comparison']): {
    readonly target: readonly ContinuousBridgeFragmentLiveV1[];
    readonly contrast: readonly ContinuousBridgeFragmentLiveV1[];
    readonly branchAtomIndex: 0 | 1;
    readonly exactNextActionIdentity: string;
  } {
  const side = comparison.startsWith('left-') ? 'left'
    : comparison.startsWith('right-') ? 'right' : null;
  if (side) {
    const contrastVariant = comparison.endsWith('A-vs-B') ? 'B' : 'C';
    const target = plan.formation.filter(value => value.direction === side
      && value.family === 'side-A-clear-then-forward-clear');
    const contrast = plan.formation.filter(value => value.direction === side
      && value.family === (contrastVariant === 'B'
        ? 'side-B-blocked-then-forward-blocked'
        : 'side-C-clear-then-forward-extension-blocked'));
    const branchAtomIndex = contrastVariant === 'B' ? 0 as const : 1 as const;
    return { target, contrast, branchAtomIndex,
      exactNextActionIdentity: cueIdentity(target[0]!.atoms[branchAtomIndex]!.cue) };
  }
  const target = plan.formation.filter(value => value.family === 'jump-clear-distance-progress');
  const contrast = plan.formation.filter(value => value.family === 'jump-blocked-no-distance-progress');
  return { target, contrast, branchAtomIndex: 0,
    exactNextActionIdentity: cueIdentity(target[0]!.atoms[0]!.cue) };
}

/** Select relations from physical members formed by the real formation run. */
export function selectMinecraftHierarchicalContinuousBridgeRelationsLiveV1(
  snapshot: HierarchicalMemorySnapshotV1, plan: ContinuousBridgeCurriculumLiveV1,
  formationTimeline: readonly ContinuousBridgeExecutionLiveV1[],
): readonly ContinuousBridgeOpaqueRelationSelectionLiveV1[] {
  assert(snapshot.r2a && snapshot.tokenEncoder,
    'continuous-bridge-relation-selection-requires-R2A');
  const timeline = new Map(formationTimeline.map(value => [value.fragmentId, value]));
  const evidence = new Map(snapshot.r2a.evidence.map(value => [value.eventId, value]));
  const encoder = DeterministicTokenFieldEncoder.fromState(snapshot.tokenEncoder);
  const comparisons: ContinuousBridgeMatchedInterventionLiveV1['comparison'][] = [
    'left-A-vs-B', 'left-A-vs-C', 'right-A-vs-B', 'right-A-vs-C',
    'jump-clear-vs-blocked',
  ];
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0)
    / values.length;
  return Object.freeze(comparisons.map(comparison => {
    const members = comparisonMembers(plan, comparison);
    assert(members.target.length === 8 && members.contrast.length === 8,
      `continuous-bridge-formation-members-invalid:${comparison}`);
    const eventIds = (items: readonly ContinuousBridgeFragmentLiveV1[]) => items.map(value => {
      const execution = timeline.get(value.fragmentId);
      assert(execution, `continuous-bridge-formation-execution-missing:${value.fragmentId}`);
      return execution.r2EventId;
    });
    const targetEventIds = eventIds(members.target), contrastEventIds = eventIds(members.contrast);
    const patternContaining = (ids: readonly string[], opposingIds: readonly string[], arm: 'target' | 'contrast') => {
      const minimumCoverage = Math.ceil(ids.length * .8);
      const maximumCrossContamination = Math.floor(ids.length * .2);
      const candidates = snapshot.r2a!.patterns.map(pattern => ({ pattern,
        coveredIds: ids.filter(id => pattern.memberEventIds.includes(id)),
        opposingIds: opposingIds.filter(id => pattern.memberEventIds.includes(id)) }))
        .filter(value => value.coveredIds.length >= minimumCoverage
          && value.opposingIds.length <= maximumCrossContamination
          && value.pattern.partitionStatus === 'resolved'
          && ['predictive-stable', 'causal-hypothesis', 'intervention-supported']
            .includes(value.pattern.grade))
        .sort((left, right) => right.coveredIds.length - left.coveredIds.length
          || left.opposingIds.length - right.opposingIds.length
          || left.pattern.patternId.localeCompare(right.pattern.patternId, 'en'));
      const best = candidates[0];
      const tied = best ? candidates.filter(value => value.coveredIds.length === best.coveredIds.length
        && value.opposingIds.length === best.opposingIds.length) : [];
      assert(best && tied.length === 1,
        `continuous-bridge-formation-pattern-not-unique:${comparison}:${arm}:${tied.length}`);
      return best;
    };
    const targetSelection = patternContaining(targetEventIds, contrastEventIds, 'target');
    const contrastSelection = patternContaining(contrastEventIds, targetEventIds, 'contrast');
    const target = targetSelection.pattern, contrast = contrastSelection.pattern;
    assert(target.patternId !== contrast.patternId,
      `continuous-bridge-target-contrast-pattern-collision:${comparison}`);
    const selectedTargetEventIds = targetSelection.coveredIds;
    const selectedContrastEventIds = contrastSelection.coveredIds;
    const relations = snapshot.r2a!.relations.filter(value => value.targetPatternId === target.patternId
      && value.contrastPatternIds.includes(contrast.patternId)
      && value.branchAtomIndex === members.branchAtomIndex
      && value.exactNextActionIdentity === members.exactNextActionIdentity
      && value.predictiveSinceEventId !== null
      && ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(value.grade));
    assert(relations.length === 1,
      `continuous-bridge-formation-relation-not-unique:${comparison}:${relations.length}`);
    const relation = relations[0]!;
    const tokenValues = (ids: readonly string[], tokenIndex: number) => ids.map(eventId => {
      const item = evidence.get(eventId);
      const perception = item?.atomPrePerceptions[members.branchAtomIndex];
      assert(perception, `continuous-bridge-branch-perception-missing:${comparison}:${eventId}`);
      return encoder.encode(`${eventId}:atom:${members.branchAtomIndex}`,
        new Float64Array(perception)).tokens[tokenIndex]!.standardizedValue;
    });
    const changedFactorIds = relation.factorIds.filter(factorId => {
      const factor = snapshot.r2a!.factors.find(value => value.factorId === factorId);
      assert(factor, `continuous-bridge-factor-missing:${comparison}:${factorId}`);
      const positive = tokenValues(selectedTargetEventIds, factor.tokenIndex);
      const negative = tokenValues(selectedContrastEventIds, factor.tokenIndex);
      return Math.max(...positive) - Math.min(...positive) <= factor.tolerance
        && Math.max(...negative) - Math.min(...negative) <= factor.tolerance
        && Math.abs(mean(positive) - mean(negative)) > factor.tolerance;
    }).sort((left, right) => left.localeCompare(right, 'en'));
    assert(changedFactorIds.length > 0,
      `continuous-bridge-opaque-factor-set-empty:${comparison}`);
    const byContext = (items: readonly ContinuousBridgeFragmentLiveV1[], selectedIds: readonly string[]) =>
      new Map(items.flatMap(value => {
        const eventId = timeline.get(value.fragmentId)!.r2EventId;
        return selectedIds.includes(eventId) ? [[value.contextOrdinal, eventId] as const] : [];
      }));
    const targetByContext = byContext(members.target, selectedTargetEventIds);
    const contrastByContext = byContext(members.contrast, selectedContrastEventIds);
    const formationMatchedPairs = [...targetByContext.entries()].sort(([left], [right]) => left - right)
      .flatMap(([contextOrdinal, targetEventId]) => {
        const contrastEventId = contrastByContext.get(contextOrdinal);
        return contrastEventId ? [Object.freeze({ targetEventId, contrastEventId })] : [];
      });
    assert(formationMatchedPairs.length >= 4,
      `continuous-bridge-formation-context-pairs-insufficient:${comparison}:${formationMatchedPairs.length}`);
    return Object.freeze({ comparison, targetPatternId: target.patternId,
      contrastPatternId: contrast.patternId, relationId: relation.relationId,
      branchAtomIndex: members.branchAtomIndex,
      exactNextActionIdentity: members.exactNextActionIdentity,
      changedFactorIds: Object.freeze(changedFactorIds),
      formationMatchedPairs: Object.freeze(formationMatchedPairs) });
  }));
}

function interventionEvidence(
  plan: ContinuousBridgeCurriculumLiveV1,
  timeline: readonly ContinuousBridgeExecutionLiveV1[],
  selection: ContinuousBridgeOpaqueRelationSelectionLiveV1,
  protocol: R2AInterventionProtocolV1,
): readonly R2AInterventionEvidenceV1[] {
  const executions = new Map(timeline.map(value => [value.fragmentId, value]));
  const fragments = plan.interventions.filter(value =>
    value.matchedIntervention?.comparison === selection.comparison);
  const pairs = new Map<string, { baseline?: string; intervention?: string }>();
  for (const fragmentPlan of fragments) {
    const metadata = fragmentPlan.matchedIntervention!, execution = executions.get(fragmentPlan.fragmentId);
    assert(execution, `continuous-bridge-intervention-execution-missing:${fragmentPlan.fragmentId}`);
    assert(metadata.branchAtomIndex === selection.branchAtomIndex
      && metadata.exactNextActionIdentity === selection.exactNextActionIdentity,
    `continuous-bridge-intervention-identity-mismatch:${fragmentPlan.fragmentId}`);
    const pair = pairs.get(metadata.pairId) ?? {};
    pair[metadata.member] = execution.r2EventId; pairs.set(metadata.pairId, pair);
  }
  assert(pairs.size === 4 && [...pairs.values()].every(value => value.baseline && value.intervention),
    `continuous-bridge-intervention-pairs-incomplete:${selection.comparison}`);
  return Object.freeze([...pairs.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([pairId, pair]) => Object.freeze({ version: 'R2AInterventionEvidenceV1' as const,
      pairId: `continuous-bridge-${pairId}`, protocolId: protocol.protocolId,
      relationId: selection.relationId, baselineEventId: pair.baseline!,
      interventionEventId: pair.intervention!,
      changedFactorIds: selection.changedFactorIds, trustedActualObservation: true })));
}

/**
 * End-to-end guided supplement.  It runs only local preregistered fragments;
 * it never injects a goal or starts a heldout controller.
 */
export async function runMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(
  compute: Compute, body: MinecraftBody, commands: ContinuousBridgeFixtureCommandPortLiveV1,
): Promise<ContinuousBridgeCurriculumExecutionLiveV1> {
  const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
  const formation: ContinuousBridgeExecutionLiveV1[] = [];
  for (const fragmentPlan of plan.formation) {
    const fixture = await prepareMinecraftHierarchicalContinuousBridgeFixtureLiveV1(
      commands, body, fragmentPlan);
    formation.push(await executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1(
      compute, body, fragmentPlan, fixture));
  }
  const formationSnapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
  assert(formationSnapshot.annotations.length === 616 && formationSnapshot.writes === 616
    && formationSnapshot.r2Store.events.length === 256,
  'continuous-bridge-formation-cardinality-invalid');
  const validations: ContinuousBridgeExecutionLiveV1[] = [];
  for (const fragmentPlan of plan.validations) {
    const fixture = await prepareMinecraftHierarchicalContinuousBridgeFixtureLiveV1(
      commands, body, fragmentPlan);
    validations.push(await executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1(
      compute, body, fragmentPlan, fixture));
  }
  const validatedSnapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
  assert(validatedSnapshot.annotations.length === 660 && validatedSnapshot.writes === 660
    && validatedSnapshot.r2Store.events.length === 272,
  'continuous-bridge-validation-cardinality-invalid');
  const selections = selectMinecraftHierarchicalContinuousBridgeRelationsLiveV1(
    validatedSnapshot, plan, formation);
  const protocols: R2AInterventionProtocolV1[] = [];
  for (const selection of selections) protocols.push(await compute.call<R2AInterventionProtocolV1>(
    'registerMatchedInterventionProtocol', {
      protocolId: `continuous-bridge-${selection.comparison}-v1`,
      relationId: selection.relationId, changedFactorIds: selection.changedFactorIds,
      formationMatchedPairs: selection.formationMatchedPairs,
    }));
  const interventions: ContinuousBridgeExecutionLiveV1[] = [];
  for (const fragmentPlan of plan.interventions) {
    const fixture = await prepareMinecraftHierarchicalContinuousBridgeFixtureLiveV1(
      commands, body, fragmentPlan);
    interventions.push(await executeMinecraftHierarchicalContinuousBridgeFragmentLiveV1(
      compute, body, fragmentPlan, fixture));
  }
  for (const selection of selections) {
    const protocol = protocols.find(value => value.relationId === selection.relationId
      && value.protocolId === `continuous-bridge-${selection.comparison}-v1`)!;
    for (const evidence of interventionEvidence(plan, interventions, selection, protocol))
      await compute.call('recordMatchedIntervention', evidence);
  }
  const snapshot = await compute.call<HierarchicalMemorySnapshotV1>('snapshot');
  for (const selection of selections) {
    const relation = snapshot.r2a?.relations.find(value => value.relationId === selection.relationId);
    const factorSet = relation?.factorSetInterventions.find(value =>
      canonical(value.factorIds) === canonical(selection.changedFactorIds));
    assert(relation?.grade === 'intervention-supported' && (factorSet?.pairIds.length ?? 0) >= 4,
      `continuous-bridge-relation-not-intervention-supported:${selection.comparison}`);
  }
  const audit = auditExecutedMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(
    plan, [...formation, ...validations, ...interventions], snapshot);
  return Object.freeze({ version: 'ContinuousBridgeCurriculumExecutionLiveV1',
    planIdentity: minecraftHierarchicalContinuousBridgeCurriculumIdentityLiveV1(),
    formation: Object.freeze(formation), validations: Object.freeze(validations),
    interventions: Object.freeze(interventions),
    selections: Object.freeze(selections), protocols: Object.freeze(protocols), audit });
}

/** Post-hoc audit over actual V10 annotations, not plan labels. */
export function auditExecutedMinecraftHierarchicalContinuousBridgeCurriculumLiveV1(
  plan: ContinuousBridgeCurriculumLiveV1,
  timeline: readonly ContinuousBridgeExecutionLiveV1[],
  snapshot: HierarchicalMemorySnapshotV1,
): ExecutedContinuousBridgeCurriculumAuditLiveV1 {
  assert(timeline.length === 144 && new Set(timeline.map(value => value.fragmentId)).size === 144,
    'continuous-bridge-executed-timeline-cardinality-invalid');
  const byFragment = new Map(timeline.map(value => [value.fragmentId, value]));
  const allEventIds = timeline.flatMap(value => value.eventIds);
  assert(allEventIds.length === 404 && new Set(allEventIds).size === 404,
    'continuous-bridge-executed-R1-event-cardinality-invalid');
  assert(snapshot.annotations.length === 772 && snapshot.writes === 772
    && snapshot.r2Store.events.length === 312,
  'continuous-bridge-executed-final-cardinality-invalid');
  const annotations = new Map(snapshot.annotations.map(value => [value.eventId, value]));
  assert(allEventIds.every(value => annotations.has(value)),
    'continuous-bridge-executed-annotation-missing');
  const r2Events = new Map(snapshot.r2Store.events.map(value => [value.eventId, value]));
  assert(timeline.every(value => {
    const r2 = r2Events.get(value.r2EventId);
    return r2?.completion === 'complete' && r2.learningEligible
      && canonical(r2.sourceEventIds) === canonical(value.eventIds);
  }), 'continuous-bridge-executed-R2-event-mismatch');
  let topologyMismatch = 0;
  for (const direction of ['left', 'right'] as const) {
    for (let contextOrdinal = 0; contextOrdinal < 8; contextOrdinal++) {
      const aPlan = plan.formation.find(value => value.direction === direction
        && value.contextOrdinal === contextOrdinal
        && value.family === 'side-A-clear-then-forward-clear')!;
      const cPlan = plan.formation.find(value => value.direction === direction
        && value.contextOrdinal === contextOrdinal
        && value.family === 'side-C-clear-then-forward-extension-blocked')!;
      const aEvent = byFragment.get(aPlan.fragmentId)?.eventIds[0];
      const cEvent = byFragment.get(cPlan.fragmentId)?.eventIds[0];
      const a = aEvent ? annotations.get(aEvent) : null, c = cEvent ? annotations.get(cEvent) : null;
      if (!a || !c || a.publicTransitionTopologyId !== c.publicTransitionTopologyId
        || cueIdentity(a.cue) !== cueIdentity(c.cue)) topologyMismatch++;
    }
  }
  const wiredDoorOpeningChangeCount = allEventIds.flatMap(eventId =>
    annotations.get(eventId)!.kernelChanges.flat()).filter(change => change.property === 'open'
      && change.before === false && change.after === true).length;
  assert(topologyMismatch === 0,
    `continuous-bridge-executed-side-A-C-topology-mismatch:${topologyMismatch}`);
  assert(wiredDoorOpeningChangeCount === 0,
    `continuous-bridge-executed-door-opening-leak:${wiredDoorOpeningChangeCount}`);
  return Object.freeze({ version: 'ExecutedContinuousBridgeCurriculumAuditLiveV1',
    executions: 144, appendedR1Atoms: 404, appendedR2Events: 144,
    finalR1Atoms: 772, finalR2Events: 312,
    sideACFirstAtomPhysicalTopologyMismatchCount: 0,
    wiredDoorOpeningChangeCount: 0, passed: true });
}
