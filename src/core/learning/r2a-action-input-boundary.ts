import type { DistributedR2ContinuousEventV1 } from './distributed-r2-contracts.js';
import type { DistributedR2AEventPhysicalInputV2 } from './distributed-r2a-physical-contracts.js';

/** Recover commands from the frozen R1 contract (before, command, observed
 * changes), never from result identities or a desired terminal. */
export function r2aInputAtActionBoundaryV1<T extends Omit<DistributedR2AEventPhysicalInputV2, 'traceId'>>(
  input: T, event: Pick<DistributedR2ContinuousEventV1, 'atomPulseRanges'>,
): T & { readonly projectedCommandPulseIndices: readonly number[] }
  & Required<Pick<DistributedR2AEventPhysicalInputV2,
    'reachableContinuationPulseDrives' | 'reachableContinuationPulseSiteIds'>> {
  const weighted = (sites: readonly number[]) => sites.map(siteId => ({ siteId, intensity: 1 }));
  const projected = input.projectedPulseDrives ?? input.projectedPulseSiteIds.map(weighted);
  const actions = input.actionPulseDrives ?? input.actionPulseSiteIds.map(weighted);
  const route = [input.conditionDrives ?? weighted(input.conditionSiteIds)];
  const commandIndices: number[] = [];
  event.atomPulseRanges.forEach((range, ordinal) => {
    const commandIndex = range.startPulseIndex + 1;
    if (commandIndex >= range.endPulseIndexExclusive || projected[commandIndex] === undefined)
      throw new Error('R2A-source-atom-missing-actual-command-pulse');
    commandIndices.push(commandIndex);
    route.push(actions[ordinal]!);
    const end = ordinal === event.atomPulseRanges.length - 1
      ? commandIndex + 1 : range.endPulseIndexExclusive;
    route.push(...projected.slice(range.startPulseIndex, end));
  });
  return { ...input, projectedCommandPulseIndices: commandIndices,
    reachableContinuationPulseDrives: route,
    reachableContinuationPulseSiteIds: route.map(pulse => pulse.map(drive => drive.siteId)) };
}
