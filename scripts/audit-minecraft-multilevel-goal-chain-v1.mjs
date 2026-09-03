import {
  MULTILEVEL_ABLATION_CONTRACT_V1,
  auditMinecraftMultilevelGoalChainProtocolV1,
  minecraftMultilevelGoalChainProtocolV1,
  multilevelGuidedTrainingPlanIdentityV1,
} from '../dist/src/evaluation/minecraft-multilevel-goal-chain-v1.js';

// Contract-only preflight.  It intentionally imports no Minecraft service or body adapter.
const protocol = minecraftMultilevelGoalChainProtocolV1();
const audit = auditMinecraftMultilevelGoalChainProtocolV1(protocol);
const summary = {
  version: 'MinecraftMultilevelGoalChainContractPreflightV1',
  trainingPlanSha256: multilevelGuidedTrainingPlanIdentityV1(),
  existingBaselineRecursiveGateCases: protocol.existingBaselineRecursiveGate.length,
  trainingEpisodes: protocol.training.length,
  foundationQualificationLayouts: protocol.foundationQualification.length,
  goalChainCases: protocol.goalChainCases.length,
  perturbations: protocol.perturbations.length,
  ablations: protocol.ablations.map(value => value.id),
  diagnosticLayouts: MULTILEVEL_ABLATION_CONTRACT_V1.diagnosticCaseIds,
  minecraftStarted: false,
  audit,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!audit.passed) process.exitCode = 1;
