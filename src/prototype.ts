/**
 * Public, environment-neutral surface of the Kairos prototype.
 *
 * This module deliberately has no import path into the Minecraft adapter,
 * process services, or viewers.  A different body can implement the control
 * environment and use the same physical memory, reasoning and control field.
 */
export { DistributedHierarchicalPhysicalMemoryV1,
  DISTRIBUTED_HIERARCHICAL_MEMORY_VERSION_V3,
  DISTRIBUTED_HIERARCHY_SEMANTICS_V2 } from './distributed-hierarchical-memory.js';
export type { KairosV5DistributedPhysicalMemoryV3,
  KairosV5DistributedPhysicalMemoryV4,
  DistributedMemoryObservationReceiptV1,
  DistributedPredictionSeedBatchRequestV1 } from './distributed-hierarchical-memory.js';

export { KairosV5RSeriesRuntimeV1,
  KAIROS_V5_R_SERIES_NAMESPACE_V1,
  KAIROS_V5_R_SERIES_RUNTIME_VERSION_V1 } from './r-series-runtime.js';
export type { KairosV5RSeriesCheckpointV1 } from './r-series-runtime.js';

export { JointTransientControlFieldV2, JOINT_CONTROL_OPERATIONS_V2 }
  from './control/field.js';
export { PhysicalControlManagerV2, fairEvidenceWindowV2 }
  from './control/controller.js';
export type { PhysicalControlEnvironmentV2, PhysicalControlResultV2,
  PhysicalControlSnapshotV2 } from './control/controller.js';
export { GroundedGoalEvaluatorV1, groundedPublicObservableV1,
  evaluateGroundedPredicateValueV1, goalPredicates, desiredChangesForGoal }
  from './control/goal.js';
export { ControlHabitWeightsV1, CONTROL_HABIT_OPERATIONS_V1,
  CONTROL_HABIT_GRAPH_RELATIONS_V1 } from './control/habit.js';
export { ControlWorkspaceV2, effectCandidatePhysicalGroupKeyV1,
  factorTransitionPhysicalGroupKeyV2, groupEffectCandidatesForControlV1,
  groupFactorTransitionsForControlV2, compactBranchPredictionForControlAuditV2 }
  from './control/workspace.js';
export * from './control/contracts.js';

export { DistributedPhysicalMedium3DV1 } from './core/physics/distributed-physical-medium.js';
export type { DistributedMediumConfigV1, DistributedMediumConfigInputV1,
  DistributedSiteStateV1, DistributedBondStateV1, SparseFieldPulseV1,
  DistributedEpisodeV1, DistributedTraceFootprintV1,
  DistributedAttractorReadoutV1, DistributedMediumSnapshotV1,
  DistributedEvidenceLevelV1 } from './core/physics/distributed-physical-contracts.js';
export { DistributedPredictionCloneV2, runDistributedPredictionCloneV2,
  physicalResidenceMatchV1, physicalActivationResidenceMatchV1 }
  from './core/prediction/distributed-prediction-clone.js';
export type { DistributedPredictionCloneRequestV2, DistributedPredictionCloneResultV2,
  DistributedPredictionCloneReasonV2, DistributedReadoutAssemblyV1,
  DistributedPredictionAssemblyReachV1 } from './core/prediction/distributed-prediction-clone.js';

export { AttractorPublicEventDictionaryStoreV1, publicReadoutSignatureV1 }
  from './core/learning/attractor-public-dictionary.js';
export type { AttractorPublicEventDictionaryV1, AttractorDictionaryEntryV1,
  AttractorDictionaryResolutionV1, PublicReadoutSignatureV1,
  TrustedAttractorPublicObservationV1 } from './core/learning/attractor-public-dictionary.js';
export { InterventionAgendaStoreV1, interventionPairIdentityV1 }
  from './core/learning/intervention-agenda.js';
export type { InterventionAgendaStateV1, PredictionViolationV1,
  ViolationLedgerRecordV1, FactorialCellV1, InterventionArmRequestV1,
  MatchedArmResultV1 } from './core/learning/intervention-agenda.js';
export { InterventionPairCollectorV1 } from './core/learning/intervention-pair-collector.js';
export type { InterventionPairCandidateV1, TrustedInterventionWindowV1,
  InterventionPairCollectorStateV1 } from './core/learning/intervention-pair-collector.js';
