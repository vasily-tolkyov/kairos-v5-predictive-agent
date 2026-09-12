import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

// This environment supplies observations and action consequences only. All
// recall, condition analysis, prediction and choice use the production code.
// Evaluation actions do not train the model. A -> B -> A training retains the
// same memory and controller; B swaps two actuator effects, leaving one intact.
const { values } = parseArgs({ options: {
  output: { type: 'string' },
  'build-root': { type: 'string', default: 'dist' },
  actions: { type: 'string', default: '128' },
  seed: { type: 'string', default: '41' },
  phases: { type: 'string', default: 'A,B,A' },
  consolidation: { type: 'string', default: 'online' },
  'skip-goals': { type: 'boolean', default: false },
} });
if (!values.output) throw new Error('output-directory-required');
const actions = Number(values.actions), seed = Number(values.seed);
const phases = values.phases.split(',');
if (!Number.isSafeInteger(actions) || actions < 1 || actions > 1024
  || !Number.isSafeInteger(seed) || seed < 0 || seed > 1_000_000
  || phases.some(phase => !['A', 'B'].includes(phase))
  || !['online', 'batch'].includes(values.consolidation)) throw new Error('invalid-evaluation-options');
const output = resolve(values.output), root = resolve(values['build-root']);
await mkdir(output, { recursive: true });
const load = file => import(pathToFileURL(resolve(root, 'src', file)).href);
const [{ DistributedHierarchicalPhysicalMemoryV1: Memory },
  { PhysicalControlManagerV2: Controller }, { cueFor, realEventHierarchyContinuityV1 },
  { sha }, { SplitMix64 }, { GroundedGoalEvaluatorV1: GoalEvaluator }] = await Promise.all([
  load('distributed-hierarchical-memory.js'), load('control/controller.js'), load('events.js'),
  load('util.js'), load('core/random.js'), load('control/goal.js'),
]);
const started = performance.now();
const progress = (stage, detail = {}) => process.stdout.write(`${JSON.stringify({
  stage, elapsedMs: Math.round(performance.now() - started), ...detail })}\n`);
const config = { version: 'JointTransientControlFieldConfigV2', seed, branchCapacity: 8,
  stepSize: .02, noiseSigma: .01, maximumIntegrationSteps: 500,
  winnerThreshold: .65, winnerMargin: .10, winnerPersistenceSteps: 20,
  inactivePruneThreshold: .0001, inactivePruneSteps: 50,
  predictionSeeds: 24, predictionSteps: 180, goalVerificationTicks: 5 };
const actionSet = [0, 1, 2, 3].map(slot => ({ kind: 'select-hotbar', parameters: { slot } }));
actionSet.push({ kind: 'observe', parameters: { ticks: 5 } });
const goal = property => ({ version: 'GroundedGoalV1', id: `terminal-${property}`,
  expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: property,
    subject: { kind: 'public-object', id: 'o', expectedType: 'opaque' },
    observable: `properties.${property}`, comparator: 'equals', target: true } } });

class World {
  memory = new Memory();
  random = new SplitMix64(BigInt(seed));
  actionCount = 0;
  actionBudget = 0;
  sequence = 0;
  phase = 'A';
  phaseIndex = 0;
  training = false;
  resetPending = false;
  order = [0, 1, 2, 3, 4];
  waits = 0;
  records = [];
  transitions = [];
  receipts = [];
  events = [];
  state = { Q: true, b0: false, b1: false, b2: false, D: false, selectedSlot: 8 };
  contextId = 'initial';
  current = this.frame();

