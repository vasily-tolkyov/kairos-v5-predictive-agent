import test from "node:test";
import assert from "node:assert/strict";
import type { Vec3 } from "../src/core/contracts.js";
import {
  R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
  R2ContinuousEventStore,
  type PublicContinuityDependencyV1,
  type R1ClosedEventAtomV1,
} from "../src/core/learning/r2-continuous-event.js";
import { vec3 } from "../src/core/vector.js";
import { canonical } from "../src/util.js";

function dependency(
  atomId: string,
  sourceEventId: string,
  startFrameSequence: number,
  endFrameSequence: number,
  dependencyId = "public-process/door-cycle",
): PublicContinuityDependencyV1 {
  return {
    version: "PublicContinuityDependencyV1",
    dependencyId,
    basis: "public-state-carried-forward",
    evidence: {
      version: "PublicContinuityEvidenceReferenceV1",
      sourceEventId,
      subject: "opaque-public-subject",
      property: "observable-cycle-state",
      beforeObservationSequence: startFrameSequence,
      afterObservationSequence: endFrameSequence,
      beforeValueSha256: "0".repeat(64),
      afterValueSha256: "0".repeat(64),
      factCategory: "public-state-persistence",
    },
  };
}

function atom(
  atomId: string,
  index: number,
  coordinate: Vec3,
  overrides: Partial<R1ClosedEventAtomV1> = {},
): R1ClosedEventAtomV1 {
  const sourceEventId = `source-${atomId}`;
  const startFrameSequence = 1 + index * 4;
  const endFrameSequence = startFrameSequence + 4;
  return {
    version: "R1ClosedEventAtomV2",
    atomId,
    sourceEventId,
    exactExperienceIdentity: `opaque-experience-${atomId}`,
    publicTransitionTopologyId: String((index + 1) % 10).repeat(64),
    kind: "action",
    completion: "complete",
    trustedActualObservation: true,
    publicOnly: true,
    sessionId: "real-session-1",
    continuityEpochId: "continuity-epoch-1",
    startedAt: index,
    endedAt: index + 1,
    startFrameSequence,
    endFrameSequence,
    publicContinuityDependencies: [dependency(
      atomId,
      sourceEventId,
      startFrameSequence,
      endFrameSequence,
    )],
    coordinateSystem: R2_CONTINUOUS_EVENT_COORDINATE_SYSTEM_V1,
    r2Coordinate: coordinate,
    ...overrides,
  };
}

const completeBoundary = {
  version: "R2EventBoundaryV1",
  completion: "complete",
  reason: "public-process-resolved",
} as const;

test("R2 stages two closed R1 events without a physical write, then commits one ordered trace", () => {
  const store = new R2ContinuousEventStore();
  store.begin(atom("a", 0, vec3(0, 0, 0)));
  store.append(atom("b", 1, vec3(1, 2, 0)));
  assert.equal(store.pendingAtomCount, 2);
  assert.equal(store.committedEventCount, 0);
  assert.equal(store.mediumSnapshot().pages.length, 0, "an open R2 chain touched the physical medium");

  const receipt = store.close(completeBoundary);
  assert.equal(receipt.status, "committed");
  if (receipt.status !== "committed") return;
  assert.equal(receipt.event.physicalStatus, "deposited");
  assert.equal(receipt.event.learningEligible, true);
  assert.deepEqual(receipt.event.atomIds, ["a", "b"]);
  assert.deepEqual(receipt.event.orderedExperienceIdentities,
    ["opaque-experience-a", "opaque-experience-b"]);
  assert.deepEqual(receipt.event.orderedTransitionTopologyIds,
    ["1".repeat(64), "2".repeat(64)]);
  assert.deepEqual(receipt.event.orderedCoordinates, [[0, 0, 0], [1, 2, 0]]);
  assert.deepEqual(receipt.event.publicDependencyLinks[0]?.sharedDependencyIds,
    ["public-process/door-cycle"]);
  assert.equal(receipt.event.publicDependencyLinks[0]?.evidencePairs[0]?.predecessor.sourceEventId,
    "source-a");
  const physical = store.mediumSnapshot();
  assert.equal(physical.pages.length, 1);
  assert.equal(physical.pages[0]?.kernels.filter((kernel) => kernel.traceId === receipt.event.traceId).length, 2);
  assert.equal(new Set(physical.pages[0]?.kernels.map((kernel) => kernel.traceId)).size, 1);
});

