import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, statfs } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AnalysisCore, MODE_PROMPTS, SYSTEM_PROMPT, TOOL_SCHEMAS, type AnalysisTools } from './analysis.js';
import { loadConfiguration, Services } from './services.js';
import { PublicObjectAliases, validateAction } from './analysis-actions.js';
import { CognitiveWorkspace, type CognitiveMode, type CognitiveWorkspaceV1 } from './cognitive-workspace.js';
import { realInputTokens } from './analysis-context.js';
import { matches } from './memory.js';
import type { Action, ActionCue, DesiredChange, Observation, PublicChange } from './contracts.js';
import { assert, canonical, fileSha, saveJson, sha } from './util.js';

export const HARNESS_ROOT = resolve('evidence/analysis-deepseek-backend-v1');
export const RUN_ROOT = resolve(HARNESS_ROOT, 'questions-002');
const PROTOCOL_FAILURE_RUN = resolve(HARNESS_ROOT, 'questions-001');
const REUSED_PROTOCOL = resolve('evidence/analysis-contract-context-root-repair-v2/questions-002/PROTOCOL.json');
const OLD_RUN = resolve('evidence/analysis-harness-v1/qualification-003');
const SOURCE_FRAME_PATH = resolve('evidence/v5-2026-08-27T11-26-53-929Z-d4ee2a75/frames.jsonl');
export interface CaseSpec { id: string; mode: CognitiveMode; goal: string; kind: string; readOnly: boolean;
  requiredTools: readonly string[]; needsUncertainty: boolean; requireAction: boolean; }
/** New questions/rubrics, frozen before inference. No model answer or next tool is supplied by the driver. */
export const CASES: readonly CaseSpec[] = [
  { id: 'current-versus-history', mode: 'orient', kind: 'observable',
    goal: '核对当前公开选中槽位是否为7，与过去槽位变化经验对照。分别报告当前读数与历史结果，说明现在是否满足目标。本例只读，不操作。',
    readOnly: true, requiredTools: ['recall'], needsUncertainty: false, requireAction: false },
  { id: 'exact-query-conditions', mode: 'recall', kind: 'supported-history',
    goal: '反查公开copper_bulb类型对象的lit变为true的历史经验，核对当前条件支持与缺失信息。不要把过去发生等同现在可靠适用；本例只研究，不行动。',
    readOnly: true, requiredTools: ['recall'], needsUncertainty: true, requireAction: false },
  { id: 'plan-without-action', mode: 'plan', kind: 'supported-prediction',
    goal: '为公开选中槽位变为6研究候选方案，结合历史及物理预测比较依据与局限。只需尚未执行的方案或合理未知，本例禁止实际行动。',
    readOnly: true, requiredTools: ['recall', 'predict'], needsUncertainty: false, requireAction: false },
  { id: 'act-check-body-result', mode: 'act', kind: 'action-no-effect',
    goal: '尝试让公开选中槽位变成7，核对本次实际返回后报告。区分完成尝试与目标真的达成；动作由你选择。',
    readOnly: false, requiredTools: ['execute_chain'], needsUncertainty: true, requireAction: true },
  { id: 'explore-test-question', mode: 'explore', kind: 'cold',
    goal: '没有可用经验。请自主提出一个能用基础行动检验的小问题，尝试并核对实际返回，保留不能确认的因果关系，然后报告。',
    readOnly: false, requiredTools: ['execute_chain'], needsUncertainty: false, requireAction: true },
  { id: 'review-new-fact', mode: 'review', kind: 'changing-observation',
    goal: '复核旧笔记“选中槽位仍为4”，根据当前和随后送达的新公开观察修订笔记，保留历史时点并报告。只读，不行动。',
    readOnly: true, requiredTools: ['set_intent'], needsUncertainty: false, requireAction: false },
  { id: 'continuity-read-early-evidence', mode: 'orient', kind: 'paged-history',
    goal: '研究槽位变为7的全部可用历史及当前预测，由你组织问题和任务。保留早期经验引用，比较后再取回早期公共材料核对，报告已读页面、条件差异与仍未知处。本例不行动。',
    readOnly: true, requiredTools: ['recall', 'predict', 'read_context'], needsUncertainty: true, requireAction: false },
  { id: 'continuity-notice-and-task', mode: 'orient', kind: 'interruption',
    goal: '让公开选中槽位变为7并核验；若有新通知，核对其实际证据，再继续或明确修订原问题。不要重复已经执行的动作。',
    readOnly: false, requiredTools: ['execute_chain'], needsUncertainty: true, requireAction: true },
];
export interface LogEvent { kind: string; time: string; value: any; }
export interface CaseResult { id: string; calls: number; milliseconds: number; finish: { status: string; report: string } | null;
  inputLimit?: number;
  maximumRequests?: number;
  error: { message: string; stack?: string } | null; workspace: CognitiveWorkspaceV1; events: readonly LogEvent[];
  fixtureActions: readonly Action[]; fixtureAttempts: readonly unknown[]; finalPublicObservation: unknown;
  physicalActions: 0; physicalWrites: 0; }
interface History { eventId: string; action: ActionCue; actualObserved: PublicChange[]; observedBefore: Record<string, unknown>;
  currentApplicability: { coreEvidenceSupport: number; querySpecificR2aApplicability: number };
  currentDifferences: unknown[]; counterevidence: string[]; unknown: string[]; }