  frame(ticks = 1) {
    this.sequence += ticks;
    const { selectedSlot, ...properties } = this.state;
    return { sequence: this.sequence, activeSeconds: this.sequence * .05,
      contextId: this.contextId, targetId: null,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot } },
      objects: [{ id: 'o', type: 'opaque', relativePosition: [0, 0, -1], properties }] };
  }

  reset(state, context) {
    this.memory.closeContinuity({ reason: 'continuity-reset' });
    this.state = { Q: true, b0: false, b1: false, b2: false, D: false, selectedSlot: 8, ...state };
    this.contextId = context;
    this.current = this.frame();
    this.resetPending = false;
    this.waits = 0;
  }

  async observe() {
    if (this.resetPending) {
      // Independent encounters, with no prescribed action or intermediate goal.
      this.reset({ Q: this.random.uniform() > .2, b0: this.random.uniform() > .5,
        b1: this.random.uniform() > .5, b2: false, D: this.random.uniform() > .5 },
      `context-${Math.floor(this.random.uniform() * 4)}`);
    }
    return this.current;
  }

  async waitForObservationAfter(sequence) {
    if (++this.waits > 32) throw new Error('controller-stalled-without-action-after-32-new-observations');
    if (this.current.sequence <= sequence) this.current = this.frame();
    return this.current;
  }

  listActionOffers(observation) {
    return this.order.map(index => ({ version: 'ActionOfferV1',
      offerId: sha({ sequence: observation.sequence, index }),
      observationSequence: observation.sequence, action: actionSet[index],
      cue: cueFor(actionSet[index], observation) }));
  }

  describeActionRequirement() { return { satisfied: true, missing: [], goal: null }; }
  async status() { return { ready: this.memory.ready, writes: this.memory.writes,
    bufferedEvents: this.memory.bufferedEvents }; }
  record(kind, value) {
    // Keep decision evidence, without duplicating a growing workspace at every tick.
    if (kind === 'joint-control-decision') {
      const node = value.workspace.nodes.find(item => item.node.nodeId === value.lastDecision?.nodeId);
      this.records.push({ kind, operation: value.lastDecision?.operation,
        converged: value.lastDecision?.converged, nodeKind: node?.node.kind,
        dependencyCount: value.workspace.dependencies.length,
        prediction: node?.prediction?.value ? {
          valid: node.prediction.value.validSampleCount,
          progress: node.prediction.value.progressFraction } : null });
    }
  }

  async executeOffer(offer) {
    if (this.actionCount >= this.actionBudget) return { executed: false, observation: this.current,
      eventId: null, refusal: 'action-budget-exhausted' };
    if (offer.observationSequence !== this.current.sequence) return { executed: false,
      observation: this.current, eventId: null, refusal: 'offer-stale' };
    const before = structuredClone(this.state), action = offer.action;
    const id = sha({ seed, phase: this.phaseIndex, actionNumber: this.actionCount });
    if (this.training) {
      const passive = { version: 'RealEventV5', id: `${id}:p`,
        cue: { kind: 'passive', parameters: {}, targetRole: null },
        frames: [this.current, this.frame()], trackedIds: ['self', 'o'],
        bodyResult: null, provenance: 'observed-passive', complete: true };
      const event = { ...passive, hierarchyContinuity: {
        ...realEventHierarchyContinuityV1(passive, id, 'reset'), processStatusAfter: 'open' } };
      this.memory.observe(event); this.events.push(event);
    }
    const first = this.frame();
    if (action.kind === 'select-hotbar') {
      const slot = action.parameters.slot;
      const effect = this.phase === 'B' && slot !== 1 && slot < 3 ? 2 - slot : slot;
      if (effect === 0 && this.state.Q) this.state.b0 = true;
      if (effect === 1 && this.state.b0) this.state.b1 = true;
      if (effect === 2 && this.state.b1) this.state.b2 = true;
      if (effect === 3) this.state.D = !this.state.D;
      this.state.selectedSlot = slot;
    }
    const frames = [first, ...Array.from({ length: action.kind === 'observe' ? 5 : 1 },
      () => this.frame())];
    this.current = frames.at(-1);
    this.actionCount++;
    this.waits = 0;
    if (this.training) {
      const event = { version: 'RealEventV5', id, cue: cueFor(action, first),
        frames, trackedIds: ['self', 'o'],
        bodyResult: { action, executed: true, status: 'completed',
          startSequence: first.sequence, endSequence: this.current.sequence, terminationReason: 'stable' },
        provenance: 'executed-real-body', complete: true };
      const complete = { ...event, hierarchyContinuity: {
        ...realEventHierarchyContinuityV1(event, id, 'continuous'), processStatusAfter: 'publicly-resolved' } };
      const receipt = this.memory.observe(complete); this.events.push(complete);
      this.receipts.push({ action: this.actionCount, novelty: receipt.novelty.newlyAllocatedSignalCount,
        writes: this.memory.writes, stablePatterns: receipt.r2aStablePatterns });
      this.resetPending = true;
      if (this.receipts.length % 8 === 0) progress('exploration', {
        phase: this.phase, phaseIndex: this.phaseIndex, ...this.receipts.at(-1) });
    }
    this.transitions.push({ training: this.training, action: action.kind === 'observe' ? 'observe'
      : action.parameters.slot, before, after: structuredClone(this.state) });
    return { executed: true, observation: this.current, eventId: this.training ? id : null };
  }
}

const world = new World();
const controller = new Controller(world.memory, world, config, undefined, { requirePredictionProgress: true });
const report = { version: 'KairosCapabilityEvaluationV1', seed, actionsPerPhase: actions,
  consolidation: values.consolidation,
  substrate: 'production-numerical-physical-memory', environment: 'synthetic-public-actuator-world',
  externalCurriculum: 'randomized-independent-public-start-states; agent-chooses-every-action',
  interventionPairsRegisteredExternally: 0, phases: [], errors: [] };
const writeReport = async () => writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
const checkpoint = async label => {
  progress('checkpoint-start', { label });
  const state = world.memory.snapshot();
  await writeFile(resolve(output, `${label}.json.gz`), gzipSync(Buffer.from(JSON.stringify(state))));
  progress('checkpoint-end', { label, writes: world.memory.writes,
    patterns: state.r2a.patterns.length, relations: state.r2a.relations.length });
  return state;
};