test("one R1 atom never produces an R2 event or physical page", () => {
  const store = new R2ContinuousEventStore();
  store.begin(atom("singleton", 0, vec3(0, 0, 0)));
  const receipt = store.close(completeBoundary);
  assert.equal(receipt.status, "singleton-rejected");
  assert.equal(store.pendingAtomCount, 0);
  assert.equal(store.committedEventCount, 0);
  assert.equal(store.mediumSnapshot().pages.length, 0);
  assert.throws(() => store.begin(atom("singleton", 0, vec3(0, 0, 0))), /already-consumed/);
});

test("ordered atom identity ignores equivalent coordinate resampling but distinguishes order and substitution", () => {
  const close = (atoms: readonly R1ClosedEventAtomV1[]) => {
    const store = new R2ContinuousEventStore();
    store.begin(atoms[0]!);
    for (const item of atoms.slice(1)) store.append(item);
    const receipt = store.close(completeBoundary);
    assert.equal(receipt.status, "committed");
    return receipt.status === "committed" ? receipt.event : assert.fail("R2 event was not committed");
  };

  const original = close([atom("a", 0, vec3(0, 0, 0)), atom("b", 1, vec3(1, 0, 0))]);
  const resampled = close([atom("a", 0, vec3(-8, 4, 1)), atom("b", 1, vec3(7, -2, 3))]);
  assert.equal(original.eventId, resampled.eventId);
  assert.notDeepEqual(original.orderedCoordinates, resampled.orderedCoordinates);

  const reversed = close([atom("b", 0, vec3(1, 0, 0)), atom("a", 1, vec3(0, 0, 0))]);
  assert.notEqual(original.eventId, reversed.eventId);
  const substituted = close([atom("a", 0, vec3(0, 0, 0)), atom("c", 1, vec3(1, 0, 0))]);
  assert.notEqual(original.eventId, substituted.eventId);
  const differentObservedTransition = close([atom("a", 0, vec3(0, 0, 0)),
    atom("b", 1, vec3(1, 0, 0), { publicTransitionTopologyId: "f".repeat(64) })]);
  assert.notEqual(original.eventId, differentObservedTransition.eventId,
    "the lossy 3-D coordinate hid a different real public transition");

  const invalidReverse = new R2ContinuousEventStore();
  invalidReverse.begin(atom("b", 1, vec3(1, 0, 0)));
  assert.throws(() => invalidReverse.append(atom("a", 0, vec3(0, 0, 0))),
    /time-order-reversed|frame-order-overlapped-or-reversed/);
  assert.equal(invalidReverse.pendingAtomCount, 1);
  assert.equal(invalidReverse.mediumSnapshot().pages.length, 0);
});

test("session, epoch, observation gap, and missing public dependency all break continuity fail-closed", () => {
  const disconnected: Array<{ atom: R1ClosedEventAtomV1; error: RegExp }> = [
    { atom: atom("session", 1, vec3(1, 0, 0), { sessionId: "new-session" }), error: /session-changed/ },
    { atom: atom("reset", 1, vec3(1, 0, 0), { continuityEpochId: "epoch-after-reset" }), error: /epoch-reset/ },
    { atom: atom("gap", 1, vec3(1, 0, 0), { startFrameSequence: 10, endFrameSequence: 12,
      publicContinuityDependencies: [dependency("gap", "source-gap", 10, 12)] }), error: /gap-breaks-continuity/ },
    { atom: atom("dependency", 1, vec3(1, 0, 0), { publicContinuityDependencies: [
      dependency("dependency", "source-dependency", 5, 9, "different-real-process"),
    ] }), error: /dependency-disconnected/ },
  ];
  for (const item of disconnected) {
    const store = new R2ContinuousEventStore();
    store.begin(atom("a", 0, vec3(0, 0, 0)));
    assert.throws(() => store.append(item.atom), item.error);
    assert.equal(store.pendingAtomCount, 1);
    assert.equal(store.mediumSnapshot().pages.length, 0);
  }
});

test("censored chains are retained for audit but never deposited or learning eligible", () => {
  const store = new R2ContinuousEventStore();
  store.begin(atom("a", 0, vec3(0, 0, 0)));
  store.append(atom("b", 1, vec3(2, 0, 0)));
  const receipt = store.interrupt("continuity-reset");
  assert.equal(receipt.status, "committed");
  if (receipt.status !== "committed") return;
  assert.equal(receipt.event.completion, "censored");
  assert.equal(receipt.event.physicalStatus, "audit-only-censored");
  assert.equal(receipt.event.learningEligible, false);
  assert.equal(receipt.event.pageId, null);
  assert.equal(receipt.event.traceId, null);
  assert.equal(store.mediumSnapshot().pages.length, 0);
  assert.equal(store.events().length, 1);
  assert.deepEqual(store.events({ learningEligibleOnly: true }), []);
});

