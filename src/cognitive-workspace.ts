import { assert, canonical, sha } from './util.js';

export const COGNITIVE_MODES = ['orient', 'recall', 'plan', 'act', 'explore', 'review'] as const;
export type CognitiveMode = typeof COGNITIVE_MODES[number];
export type TaskStatus = 'open' | 'active' | 'paused' | 'completed' | 'abandoned';
export interface CognitiveTaskV1 {
  readonly id: string;
  readonly parentId: string | null;
  readonly objective: string;
  readonly question: string;
  readonly completionCriteria: readonly string[];
  readonly status: TaskStatus;
  readonly conclusion: string;
  readonly hypotheses: readonly string[];
  readonly unknowns: readonly string[];
  readonly attemptedBranches: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly provenance: 'model-note';
}
export type TaskPatch = { id: string } & Partial<Omit<CognitiveTaskV1, 'id' | 'provenance'>>;
export interface IntentUpdateV1 {
  readonly mode?: CognitiveMode;
  readonly currentTaskId?: string;
  readonly tasks?: readonly TaskPatch[];
  readonly acknowledgeAttention?: readonly string[];
}
export type EvidenceKind = 'public-observation' | 'historical-experience' | 'prediction' | 'actual-action' | 'attention';
export interface CognitiveEvidenceV1 {
  readonly version: 'CognitiveEvidenceV1';
  readonly ref: string;
  readonly goalId: string;
  readonly taskId: string;
  readonly kind: EvidenceKind;
  readonly source: string;
  readonly recordedAt: string;
  readonly observationSequence: number | null;
  /** Acquisition/query time. Unknown remains null; it is not the returned history's occurrence time. */
  readonly activeSeconds: number | null;
  readonly query: unknown;
  readonly data: unknown;
  readonly sha256: string;
}
export interface CognitiveWorkspaceV1 {
  readonly version: 'CognitiveWorkspaceV1';
  readonly goalId: string;
  readonly originalGoal: string;
  readonly originalConstraints: readonly string[];
  readonly mode: CognitiveMode;
  readonly currentTaskId: string;
  readonly tasks: readonly CognitiveTaskV1[];
  readonly evidence: readonly CognitiveEvidenceV1[];
  readonly latestObservationRef: string | null;
  readonly latestToolEvidenceRef: string | null;
  readonly pendingAttention: readonly string[];
}

const emptyTask = (id: string, objective: string, parentId: string | null): CognitiveTaskV1 => ({
  id, parentId, objective, question: '', completionCriteria: [], status: 'open', conclusion: '',
  hypotheses: [], unknowns: [], attemptedBranches: [], evidenceRefs: [], provenance: 'model-note',
});
const publicTask = (task: CognitiveTaskV1, originalGoal: string) => {
  const { objective, ...fields } = task;
  return { ...fields, ...(objective === originalGoal ? { objectiveReference: 'originalUserGoal' } : { objective }) };
};

const pick = (value: any, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys
  .filter(key => value?.[key] !== undefined).map(key => [key, structuredClone(value[key])]));
const SUPPORT_FIELDS = ['eligibleHistoricalCount', 'activeR1Count', 'activeR2Count', 'eligibleLinkCoverage',
  'distinctR2BasinCount', 'r2IndependentSupport', 'r2PhysicalSupport', 'r2aMatchedCoverage', 'relationReliability',
  'contextMatch', 'residualMatch', 'querySpecificR2aApplicability', 'conditionalWeightConcentration', 'coreEvidenceSupport', 'calibratedProbability'];

