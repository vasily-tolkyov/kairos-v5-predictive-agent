/** Post-hoc presentation of verified public records. No body or memory port. */
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileSha, saveJson } from '../dist/src/util.js';

const [directory, output] = process.argv.slice(2);
if (!output) throw new Error('audited-run-new-demo-directory-required');
const audit = JSON.parse(await readFile(resolve(directory, 'MULTISTAGE_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await fileSha(resolve(directory, 'events.jsonl'))
  || audit.framesSha256 !== await fileSha(resolve(directory, 'frames.jsonl')))
  throw new Error('demo-requires-intact-passed-multistage-audit');
const events = new Map(), steps = [], chains = [], queries = [], operations = [];
const requiredTransitions = audit.milestones?.length ?? 2;
let decision, goal, completedActions = 0;
for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')) })) {
  const { kind, value } = JSON.parse(line);
  if (kind === 'final-goal-injected') goal = value.goal;
  if (kind === 'real-event') events.set(value.id, value);
  if (kind === 'joint-control-decision') decision = value;
  if (kind === 'physical-prediction-query-completed') queries.push(value);
  if (kind === 'control-operation-result') operations.push({ completedActions,
    operation: value.event.operation, baseSequence: value.event.baseSequence, epoch: value.event.epoch,
    accepted: value.accepted.accepted });
  if (kind === 'control-physical-short-chain') {
    const chain = value.chain;
    chains.push({ beforeFirstAction: completedActions === 0, path: chain.candidatePath,
      physicalBinding: chain.binding, horizon: chain.horizonObservationSteps,
      progress: chain.progressSampleCount, total: chain.totalSampleCount,
      linkedCompleteLanes: chain.lanes.filter(lane => lane.status === 'goal-reached'
        && lane.steps.length === requiredTransitions
        && lane.steps.every((step, index) => index === 0 || step.inputReadoutId
          === lane.steps[index - 1].output.physicalReadout.readoutId)
        && lane.steps.every(step => step.sample.status === 'reached' && step.evidence.r1.active
          && step.evidence.r2.active && step.evidence.r2a.productionEligible
          && step.evidence.r2a.applicability >= .75
          && !('self' in step.output) && !('objects' in step.output))).length });
  }
  if (kind !== 'control-action-result') continue;
  completedActions++;
  const event = events.get(value.result.eventId);
  const selected = audit.actions.find(action => action.eventId === event?.id);
  if (!event || !selected || !decision) throw new Error('recorded-action-evidence-not-found');
  steps.push({ eventId: event.id, action: value.offer.action, executed: value.result.executed,
    decision: decision.lastDecision,
    field: decision.field.sites.map(site => ({ id: site.siteId, operation: site.operation,
      activation: site.activation, drives: site.drives, eligible: site.hardEligible })),
    dependencies: decision.workspace.dependencies,
    evidence: selected.physical ? { physical: true, samples: selected.validSamples,
      progress: selected.progress, r1: selected.evidence.r1.active, r2: selected.evidence.r2.active,
      r2a: selected.evidence.r2a.evidenceGrade, applicability: selected.evidence.r2a.applicability,
      physicalReferences: selected.evidence } : null,
    frames: event.frames, receipt: event.bodyResult });
}
const linked = chains.filter(chain => chain.beforeFirstAction && chain.linkedCompleteLanes === 24);
const transitions = audit.actions.filter(action => action.physical && action.before !== action.after);
const feedback = transitions.slice(0, -1).map(action => ({ afterEventId: action.eventId,
  acceptedOperations: ['recall-effect', 'compare-condition', 'predict-branch'].filter(operation =>
    operations.some(item => item.completedActions > 0 && item.operation === operation && item.accepted
      && item.baseSequence >= action.endSequence)) }));
const freshAfterEach = feedback.every(value => value.acceptedOperations.length === 3);
const physicalChainAudit = { version: 'LinkedPhysicalFutureAuditV2', passed: linked.length > 0 && freshAfterEach,
  requiredTransitions, chains, feedback, freshAfterEach, operations, queryTimings: queries.map(q => ({ method: q.method,
    durationMs: q.durationIncludingQueueMs, sequence: q.baseSequence })),
  eventsSha256: audit.eventsSha256, framesSha256: audit.framesSha256,
  limitation: 'Observed production contribution; no new ablation proves short-chain scoring indispensable.' };
await saveJson(resolve(directory, 'LINKED_SHORT_CHAIN_AUDIT.json'), physicalChainAudit);
// Presentation must not turn missing optional whole-chain evidence into a
// fabricated positive, or erase a separately audited real goal result.
const data = { version: 'RecordedPrototypeEvidenceDemoV1',
  limits: '真实 Minecraft 多阶段目标的公开记录回放，不是录屏或当前直播。未观察区域不补建；本页没有动作、训练或经验写入权限。',
  audit: { passed: true, continuityErrors: audit.continuityErrors,
    frameMismatches: audit.embeddedFrameMismatches, predictedRealGoalTransitions: transitions.length,
    sourceFrames: audit.rawFrameCount, linkedFullChainSamples: linked.length > 0 ? 24 : 0, freshAfterEach,
    limits: '已学习交互上的多步开发案例，不代表通用导航、任意动作组合或开放世界因果能力。' },
  cases: [{ title: `最终目标 note=${audit.targetNote ?? 2}：${requiredTransitions}步状态依赖与真实核验`, steps, goal,
    source: resolve(directory), eventsSha256: audit.eventsSha256,
    recordIntegrity: { passed: audit.integrity, frames: audit.rawFrameCount,
      sampledFrames: steps.reduce((n, step) => n + step.frames.length, 0),
      frameMismatches: audit.embeddedFrameMismatches, controllerDoubleVerification: audit.doubleVerification } }] };
let template = await readFile(resolve('docs/recorded-prototype-demo-template.html'), 'utf8');
const transitionText = transitions.map(action => `${action.before}→${action.after}（${action.validSamples}个有效样本）`).join('；');
template = template.replace('<h2>实际动作与回执</h2>',
  `<h2>已核验的目标链</h2><p>只给最终目标 note=${audit.targetNote ?? 2}；真实过程：${transitionText}；随后双观察验证。</p><p class="muted">动作前完整${requiredTransitions}步沿袭：${linked.length > 0 ? '24/24实际到达' : '本记录未证明完整24/24到达'}。每个中间结果后重新查询：${freshAfterEach ? '已记录' : '证据未齐全'}。未知样本不补成成功。</p><h2>实际动作与回执</h2>`);
await mkdir(output, { recursive: false });
await writeFile(resolve(output, 'index.html'), template.replace('/*__EVIDENCE__*/',
  JSON.stringify(data).replaceAll('<', '\\u003c')), { flag: 'wx' });
await saveJson(resolve(output, 'DEMO_SOURCES.json'), data);
console.log(JSON.stringify({ artifact: resolve(output, 'index.html'), actions: steps.length,
  linkedCompleteChains: linked.length, requiredTransitions, freshAfterEach }));
