import type { Observation, RealEvent, VerifiedInternalChannelV1 } from '../contracts.js';
import type { PhysicalControlSnapshotV2 } from './controller.js';

export const VERIFIED_INTERNAL_PROPERTY_PREFIX_V1 = 'internal/' as const;

export interface InteroceptiveStateInputV1 {
  readonly control: PhysicalControlSnapshotV2 | null;
  readonly actions: number;
  readonly actionBudget: number;
  /** Bounded recent attention notices retained by the current runtime. */
  readonly recentAttentionNotices?: readonly { readonly kind: string }[];
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Compute only deterministic, pre-outcome quantities from already-held state. */
export function computeInteroceptiveChannelsV1(input: InteroceptiveStateInputV1):
readonly VerifiedInternalChannelV1[] {
  const channels: VerifiedInternalChannelV1[] = [];
  const add = (name: VerifiedInternalChannelV1['name'], value: number): void => {
    channels.push({ version: 'VerifiedInternalChannelV1', name, value: bounded(value),
      provenance: 'verified-internal', availableBeforeOutcome: true });
  };
  const activations = input.control?.field.sites.map(site => Math.max(0, site.activation)) ?? [];
  const total = activations.reduce((sum, value) => sum + value, 0);
  if (activations.length > 0 && total > 0) {
    const entropy = activations.length === 1 ? 0 : -activations.reduce((sum, value) => {
      const p = value / total; return sum + (p > 0 ? p * Math.log(p) : 0);
    }, 0) / Math.log(activations.length);
    add('branch-entropy', entropy);
  }
  const residual = input.control?.field.lastGoalEvaluation?.residual;
  if (typeof residual === 'number') add('goal-residual', residual);
  const nodes = input.control?.workspace.nodes ?? [];
  const predictions = nodes.filter(node => node.prediction?.fresh)
    .map(node => node.prediction?.value)
    .filter((value): value is NonNullable<typeof value> => value !== undefined);
  if (predictions.length > 0)
    add('prediction-support', predictions.reduce((sum, value) => sum + value.prediction.support, 0)
      / predictions.length);
  const conditionValues = nodes.flatMap(node => {
    const condition = node.condition?.fresh ? node.condition.value : undefined;
    return condition?.memberResults?.map(member => member.value) ?? (condition ? [condition] : []);
  });
  if (conditionValues.length > 0)
    add('applicable-relations', conditionValues.filter(value => value.productionEligible
      && value.applicability > 0).length / conditionValues.length);
  const notices = input.recentAttentionNotices;
  if (notices && notices.length > 0)
    add('surprise-rate', notices.filter(value => value.kind === 'prediction-violation').length
      / notices.length);
  if (Number.isFinite(input.actionBudget) && input.actionBudget > 0)
    add('action-budget-remaining', (input.actionBudget - input.actions) / input.actionBudget);
  return channels;
}

/** Attach channels at the runtime commit boundary; validation enforces their provenance. */
export function attachInteroceptionToEventV1(event: RealEvent,
  channels: readonly VerifiedInternalChannelV1[]): RealEvent {
  if (channels.length === 0) return event;
  // Keep verified-internal values out of Observation.self.properties.  That
  // object is the public-world channel and is consumed by grounded goals;
  // mixing the two would let an internal metric satisfy a world predicate.
  return { ...event, version: 'RealEventV6', verifiedInternalChannels: structuredClone(channels) };
}

export function verifiedInternalChannelsFromEventV1(event: RealEvent):
readonly VerifiedInternalChannelV1[] {
  return structuredClone(event.verifiedInternalChannels ?? []);
}

/** Public observations never gain internal channels. This assertion is used by tests. */
export function assertPublicObservationHasNoInternalChannelsV1(observation: Observation): void {
  if (Object.keys(observation.self.properties).some(key => key.startsWith(VERIFIED_INTERNAL_PROPERTY_PREFIX_V1)))
    throw new Error('public-observation-cannot-contain-verified-internal-channel');
}
