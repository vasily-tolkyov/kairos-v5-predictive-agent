import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { Action, Observation, RealEvent } from "../src/contracts.js";
import type { GroundedGoalV1, GoalEvaluationV1 }
  from "../src/control/contracts.js";
import { DistributedHierarchicalPhysicalMemoryV1,
  type KairosV5DistributedPhysicalMemoryV3 }
  from "../src/distributed-hierarchical-memory.js";
import { realEventHierarchyContinuityV1 } from "../src/events.js";
import { sha } from "../src/util.js";

type Mode = "effect" | "motion" | "verify";

function event(index: number, mode: Mode,
  boundaryBefore: "continuous" | "reset" = "reset", contextIndex = index % 8,
  timeBase = index * 1.1): RealEvent {
  const frames: Observation[] = Array.from({ length: 2 }, (_unused, step) => ({
    sequence: index * 5 + step,
    activeSeconds: timeBase + step * 0.001,
    self: {
      position: [0, mode === "motion" ? Math.sin(Math.PI * step / 2) : 0, 0],
      yaw: 0,
      pitch: 0,
      properties: { grounded: mode !== "motion" || step === 0 || step === 20 },
    },
    objects: [{
      id: "opaque-object-1",
      type: "opaque-type",
      relativePosition: [1, 0, 0],
      properties: {
        state: mode === "effect" && step >= 1,
        observablePhase: mode === "effect" ? step
          : mode === "motion" ? -step : 0,
      },
    }],
    targetId: "opaque-object-1",
    contextId: `opaque-context-${contextIndex}`,
  }));
  const action: Action = mode === "effect"
    ? { kind: "interact", parameters: {}, targetId: "opaque-object-1" }
    : mode === "motion"
      ? { kind: "jump", parameters: { forward: false, ticks: 4 } }
      : { kind: "observe", parameters: { ticks: 5 } };
  const bare: RealEvent = {
    version: "RealEventV5",
    id: `distributed-integration-event-${index}`,
    cue: { kind: action.kind, parameters: action.parameters,
      targetRole: mode === "effect" ? "opaque-type" : null },
    frames,
    trackedIds: ["self", "opaque-object-1"],
    bodyResult: {
      action,
      executed: true,
      status: "completed",
      startSequence: frames[0]!.sequence,
      endSequence: frames.at(-1)!.sequence,
      terminationReason: "stable",
    },
    provenance: "executed-real-body",
    complete: true,
  };
  return { ...bare, hierarchyContinuity: realEventHierarchyContinuityV1(
    bare, "distributed-production-integration-session", boundaryBefore) };
}

function goalAndEvaluation(observation: Observation): {
  readonly goal: GroundedGoalV1;
  readonly evaluation: GoalEvaluationV1;
} {
  const goal: GroundedGoalV1 = {
    version: "GroundedGoalV1",
    id: "opaque-state-goal",
    expression: {
      kind: "predicate",
      predicate: {
        version: "GoalPredicateV1",
        id: "opaque-state",
        subject: { kind: "public-object", id: "opaque-object-1", expectedType: "opaque-type" },
        observable: "properties.state",
        comparator: "equals",
        target: true,
      },
    },
  };
  return {
    goal,
    evaluation: {
      goalId: goal.id,
      status: "mismatch",
      residual: 1,
      observationSequence: observation.sequence,
      predicates: [{ predicateId: "opaque-state", status: "mismatch", residual: 1,
        actual: false, baseline: false, reason: null }],
    },
  };
}

function erasePhysicalMedium(snapshot: KairosV5DistributedPhysicalMemoryV3,
  layer: "R1" | "R2" | "R2A"): KairosV5DistributedPhysicalMemoryV3 {
  const result = structuredClone(snapshot);
  const medium = layer === "R1" ? result.r1Medium
    : layer === "R2" ? result.r2Medium : result.r2a.medium;
  Object.assign(medium, {
    sites: medium.sites.map(site => ({ ...site, potentialDepth: 0,
      activation: 0, supportMass: 0 })),
    learnedBonds: [],
  });
  if (layer === "R1") Object.assign(result.r1, { mediumSnapshotSha256: sha(result.r1Medium) });
  if (layer === "R2") Object.assign(result.r2, { mediumSnapshotSha256: sha(result.r2Medium) });
  return result;
}

function retainOnePatternMember(snapshot: KairosV5DistributedPhysicalMemoryV3):
KairosV5DistributedPhysicalMemoryV3 {
  const result = structuredClone(snapshot);
  const pattern = result.r2a.patterns.find(value => value.grade === "predictive-stable");
  assert(pattern, "stable pattern missing from partial-erasure fixture");
  const erasedR2EventIds = new Set(pattern.memberR2EventIds.slice(1));
  const erasedR1EventIds = new Set(result.r2.events
    .filter(value => erasedR2EventIds.has(value.eventId)).flatMap(value => value.sourceEventIds));
  Object.assign(result.r1Medium, { footprints: result.r1Medium.footprints.map(footprint =>
    erasedR1EventIds.has(footprint.traceId) ? { ...footprint, supportMass: 0 } : footprint) });
  Object.assign(result.r1, { mediumSnapshotSha256: sha(result.r1Medium) });
  return result;
}