const change = (subject: string, property: string, before: PublicChange['before'], after: PublicChange['after']): PublicChange =>
  ({ subject, property, before, after, observationIndex: 1, meaning: 'observed-co-occurrence' });
export interface FixtureOptions {
  initialBody?: Record<string, PublicChange['before']>;
  emptyHistory?: boolean;
  actionHasEffect?: boolean;
  noticeAfterFirstAction?: { property: string; before: PublicChange['before']; after: PublicChange['after'] };
}
export const EVIDENCE_BOUNDARY_ROOT = resolve('evidence/evidence-boundary-observation-order-short-loop-v1');
export const EVIDENCE_BOUNDARY_CASES: readonly CaseSpec[] = [
  { id: 'goal-met-secondary-change', mode: 'orient', kind: 'boundary-notice',
    goal: '让当前公开选中槽位变为5，核对本次结果；若收到新通知，一并核对其证据，报告原目标与新变化。不要重复已执行的动作。',
    readOnly: false, requiredTools: ['execute_chain'], needsUncertainty: true, requireAction: true },
  { id: 'goal-unmet-secondary-change', mode: 'orient', kind: 'boundary-notice',
    goal: '尝试让当前公开选中槽位变为8，核对本次实际返回；若收到新通知，一并核对其证据，再报告本次尝试、原目标与新变化。',
    readOnly: false, requiredTools: ['execute_chain'], needsUncertainty: true, requireAction: true },
];
export const EVIDENCE_BOUNDARY_FIXTURES: readonly FixtureOptions[] = [
  { initialBody: { selectedSlot: 1, food: 18 }, emptyHistory: true, actionHasEffect: true,
    noticeAfterFirstAction: { property: 'food', before: 18, after: 17 } },
  { initialBody: { selectedSlot: 2, health: 18 }, emptyHistory: true, actionHasEffect: false,
    noticeAfterFirstAction: { property: 'health', before: 18, after: 16 } },
];
function histories(): History[] {
  const slot = (n: number): ActionCue => ({ kind: 'select-hotbar', parameters: { slot: n }, targetRole: null });
  const wait: ActionCue = { kind: 'wait', parameters: { ticks: 5 }, targetRole: null };
  const use: ActionCue = { kind: 'interact', parameters: {}, targetRole: 'copper_bulb' };
  const rows: [string, PublicChange, ActionCue, number][] = [
    ['slot-a', change('self', 'selectedSlot', 1, 7), slot(7), .8],
    ['slot-b', change('self', 'selectedSlot', 3, 6), slot(6), .8],
    ['health-a', change('self', 'health', 20, 19), wait, 0],
    ['food-a', change('self', 'food', 18, 20), wait, 0],
    ['light-a', change('copper_bulb#1', 'lit', false, true), use, 0],
    ['light-b', change('copper_bulb#2', 'lit', true, false), use, 0],
    ['power-a', change('copper_bulb#1', 'powered', false, true), use, 0],
    ['slot-c', change('self', 'selectedSlot', 5, 7), slot(7), 0],
    ['slot-d', change('self', 'selectedSlot', 6, 7), slot(7), 0],
    ['slot-e', change('self', 'selectedSlot', 8, 7), slot(7), 0],
    ['slot-f', change('self', 'selectedSlot', 2, 7), slot(7), 0],
  ];
  return rows.map(([id, c, action, support]) => ({ eventId: `explicit-test-history-${id}`, action, actualObserved: [c],
    observedBefore: { onGround: true, health: 20 },
    currentApplicability: { coreEvidenceSupport: support, querySpecificR2aApplicability: support },
    currentDifferences: support ? [] : [{ property: 'current-condition', historical: 'observed', current: 'unknown', necessaryCondition: false }],
    counterevidence: support ? [] : ['current-R2A-applicability-unestablished'], unknown: ['historical-result-is-not-current-fact'] }));
}
/** Explicit public interface fixture, NEVER Minecraft/learned-physics evidence. Uses the production matcher verbatim. */
export class SealedToolFixture implements AnalysisTools {
  readonly actions: Action[] = [];
  readonly attempts: unknown[] = [];
  readonly observation: any;
  readonly history: History[];
  readonly timeline: unknown[] = [];
  core!: AnalysisCore;
  #frameReads = 0;
  #interrupted = false;
  constructor(readonly spec: CaseSpec, sealed: unknown, readonly options: FixtureOptions = {}) {
    this.observation = structuredClone(sealed);
    this.observation.body.selectedSlot = 4;
    Object.assign(this.observation.body, options.initialBody);
    this.history = options.emptyHistory ? [] : histories();
    this.observation.testResponseNotice = '封存公开帧的接口测试副本；测试历史/预测/动作均非真实Minecraft物理能力证据。';
  }
  context(): unknown {
    this.#frameReads++;
    // Frozen external fixture schedule: new fact on the second model-context read, not a hidden observe condition.
    if (this.spec.kind === 'changing-observation' && this.#frameReads === 2) {
      this.observation.sequence += 5; this.observation.activeSeconds += .25; this.observation.body.selectedSlot = 3;
      this.timeline.push({ trigger: 'external-context-boundary-2', observation: structuredClone(this.observation) });
    }
    return { publicObservation: structuredClone(this.observation), fixtureOnly: true, physicalWrites: 0, physicalActions: 0 };
  }
  async observe(): Promise<unknown> { return { publicObservation: structuredClone(this.observation) }; }
  async recall(desired: DesiredChange, offset: number): Promise<unknown> {
    const eligible = this.spec.kind === 'cold' ? [] : this.history.filter(h => h.actualObserved.some(c => matches(c, desired)));
    const candidates = eligible.slice(offset, offset + 2).map(h => ({ ...structuredClone(h), actualObserved: h.actualObserved.filter(c => matches(c, desired)) }));
    return { kind: 'historical-observation', testFixture: true, query: desired, total: eligible.length, offset,
      nextOffset: offset + 2 < eligible.length ? offset + 2 : null, candidates, unknown: eligible.length ? [] : ['no-matching-available-experience'] };
  }
  async predict(action: Action, assumptions: readonly string[]): Promise<unknown> {
    validateAction(action);
    const cue: ActionCue = { kind: action.kind, parameters: action.parameters,
      targetRole: action.targetId ? this.observation.objects.find((o: any) => o.id === action.targetId)?.type ?? null : null };
    if (action.targetId) assert(cue.targetRole, 'unknown-or-no-longer-visible-object-alias');
    const matching = this.spec.kind === 'cold' ? [] : this.history.filter(h => canonical(h.action) === canonical(cue) && h.currentApplicability.coreEvidenceSupport > 0);
    return { kind: 'hypothetical-prediction', testFixture: true, action, support: matching.length ? .8 : 0,
      sampleCount: matching.length ? 24 : 0, calibratedProbability: false, observationSequence: this.observation.sequence,
      outcomes: matching.map(h => ({ change: h.actualObserved[0], sampleCount: 20 })),
      unknown: matching.length ? ['prediction-is-not-actual-result'] : ['no-current-physical-support'],
      assumptions: { status: '未模拟的假设', values: assumptions, usedByPhysicalPrediction: false } };
  }
  async execute(actions: readonly Action[]): Promise<unknown> {
    const results = [];
    for (const action of actions) {
      validateAction(action); const before = structuredClone(this.observation);
      if (action.targetId) {
        const target = this.observation.objects.find((o: any) => o.id === action.targetId);
        assert(target, 'unknown-or-no-longer-visible-object-alias');
        const status = action.kind !== 'attack' && this.observation.crosshair !== action.targetId ? 'no-target'
          : Math.hypot(...target.positionFRU) > 4.5 ? 'out-of-reach' : null;
        if (status) { const r = { action, executed: false, status, testFixture: true, startSequence: before.sequence, endSequence: before.sequence };
          this.attempts.push(r); results.push(r); continue; }
      }
      this.actions.push(structuredClone(action)); this.observation.sequence += 5; this.observation.activeSeconds += .25;
      if (this.options.actionHasEffect ?? this.spec.kind !== 'action-no-effect') {
        if (action.kind === 'select-hotbar') this.observation.body.selectedSlot = action.parameters.slot;
        if (action.kind === 'look') { this.observation.body.yawDegrees += Number(action.parameters.yawDegrees); this.observation.body.pitchDegrees += Number(action.parameters.pitchDegrees); }
      }
      const r = { action, executed: true, status: 'completed', testFixture: true, startSequence: before.sequence, endSequence: this.observation.sequence,
        before: before.body, after: structuredClone(this.observation.body), actualChange: canonical(before.body) !== canonical(this.observation.body), physicalWriterInvoked: false };
      this.attempts.push(r); results.push(r);
      if ((this.spec.kind === 'interruption' || this.options.noticeAfterFirstAction) && !this.#interrupted) {
        const changed = this.options.noticeAfterFirstAction ?? { property: 'health', before: 20, after: 19 };
        assert(this.observation.body[changed.property] === changed.before, 'fixture-notice-before-mismatch');
        this.#interrupted = true; this.observation.sequence++; this.observation.activeSeconds += .05;
        this.observation.body[changed.property] = changed.after;
        const notice = { kind: 'unknown-change', subjectId: 'self', sequence: this.observation.sequence, forecastCompletedBeforeSequence: null,
          evidence: { source: 'EXPLICIT_CONSISTENT_TEST_NOTICE_NOT_PRODUCER_PROOF', changes: [change('self', changed.property, changed.before, changed.after)], prediction: null } };
        this.timeline.push({ trigger: 'after-first-executed-action', notice, observation: structuredClone(this.observation) });
        this.core.wake(notice);
        return { results, interrupted: true, remainingActionsNotExecuted: actions.length - results.length,
          testFixture: true, publicObservation: structuredClone(this.observation) };
      }
    }
    return { results, interrupted: false, testFixture: true, publicObservation: structuredClone(this.observation) };
  }
}

