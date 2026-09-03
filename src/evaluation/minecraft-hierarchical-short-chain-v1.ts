/**
 * Read-only preflight for the proposed Minecraft note=2 hierarchical short
 * chain. It contains no body, service, memory or fixture import: a NO-GO result
 * cannot start Minecraft or mutate physical experience.
 */
export const MINECRAFT_HIERARCHICAL_SHORT_CHAIN_PREFLIGHT_V1 =
  'MinecraftHierarchicalShortChainPreflightV1' as const;

export type MinecraftHierarchicalShortChainBlockerV1 =
  'blocked-by-r2a-factor-identification';

export interface MinecraftHierarchicalShortChainPreflightInputV1 {
  readonly resetSeparatedLegacyR1Atoms: number;
  readonly foundationContinuousEvents: number;
  readonly r1AtomsPerContinuousEvent: number;
  readonly postProtocolContinuousEvents: number;
  readonly foundationCategoricalValues: readonly string[];
  readonly requiredCategoricalValues: readonly string[];
  readonly changedPublicTokenCount: number;
  readonly minimumRelevantFactorCount: number;
  readonly matchedPairsRequiredPerFactor: number;
  readonly eventsPerMatchedPair: number;
}

export interface MinecraftHierarchicalShortChainPreflightV1 {
  readonly version: typeof MINECRAFT_HIERARCHICAL_SHORT_CHAIN_PREFLIGHT_V1;
  readonly go: false;
  readonly classification: MinecraftHierarchicalShortChainBlockerV1;
  readonly minecraftExecutionPermitted: false;
  readonly mixedInitialization: {
    readonly r1AtomCount: number;
    readonly requiredR1AtomCount: 128;
    readonly exactlyFillsInitialization: boolean;
    readonly missingCategoricalValues: readonly string[];
    readonly vocabularyCovered: boolean;
    readonly legacyResetR2EventUpperBound: 0;
  };
  readonly prospectiveIntervention: {
    readonly availableEvents: number;
    readonly availableNonReusedPairs: number;
    readonly factorCapacity: number;
    readonly requiredFactors: number;
    readonly requiredNonReusedPairs: number;
    readonly requiredEvents: number;
    readonly missingEvents: number;
    readonly enoughForAllFactors: boolean;
    readonly isolatesExactlyOnePublicToken: boolean;
  };
  readonly blockers: readonly [
    'categorical-transition-is-not-a-single-token-intervention',
    'post-protocol-events-cannot-support-every-required-factor'
  ];
  readonly boundary: {
    readonly liveMinecraftStarted: false;
    readonly physicalMemoryReadOrWritten: false;
    readonly legacySnapshotImported: false;
    readonly conclusion: string;
  };
}

export const MINECRAFT_HIERARCHICAL_SHORT_CHAIN_AUDITED_INPUT_V1:
  MinecraftHierarchicalShortChainPreflightInputV1 = Object.freeze({
    resetSeparatedLegacyR1Atoms: 32,
    foundationContinuousEvents: 24,
    r1AtomsPerContinuousEvent: 4,
    postProtocolContinuousEvents: 8,
    foundationCategoricalValues: Object.freeze(['0', '1', '2']),
    requiredCategoricalValues: Object.freeze(['0', '1', '2']),
    // note=0 -> note=1 removes one one-hot key and adds another.
    changedPublicTokenCount: 2,
    minimumRelevantFactorCount: 2,
    matchedPairsRequiredPerFactor: 4,
    eventsPerMatchedPair: 2,
  });

/** Compute the current hard data/protocol lower bound without constructing memory. */
export function preflightMinecraftHierarchicalShortChainV1(
  input: MinecraftHierarchicalShortChainPreflightInputV1 =
    MINECRAFT_HIERARCHICAL_SHORT_CHAIN_AUDITED_INPUT_V1,
): MinecraftHierarchicalShortChainPreflightV1 {
  const integerFields = [input.resetSeparatedLegacyR1Atoms, input.foundationContinuousEvents,
    input.r1AtomsPerContinuousEvent, input.postProtocolContinuousEvents,
    input.changedPublicTokenCount, input.minimumRelevantFactorCount,
    input.matchedPairsRequiredPerFactor, input.eventsPerMatchedPair];
  if (integerFields.some(value => !Number.isSafeInteger(value) || value < 0)
    || input.r1AtomsPerContinuousEvent < 2 || input.matchedPairsRequiredPerFactor < 1
    || input.eventsPerMatchedPair < 2 || input.minimumRelevantFactorCount < 1) {
    throw new Error('invalid-minecraft-hierarchical-short-chain-preflight-input');
  }

  const r1AtomCount = input.resetSeparatedLegacyR1Atoms
    + input.foundationContinuousEvents * input.r1AtomsPerContinuousEvent;
  const observed = new Set(input.foundationCategoricalValues);
  const missingCategoricalValues = [...new Set(input.requiredCategoricalValues)]
    .filter(value => !observed.has(value)).sort();
  const availableNonReusedPairs = Math.floor(
    input.postProtocolContinuousEvents / input.eventsPerMatchedPair);
  const factorCapacity = Math.floor(
    availableNonReusedPairs / input.matchedPairsRequiredPerFactor);
  const requiredNonReusedPairs = input.minimumRelevantFactorCount
    * input.matchedPairsRequiredPerFactor;
  const requiredEvents = requiredNonReusedPairs * input.eventsPerMatchedPair;

  return Object.freeze({
    version: MINECRAFT_HIERARCHICAL_SHORT_CHAIN_PREFLIGHT_V1,
    go: false,
    classification: 'blocked-by-r2a-factor-identification',
    minecraftExecutionPermitted: false,
    mixedInitialization: Object.freeze({
      r1AtomCount,
      requiredR1AtomCount: 128 as const,
      exactlyFillsInitialization: r1AtomCount === 128,
      missingCategoricalValues: Object.freeze(missingCategoricalValues),
      vocabularyCovered: missingCategoricalValues.length === 0,
      legacyResetR2EventUpperBound: 0 as const,
    }),
    prospectiveIntervention: Object.freeze({
      availableEvents: input.postProtocolContinuousEvents,
      availableNonReusedPairs,
      factorCapacity,
      requiredFactors: input.minimumRelevantFactorCount,
      requiredNonReusedPairs,
      requiredEvents,
      missingEvents: Math.max(0, requiredEvents - input.postProtocolContinuousEvents),
      enoughForAllFactors: factorCapacity >= input.minimumRelevantFactorCount,
      isolatesExactlyOnePublicToken: input.changedPublicTokenCount === 1,
    }),
    blockers: Object.freeze([
      'categorical-transition-is-not-a-single-token-intervention',
      'post-protocol-events-cannot-support-every-required-factor',
    ] as const),
    boundary: Object.freeze({
      liveMinecraftStarted: false as const,
      physicalMemoryReadOrWritten: false as const,
      legacySnapshotImported: false as const,
      conclusion: 'The mixed 128-atom initialization is feasible, but the current single-factor '
        + 'intervention protocol cannot certify the categorical note transition, and eight '
        + 'post-registration events can certify at most one factor. The held-out batch must not run.',
    }),
  });
}