async function workerCall(worker: Worker, id: number, method: string,
  ...args: readonly unknown[]): Promise<unknown> {
  const response = new Promise<unknown>((resolve, reject) => {
    const onMessage = (message: { readonly id: number; readonly value?: unknown;
      readonly error?: { readonly message: string } }): void => {
      if (message.id !== id) return;
      worker.off("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.value);
    };
    worker.on("message", onMessage);
  });
  worker.postMessage({ id, method, args });
  return response;
}

test("production worker owns a real empty DistributedHierarchicalPhysicalMemoryV1", async () => {
  const worker = new Worker(new URL("../src/worker.js", import.meta.url));
  try {
    const status = await workerCall(worker, 1, "status") as {
      readonly ready: boolean; readonly writes: number; readonly bufferedEvents: number };
    const snapshot = await workerCall(worker, 2, "snapshot") as KairosV5DistributedPhysicalMemoryV3;
    assert.deepEqual(status, { ready: false, writes: 0, bufferedEvents: 0, mapSha256: null });
    assert.equal(snapshot.version, "KairosV5DistributedPhysicalMemoryV3");
    assert.equal(snapshot.r1Medium.sites.length, 32 ** 3);
    assert.equal(snapshot.r2Medium.sites.length, 32 ** 3);
    assert.equal(snapshot.r2a.medium.sites.length, 32 ** 3);
  } finally {
    await worker.terminate();
  }
});

test("production hierarchy deposits R1 immediately and reaches the 128-event ready boundary", () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  const first = memory.observe(event(0, "effect", "reset", 0, 0));
  assert.equal(first.status, "initialization-buffer");
  assert.equal(first.writes, 1);
  assert.equal(first.r1Atoms, 1);
  assert(memory.snapshot().r1Medium.sites.some(site => site.potentialDepth > 0));
  for (let index = 1; index < 128; index += 1) {
    const mode: Mode = index % 3 === 0 ? "effect" : index % 3 === 1 ? "motion" : "verify";
    // Reset-separated initialization atoms may share an active-time interval;
    // they remain distinct real events through their observations and ids.
    memory.observe(event(index, mode, "reset", index % 8, 0));
  }
  assert.equal(memory.ready, true);
  assert.equal(memory.writes, 128);
  assert.equal(memory.bufferedEvents, 128);
  assert(memory.mapSha256);
  const snapshot = memory.snapshot();
  const restored = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(snapshot));
  assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
});

test("production hierarchy queries are read-only and each physical layer fails closed independently", () => {
  const memory = new DistributedHierarchicalPhysicalMemoryV1();
  for (let chain = 0; chain < 8; chain += 1) {
    const start = chain * 3, base = chain * 0.02;
    memory.observe(event(start, "effect", "reset", chain, base));
    memory.observe(event(start + 1, "motion", "continuous", chain, base + 0.005));
    memory.observe(event(start + 2, "verify", "continuous", chain, base + 0.010));
  }
  const snapshot = memory.snapshot();
  const restored = DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(snapshot));
  assert.equal(JSON.stringify(restored.snapshot()), JSON.stringify(snapshot));
  const observation = event(200, "verify").frames[0]!;
  const { goal, evaluation } = goalAndEvaluation(observation);
  const before = sha(restored.snapshot());
  const continuous = restored.recallContinuousPattern(goal, evaluation, observation);
  // The stochastic clone's full read-only path is covered by the G5 tests.
  // Here an unsupported exact cue exercises the production prediction entry
  // without turning this integration test into another 24-rollout benchmark.
  restored.predict({ kind: "attack", parameters: {}, targetRole: null }, observation);
  assert.equal(continuous.length, 1);
  assert.equal(continuous[0]!.evidenceGrade, "predictive-stable");
  assert(continuous[0]!.activePhysicalTraceIds.length >= 8);
  // A single repeated outcome has no differential R2A relation.  It is a live
  // stable pattern, but current conditional eligibility must remain false.
  assert.equal(continuous[0]!.currentPredictionEligible, false);
  assert.deepEqual(continuous[0]!.currentRelationIds, []);
  assert.equal(sha(restored.snapshot()), before);

  const partiallyErased = DistributedHierarchicalPhysicalMemoryV1.restore(retainOnePatternMember(snapshot));
  const downgraded = partiallyErased.recallContinuousPattern(goal, evaluation, observation);
  assert.equal(downgraded[0]?.evidenceGrade, "single-observation",
    "historical stable metadata kept a one-member physical pattern qualified");

  for (const layer of ["R1", "R2", "R2A"] as const) {
    const erased = DistributedHierarchicalPhysicalMemoryV1.restore(erasePhysicalMedium(snapshot, layer));
    const upper = erased.recallContinuousPattern(goal, evaluation, observation);
    assert(upper.length === 0 || upper.every(value => !value.currentPredictionEligible
      && value.activePhysicalTraceIds.length === 0
      && value.evidenceGrade === "single-observation"),
    `inactive ${layer} support survived through hierarchy indexes`);
    if (layer === "R1") assert.deepEqual(erased.recallAtomicEffect(goal, evaluation, observation), []);
    if (layer === "R2") assert(erased.recallAtomicEffect(goal, evaluation, observation)
      .every(value => !value.evidence.r2.active));
    if (layer === "R2A") assert(erased.recallAtomicEffect(goal, evaluation, observation)
      .every(value => !value.evidence.r2a.predictionEligible && !value.evidence.r2a.productionEligible));
  }
});