/** Presentation only: no inference, thresholds, result substitution or mutation of stored evidence. */
function publicPrediction(value: any): unknown {
  if (!value || typeof value !== 'object') return value;
  const result = pick(value, ['kind', 'action', 'support', 'sampleCount', 'calibratedProbability', 'unknown', 'assumptions',
    'observationSequence', 'activeSeconds', 'createdAt', 'originSequence', 'completedSequence', 'outcomes', 'omittedOutcomeCount', 'testFixture']);
  if (value.evidence) result.evidence = pick(value.evidence.evidence ?? value.evidence, SUPPORT_FIELDS);
  if (Array.isArray(value.samples)) {
    result.sampleCount = value.samples.length;
    const counts = new Map<string, { change: unknown; sampleCount: number }>();
    for (const sample of value.samples) {
      const unique = new Map<string, unknown>();
      for (const read of sample.readout ?? []) for (const change of read.changes ?? []) unique.set(canonical(change), change);
      for (const [key, change] of unique) { const item = counts.get(key) ?? { change, sampleCount: 0 }; item.sampleCount++; counts.set(key, item); }
    }
    result.outcomes = [...counts.values()];
  }
  return result;
}
export function publicEvidenceData(kind: EvidenceKind, raw: any): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  if (kind === 'public-observation') return structuredClone(raw);
  if (kind === 'historical-experience') {
    const result = pick(raw, ['kind', 'observationSequence', 'activeSeconds', 'total', 'offset', 'nextOffset', 'query', 'unknown', 'buffered', 'testFixture', 'condition', 'support', 'past', 'applicable']);
    if (Array.isArray(raw.candidates)) result.candidates = raw.candidates.map((candidate: any) => ({
      ...pick(candidate, ['eventId', 'action', 'actualObserved', 'actualObservedScope', 'historicalOccurrence',
        'observedBefore', 'currentDifferences', 'counterevidence', 'unknown']),
      currentApplicability: Array.isArray(candidate.currentApplicability?.contributions) ? {
        ...pick(candidate.currentApplicability, ['scope', 'calibratedProbability']),
        contributions: candidate.currentApplicability.contributions.map((contribution: any) => ({
          ...pick(contribution, ['r2Activation', 'coactivationStrength', 'r3CausalScore', 'causalMultiplier', 'weight']),
          matchedRelations: (contribution.matchedRelations ?? []).map((relation: any) =>
            pick(relation, ['state', 'relationReliability', 'contextMatch', 'residualMatch', 'relationApplicability'])),
        })),
      } : pick(candidate.currentApplicability, SUPPORT_FIELDS), // Old evidence stays readable, not relabelled as new trace evidence.
      ...(candidate.actionAggregateSupport ? { actionAggregateSupport: pick(candidate.actionAggregateSupport, SUPPORT_FIELDS) } : {}),
    }));
    return result;
  }
  if (kind === 'prediction') return publicPrediction(raw);
  if (kind === 'actual-action') {
    const result = pick(raw, ['results', 'observationSequence', 'activeSeconds', 'interrupted', 'remainingActionsNotExecuted', 'reason', 'stop', 'notAnImpossibilityClaim',
      'publicObservation', 'testFixture', 'executed', 'status', 'state']);
    if (Array.isArray(raw.results)) result.results = raw.results.map((r: any) => ({
      ...pick(r, ['eventId', 'action', 'executed', 'status', 'startSequence', 'endSequence', 'startActiveSeconds', 'endActiveSeconds', 'observationWindow', 'terminationReason',
        'before', 'after', 'actualChange', 'publicChanges', 'testFixture']),
      ...(r.learning ? { learning: pick(r.learning, ['writes', 'buffered']) } : {}),
    }));
    return result;
  }
  // The producer remains unchanged; only its public facts/forecast are exposed, never raw kernels or coordinates.
  const notice = pick(raw, ['kind', 'subjectId', 'sequence', 'forecastCompletedBeforeSequence', 'changes']);
  if (raw.prediction !== undefined) notice.prediction = publicPrediction(raw.prediction);
  if (raw.evidence !== undefined) notice.evidence = Array.isArray(raw.evidence) ? structuredClone(raw.evidence) : {
    ...pick(raw.evidence, ['source', 'changes', 'unknown', 'originalQuestionStillUnanswered']),
    ...(raw.evidence.prediction !== undefined ? { prediction: publicPrediction(raw.evidence.prediction) } : {}),
  };
  return notice;
}
const pointer = (part: string) => part.replaceAll('~', '~0').replaceAll('/', '~1');
export interface ReadContextArguments {
  readonly reference: string;
  readonly field?: string;
  readonly offset?: number;
  readonly limit?: number;
}
/** The analysis boundary supplies its wire presentation; stored evidence stays logical and immutable. */
export type ReadContextArgumentPresenter = (arguments_: ReadContextArguments) => unknown;
const logicalReadContextArguments: ReadContextArgumentPresenter = arguments_ => arguments_;
function pageHint(present: ReadContextArgumentPresenter, arguments_: ReadContextArguments) {
  return { tool: 'read_context', arguments: present(arguments_) };
}
/** Omitted public material is explicitly addressable, not silently truncated. */
function preview(value: any, reference: string, present: ReadContextArgumentPresenter, path = ''): unknown {
  if (Array.isArray(value)) {
    if (value.length <= 4) return value.map((v, i) => preview(v, reference, present, `${path}/${i}`));
    return { items: value.slice(0, 4).map((v, i) => preview(v, reference, present, `${path}/${i}`)), total: value.length,
      coveredRange: [0, 4], more: pageHint(present, { reference, field: path, offset: 4, limit: 4 }) };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value), shown = Object.fromEntries(entries.slice(0, 12)
      .map(([key, v]) => [key, preview(v, reference, present, `${path}/${pointer(key)}`)]));
    return entries.length > 12 ? { ...shown, moreFields: { ...pageHint(present, { reference, field: path, offset: 12, limit: 12 }), total: entries.length } } : shown;
  }
  return value;
}

