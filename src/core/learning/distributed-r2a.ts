/**
 * Production R2A surface.
 *
 * The implementation deliberately lives in `distributed-r2a-physical.ts` so
 * the retired V1 action-family/Jaccard/set classifier cannot remain reachable
 * beside the physical learner.  R2 `physicalPulseSiteIds` are projected by
 * `SparseInterlayerProjectionV1.projectPulse`; R2 `bondReferences` become
 * `sourceNeighborhoods` and only anchor allocation inside the R2A lattice.
 * Pattern qualification probes the field (`probe`/`probeSequential`) and uses
 * attractor dwellSteps, returnRate, escapeRate, forwardPropagationRate and
 * reverseRejectionRate.  Interventions resolve baselineR2EventId and
 * interventionR2EventId, then derive factorAblationSelectionRate and
 * factorAblationLoss from physical runs without the factor population.
 */
export { DistributedR2APhysicalPatternLearnerV2,
  DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V6,
  DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V7,
  DISTRIBUTED_R2A_INDEX_ALGORITHM_IDENTITY_V5,
  distributedObservedPopulationCoversLocalAssemblyV1,
  normalizeDistributedWeightedPulseV1 }
  from './distributed-r2a-physical.js';
export type {
  DistributedR2AConditionBindingV2,
  DistributedR2AEventPhysicalInputV2,
  DistributedR2AInterventionAssessmentV2,
  DistributedR2AInterventionPairV2,
  DistributedR2APhysicalApplicabilityV2,
  DistributedR2APhysicalFactorV2,
  DistributedR2APhysicalObservationReceiptV2,
  DistributedR2APhysicalPatternV2,
  DistributedR2APhysicalRelationV2,
  DistributedR2APhysicalStateV3,
  DistributedR2ATransientFactorProjectionV2,
  DistributedR2AConsolidationBatchStatusV1,
  DistributedR2AConsolidationBatchReceiptV1,
  DistributedR2AConsolidationPerformanceAuditV1,
} from './distributed-r2a-physical-contracts.js';