try {
  for (const [phaseIndex, phase] of phases.entries()) {
    world.phase = phase;
    world.phaseIndex = phaseIndex;
    world.training = true;
    world.actionBudget = world.actionCount + actions;
    world.resetPending = true;
    const beforeWrites = world.memory.writes, beforeAction = world.actionCount;
    const recordStart = world.records.length, transitionStart = world.transitions.length;
    progress('phase-start', { phase, phaseIndex });
    if (values.consolidation === 'batch') world.memory.beginR2AConsolidationBatchV1();
    const exploration = await controller.exploreUntil(() => world.actionCount >= world.actionBudget);
    world.training = false;
    world.resetPending = false;
    await writeFile(resolve(output, `phase-${phaseIndex}-${phase}-events.jsonl`),
      world.events.map(event => JSON.stringify(event)).join('\n') + '\n');
    progress('exploration-end', { phase, phaseIndex,
      actionCounts: Object.fromEntries(actionSet.map(action => action.kind === 'observe' ? 'observe'
        : action.parameters.slot).map(action => [action,
        world.transitions.slice(transitionStart).filter(value => value.action === action).length])) });
    if (values.consolidation === 'batch') {
      progress('consolidation-start', { phase, phaseIndex });
      world.memory.endR2AConsolidationBatchV1();
      progress('consolidation-end', { phase, phaseIndex });
    }
    const snapshot = await checkpoint(`phase-${phaseIndex}-${phase}`);
    const transitions = world.transitions.slice(transitionStart);
    const phaseResult = { phase, phaseIndex, exploration, beforeWrites,
      afterWrites: world.memory.writes, newActions: world.actionCount - beforeAction,
      coverage: [...new Set(transitions.map(value => value.action))],
      outcomeChanges: Object.fromEntries(['b0', 'b1', 'b2'].map(key => [key,
        transitions.filter(value => value.before[key] !== value.after[key]).length])),
      newPhysicalFootprints: snapshot.r1.records.length - beforeWrites,
      completeR2Events: snapshot.r2.events.length,
      patternCount: snapshot.r2a.patterns.length,
      stablePatterns: snapshot.r2a.patterns.filter(value =>
        ['predictive-stable', 'causal-hypothesis', 'intervention-supported'].includes(value.grade)).length,
      relations: snapshot.r2a.relations.length,
      interventionSupportedRelations: snapshot.r2a.relations.filter(value => value.grade === 'intervention-supported').length,
      explorationDecisions: world.records.length - recordStart, goals: [] };
    report.phases.push(phaseResult);
    await writeReport();
    if (!values['skip-goals']) for (const [name, state, property, order] of [
      ['one-stage', { b0: true, b1: true }, 'b2', [2, 3, 0, 1, 4]],
      ['two-stage', { b0: true }, 'b2', [1, 0, 3, 2, 4]],
      ['three-stage', {}, 'b2', [3, 2, 1, 0, 4]],
      ['retained-relation', { b0: true }, 'b1', [0, 2, 3, 1, 4]],
      ['unreachable', { Q: false }, 'b2', [1, 3, 2, 0, 4]],
    ]) {
      world.reset(state, `held-out-${phaseIndex}-${name}`);
      world.order = order;
      world.actionBudget = world.actionCount + 5;
      const start = world.transitions.length, record = world.records.length;
      progress('goal-start', { phase, phaseIndex, name });
      let result = null, error = null;
      try { result = await controller.runGoal(goal(property)); }
      catch (cause) { error = cause.message; }
      const decisions = world.records.slice(record).filter(value => value.converged);
      const executions = decisions.filter(value => value.operation === 'execute');
      const evaluator = new GoalEvaluator();
      evaluator.setGoal(goal(property), world.current);
      const confirmed = result?.status === 'goal-verified'
        && evaluator.evaluate(world.current).status === 'satisfied';
      phaseResult.goals.push({ name, result, error, confirmed,
        planned: executions.length > 0 && executions.every(value => value.nodeKind !== 'exploration'),
        dependencies: Math.max(0, ...decisions.map(value => value.dependencyCount)),
        timeline: world.transitions.slice(start), decisions,
        writesUnchanged: world.memory.writes === phaseResult.afterWrites });
      progress('goal-end', { phase, name, confirmed, error, status: result?.status });
      await writeReport();
    }
  }
} catch (cause) {
  report.errors.push({ message: cause.message, stack: cause.stack });
  progress('error', { message: cause.message, stack: cause.stack });
  await checkpoint('interrupted').catch(error => report.errors.push({ message: error.message }));
} finally {
  report.durationMs = Math.round(performance.now() - started);
  report.receipts = world.receipts;
  report.success = report.errors.length === 0 && report.phases.length === phases.length
    && !values['skip-goals'] && report.phases.every(phase => phase.goals.length === 5
      && phase.goals.every(item => item.writesUnchanged && !item.error
        && (item.name === 'unreachable' ? !item.confirmed : item.confirmed && item.planned)));
  await writeReport();
  progress('complete', { success: report.success, errors: report.errors });
  process.exitCode = report.success ? 0 : 1;
}
