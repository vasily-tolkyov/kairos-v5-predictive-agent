import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Read-only replay of one recorded action-start frame. No replay is learned
// and none of these counterfactual plans is counted as physical execution.
const [build, memory, source, indexText, output] = process.argv.slice(2);
if (!output) throw new Error('usage: BUILD_DIST MEMORY_GZ NATIVE_RUN ACTION_JOURNAL_NUMBER NEW_JSON');
const { ExperienceSession } = await import(resolve(build, 'src/experience-session.js'));
const { compareExperiencePrediction } = await import(resolve(build, 'src/experience-agent.js'));
const { experienceInputs } = await import(resolve(build, 'src/experience-medium.js'));
const report = JSON.parse(await readFile(resolve(source, 'results.json'), 'utf8'));
const entry = JSON.parse(await readFile(resolve(source, 'journal/physical-actions', indexText.padStart(7, '0') + '.json'), 'utf8'));
const bytes = await readFile(resolve(source, 'events', String(entry.eventFile).padStart(7, '0') + '.json.gz'));
const event = JSON.parse(gunzipSync(bytes)), before = event.frames[0], after = event.frames.at(-1);
const saved = JSON.parse(gunzipSync(await readFile(resolve(memory))));
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
const task = (report.tasks ?? saved.tasks).find(task => task.goal.id === 'reach-other-side'), plans = [];
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
  actualBefore: before.self, actualAfter: after.self, inputs: experienceInputs(before), measurements, plans,
  unchangedLearningDigest: finalDigest, physicalTrials: 0 };
await writeFile(resolve(output), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output: resolve(output), plans: plans.map(({ steps, ...plan }) => ({
  ...plan, actions: steps.map(step => step.action), length: steps.length })) }));