const uncertainty = (text: string) => /未知|不确定|不足|缺|不能|未|没有|尚|不可靠|不支持|无法|不保证/.test(text);
const TEST_DISCLAIMER = '\n这是明确标注的公共工具接口测试，返回不证明真实Minecraft物理能力。由你选择工具与模式；请引用本目标的实际工具材料。';
const numberWord = (text: string) => '零一二三四五六七八九'.includes(text) ? '零一二三四五六七八九'.indexOf(text) : Number(text);
function currentSlotClaims(text: string): number[] {
  return [...text.matchAll(/(?:当前|目前|现在|新观察)[^。！？；\n]*?(?:选中槽位|槽位|selectedSlot)(?:\s|读数|显示)*(?:为|是|[:=]|显示为|读数为)\s*(\d+|[零一二三四五六七八])/g)].map(m => numberWord(m[1]!));
}
/** Independent post-hoc checks, not a model tool, corrective prompt or action selector. */
export function scoreCase(spec: CaseSpec, result: CaseResult): { passed: boolean; checks: Record<string, boolean>; failures: string[]; dimensions: unknown } {
  const ends = result.events.filter(e => e.kind === 'tool-end'), requests = result.events.filter(e => e.kind === 'analysis-request');
  const finish = ends.findLast(e => e.value.name === 'finish')?.value.args;
  const refs: string[] = finish?.evidenceRefs ?? [], report = result.finish?.report ?? '';
  const recalled = result.workspace.evidence.filter(e => e.kind === 'historical-experience');
  const recallChanges = recalled.flatMap(e => (e.data as any).candidates?.flatMap((c: any) => c.actualObserved) ?? []);
  const exactMatches = recalled.every(e => ((e.data as any).candidates ?? []).every((h: any) => h.actualObserved.length > 0
    && h.actualObserved.every((c: PublicChange) => matches(c, (e.query as any).desiredChange))));
  const checks: Record<string, boolean> = {
    explicitFinish: result.finish !== null && result.error === null,
    requiredTools: spec.requiredTools.every(name => ends.some(e => e.value.name === name)),
    withinRequestLimit: result.calls <= (result.maximumRequests ?? 12) && requests.every(e => e.value.inputTokens <= (result.inputLimit ?? 6500)),
    realEvidenceReferences: refs.length > 0 && refs.every(ref => result.workspace.evidence.some(e => e.ref === ref)),
    exactQueryResults: exactMatches,
    noActionWhenReadOnly: !spec.readOnly || result.fixtureAttempts.length === 0,
    attemptWhenNeeded: !spec.requireAction || result.fixtureAttempts.length > 0,
    noPhysicalClaimsFromTestTool: result.physicalActions === 0 && result.physicalWrites === 0,
    uncertaintyWhenNeeded: !spec.needsUncertainty || uncertainty(report),
  };
  if (spec.kind === 'observable') {
    const current = (result.finalPublicObservation as any).body.selectedSlot, claims = currentSlotClaims(report);
    checks.currentFactNotHistoricalAfter = claims.length > 0 && claims.every(n => n === current)
      && refs.some(ref => result.workspace.evidence.some(e => e.ref === ref && e.kind === 'public-observation' && (e.data as any).body.selectedSlot === current));
    checks.historyActuallyRead = recallChanges.some((c: PublicChange) => c.subject === 'self' && c.property === 'selectedSlot' && c.after === 7)
      && refs.some(ref => recalled.some(e => e.ref === ref)) && /历史|过去|曾|之前/.test(report) && /7|七/.test(report);
  }
  if (spec.kind === 'supported-history') {
    checks.requestedOtherSubjectAndProperty = recalled.some(e => {
      const q = (e.query as any).desiredChange;
      return q.property === 'lit' && q.value === true && (q.subject === undefined || q.subject === 'copper_bulb' || q.subject === 'copper_bulb#1')
        && (e.data as any).candidates.some((h: any) => h.actualObserved.some((c: PublicChange) => c.subject.startsWith('copper_bulb#') && c.property === 'lit' && c.after === true));
    });
    checks.historicalNotCurrentGuarantee = uncertainty(report) && /历史|过去|曾/.test(report) && refs.some(ref => recalled.some(e => e.ref === ref));
  }
  if (spec.kind === 'supported-prediction') checks.supportedPlanOrExplicitUnknown = result.workspace.evidence.some(e => e.kind === 'prediction'
    && refs.includes(e.ref) && (uncertainty(report) || ((e.data as any).action?.kind === 'select-hotbar' && (e.data as any).action?.parameters.slot === 6 && /6|六/.test(report))));
  if (spec.kind === 'action-no-effect') checks.attemptVsGoalReported = (result.finalPublicObservation as any).body.selectedSlot === 4
    && /未|无效|没有|不满足|失败/.test(report) && refs.some(ref => result.workspace.evidence.some(e => e.ref === ref && e.kind === 'actual-action'));
  if (spec.kind === 'cold') {
    checks.modelDefinedQuestion = result.workspace.tasks.some(t => t.question.trim().length > 0);
    checks.notZeroAngleNoOp = result.fixtureActions.some(a => a.kind !== 'look' || a.parameters.yawDegrees !== 0 || a.parameters.pitchDegrees !== 0);
    checks.actualReturnCited = refs.some(ref => result.workspace.evidence.some(e => e.ref === ref && e.kind === 'actual-action'));
  }
  if (spec.kind === 'changing-observation') {
    checks.newFactActuallyDelivered = requests.some(e => canonical(e.value.request).includes('\\"selectedSlot\\":3'));
    checks.newFactCorrectedNote = /3|三/.test(report) && /4|四|旧|先前/.test(report)
      && result.workspace.tasks.some(t => /3|三/.test(t.conclusion)) && refs.some(ref => result.workspace.evidence.some(e => e.ref === ref
        && e.kind === 'public-observation' && (e.data as any).body.selectedSlot === 3));
  }
  if (spec.kind === 'paged-history') {
    const early = recalled[0];
    checks.earlierMaterialReadBack = !!early && ends.some(e => e.value.name === 'read_context' && e.value.args.reference === early.ref);
    checks.allClaimedHistoryPagesRead = recalled.some(e => (e.data as any).offset === 4 && (e.data as any).nextOffset === null);
    checks.modelOrganizedTasks = result.workspace.tasks.length > 1;
  }
  if (spec.kind === 'interruption') {
    const notice = result.workspace.evidence.find(e => e.kind === 'attention');
    checks.noticeReachedNextAnalysis = !!notice && requests.some(e => canonical(e.value.request).includes(notice.ref));
    checks.noticeFactsAddressed = !!notice && (refs.includes(notice.ref) || result.workspace.tasks.some(t => t.evidenceRefs.includes(notice.ref))) && /19|生命|health/.test(report);
    checks.originalQuestionRetained = result.workspace.originalGoal === spec.goal + TEST_DISCLAIMER;
    checks.noActionRepeated = result.fixtureActions.filter(a => a.kind === 'select-hotbar' && a.parameters.slot === 7).length <= 1;
  }
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return { passed: failures.length === 0, checks, failures, dimensions: {
    taskJudgment: { finish: result.finish, failures: failures.filter(k => !['exactQueryResults', 'noActionWhenReadOnly', 'withinRequestLimit'].includes(k)) },
    toolSemantics: { exactQueryResults: exactMatches, attempts: result.fixtureAttempts.length, executed: result.fixtureActions.length },
    modeUse: { testInitialMode: spec.mode, requestedModes: requests.map(e => e.value.mode), autonomousRoutingProven: false },
    continuity: { originalGoalPreserved: result.workspace.originalGoal === spec.goal + TEST_DISCLAIMER,
      readContextCalls: ends.filter(e => e.value.name === 'read_context').length },
  } };
}

