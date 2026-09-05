import { parentPort } from 'node:worker_threads';
import { DistributedHierarchicalPhysicalMemoryV1 as PhysicalMemory,
  type DistributedMemorySnapshotV3 as MemorySnapshot,
  type KairosV5DistributedPhysicalMemoryV4 as MemorySnapshotV4 } from './distributed-hierarchical-memory.js';
import type { DistributedLayerMeasurementsV1 }
  from './core/physics/distributed-hierarchical-timescale-owner-v1.js';
import type { TrustedRuntimeMeasurementContextV1 }
  from './core/physics/runtime-measured-salience-bridge-v1.js';
import type { ActionCue, DesiredChange, Observation, RealEvent } from './contracts.js';
import type { EffectRecallCandidateV1, GroundedGoalV1, GoalEvaluationV1,
  HypotheticalPublicStateV1 } from './control/contracts.js';
import { sha } from './util.js';

let memory = new PhysicalMemory();
parentPort!.on('message', (message: { id: number; method: string; args: unknown[] }) => {
  try {
    const args = message.args; let value: unknown;
    switch (message.method) {
      case 'observe': value = memory.observe(args[0] as RealEvent); break;
      case 'advance': memory.advanceTo(args[0] as number); value = null; break;
      case 'recall': value = memory.recall(args[0] as DesiredChange, args[1] as Observation, args[2] as number); break;
      case 'predict': value = memory.predict(args[0] as ActionCue, args[1] as Observation, args[2] as Parameters<PhysicalMemory['predict']>[2]); break;
      case 'recallByEffect': value = memory.recallByEffect(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'recallAtomicEffect': value = memory.recallAtomicEffect(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'recallContinuousPattern': value = memory.recallContinuousPattern(args[0] as GroundedGoalV1,
        args[1] as GoalEvaluationV1, args[2] as Observation); break;
      case 'compareConditions': value = memory.compareConditions(args[0] as EffectRecallCandidateV1,
        args[1] as Observation | HypotheticalPublicStateV1); break;
      case 'predictCandidate': value = memory.predictCandidate(args[0] as EffectRecallCandidateV1,
        args[1] as Observation | HypotheticalPublicStateV1, args[2] as GroundedGoalV1,
        args[3] as GoalEvaluationV1); break;
      case 'recallFactorTransition': value = memory.recallFactorTransition(args[0] as readonly string[],
        args[1] as Observation | HypotheticalPublicStateV1); break;
      case 'compareCurrentFactors': value = memory.compareCurrentFactors(args[0] as string,
        args[1] as Observation); break;
      case 'compareProjectedParentRelations': value = memory.compareProjectedParentRelations(
        args[0] as readonly string[], args[1] as Observation,
        args[2] as readonly HypotheticalPublicStateV1[],
        args[3] as { readonly r1Active: boolean; readonly r2Active: boolean }); break;
      case 'predictContinuation': value = memory.predictContinuation(args[0] as string,
        args[1] as ActionCue, args[2] as Observation); break;
      case 'closeContinuity': value = memory.closeContinuity(args[0] as Parameters<PhysicalMemory['closeContinuity']>[0]); break;
      case 'recordDistributedMatchedIntervention': memory.recordDistributedMatchedIntervention(
        args[0] as Parameters<PhysicalMemory['recordDistributedMatchedIntervention']>[0]); value = null; break;
      case 'snapshot': value = memory.snapshot(); break;
      case 'enableTimescaleV2': memory.enableTimescaleV2(); value = null; break;
      case 'advanceMeasured': memory.advanceTo(args[0] as number,
        args[1] as DistributedLayerMeasurementsV1); value = null; break;
      case 'snapshotV4': value = memory.snapshotV4(); break;
      case 'restore': memory = PhysicalMemory.restore(args[0] as MemorySnapshot); value = { writes: memory.writes }; break;
      case 'restoreV4': memory = PhysicalMemory.restoreV4(args[0] as MemorySnapshotV4);
        value = { writes: memory.writes }; break;
      case 'recordRuntimeMeasurement': memory.recordRuntimeMeasurement(
        args[0] as TrustedRuntimeMeasurementContextV1); value = null; break;
      case 'status': value = { ready: memory.ready, writes: memory.writes, bufferedEvents: memory.bufferedEvents,
        mapSha256: memory.mapSha256 }; break;
      case 'hash': value = sha(memory.snapshot()); break;
      default: throw new Error(`unknown-worker-method:${message.method}`);
    }
    parentPort!.postMessage({ id: message.id, value });
  } catch (error) {
    const value = error as Error;
    parentPort!.postMessage({ id: message.id, error: { message: value.message, stack: value.stack } });
  }
});
