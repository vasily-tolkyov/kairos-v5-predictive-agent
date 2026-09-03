import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import type { Action, ActionCue, Observation, PublicValue, RealEvent }
  from '../src/contracts.js';
import { DistributedHierarchicalPhysicalMemoryV1 }
  from '../src/distributed-hierarchical-memory.js';
import type { ActionObservationScopeV1, ActionOfferV1, GroundedGoalV1,
  JointTransientControlFieldConfigV2 } from '../src/control/contracts.js';
import { factorTransitionCandidateForControlV2, PhysicalControlManagerV2,
  type PhysicalControlEnvironmentV2 } from '../src/control/controller.js';
import { GroundedGoalEvaluatorV1 } from '../src/control/goal.js';
import { cueFor, cueIdentity, realEventHierarchyContinuityV1 } from '../src/events.js';
import { scanAnonymousPhysicalStructureV1 }
  from '../src/core/physics/distributed-physical-structure-scanner.js';
import { sha } from '../src/util.js';

type Branch = 'alpha-success' | 'alpha-contrast' | 'beta-success' | 'beta-contrast';

const ALPHA: Action = { kind: 'select-hotbar', parameters: { slot: 0 } };
const BETA: Action = { kind: 'select-hotbar', parameters: { slot: 1 } };
const PREFIX: Action = { kind: 'select-hotbar', parameters: { slot: 8 } };
const OBSERVE: Action = { kind: 'observe', parameters: { ticks: 5 } };

const GOAL: GroundedGoalV1 = {
  version: 'GroundedGoalV1', id: 'anonymous-R-true',
  expression: { kind: 'predicate', predicate: {
    version: 'GoalPredicateV1', id: 'R',
    subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: 'properties.R', comparator: 'equals', target: true,
  } },
};

const CONFIG: JointTransientControlFieldConfigV2 = {
  version: 'JointTransientControlFieldConfigV2', seed: 1, branchCapacity: 8,
  stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5,
};

// This integration test intentionally exercises the full distributed substrate
// and can spend minutes inside one synchronous physical operation.  Node's test
// reporter cannot emit a useful timeout while that operation owns the event
// loop, so an opt-in, write-only progress stream brackets the operations that
// already existed in the test.  It must never take a snapshot or run a query of
// its own: enabling diagnostics must not change the physical experiment.
const DIAGNOSTIC_PROGRESS = process.env.KAIROS_G5_DIAGNOSTIC_PROGRESS === '1';
const DIAGNOSTIC_SNAPSHOT_PATH = process.env.KAIROS_G5_DIAGNOSTIC_SNAPSHOT_PATH;
const PRECONSOLIDATION_DIAGNOSTIC =
  process.env.KAIROS_RUN_R2A_PRECONSOLIDATION_DIAGNOSTIC === '1';
const PRECONSOLIDATION_SNAPSHOT_PATH =
  process.env.KAIROS_G5_PRECONSOLIDATION_SNAPSHOT_PATH;
const DIAGNOSTIC_STARTED_AT = process.hrtime.bigint();
let diagnosticSequence = 0;

function diagnosticProgress(stage: string, event: 'start' | 'progress' | 'end' | 'error',
  detail: Readonly<Record<string, unknown>> = {}): void {
  if (!DIAGNOSTIC_PROGRESS) return;
  const elapsedMs = Number(process.hrtime.bigint() - DIAGNOSTIC_STARTED_AT) / 1_000_000;
  process.stderr.write(`${JSON.stringify({
    kind: 'g5-physical-two-step-progress',
    sequence: ++diagnosticSequence,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    stage,
    event,
    ...detail,
  })}\n`);
}

