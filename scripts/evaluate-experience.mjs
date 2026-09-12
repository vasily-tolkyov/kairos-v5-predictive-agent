import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
const { values } = parseArgs({ options: {
  output: { type: 'string' }, 'build-root': { type: 'string', default: 'dist' },
  actions: { type: 'string', default: '4096' }, seeds: { type: 'string', default: '41,73,109' },
  phases: { type: 'string', default: 'A,B,A' },
} });
if (!values.output) throw new Error('output-required');
const output = resolve(values.output), root = resolve(values['build-root']);
const actions = Number(values.actions), seeds = values.seeds.split(',').map(Number), phases = values.phases.split(',');
if (!Number.isSafeInteger(actions) || actions < 1 || actions > 10000
  || !seeds.length || seeds.some(seed => !Number.isSafeInteger(seed) || seed < 1)
  || phases.some(phase => !['A', 'B'].includes(phase))) throw new Error('invalid-evaluation-options');
await mkdir(output, { recursive: true });
const load = file => import(pathToFileURL(resolve(root, 'src', file)).href);
const [{ ExperienceMedium, experienceState, ExperienceAgent }, { cueFor, cueIdentity }, { sha }]
  = await Promise.all([load('prototype.js'), load('events.js'), load('util.js')]);
const started = performance.now(), report = { version: 1, actionsPerPhase: actions, seeds, phases, runs: [], passed: false };
const progress = (stage, detail) => process.stdout.write(JSON.stringify({ stage, elapsedMs: Math.round(performance.now() - started), ...detail }) + '\n');

// This is the independent body/world oracle. Its mechanisms are not passed to
// the learner or planner. Receptor names and motor assignments vary by seed.
class World {
  phase = 'A'; sequence = 0; counter = 0; events = []; random;
  bits = [true, false, false, false, false, false]; selected = 8;
  constructor(seed) {
    this.seed = seed; this.random = seed;
    this.names = Array.from({ length: 6 }, (_, i) => 'r' + sha({ seed, receptor: i }).slice(0, 10));
    this.motors = [0, 1, 2, 3, 4].sort((a, b) => sha({ seed, motor: a }).localeCompare(sha({ seed, motor: b })));
    this.bodyActions = this.motors.map(slot => ({ kind: 'select-hotbar', parameters: { slot } }));
    this.current = this.frame();
  }
  uniform() { let x = this.random; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.random = x >>> 0; return this.random / 4294967296; }
  frame(ticks = 1) {
    this.sequence += ticks;
    return { sequence: this.sequence, activeSeconds: this.sequence * .05,
      contextId: 'context-' + (this.counter % 4), targetId: null,
      self: { position: [0, 0, 0], yaw: 0, pitch: 0, properties: { selectedSlot: this.selected } },
      objects: [{ id: 'sensor', type: 'opaque', relativePosition: [0, 0, -1],
        properties: Object.fromEntries(this.names.map((key, i) => [key, this.bits[i]])) }] };
  }
  set(bits, slot = 8) { this.bits = [...bits]; this.selected = slot; this.current = this.frame(); }
  async observe() { return this.current; }
  listActionOffers(observation) {
    return [...this.bodyActions].sort((a, b) => sha({ action: a, sequence: observation.sequence })
      .localeCompare(sha({ action: b, sequence: observation.sequence }))).map(action => ({
      version: 'ActionOfferV1', offerId: sha({ action, sequence: observation.sequence }),
      observationSequence: observation.sequence, action, cue: cueFor(action, observation) }));
  }
  consequence(bits, action) {
    const after = [...bits]; let role = this.bodyActions.findIndex(value => value.parameters.slot === action.parameters.slot);
    if (this.phase === 'B' && role < 3 && role !== 1) role = 2 - role;
    if (role < 3 && after[role]) after[role + 1] = true;
    if (role === 3) after[4] = !after[4];
    if (role === 4) after[5] = !after[5];
    return after;
  }
  async executeOffer(offer) {
    if (offer.observationSequence !== this.current.sequence) throw new Error('stale-physical-offer');
    const before = this.current;
    this.bits = this.consequence(this.bits, offer.action); this.selected = offer.action.parameters.slot;
    this.counter++; this.current = this.frame();
    const event = { version: 'RealEventV5', id: `real-${this.seed}-${this.counter}`,
      cue: cueFor(offer.action, before), frames: [before, this.current], trackedIds: ['self', 'sensor'],
      provenance: 'executed-real-body', complete: true,
      bodyResult: { action: offer.action, executed: true, status: 'completed',
        startSequence: before.sequence, endSequence: this.current.sequence, terminationReason: 'stable' } };
    this.events.push(event);
    return { executed: true, observation: this.current, event };
  }
  async waitForObservationAfter(sequence) { if (this.current.sequence <= sequence) this.current = this.frame(); return this.current; }
  goal(index) { return { version: 'GroundedGoalV1', id: sha({ terminal: this.names[index] }),
    expression: { kind: 'predicate', predicate: { version: 'GoalPredicateV1', id: this.names[index],
      subject: { kind: 'public-object', id: 'sensor', expectedType: 'opaque' },
      observable: 'properties.' + this.names[index], comparator: 'equals', target: true } } }; }
  trainingEncounter() {
    // Never demonstrate a whole successful chain or its all-false evaluation
    // start. Every encounter contains exactly one agent-selected action.
    let bits;
    do { bits = Array.from({ length: 6 }, () => this.uniform() >= .5); }
    while (!bits[1] && !bits[2] && !bits[3]);
    this.set(bits, [8, ...this.motors][Math.floor(this.uniform() * 6)]);
  }
}