/** Temporary goal-local notes and immutable tool material, never a physical memory or planner. */
export class CognitiveWorkspace {
  #state: CognitiveWorkspaceV1 | null = null;
  #goalNumber = 0;
  #evidenceNumber = 0;
  constructor(private readonly presentReadContextArguments: ReadContextArgumentPresenter = logicalReadContextArguments) {}
  get active(): boolean { return this.#state !== null; }
  get mode(): CognitiveMode { return this.state().mode; }
  get currentTaskId(): string { return this.state().currentTaskId; }
  private state(): CognitiveWorkspaceV1 { assert(this.#state, 'workspace-no-current-goal'); return this.#state; }
  startGoal(originalGoal: string, originalConstraints: readonly string[] = []): void {
    assert(originalGoal.trim().length > 0, 'workspace-empty-goal');
    this.#evidenceNumber = 0;
    this.#state = { version: 'CognitiveWorkspaceV1', goalId: `g${++this.#goalNumber}`, originalGoal,
      originalConstraints: structuredClone(originalConstraints), mode: 'orient', currentTaskId: 't0',
      // Only the user-supplied root exists initially. No generated subgoals or success conditions.
      tasks: [emptyTask('t0', originalGoal, null)], evidence: [], latestObservationRef: null,
      latestToolEvidenceRef: null, pendingAttention: [] };
  }
  snapshot(): CognitiveWorkspaceV1 { return structuredClone(this.state()); }
  update(update: IntentUpdateV1): unknown {
    const old = this.state(), tasks = new Map(old.tasks.map(task => [task.id, task]));
    assert(Object.keys(update).every(key => ['mode', 'currentTaskId', 'tasks', 'acknowledgeAttention'].includes(key)), 'workspace-unknown-update-field');
    if (update.mode !== undefined) assert(COGNITIVE_MODES.includes(update.mode), 'workspace-unknown-mode');
    for (const patch of update.tasks ?? []) {
      assert(/^t[A-Za-z0-9_-]{0,23}$/.test(patch.id), 'workspace-invalid-task-id');
      assert(Object.keys(patch).every(key => ['id', 'parentId', 'objective', 'question', 'completionCriteria', 'status', 'conclusion', 'hypotheses', 'unknowns', 'attemptedBranches', 'evidenceRefs'].includes(key)), 'workspace-task-not-a-model-note');
      if (!tasks.has(patch.id)) assert(typeof patch.objective === 'string' && patch.objective.trim().length > 0, 'workspace-new-task-needs-model-objective');
      const next = { ...(tasks.get(patch.id) ?? emptyTask(patch.id, patch.objective!, patch.parentId ?? null)), ...structuredClone(patch) };
      assert(['open', 'active', 'paused', 'completed', 'abandoned'].includes(next.status), 'workspace-invalid-status');
      for (const ref of next.evidenceRefs) this.evidence(ref);
      tasks.set(patch.id, next);
    }
    for (const task of tasks.values()) {
      const seen = new Set([task.id]); let parent = task.parentId;
      while (parent !== null) {
        assert(tasks.has(parent) && !seen.has(parent), 'workspace-invalid-parent-or-cycle');
        seen.add(parent); parent = tasks.get(parent)!.parentId;
      }
    }
    const currentTaskId = update.currentTaskId ?? old.currentTaskId;
    assert(tasks.has(currentTaskId), 'workspace-unknown-current-task');
    const attentionRefs = [...new Set(update.acknowledgeAttention ?? [])];
    for (const ref of attentionRefs) assert(this.evidence(ref).kind === 'attention', 'workspace-unknown-pending-attention');
    const acknowledgedAttention = attentionRefs.filter(ref => old.pendingAttention.includes(ref));
    const alreadyAcknowledgedAttention = attentionRefs.filter(ref => !old.pendingAttention.includes(ref));
    this.#state = { ...old, mode: update.mode ?? old.mode, currentTaskId, tasks: [...tasks.values()],
      pendingAttention: old.pendingAttention.filter(ref => !attentionRefs.includes(ref)) };
    return { storedAs: 'model-note', mode: this.mode, currentTaskId, updatedTaskIds: (update.tasks ?? []).map(t => t.id),
      acknowledgedAttention, alreadyAcknowledgedAttention };
  }
  evidence(ref: string): CognitiveEvidenceV1 {
    const found = this.state().evidence.find(e => e.ref === ref);
    assert(found, `context-reference-not-in-current-goal:${ref}`);
    assert(found.sha256 === sha({ ...found, sha256: undefined }), 'context-evidence-integrity-error');
    return structuredClone(found);
  }
  read(reference: string): unknown {
    const task = this.state().tasks.find(t => t.id === reference);
    if (task) return structuredClone(task);
    return this.evidence(reference);
  }
  /** One unpaged public document per reference. All presentation and JSON pointers start here. */
  private publicDocument(reference: string) {
    const state = this.state(), task = state.tasks.find(t => t.id === reference);
    if (task) return { document: structuredClone(publicTask(task, state.originalGoal)), metadata: { ref: reference, kind: 'model-note' } };
    if (reference === 'originalUserGoal' || reference === 'originalUserConstraints') return {
      document: reference === 'originalUserGoal' ? state.originalGoal : structuredClone(state.originalConstraints),
      metadata: { ref: reference, kind: 'user-goal' },
    };
    const e = this.evidence(reference);
    const metadata = { ref: e.ref, kind: e.kind, source: e.source, observationSequence: e.observationSequence,
      activeSeconds: e.activeSeconds ?? null, query: e.query };
    let data = publicEvidenceData(e.kind, e.data), observationClock: unknown = undefined;
    if (e.kind === 'public-observation' && data && typeof data === 'object') {
      const { sequence, activeSeconds, observedAt, ...publicState } = data as Record<string, unknown>;
      observationClock = pick(data, ['sequence', 'activeSeconds', 'observedAt']); data = publicState;
    }
    if (e.kind === 'actual-action' && data && typeof data === 'object' && 'publicObservation' in data) {
      const d = data as Record<string, unknown>;
      // Exact prior acquisition only: later frames or changing critical-reference selections cannot rewrite this document.
      const matching = state.evidence.slice(0, state.evidence.findIndex(item => item.ref === reference))
        .find(item => item.kind === 'public-observation' && canonical(item.data) === canonical(d.publicObservation));
      if (matching) { const { publicObservation: _redundant, ...rest } = d; data = { ...rest, publicObservationReference: matching.ref }; }
    }
    return { document: { ...metadata, data, ...(observationClock === undefined ? {} : { observationClock }) }, metadata };
  }
  publicSummary(reference: string): any {
    return preview(this.publicDocument(reference).document, reference, this.presentReadContextArguments);
  }
  readPublic(reference: string, field = '', offset = 0, limit = 12): unknown {
    assert(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 12, 'context-invalid-page');
    const { document, metadata } = this.publicDocument(reference);
    let value: any = document;
    assert(field === '' || field.startsWith('/'), 'context-field-needs-json-pointer');
    const keys = field.slice(1).split('/').filter((_v, i) => field !== '' || i !== 0)
      .map(raw => raw.replaceAll('~1', '/').replaceAll('~0', '~'));
    assert(keys.every(key => !['__proto__', 'prototype', 'constructor'].includes(key)), 'context-public-field-missing');
    for (const key of keys) {
      // Only an absent field in this already-filtered public document is a query result.
      if (value == null || !Object.hasOwn(value, key)) return { ...metadata, status: 'field-not-found', reference, field };
      value = value[key];
    }
    const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : null;
    const total = Array.isArray(value) ? value.length : entries?.length ?? 1;
    const selectedValue = Array.isArray(value) ? value.slice(offset, offset + limit).map((v: any, i: number) => preview(v, reference, this.presentReadContextArguments, `${field}/${offset + i}`))
      : entries ? Object.fromEntries(entries.slice(offset, offset + limit).map(([key, v]) => [key, preview(v, reference, this.presentReadContextArguments, `${field}/${pointer(key)}`)])) : value;
    const nextOffset = offset + limit < total ? offset + limit : null;
    return { ...metadata, status: 'found', selectedValue, page: { field, offset, total, nextOffset },
      ...(nextOffset === null ? {} : { more: pageHint(this.presentReadContextArguments, { reference, field, offset: nextOffset, limit }) }) };
  }
  addEvidence(kind: EvidenceKind, source: string, data: unknown, query: unknown = null,
    observationSequence: number | null = null, toolResult = true, activeSeconds: number | null = null): CognitiveEvidenceV1 {
    const old = this.state();
    const material = { version: 'CognitiveEvidenceV1' as const, ref: `${old.goalId}-e${++this.#evidenceNumber}`,
      goalId: old.goalId, taskId: old.currentTaskId, kind, source, recordedAt: new Date().toISOString(),
      observationSequence, activeSeconds, query: structuredClone(query), data: structuredClone(data) };
    const evidence = { ...material, sha256: sha(material) };
    this.#state = { ...old, evidence: [...old.evidence, evidence],
      latestObservationRef: kind === 'public-observation' ? evidence.ref : old.latestObservationRef,
      latestToolEvidenceRef: toolResult ? evidence.ref : old.latestToolEvidenceRef,
      pendingAttention: kind === 'attention' ? [...old.pendingAttention, evidence.ref] : old.pendingAttention };
    return structuredClone(evidence);
  }
  /** A public read, never an update from a prediction or a model's conclusion. */
  observe(data: unknown, source = 'observe'): { evidence: CognitiveEvidenceV1; changeSummary: string } {
    const old = this.state();
    const previous = old.latestObservationRef ? this.evidence(old.latestObservationRef) : null;
    const previousData = previous?.data as Record<string, unknown> | null;
    const current = data as Record<string, unknown>;
    const withoutClock = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['sequence', 'activeSeconds', 'observedAt'].includes(key)));
    const unchanged = previousData && canonical(withoutClock(previousData)) === canonical(withoutClock(current));
    if (source === 'current-public-frame' && previous && canonical(previous.data) === canonical(data))
      return { evidence: previous, changeSummary: '与上次相比无新公开变化' };
    return { evidence: this.addEvidence('public-observation', source, data, null,
      typeof current.sequence === 'number' ? current.sequence : null, source === 'observe',
      typeof current.activeSeconds === 'number' ? current.activeSeconds : null),
      changeSummary: unchanged ? '与上次相比无新公开变化' : previous ? '有新的公开观察；不等同于已建立因果关系' : '本目标的首次公开观察' };
  }
  /** One immutable goal header, distinct from the current-state view sent after the transcript. */
  originalMaterial(): string {
    return canonical({ originalUserGoal: this.publicDocument('originalUserGoal').document,
      originalUserConstraints: this.publicDocument('originalUserConstraints').document });
  }
  material(operationalState: unknown = null, minimalIndex = false): { text: string; evidenceRefs: readonly string[] } {
    const s = this.state(), current = s.tasks.find(t => t.id === s.currentTaskId)!;
    const parent = s.tasks.find(t => t.id === current.parentId);
    const refs = [...new Set([...current.evidenceRefs, s.latestObservationRef, s.latestToolEvidenceRef, ...s.pendingAttention].filter((r): r is string => r !== null))];
    // A reference identifies an immutable acquisition, not another copy of identical content.
    // Clock metadata remains on EACH reference. This is exact-value deduplication, not a model summary.
    const firstByContent = new Map<string, string>();
    const evidence = refs.map(ref => {
      const document = this.publicDocument(ref).document as Record<string, unknown>;
      const { data, ...metadata } = document;
      const key = sha(data), first = firstByContent.get(key);
      if (first) return { ...metadata, dataSameAs: first };
      firstByContent.set(key, ref); return preview(document, ref, this.presentReadContextArguments);
    });
    const value = { originalGoalReference: 'originalUserGoal', originalConstraintsReference: 'originalUserConstraints',
      mode: s.mode, currentTask: this.publicDocument(current.id).document,
      parentTask: parent ? pick(this.publicDocument(parent.id).document, ['id', 'objective', 'objectiveReference', 'question', 'status']) : null,
      otherTasks: s.tasks.filter(t => t.id !== current.id && t.id !== parent?.id).map(t => pick(this.publicDocument(t.id).document,
        minimalIndex ? ['id', 'status'] : ['id', 'parentId', 'objective', 'objectiveReference', 'status'])),
      pendingAttentionRefs: s.pendingAttention, latestPublicObservationRef: s.latestObservationRef,
      readingKey: '这是上述历史交互之后的当前已知状态，不是新目标，也不是此前动作发生前的状态。latestPublicObservationRef才是最新公开读数；历史after属于过去；prediction尚未发生；任务是模型笔记。more/moreFields中的tool与arguments是分页调用提示，仅arguments作为工具入参，页说明不是入参；缺省摘要不代表全部。',
      evidence, operationalState };
    return { text: canonical(value), evidenceRefs: refs };
  }
}