test("a real zero-arc chain remains an R2 record and reports representation failure without deposition", () => {
  const store = new R2ContinuousEventStore();
  store.begin(atom("a", 0, vec3(3, 3, 3)));
  store.append(atom("b", 1, vec3(3, 3, 3)));
  const receipt = store.close(completeBoundary);
  assert.equal(receipt.status, "committed");
  if (receipt.status !== "committed") return;
  assert.equal(receipt.event.completion, "complete");
  assert.equal(receipt.event.physicalStatus, "unrepresented-zero-arc");
  assert.equal(receipt.event.learningEligible, false);
  assert.deepEqual(receipt.event.atomIds, ["a", "b"]);
  assert.equal(store.mediumSnapshot().pages.length, 0);
});

test("continuity dependencies require replayable public subject/property evidence owned by the R1 window", () => {
  const valid = atom("a", 0, vec3(0, 0, 0));
  const missingSubject = structuredClone(valid) as any;
  missingSubject.publicContinuityDependencies[0].evidence.subject = "";
  const wrongSource = structuredClone(valid) as any;
  wrongSource.publicContinuityDependencies[0].evidence.sourceEventId = "another-event";
  const outsideWindow = structuredClone(valid) as any;
  outsideWindow.publicContinuityDependencies[0].evidence.afterObservationSequence = 100;
  for (const invalid of [missingSubject, wrongSource, outsideWindow]) {
    const store = new R2ContinuousEventStore();
    assert.throws(() => store.begin(invalid), /continuity evidence|continuity-evidence/);
    assert.equal(store.pendingAtomCount, 0);
    assert.equal(store.mediumSnapshot().pages.length, 0);
  }
});

test("snapshot and restore preserve both pending transactionality and committed physical identity", () => {
  const pending = new R2ContinuousEventStore();
  pending.begin(atom("a", 0, vec3(0, 0, 0)));
  pending.append(atom("b", 1, vec3(1, 0, 0)));
  const pendingState = pending.snapshot();
  assert.equal(pendingState.medium.pages.length, 0);
  const legacyState = structuredClone(pendingState) as { version: string };
  legacyState.version = "R2ContinuousEventStoreStateV2";
  assert.throws(() => R2ContinuousEventStore.restore(legacyState as never),
    /incompatible-R2-continuous-event-checkpoint/);
  const restoredPending = R2ContinuousEventStore.restore(pendingState);
  assert.equal(canonical(restoredPending.snapshot()), canonical(pendingState));

  const directReceipt = pending.close(completeBoundary);
  const restoredReceipt = restoredPending.close(completeBoundary);
  assert.equal(directReceipt.status, "committed");
  assert.equal(restoredReceipt.status, "committed");
  if (directReceipt.status !== "committed" || restoredReceipt.status !== "committed") return;
  assert.equal(directReceipt.event.eventId, restoredReceipt.event.eventId);
  assert.equal(canonical(restoredPending.snapshot()), canonical(pending.snapshot()));

  const roundTrip = R2ContinuousEventStore.restore(restoredPending.snapshot());
  assert.equal(canonical(roundTrip.snapshot()), canonical(restoredPending.snapshot()));
  const tamperedTopology = structuredClone(restoredPending.snapshot());
  (tamperedTopology.events[0]!.orderedTransitionTopologyIds as string[])[1] = "e".repeat(64);
  assert.throws(() => R2ContinuousEventStore.restore(tamperedTopology),
    /stored-R2-ordered-identity-mismatch/);
  const defensive = roundTrip.events()[0]!;
  (defensive.orderedCoordinates[0] as number[])[0] = 99;
  assert.equal(roundTrip.events()[0]!.orderedCoordinates[0]![0], 0);
});

test("a runtime-shaped censored R1 observation cannot masquerade as a closed R1 atom", () => {
  const invalid = { ...atom("censored", 0, vec3(0, 0, 0)), completion: "censored" } as any;
  const store = new R2ContinuousEventStore();
  assert.throws(() => store.begin(invalid), /requires-one-complete/);
  assert.equal(store.pendingAtomCount, 0);
  assert.equal(store.mediumSnapshot().pages.length, 0);
});
