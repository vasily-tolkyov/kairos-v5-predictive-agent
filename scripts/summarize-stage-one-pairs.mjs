import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [planPath, output] = process.argv.slice(2); assert(output, 'usage: PAIRED_PLAN_JSON NEW_RESULT_JSON');
const bytes = await readFile(planPath), plan = JSON.parse(bytes), protocol = JSON.parse(await readFile(plan.protocol));
const optional = async path => { try { return JSON.parse(await readFile(path)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const rows = [];
for (const pair of plan.pairs) {
  const row = { pair: pair.pair, case: pair.case, seed: pair.seed, conditions: {} };
  for (const [index, condition] of pair.conditionsInOrder.entries()) {
    const directory = resolve(pair.outputs[index]), report = await optional(resolve(directory, 'results.json'));
    const audit = await optional(resolve(directory, 'independent-audit-01.json'));
    const status = !report ? 'not-completed-or-not-launched' : !report.stoppedAt ? 'not-stopped'
      : audit?.status === 'audited' ? 'audited' : 'stopped-not-audited';
    row.conditions[condition] = { source: pair.outputs[index], status, runStatus: report?.status ?? null,
      success: report?.status === 'goal-verified' && status === 'audited',
      decisions: report?.final?.decisions ?? null, executed: report?.final?.executed ?? null,
      seconds: report?.seconds ?? null, metrics: audit?.metrics ?? null,
      frozenUnchanged: report ? report.initialLearningDigest === report.finalLearningDigest : null,
      modelDigest: report?.initialLearningDigest ?? null,
      modelSourceSha256: report?.modelSource?.sha256 ?? null };
  }
  const retained = row.conditions['retained-frozen'], erased = row.conditions['erased-frozen'];
  row.complete = retained.status === 'audited' && erased.status === 'audited';
  row.retainedCost = retained.success ? retained.decisions : protocol.testBudget.decisions;
  row.erasedCost = erased.success ? erased.decisions : protocol.testBudget.decisions;
  rows.push(row);
}
const complete = rows.filter(row => row.complete), wins = complete.filter(row => row.conditions['retained-frozen'].success && !row.conditions['erased-frozen'].success).length;
const losses = complete.filter(row => !row.conditions['retained-frozen'].success && row.conditions['erased-frozen'].success).length;
const n = wins + losses; let signTestP = n ? 0 : 1;
for (let k = wins; n && k <= n; k++) { let combinations = 1; for (let j = 1; j <= k; j++) combinations *= (n - j + 1) / j; signTestP += combinations / 2 ** n; }
const median = input => { const values = [...input].sort((a, b) => a - b), middle = Math.floor(values.length / 2); return values.length ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 : null; };
const summary = condition => {
  const observed = rows.map(row => row.conditions[condition]).filter(row => row.status === 'audited');
  const total = key => observed.reduce((sum, row) => sum + row.metrics[key], 0);
  const executed = total('executed'), supported = total('supportedPredictions');
  return { auditedRuns: observed.length, successes: observed.filter(row => row.success).length,
    decisions: total('decisions'), executed, executionRate: executed / Math.max(1, total('decisions')),
    supportedPredictions: supported, supportedCorrect: total('supportedCorrect'),
    supportCoverage: supported / Math.max(1, executed), supportedAccuracy: supported ? total('supportedCorrect') / supported : null,
    missingPredictions: total('missingPredictions'), unsupportedPredictions: total('unsupportedPredictions'),
    allAvailablePredictions: total('allAvailablePredictions'), allAvailableCorrect: total('allAvailableCorrect'),
    totalSeconds: observed.reduce((sum, row) => sum + row.seconds, 0),
    learnedTaskChoices: total('learnedTaskChoices'), allFrozenUnchanged: observed.every(row => row.frozenUnchanged),
    samePinnedDonor: condition === 'retained-frozen' ? observed.every(row => row.modelSourceSha256 === plan.modelSourceSha256
      && row.modelDigest === plan.modelLearningDigest) : null };
};
const retained = summary('retained-frozen'), erased = summary('erased-frozen'), accepted = protocol.stageAcceptance;
const medianPairedCostGain = median(complete.map(row => row.erasedCost - row.retainedCost));
const gates = { allPairsComplete: complete.length === plan.pairs.length,
  frozen: retained.allFrozenUnchanged && erased.allFrozenUnchanged && retained.samePinnedDonor,
  successes: retained.successes >= accepted.retainedSuccessesAtLeast,
  successRateGain: (retained.successes - erased.successes) / plan.pairs.length >= accepted.successRateGainAtLeast,
  pairedSignTest: signTestP <= accepted.pairedSuccessSignTestOneSidedPAtMost,
  cost: medianPairedCostGain !== null && medianPairedCostGain > 0,
  execution: retained.executionRate >= accepted.executedFractionAtLeast && erased.executionRate >= accepted.executedFractionAtLeast,
  learnedPredictionCoverage: retained.supportCoverage >= accepted.supportedKeyPredictionCoverageAtLeast,
  learnedPredictionAccuracy: retained.supportedAccuracy !== null && retained.supportedAccuracy >= accepted.supportedPlanarPredictionMatchedFractionAtLeast };
const result = { version: 'StageOnePairedSummary1', status: complete.length === plan.pairs.length ? 'complete' : 'incomplete',
  planSha256: createHash('sha256').update(bytes).digest('hex'), registeredPairs: plan.pairs.length, completedPairs: complete.length,
  retained, erased, discordantRetainedWins: wins, discordantErasedWins: losses, oneSidedExactPairedSignTestP: signTestP,
  medianPairedCostGain, gates, acceptancePassed: Object.values(gates).every(Boolean), pairs: rows,
  scope: 'The complete preregistered stage-one paired set only. Predictions are reported in both conditions; learned prediction gates apply to retained-frozen. Missing runs prohibit acceptance. Failed task costs use the full fixed decision cap. This does not establish multistage or sustained learning.' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...result, pairs: rows.length }));