export async function sourceIdentity(): Promise<any> {
  const files: { path: string; sha256: string }[] = [];
  for (const root of ['src', 'test']) for (const f of await readdir(root, { recursive: true })) if (/\.(ts|mjs|py)$/.test(f)) {
    const path = resolve(root, f); files.push({ path: relative(process.cwd(), path).replaceAll('\\', '/'), sha256: await fileSha(path) });
  }
  for (const path of ['package.json', 'package-lock.json', 'kairos.config.json']) files.push({ path, sha256: await fileSha(path) });
  files.sort((a, b) => a.path.localeCompare(b.path, 'en')); return { version: 'AnalysisHarnessSourceIdentityV1', files, sha256: sha(files) };
}
async function sealedFrame(): Promise<{ observation: unknown; source: unknown }> {
  const stream = createReadStream(SOURCE_FRAME_PATH), lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) { const frame = JSON.parse(line).value as Observation;
    if (frame.sequence >= 40) return { observation: new PublicObjectAliases().present(frame), source: { path: SOURCE_FRAME_PATH, sequence: frame.sequence, rawLineSha256: sha(line), rawLine: line } };
  } } finally { lines.close(); stream.destroy(); }
  throw new Error('sealed-public-frame-missing');
}
export async function auditOldQueries(): Promise<unknown> {
  const queries: unknown[] = [];
  for (const item of await readdir(OLD_RUN, { withFileTypes: true })) if (item.isDirectory()) {
    const result = JSON.parse(await readFile(resolve(OLD_RUN, item.name, 'RESULT.json'), 'utf8')) as CaseResult;
    for (const event of result.events.filter(e => e.kind === 'tool-end' && e.value.name === 'recall')) {
      const raw = event.value.result.summary;
      const c: PublicChange[] = (raw.candidates ?? []).flatMap((h: any) => h.actualObserved);
      queries.push({ case: item.name, query: event.value.args.desiredChange, oldReturned: c,
        matchesUnderProduction: c.filter(change => matches(change, event.value.args.desiredChange)),
        correctExactQueryResults: c.map(change => ({ subject: change.subject, property: change.property, value: change.after,
          matches: matches(change, { subject: change.subject, property: change.property, value: change.after }) })) });
    }
  }
  return { queries, calls: queries.length, nonempty: queries.filter((q: any) => q.oldReturned.length).length,
    mismatchedNonempty: queries.filter((q: any) => q.oldReturned.length && q.matchesUnderProduction.length === 0).length };
}
/** Reuse the exact failed public materials, not a synthetic short replacement. No model generation. */
export async function audit6814(actualWire: any, config: Awaited<ReturnType<typeof loadConfiguration>>): Promise<void> {
  const path = resolve(OLD_RUN, 'plan-supported/RESULT.json'), old = JSON.parse(await readFile(path, 'utf8')) as CaseResult;
  const w = new CognitiveWorkspace(); w.startGoal(old.workspace.originalGoal, old.workspace.originalConstraints);
  for (const e of old.workspace.evidence) w.addEvidence(e.kind, e.source, e.data, e.query, e.observationSequence, e.ref === old.workspace.latestToolEvidenceRef);
  w.update({ mode: old.workspace.mode, currentTaskId: old.workspace.currentTaskId,
    tasks: old.workspace.tasks.map(({ provenance: _p, ...task }) => task) });
  const last = old.events.findLast(e => e.kind === 'tool-end' && e.value.name === 'execute_chain')!;
  const request = { ...actualWire, messages: [{ role: 'system', content: `${SYSTEM_PROMPT}\n${MODE_PROMPTS.plan}` },
    { role: 'user', content: w.material({ fixtureOnly: true, physicalActions: 0, physicalWrites: 0 }).text },
    { role: 'assistant', content: null, tool_calls: [{ id: 'replay-last-tool', type: 'function', function: { name: last.value.name, arguments: canonical(last.value.args) } }] },
    { role: 'tool', tool_call_id: 'replay-last-tool', content: canonical({ evidenceRef: old.workspace.latestToolEvidenceRef, materialLocation: '当前工作区材料（只存一份）' }) }] };
  const inputTokens = await realInputTokens(request, config.analysis);
  await saveJson(resolve(RUN_ROOT, '6814_MATERIAL_REPLAY.json'), { source: path, sourceSha256: await fileSha(path),
    oldReportedInputTokens: 6814, inputTokens, maximumInputTokens: config.analysis.maximumInputTokens ?? 6500, generationCalls: 0, request,
    preservedEvidenceRefs: w.snapshot().evidence.map(e => e.ref), storedDataUnchanged: old.workspace.evidence.every((e, i) => sha(e.data) === sha(w.snapshot().evidence[i]!.data)),
    acquisitionWallClocksRegeneratedButNotSent: true });
  assert(inputTokens <= (config.analysis.maximumInputTokens ?? 6500), '6814-real-material-still-over-budget');
}
export async function verifyShortLoopGate(): Promise<void> {
  const prior = JSON.parse(await readFile(resolve(RUN_ROOT, 'PROTOCOL.json'), 'utf8'));
  const protocol = JSON.parse(await readFile(resolve(EVIDENCE_BOUNDARY_ROOT, 'INCREMENTAL_PROTOCOL.json'), 'utf8'));
  const config = await loadConfiguration();
  assert(prior.casesSha256 === sha(CASES) && prior.schemaSha256 === sha(TOOL_SCHEMAS) && prior.configSha256 === sha(config)
    && prior.promptSha256 === protocol.priorPromptSha256, 'short-loop-prior-contract-mismatch');
  assert(protocol.casesSha256 === sha(EVIDENCE_BOUNDARY_CASES) && protocol.fixturesSha256 === sha(EVIDENCE_BOUNDARY_FIXTURES)
    && protocol.promptSha256 === sha({ SYSTEM_PROMPT, MODE_PROMPTS })
    && protocol.schemaSha256 === sha(TOOL_SCHEMAS) && protocol.configSha256 === sha(config), 'short-loop-current-contract-mismatch');
  const manifestPath = resolve(HARNESS_ROOT, 'EVIDENCE_MANIFEST.sha256');
  assert(await fileSha(manifestPath) === protocol.priorEvidenceManifestSha256, 'short-loop-prior-evidence-changed');
  const manifest = new Map((await readFile(manifestPath, 'utf8')).trim().split(/\r?\n/).map(line => [line.slice(66), line.slice(0, 64)]));
  // Seven prior questions retain their original prompt identity. The eighth was NOT adjudicated a pass.
  for (const [index, spec] of CASES.slice(0, 7).entries()) {
    const path = resolve(RUN_ROOT, spec.id, 'RESULT.json');
    assert(await fileSha(path) === manifest.get(`questions-002/${spec.id}/RESULT.json`), 'short-loop-prior-result-changed');
    const result = JSON.parse(await readFile(path, 'utf8')) as CaseResult, score = scoreCase(spec, result);
    if (index === 0) {
      assert(await fileSha(protocol.currentFactAdjudication.path) === protocol.currentFactAdjudication.sha256,
        'short-loop-current-fact-adjudication-changed');
      assert(score.failures.every(key => key === 'currentFactNotHistoricalAfter'), 'short-loop-unadjudicated-prior-failure');
    } else assert(score.passed, `short-loop-prior-question-not-passed:${spec.id}`);
  }
  for (const spec of EVIDENCE_BOUNDARY_CASES) {
    const directory = resolve(EVIDENCE_BOUNDARY_ROOT, 'questions', spec.id);
    const result = JSON.parse(await readFile(resolve(directory, 'RESULT.json'), 'utf8')) as CaseResult;
    const review = JSON.parse(await readFile(resolve(directory, 'SEMANTIC_REVIEW.json'), 'utf8'));
    assert(result.inputLimit === (config.analysis.maximumInputTokens ?? 6500), 'short-loop-input-budget-mismatch');
    assert(result.maximumRequests === 8 && scoreCase(spec, result).passed, `short-loop-new-question-not-passed:${spec.id}`);
    assert(review.resultSha256 === await fileSha(resolve(directory, 'RESULT.json'))
      && review.rawSha256 === await fileSha(resolve(directory, 'RAW.jsonl'))
      && ['goalOutcomeDistinguished', 'noticeEvidenceAddressed', 'causalUncertaintyPreserved', 'goalRelevanceNotCausalProof', 'noUnrequestedReplay']
        .every(key => review.checks[key] === true), 'short-loop-new-semantic-review-missing-or-failed');
  }
}
export async function runCase(spec: CaseSpec, observation: unknown, config: Awaited<ReturnType<typeof loadConfiguration>>, minimal = false,
  beforeRequest?: () => void, options: { outputRoot?: string; maximumRequests?: number; fixture?: FixtureOptions } = {}): Promise<CaseResult> {
  const maximumRequests = options.maximumRequests ?? 12;
  const directory = resolve(options.outputRoot ?? RUN_ROOT, spec.id + (minimal ? '-minimal-context-comparison' : '')); await mkdir(directory);
  const events: LogEvent[] = [], log = createWriteStream(resolve(directory, 'RAW.jsonl'), { flags: 'wx' });
  const fixture = new SealedToolFixture(spec, observation, options.fixture);
  // Permitted comparison changes context burden only. Same relevant facts, goal, tools, matching and body semantics.
  if (minimal) {
    fixture.observation.objects = fixture.observation.objects.filter((o: any) => spec.kind === 'supported-history' && o.type === 'copper_bulb');
    fixture.observation.publicFieldsOmittedForContextComparison = '无关对象省略；不是宣称它们消失。';
  }
  await saveJson(resolve(directory, 'FIXTURE.json'), { publicObservation: fixture.observation, history: fixture.history,
    schedule: options.fixture ?? { changingObservation: 'context-read-2:slot=3', interruption: 'after-first-executed-action:health=19;stop-unexecuted-tail' },
    explicitlyNotPhysicalEvidence: true, testInitialMode: spec.mode, minimalContextComparison: minimal });
  const record = (kind: string, value: unknown) => { const e = { kind, time: new Date().toISOString(), value }; events.push(e); log.write(canonical(e) + '\n'); };
  const core = new AnalysisCore(config.analysis, fixture, record, { initialModeForTest: spec.mode, minimalContextForTest: minimal,
    beforeModelRequest: count => { assert(count < maximumRequests, `evaluation-request-limit:${maximumRequests}`); beforeRequest?.(); } });
  fixture.core = core;
  const started = performance.now(); let finish: CaseResult['finish'] = null, error: CaseResult['error'] = null;
  try { finish = await core.run(spec.goal + TEST_DISCLAIMER); } catch (e) { error = { message: (e as Error).message, stack: (e as Error).stack }; }
  finally { await new Promise<void>(resolve => log.end(resolve)); }
  const result: CaseResult = { id: spec.id, calls: core.calls, milliseconds: performance.now() - started, finish, error,
    inputLimit: config.analysis.maximumInputTokens ?? 6500, maximumRequests,
    workspace: core.workspace.snapshot(), events, fixtureActions: fixture.actions, fixtureAttempts: fixture.attempts,
    finalPublicObservation: fixture.observation, physicalActions: 0, physicalWrites: 0 };
  await saveJson(resolve(directory, 'RESULT.json'), result);
  await saveJson(resolve(directory, 'FIXTURE_TIMELINE.json'), fixture.timeline);
  const score = scoreCase(spec, result); await saveJson(resolve(directory, 'SCORE.json'), score);
  console.log(canonical({ id: spec.id, minimal, calls: core.calls, milliseconds: result.milliseconds, error: error?.message ?? null,
    passed: score.passed, failures: score.failures, finish, fixtureAttempts: fixture.attempts.length, fixtureActions: fixture.actions.length,
    modes: events.filter(e => e.kind === 'analysis-request').map(e => e.value.mode), inputTokens: events.filter(e => e.kind === 'analysis-request').map(e => e.value.inputTokens) }));
  return result;
}
export async function runQualification(): Promise<void> {
  const disk = await statfs('D:/'); assert(disk.bavail * disk.bsize > 2 * 1024 ** 3, 'D-disk-insufficient-space');
  await mkdir(RUN_ROOT); // Exclusive evidence destination: no silent rerun/overwrite.
  const config = await loadConfiguration(), identity = await sourceIdentity();
  const priorFailure = JSON.parse(await readFile(resolve(PROTOCOL_FAILURE_RUN, 'SUMMARY.json'), 'utf8'));
  assert(priorFailure.completedRequiredCases === 1 && priorFailure.cases[0]?.failureClass === 'configuration-or-protocol-error',
    'not-a-protocol-repair-continuation');
  const priorCalls = priorFailure.cases.reduce((sum: number, r: any) => sum + r.calls, 0);
  let requestsStarted = priorCalls;
  const beforeRequest = () => { assert(requestsStarted < 116, 'whole-experiment-generation-ceiling:116'); requestsStarted++; };
  const prior = JSON.parse(await readFile(REUSED_PROTOCOL, 'utf8'));
  assert(prior.casesSha256 === sha(CASES) && prior.promptSha256 === sha({ SYSTEM_PROMPT, MODE_PROMPTS })
    && prior.schemaSha256 === sha(TOOL_SCHEMAS) && sha(prior.fixtureHistories) === sha(histories()), 'reasoning-comparison-contract-changed');
  const sealed = { observation: prior.fixturePublicBase, source: prior.sealedPublicSource };
  await saveJson(resolve(RUN_ROOT, 'SOURCE_IDENTITY.json'), identity);
  await saveJson(resolve(RUN_ROOT, 'PROTOCOL.json'), { version: 'DeepSeekAnalysisBackendV1', cases: CASES, casesSha256: sha(CASES),
    actualModelPerCaseMaximum: 12, realMinecraftAllowed: false, scoringAfterRunOnly: true, testInitialModes: CASES.map(c => c.mode),
    promptSha256: sha({ SYSTEM_PROMPT, MODE_PROMPTS }), schemaSha256: sha(TOOL_SCHEMAS), config, configSha256: sha(config),
    phases: ['first-three-once', 'remaining-five-only-if-three-pass', 'short-only-if-eight-pass'], maximumDistinctFailureComparisons: 0,
    priorProtocolFailure: { path: PROTOCOL_FAILURE_RUN, calls: priorCalls, preserved: true, semanticRerun: false },
    reusedProtocol: { path: REUSED_PROTOCOL, sha256: await fileSha(REUSED_PROTOCOL) },
    fixturePublicBase: sealed.observation, fixtureHistories: histories(), sealedPublicSource: sealed.source });
  await saveJson(resolve(RUN_ROOT, 'PROMPTS_AND_SCHEMAS.json'), { SYSTEM_PROMPT, MODE_PROMPTS, TOOL_SCHEMAS });
  const services = new Services(config, resolve('tmp/analysis-deepseek-backend-v1'), RUN_ROOT);
  const results: CaseResult[] = [];
  const failureClass = (r: CaseResult): string | null => {
    if (r.events.some(e => e.kind === 'analysis-response' && (e.value.rawStopReason === 'length' || e.value.stopReason === 'length'))) return 'output-length-limit';
    if (/timeout|timed out/i.test(r.error?.message ?? '')) return 'request-time-limit';
    if (/credential|401|402|403|model.*not.*found/i.test(r.error?.message ?? '')) return 'provider-permission-or-model-unavailable';
    if (/llama-context-endpoint|ECONNREFUSED|connection error|503|502/i.test(r.error?.message ?? '')) return 'service-error';
    if (/thinking-mismatch|thinking-not-enabled|output-budget-mismatch|total-context-budget|reasoning-transport|DeepSeek-wire-option|tokenizer|actual-token-budget/.test(r.error?.message ?? '')) return 'configuration-or-protocol-error';
    if (r.error && !/evaluation-request-limit/.test(r.error.message)) return 'interface-or-runtime-error';
    return scoreCase(CASES.find(c => c.id === r.id)!, r).passed ? null : 'model-task-or-interface-use';
  };
  try {
    await services.startAnalysis();
    for (const spec of CASES.slice(0, 3)) {
      const r = await runCase(spec, sealed.observation, config, false, beforeRequest); results.push(r);
      const category = failureClass(r);
      if (r.error && !/evaluation-request-limit/.test(r.error.message)) throw new Error(`${category}:${spec.id}:${r.error.message}`);
    }
    const failures = results.filter(r => !scoreCase(CASES.find(c => c.id === r.id)!, r).passed);
    if (failures.length) { process.exitCode = 1; return; }
    for (const spec of CASES.slice(3)) {
      const r = await runCase(spec, sealed.observation, config, false, beforeRequest); results.push(r);
      if (!scoreCase(spec, r).passed) { process.exitCode = 1; break; }
    }
  } finally {
    await services.stop();
    const finalIdentity = await sourceIdentity();
    await saveJson(resolve(RUN_ROOT, 'SUMMARY.json'), { completedRequiredCases: results.length,
      requiredPassed: results.filter(r => scoreCase(CASES.find(c => c.id === r.id)!, r).passed).length,
      cases: results.map(r => ({ id: r.id, calls: r.calls, failureClass: failureClass(r), ...scoreCase(CASES.find(c => c.id === r.id)!, r) })),
      comparisons: [], remainingFiveNotRun: results.length <= 3,
      priorProtocolFailureCalls: priorCalls, totalGenerationCalls: priorCalls + results.reduce((n, r) => n + r.calls, 0),
      sourceUnchanged: sha(finalIdentity) === sha(identity), productionPhysicsTested: false, realShortLoopStarted: false,
      modelIdentity: config.analysis.provider === 'deepseek' ? { provider: 'deepseek', requestedModel: config.analysis.model,
        remoteWeightsLocallyVerifiable: false } : { modelHash: config.analysis.modelSha256, llamaHash: config.analysis.llamaSha256 },
      attentionProducerAccepted: false,
      physicalActions: 0, physicalWrites: 0 });
    const firstRequest = results.flatMap(r => r.events).find(e => e.kind === 'analysis-request');
    const firstResponse = results.flatMap(r => r.events).find(e => e.kind === 'analysis-response');
    if (firstRequest && firstResponse) await saveJson(resolve(RUN_ROOT, 'FIRST_REQUEST_TOKEN_COMPARISON.json'), {
      localOfficialRenderedTokens: firstRequest.value.inputTokens, counter: firstRequest.value.tokenCounter,
      serverInputTokens: firstResponse.value.usage.input + firstResponse.value.usage.cacheRead + firstResponse.value.usage.cacheWrite,
      serverUsage: firstResponse.value.usage, extraGenerationRequests: 0,
      note: 'Local official-renderer count and actual hosted API usage are separately reported, not presumed identical.' });
    assert(sha(finalIdentity) === sha(identity), 'qualification-source-changed-during-run');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runQualification().catch(error => { console.error(error); process.exitCode = 1; });