function diagnosticStage<T>(stage: string, detail: Readonly<Record<string, unknown>>,
  work: () => T): T {
  const startedAt = process.hrtime.bigint();
  diagnosticProgress(stage, 'start', detail);
  try {
    const value = work();
    diagnosticProgress(stage, 'end', {
      ...detail,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
    });
    return value;
  } catch (error) {
    diagnosticProgress(stage, 'error', {
      ...detail,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function diagnosticAsyncStage<T>(stage: string, detail: Readonly<Record<string, unknown>>,
  work: () => Promise<T>): Promise<T> {
  const startedAt = process.hrtime.bigint();
  diagnosticProgress(stage, 'start', detail);
  try {
    const value = await work();
    diagnosticProgress(stage, 'end', {
      ...detail,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
    });
    return value;
  } catch (error) {
    diagnosticProgress(stage, 'error', {
      ...detail,
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3)),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

interface State {
  readonly P?: boolean;
  readonly F: boolean;
  readonly R: boolean;
  readonly selectedSlot: number;
}

class EventClock {
  sequence = 1;
  seconds = 0;
  eventNumber = 0;

  frame(state: State, contextId: string): Observation {
    return {
      sequence: this.sequence++, activeSeconds: this.seconds += .001,
      contextId, targetId: null,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0,
        properties: { selectedSlot: state.selectedSlot,
          ...(state.P === undefined ? {} : { P: state.P }) } },
      objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1],
        properties: { F: state.F, R: state.R } }],
    };
  }
}

function realActionEvent(clock: EventClock, id: string, action: Action,
  beforeState: State, afterState: State, contextId: string,
  continuity?: { readonly sessionId: string; readonly boundary: 'reset' | 'continuous';
    readonly status: 'open' | 'publicly-resolved' }): RealEvent {
  const before = clock.frame(beforeState, contextId), after = clock.frame(afterState, contextId);
  const bare: RealEvent = {
    version: 'RealEventV5', id, cue: cueFor(action, before), frames: [before, after],
    trackedIds: ['self', 'o'],
    bodyResult: { action, executed: true, status: 'completed',
      startSequence: before.sequence, endSequence: after.sequence,
      terminationReason: 'stable' },
    provenance: 'executed-real-body', complete: true,
  };
  if (!continuity) return bare;
  return { ...bare, hierarchyContinuity: {
    ...realEventHierarchyContinuityV1(bare, continuity.sessionId, continuity.boundary),
    processStatusAfter: continuity.status,
  } };
}

function branchStates(branch: Branch): { readonly before: State; readonly after: State;
  readonly action: Action } {
  if (branch === 'alpha-success') return {
    action: ALPHA,
    before: { P: true, F: false, R: false, selectedSlot: 8 },
    after: { P: true, F: true, R: false, selectedSlot: 0 },
  };
  if (branch === 'alpha-contrast') return {
    action: ALPHA,
    before: { P: false, F: false, R: false, selectedSlot: 8 },
    after: { P: false, F: false, R: false, selectedSlot: 0 },
  };
  if (branch === 'beta-success') return {
    action: BETA,
    before: { F: true, R: false, selectedSlot: 8 },
    after: { F: true, R: true, selectedSlot: 1 },
  };
  return {
    action: BETA,
    before: { F: false, R: false, selectedSlot: 8 },
    after: { F: false, R: false, selectedSlot: 1 },
  };
}

function depositTraining(memory: DistributedHierarchicalPhysicalMemoryV1,
  stopAfterCompleteR2Events?: number): {
  readonly clock: EventClock;
  readonly actionEventIds: Readonly<Record<Branch, readonly string[]>>;
} {
  const clock = new EventClock();
  const actionEventIds: Record<Branch, string[]> = {
    'alpha-success': [], 'alpha-contrast': [], 'beta-success': [], 'beta-contrast': [],
  };
  const branches: readonly Branch[] = [
    'alpha-success', 'alpha-contrast', 'beta-success', 'beta-contrast',
  ];
  let completeR2Events = 0;
  for (let repetition = 0; repetition < 8; repetition += 1) {
    for (const branch of branches) {
      const states = branchStates(branch);
      const sessionId = `anonymous-${branch}-${repetition}`;
      const contextId = `anonymous-context-${repetition % 4}`;
      const prefixState = { ...states.before, selectedSlot: 8 };
      diagnosticStage('training-r1-prefix-and-r2-open', { repetition, branch }, () =>
        memory.observe(realActionEvent(clock, `${sessionId}:prefix`, PREFIX,
          prefixState, prefixState, contextId,
          { sessionId, boundary: 'reset', status: 'open' })));
      const actionEventId = `${sessionId}:action`;
      diagnosticStage('training-r1-action-and-r2-close', { repetition, branch }, () =>
        memory.observe(realActionEvent(clock, actionEventId, states.action,
          states.before, states.after, contextId,
          { sessionId, boundary: 'continuous', status: 'publicly-resolved' })));
      actionEventIds[branch].push(actionEventId);
      completeR2Events += 1;
      if (stopAfterCompleteR2Events !== undefined
        && completeR2Events === stopAfterCompleteR2Events) {
        return { clock, actionEventIds };
      }
    }
    diagnosticProgress('training-r1-r2', 'progress', {
      completedRepetitions: repetition + 1,
      writes: memory.writes,
      bufferedEvents: memory.bufferedEvents,
    });
  }

  // Readiness is a property of 128 trusted real events.  These reset-separated
  // filler atoms cannot create an R2 road or an R2A relation.
  diagnosticStage('training-reset-separated-r1-fillers', { eventCount: 64 }, () => {
    for (let repetition = 0; repetition < 64; repetition += 1) {
      const before: State = { F: false, R: false, selectedSlot: 6 };
      const after: State = { F: false, R: false, selectedSlot: 7 };
      memory.observe(realActionEvent(clock, `anonymous-filler-${repetition}`,
        { kind: 'select-hotbar', parameters: { slot: 7 } }, before, after,
        `filler-context-${repetition % 4}`));
      if ((repetition + 1) % 8 === 0) diagnosticProgress(
        'training-reset-separated-r1-fillers', 'progress', {
          completedEvents: repetition + 1,
          writes: memory.writes,
          bufferedEvents: memory.bufferedEvents,
        });
    }
  });

  const snapshot = diagnosticStage('training-pre-intervention-snapshot', {}, () => memory.snapshot());
  const scan = scanAnonymousPhysicalStructureV1(snapshot.r2a.medium);
  const supportHistogram = (values: readonly number[]): Readonly<Record<string, number>> => {
    const result: Record<string, number> = {};
    for (const value of values.filter(entry => entry > 0)) {
      const key = value.toFixed(6);
      result[key] = (result[key] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(result)
      .sort(([left], [right]) => Number(left) - Number(right)));
  };
  if (DIAGNOSTIC_SNAPSHOT_PATH) writeFileSync(DIAGNOSTIC_SNAPSHOT_PATH,
    gzipSync(Buffer.from(JSON.stringify(snapshot))));
  diagnosticProgress('training-pre-intervention-physical-index', 'end', {
    patternCount: snapshot.r2a.patterns.length,
    relationCount: snapshot.r2a.relations.length,
    patterns: snapshot.r2a.patterns.map(pattern => ({
      patternId: pattern.patternId,
      memberCount: pattern.memberR2EventIds.length,
      grade: pattern.grade,
      contextCount: pattern.contextIds.length,
      forwardPropagationRate: pattern.corridor.forwardPropagationRate,
      reverseRejectionRate: pattern.corridor.reverseRejectionRate,
      attractorEvidence: pattern.attractor.evidenceLevel,
      attractorAmbiguous: pattern.attractor.ambiguous,
    })),
    relations: snapshot.r2a.relations.map(relation => ({
      relationId: relation.relationId,
      patternId: relation.patternId,
      grade: relation.grade,
      factorCount: relation.factors.length,
      fullFactorSelectionRate: relation.meanFullFactorSelectionRate,
      stateContrastSelectionLoss: relation.stateContrastSelectionLoss,
      factorAblationLoss: relation.meanFactorAblationLoss,
    })),
    scan: {
      thresholds: scan.thresholds,
      qualifiedSiteCount: scan.qualifiedSiteCount,
      qualifiedDirectedBondCount: scan.qualifiedDirectedBondCount,
      basinCount: scan.basins.length,
      terminalAttractorCount: scan.terminalAttractors.length,
      sharedPrefixCorridorCount: scan.sharedPrefixCorridors.length,
      basinSupportMasses: scan.basins.map(value => value.meanSupportMass),
      siteSupportHistogram: supportHistogram(snapshot.r2a.medium.sites.map(value => value.supportMass)),
      localBondSupportHistogram: supportHistogram(snapshot.r2a.medium.learnedBonds
        .filter(value => value.kind === 'local').map(value => value.supportMass)),
      directedBondSupportHistogram: supportHistogram(snapshot.r2a.medium.learnedBonds
        .filter(value => value.kind === 'plastic-directed').map(value => value.supportMass)),
    },
  });
  const r2For = (eventId: string): string => {
    const annotation = snapshot.annotations.find(value => value.eventId === eventId);
    assert(annotation && annotation.r2EventIds.length === 1,
      `training action has no unique complete R2 event:${eventId}`);
    return annotation.r2EventIds[0]!;
  };
  for (let repetition = 0; repetition < 4; repetition += 1) {
    diagnosticStage('matched-intervention-alpha', { repetition }, () =>
      memory.recordDistributedMatchedIntervention({
        version: 'DistributedR2AInterventionPairV2',
        baselineR2EventId: r2For(actionEventIds['alpha-contrast'][repetition]!),
        interventionR2EventId: r2For(actionEventIds['alpha-success'][repetition]!),
      }));
    diagnosticStage('matched-intervention-beta', { repetition }, () =>
      memory.recordDistributedMatchedIntervention({
        version: 'DistributedR2AInterventionPairV2',
        baselineR2EventId: r2For(actionEventIds['beta-contrast'][repetition]!),
        interventionR2EventId: r2For(actionEventIds['beta-success'][repetition]!),
      }));
  }
  diagnosticProgress('deposit-training', 'end', {
    writes: memory.writes,
    bufferedEvents: memory.bufferedEvents,
  });
  return { clock, actionEventIds };
}

class AnonymousTwoStepEnvironment implements PhysicalControlEnvironmentV2 {
  readonly actionBudget = 4;
  actionCount = 0;
  P = true;
  F = false;
  R = false;
  selectedSlot = 8;
  readonly timeline: string[] = [];
  readonly records: Array<{ readonly kind: string; readonly value: unknown }> = [];
  #observation: Observation;
  #waits = 0;

  constructor(readonly memory: DistributedHierarchicalPhysicalMemoryV1,
    readonly clock: EventClock) {
    this.#observation = this.#nextObservation(1);
  }

  #state(): State { return { P: this.P, F: this.F, R: this.R, selectedSlot: this.selectedSlot }; }
  #nextObservation(ticks: number): Observation {
    let value = this.clock.frame(this.#state(), 'evaluation-context');
    for (let index = 1; index < ticks; index += 1)
      value = this.clock.frame(this.#state(), 'evaluation-context');
    this.#observation = value; return value;
  }
  async observe(): Promise<Observation> { return this.#observation; }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    assert(++this.#waits <= 40, 'control-field-did-not-converge-within-40-real-observations');
    while (this.#observation.sequence <= sequence) this.#nextObservation(1);
    return this.#observation;
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    return [BETA, ALPHA, OBSERVE].map(action => ({
      version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
      observationSequence: observation.sequence, action, cue: cueFor(action, observation),
    }));
  }
  describeActionRequirement(): { readonly satisfied: boolean; readonly missing: readonly string[];
    readonly goal: GroundedGoalV1 | null } {
    return { satisfied: true, missing: [], goal: null };
  }
  async executeOffer(offer: ActionOfferV1, _scope: ActionObservationScopeV1) {
    const current = this.listActionOffers(this.#observation)
      .find(value => cueIdentity(value.cue) === cueIdentity(offer.cue));
    if (!current) return { executed: false, observation: this.#observation,
      eventId: null, refusal: 'offer-stale' as const };
    const beforeState = this.#state();
    const role = cueIdentity(offer.cue) === cueIdentity(cueFor(ALPHA, this.#observation)) ? 'alpha'
      : cueIdentity(offer.cue) === cueIdentity(cueFor(BETA, this.#observation)) ? 'beta' : 'observe';
    if (role === 'alpha' && this.P) { this.F = true; this.selectedSlot = 0; }
    if (role === 'beta') { if (this.F) this.R = true; this.selectedSlot = 1; }
    const ticks = role === 'observe' ? 5 : 2;
    const frames: Observation[] = [];
    frames.push(this.#observation);
    for (let index = 1; index < ticks; index += 1) frames.push(this.#nextObservation(1));
    const action = current.action;
    const eventId = `evaluation-real-${this.actionCount + 1}-${role}`;
    const event: RealEvent = {
      version: 'RealEventV5', id: eventId, cue: cueFor(action, frames[0]!), frames,
      trackedIds: ['self', 'o'],
      bodyResult: { action, executed: true, status: 'completed',
        startSequence: frames[0]!.sequence, endSequence: frames.at(-1)!.sequence,
        terminationReason: 'stable' },
      provenance: 'executed-real-body', complete: true,
    };
    // The isolated evaluation copy learns only the actually executed body
    // event.  A singleton cannot become fresh production evidence.
    this.memory.observe(event);
    this.actionCount++; this.timeline.push(role);
    const afterState = this.#state();
    assert(beforeState !== afterState);
    return { executed: true, observation: this.#observation, eventId };
  }
  async status() {
    return { ready: this.memory.ready, bufferedEvents: this.memory.bufferedEvents,
      writes: this.memory.writes };
  }
  record(kind: string, value: unknown): void {
    this.records.push({ kind, value });
    diagnosticProgress('manager-record', 'progress', {
      recordKind: kind,
      recordNumber: this.records.length,
      actionCount: this.actionCount,
    });
  }
}

// Building two independent intervention-supported relations through the public
// per-event production API is deliberately expensive.  Keep the diagnostic in
// the normal compiled suite without turning every regression run into a
// multi-minute physical training job.  The dedicated G5 command opts in.
const RUN_REAL_G5_TWO_STEP = process.env.KAIROS_RUN_REAL_G5_TWO_STEP === '1';

test('R2A pre-consolidation audit exposes the physical lattice after 15 complete events',
  { skip: PRECONSOLIDATION_DIAGNOSTIC ? false
    : 'set KAIROS_RUN_R2A_PRECONSOLIDATION_DIAGNOSTIC=1 for the bounded raw-lattice audit',
  timeout: 180_000 }, () => {
    const memory = new DistributedHierarchicalPhysicalMemoryV1();
    depositTraining(memory, 15);
    const snapshot = memory.r2aRawPhysicalMediumSnapshotForAudit();
    const beforeHash = sha(snapshot);
    const scan = scanAnonymousPhysicalStructureV1(snapshot);
    const afterHash = sha(memory.r2aRawPhysicalMediumSnapshotForAudit());
    assert.equal(afterHash, beforeHash, 'raw scan changed the R2A physical substrate');
    if (PRECONSOLIDATION_SNAPSHOT_PATH) writeFileSync(PRECONSOLIDATION_SNAPSHOT_PATH,
      gzipSync(Buffer.from(JSON.stringify(snapshot))));
    const sizeHistogram = (values: readonly number[]): Readonly<Record<string, number>> => {
      const result: Record<string, number> = {};
      for (const value of values) result[String(value)] = (result[String(value)] ?? 0) + 1;
      return Object.fromEntries(Object.entries(result)
        .sort(([left], [right]) => Number(left) - Number(right)));
    };
    diagnosticProgress('r2a-preconsolidation-raw-scan', 'end', {
      completeR2Events: 15,
      siteCount: snapshot.sites.length,
      footprintCount: snapshot.footprints.length,
      learnedBondCount: snapshot.learnedBonds.length,
      thresholds: scan.thresholds,
      qualifiedSiteCount: scan.qualifiedSiteCount,
      qualifiedDirectedBondCount: scan.qualifiedDirectedBondCount,
      basinCount: scan.basins.length,
      basinSizeHistogram: sizeHistogram(scan.basins.map(value => value.coreSiteIds.length)),
      terminalAttractorCount: scan.terminalAttractors.length,
      terminalSizeHistogram: sizeHistogram(scan.terminalAttractors
        .map(value => value.coreSiteIds.length)),
      terminalSupportHistogram: sizeHistogram(scan.terminalAttractors
        .map(value => Math.floor(value.meanSupportMass))),
      sharedPrefixCorridorCount: scan.sharedPrefixCorridors.length,
    });
    assert.equal(snapshot.footprints.length, 15,
      'pre-consolidation audit did not stop before the sixteenth complete event');
  });

test('G5 real distributed memory decomposes and executes anonymous F then R chain',
  { skip: RUN_REAL_G5_TWO_STEP ? false
    : 'set KAIROS_RUN_REAL_G5_TWO_STEP=1 for the bounded physical integration diagnostic',
  timeout: 600_000 }, async () => {
    diagnosticProgress('real-g5-two-step-test', 'start');
    const trained = diagnosticStage('construct-empty-distributed-memory', {}, () =>
      new DistributedHierarchicalPhysicalMemoryV1());
    const { clock } = diagnosticStage('deposit-training', {}, () => depositTraining(trained));
    assert.equal(trained.ready, true);
    assert.equal(trained.writes, 128);

    const frozen = diagnosticStage('freeze-snapshot', {}, () => trained.snapshot());
    const frozenHash = diagnosticStage('freeze-snapshot-hash', {}, () => sha(frozen));
    const memory = diagnosticStage('restore-frozen-memory', {}, () =>
      DistributedHierarchicalPhysicalMemoryV1.restore(structuredClone(frozen)));
    const environment = new AnonymousTwoStepEnvironment(memory, clock);
    const initial = await diagnosticAsyncStage('precheck-observe', {}, () => environment.observe());
    const evaluator = new GroundedGoalEvaluatorV1();
    evaluator.setGoal(GOAL, initial);
    const difference = evaluator.evaluate(initial);
    const betaCandidates = diagnosticStage('precheck-recall-beta-effect', {}, () =>
      memory.recallAtomicEffect(GOAL, difference, initial));
    assert(betaCandidates.length >= 8, 'R=true did not recall the repeated real beta effect');
    const beta = betaCandidates.find(value => cueIdentity(value.actionCue)
      === cueIdentity(cueFor(BETA, initial)));
    assert(beta, 'R=true recall did not retain exact beta action identity');
    assert.equal(beta.evidence.r2a.evidenceGrade, 'intervention-supported');
    assert.equal(beta.evidence.r2a.productionEligible, true);
    const betaCondition = diagnosticStage('precheck-compare-beta-condition', {}, () =>
      memory.compareConditions(beta, initial));
    assert.equal(betaCondition.productionEligible, false,
      'beta was incorrectly applicable before F was established');
    const missing = [...betaCondition.contradictedFactorIds, ...betaCondition.unknownFactorIds];
    assert(missing.length > 0, 'beta condition mismatch exposed no opaque factor');
    const transitions = diagnosticStage('precheck-recall-factor-transition', {
      missingFactorCount: missing.length,
    }, () => memory.recallFactorTransition(missing, initial));
    const alphaTransition = transitions.find(value => cueIdentity(value.actionCue)
      === cueIdentity(cueFor(ALPHA, initial)));
    assert(alphaTransition, 'real factor transition recall did not recover alpha');
    const alpha = factorTransitionCandidateForControlV2(alphaTransition, missing);
    const alphaCondition = diagnosticStage('precheck-compare-alpha-condition', {}, () =>
      memory.compareConditions(alpha, initial));
    assert.equal(alphaCondition.productionEligible, true,
      'alpha is not production-applicable in its real P=true condition');
    const beforeQuery = diagnosticStage('precheck-readonly-hash-before', {}, () =>
      sha(memory.snapshot()));
    const alphaPrediction = diagnosticStage('precheck-alpha-prediction-24x180', {
      predictionSeeds: CONFIG.predictionSeeds,
      predictionSteps: CONFIG.predictionSteps,
    }, () => memory.predictCandidate(alpha, initial, GOAL, difference));
    assert(alphaPrediction.validSampleCount >= 8,
      `alpha physical rollout has ${alphaPrediction.validSampleCount} valid samples`);
    const projected = diagnosticStage('precheck-project-parent-relations', {
      relationCount: beta.evidence.r2a.relationIds.length,
      predictedStateCount: alphaPrediction.nextStates.length,
    }, () => memory.compareProjectedParentRelations(beta.evidence.r2a.relationIds,
      initial, alphaPrediction.nextStates,
      { r1Active: alpha.evidence.r1.active, r2Active: alpha.evidence.r2.active }));
    const afterQuery = diagnosticStage('precheck-readonly-hash-after', {}, () =>
      sha(memory.snapshot()));
    assert.equal(afterQuery, beforeQuery,
      'recall/R3/24x180 clone/projected relation query wrote into physical memory');
    assert(projected.filter(value => value.productionEligible).length >= 8,
      `alpha terminal field did not physically restore beta's full factor condition:${JSON.stringify({
        valid: alphaPrediction.validSampleCount,
        projectedEligible: projected.filter(value => value.productionEligible).length,
        nextStates: alphaPrediction.nextStates.slice(0, 2),
      })}`);

    const manager = new PhysicalControlManagerV2(memory, environment, CONFIG,
      undefined, { requirePredictionProgress: true });
    const result = await diagnosticAsyncStage('manager-run-goal', {
      actionBudget: environment.actionBudget,
      predictionSeeds: CONFIG.predictionSeeds,
      predictionSteps: CONFIG.predictionSteps,
    }, () => manager.runGoal(GOAL));
    assert.equal(result.status, 'goal-verified');
    assert.equal(environment.R, true);
    assert.deepEqual(environment.timeline, ['alpha', 'beta', 'observe']);
    const finalFrozenHash = diagnosticStage('final-frozen-snapshot-hash', {}, () => sha(frozen));
    assert.equal(finalFrozenHash, frozenHash, 'evaluation mutated the frozen baseline snapshot');

    const executed = environment.records.filter(record => record.kind === 'control-action-result');
    assert.equal(executed.length, 3);
    for (const record of executed.slice(0, 2)) {
      const workspace = (record.value as { workspace?: unknown }).workspace;
      assert(workspace, 'physical execution has no retained workspace evidence');
    }
    diagnosticProgress('real-g5-two-step-test', 'end', {
      resultStatus: result.status,
      actionCount: environment.actionCount,
      timeline: environment.timeline,
    });
  });
