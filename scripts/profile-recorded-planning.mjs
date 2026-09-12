import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Read-only replay of one recorded action-start frame. No replay is learned
// and none of these counterfactual plans is counted as physical execution.
export function parseProfileArguments(args) {
  const [build, memory, source, indexText, output, goalId = 'reach-other-side'] = args;
  if (args.length < 5 || args.length > 6 || !build || !memory || !source || !indexText || !output)
    throw new Error('usage: BUILD_DIST MEMORY_GZ NATIVE_RUN ACTION_JOURNAL_NUMBER NEW_JSON [GOAL_ID]');
  if (!goalId) throw new Error('recorded-planning-goal-id-must-not-be-empty');
  return { build, memory, source, indexText, output, goalId };
}

export function selectRecordedTask(report, saved, goalId) {
  const matches = [report.tasks ?? [], saved.tasks ?? []].map(tasks => {
    if (!Array.isArray(tasks)) throw new Error('invalid-recorded-planning-task-list');
    return tasks.filter(task => task?.goal?.id === goalId);
  });
  if (matches.some(tasks => tasks.length > 1)) throw new Error('ambiguous-recorded-planning-goal:' + goalId);
  const [reported, checkpoint] = matches.map(tasks => tasks[0]);
  if (!reported && !checkpoint) throw new Error('missing-recorded-planning-goal:' + goalId);
  if (reported && checkpoint && !isDeepStrictEqual(reported.goal, checkpoint.goal))
    throw new Error('ambiguous-recorded-planning-goal-definition:' + goalId);
  // A matching stopped-run task owns its actual baseline; the saved model is
  // only a fallback when that task is absent from the report.
  return { task: reported ?? checkpoint, goalSource: reported ? 'report.tasks' : 'saved.tasks' };
}

async function profile({ build, memory, source, indexText, output, goalId }) {
  const report = JSON.parse(await readFile(resolve(source, 'results.json'), 'utf8'));
  const memoryBytes = await readFile(resolve(memory)), saved = JSON.parse(gunzipSync(memoryBytes));
  const { task, goalSource } = selectRecordedTask(report, saved, goalId);
  const sourceModelSha256 = createHash('sha256').update(memoryBytes).digest('hex');
  const scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  const { ExperienceSession } = await import(pathToFileURL(resolve(build, 'src/experience-session.js')).href);
  const { compareExperiencePrediction } = await import(pathToFileURL(resolve(build, 'src/experience-agent.js')).href);
  const { experienceInputs } = await import(pathToFileURL(resolve(build, 'src/experience-medium.js')).href);
  const entry = JSON.parse(await readFile(resolve(source, 'journal/physical-actions', indexText.padStart(7, '0') + '.json'), 'utf8'));
  const bytes = await readFile(resolve(source, 'events', String(entry.eventFile).padStart(7, '0') + '.json.gz'));
  const event = JSON.parse(gunzipSync(bytes)), before = event.frames[0], after = event.frames.at(-1);
  const session = ExperienceSession.restore(saved);
  const hash = () => createHash('sha256').update(JSON.stringify([session.agent.medium.snapshot(), session.agent.affordances.snapshot()])).digest('hex');
  const initialDigest = hash(), measurements = [];
  for (const probe of [false, true]) for (const offer of entry.availableOffers) {
    const start = performance.now(), prediction = session.agent.medium.predict(offer.cue, before, { probe });
    measurements.push({ probe, action: offer.action, milliseconds: performance.now() - start,
      supportedPosition: prediction.supportedFields.filter(field => field.startsWith('self/position.')),
      proposedPosition: prediction.observation?.self.position,
      contextChannels: Object.keys(prediction.observation?.predictionContext ?? {}),
      actualComparison: offer.action.kind === entry.offer.action.kind
        && JSON.stringify(offer.action.parameters) === JSON.stringify(entry.offer.action.parameters)
        ? compareExperiencePrediction(prediction, after) : undefined });
  }
  const plans = [];
  for (const exploratory of [false, true]) for (const milliseconds of [100, 500, 2000]) {
    const started = performance.now(), plan = session.agent.plan(task.goal, before, entry.availableOffers,
      { baseline: task.baseline, exploratory, depth: exploratory ? 6 : 32, expansions: 128, milliseconds });
    plans.push({ exploratory, budgetMilliseconds: milliseconds, elapsedMilliseconds: performance.now() - started,
      expanded: plan.expanded, reason: plan.reason, steps: plan.steps.map(step => ({
        action: step.offer.action, position: step.prediction.observation?.self.position,
        supportedFields: step.prediction.supportedFields, hypothesizedFields: step.prediction.hypothesizedFields })) });
  }
  const finalDigest = hash();
  if (initialDigest !== finalDigest) throw new Error('read-only-replay-mutated-learning');
  const result = { version: 'RecordedPlanningProfile1', source: resolve(source), event: event.id,
    eventSha256: createHash('sha256').update(bytes).digest('hex'), build: resolve(build), memory: resolve(memory),
    sourceModelSha256, scriptSha256, goalId: task.goal.id, goal: task.goal, goalBaseline: task.baseline ?? null, goalSource,
    actualBefore: before.self, actualAfter: after.self, inputs: experienceInputs(before), measurements, plans,
    unchangedLearningDigest: finalDigest, physicalTrials: 0 };
  await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output: resolve(output), goalId: task.goal.id, plans: plans.map(({ steps, ...plan }) => ({
    ...plan, actions: steps.map(step => step.action), length: steps.length })) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await profile(parseProfileArguments(process.argv.slice(2)));