for (const seed of seeds) {
  const world = new World(seed), medium = new ExperienceMedium(seed), agent = new ExperienceAgent(medium);
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
    world.phase = phases[phaseIndex];
    world.set([true, false, false, false, false, false]);
    const frozenAtChange = await new ExperienceAgent(ExperienceMedium.restore(medium.snapshot()))
      .runGoal(world, world.goal(3), { actionBudget: 5, learn: false, allowExploration: false });
    const beforeEvents = world.events.length, counts = {}, prequential = [];
    for (let i = 0; i < actions; i++) {
      world.trainingEncounter();
      const observation = await world.observe(), offer = agent.explore(observation, world.listActionOffers(observation));
      if (!offer) throw new Error('exploration-produced-no-action');
      counts[cueIdentity(offer.cue)] = (counts[cueIdentity(offer.cue)] ?? 0) + 1;
      const real = await world.executeOffer(offer);
      prequential.push(medium.observe(real.event).correctBeforeUpdate);
    }
    const snapshot = medium.snapshot(), snapshotHash = sha(snapshot);
    await writeFile(resolve(output, `${seed}-${phaseIndex}-${world.phase}-memory.json.gz`), gzipSync(JSON.stringify(snapshot)));
    await writeFile(resolve(output, `${seed}-${phaseIndex}-${world.phase}-events.jsonl`),
      world.events.slice(beforeEvents).map(event => JSON.stringify(event)).join('\n') + '\n');
    const restored = ExperienceMedium.restore(snapshot), evaluation = new ExperienceAgent(restored);
    const holdout = { total: 0, correct: 0, accepted: 0, acceptedCorrect: 0,
      unseenCombinationTotal: 0, unseenCombinationCorrect: 0, errors: [] };
    for (let mask = 0; mask < 64; mask++) for (const action of world.bodyActions) {
      const bits = Array.from({ length: 6 }, (_, index) => Boolean(mask & (1 << index)));
      world.set(bits);
      const prediction = restored.predict(cueFor(action, world.current), world.current);
      const actualBits = world.consequence(bits, action);
      const expected = structuredClone(world.current);
      expected.self.properties.selectedSlot = action.parameters.slot;
      expected.objects[0].properties = Object.fromEntries(world.names.map((name, index) => [name, actualBits[index]]));
      const correct = prediction.observation && sha(experienceState(prediction.observation)) === sha(experienceState(expected));
      holdout.total++; holdout.correct += Number(correct); holdout.accepted += Number(prediction.accepted);
      holdout.acceptedCorrect += Number(correct && prediction.accepted);
      if (!bits[1] && !bits[2] && !bits[3]) {
        holdout.unseenCombinationTotal++; holdout.unseenCombinationCorrect += Number(correct);
      }
      if ((!correct || !prediction.accepted) && holdout.errors.length < 12) holdout.errors.push({
        bits, action, correct: Boolean(correct), margin: prediction.activationMargin,
        score: prediction.prequentialAccuracy, reason: prediction.reason });
    }
    const goals = [];
    for (const distractors of [[false, false], [true, false], [false, true], [true, true]]) {
      for (const [label, stage, prefix] of [['one', 1, 0], ['two', 2, 0], ['three', 3, 0],
        ['partial-two', 3, 1], ['partial-one', 3, 2], ['retained', 2, 1]]) {
        const bits = [true, prefix >= 1, prefix >= 2, false, ...distractors]; world.set(bits);
        const plan = evaluation.plan(world.goal(stage), world.current, world.listActionOffers(world.current));
        const result = await evaluation.runGoal(world, world.goal(stage), { actionBudget: 5, learn: false, allowExploration: false });
        goals.push({ label, distractors, initialPlanLength: plan.steps.length,
          status: result.status, actions: result.actions, success: result.status === 'goal-verified'
            && result.actions.length > 0 && result.actions.every(action => action.mode === 'planned' && action.predictionCorrect) });
      }
      world.set([true, false, false, false, ...distractors]);
      const combined = { version: 'GroundedGoalV1', id: 'combined-observed-terminal',
        expression: { kind: 'all', children: [world.goal(3).expression, world.goal(4).expression] } };
      const plan = evaluation.plan(combined, world.current, world.listActionOffers(world.current));
      const result = await evaluation.runGoal(world, combined, { actionBudget: 5, learn: false, allowExploration: false });
      goals.push({ label: 'conjunction', distractors, initialPlanLength: plan.steps.length,
        status: result.status, actions: result.actions, success: result.status === 'goal-verified'
          && result.actions.length >= 3 && result.actions.every(action => action.mode === 'planned' && action.predictionCorrect) });
    }
    world.set([false, false, false, false, false, false]);
    const unreachable = await evaluation.runGoal(world, world.goal(3), { actionBudget: 5, learn: false, allowExploration: false });
    const queryReadOnly = sha(restored.snapshot()) === snapshotHash && sha(medium.snapshot()) === snapshotHash;
    const erased = structuredClone(snapshot);
    for (const [, network] of erased.networks) {
      if (network.motion) { network.motion.mean.fill(0); network.motion.correct = 0; }
      for (const head of network.heads) {
        for (const row of head.readout) row.fill(0);
        for (const row of head.categoryReadout) row.fill(0);
        head.numericMeans.fill(0);
        head.correct = head.categoryCorrect = head.regressionCorrect = 0;
        for (const quality of head.numericQuality) quality.correct = 0;
      }
    }
    world.set([true, false, false, false, false, false]);
    const withoutConductances = await new ExperienceAgent(ExperienceMedium.restore(erased)).runGoal(world,
      world.goal(3), { actionBudget: 5, learn: false, allowExploration: false });
    const actionRequired = !restored.predict(null, world.current).accepted;
    const run = { seed, phaseIndex, phase: world.phase, writes: medium.writes, counts,
      prequentialFirst64: prequential.slice(0, 64).filter(Boolean).length / Math.min(64, actions),
      prequentialLast64: prequential.slice(-64).filter(Boolean).length / Math.min(64, actions),
      holdout, goals, unreachable: { status: unreachable.status, actions: unreachable.actions.length }, queryReadOnly,
      controls: { frozenAtChange: frozenAtChange.status, withoutConductances: withoutConductances.status, actionRequired },
      passed: holdout.correct === holdout.total && goals.every(goal => goal.success)
        && unreachable.status !== 'goal-verified' && queryReadOnly
        && (phaseIndex > 0 && phases[phaseIndex - 1] === world.phase || frozenAtChange.status !== 'goal-verified')
        && withoutConductances.status !== 'goal-verified' && actionRequired };
    report.runs.push(run);
    await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
    progress('phase', { seed, phaseIndex, phase: world.phase, holdout: `${holdout.correct}/${holdout.total}`,
      accepted: holdout.accepted, goals: `${goals.filter(goal => goal.success).length}/${goals.length}`,
      queryReadOnly, passed: run.passed });
  }
}
report.passed = report.runs.every(run => run.passed);
report.elapsedMs = Math.round(performance.now() - started);
await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2));
progress('complete', { passed: report.passed });
if (!report.passed) process.exitCode = 1;
