import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { createModels, createProvider, type Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import Type from 'typebox';
import type { Action, DesiredChange } from './contracts.js';
import { analysisSampling, LOCAL_ANALYSIS_ALIAS, type Configuration } from './services.js';
import { ACTION_SCHEMA, SPATIAL_CONVENTION, QUERY_CONVENTION, validateAction } from './analysis-actions.js';
import { CognitiveWorkspace, COGNITIVE_MODES, type CognitiveMode, type EvidenceKind, type IntentUpdateV1 } from './cognitive-workspace.js';
import { budgetPayload, orderAnalysisContext, realInputTokens } from './analysis-context.js';
import { canonical, sha, assert } from './util.js';
import { publicAnalysisEvidence, readDesignatedDeepSeekCredential } from './analysis-provider.js';
import { deriveStrictToolSchema, encodeStrictToolArguments, decodeStrictToolArguments, nativeStrictTools, STRICT_WIRE_GUIDANCE, STRICT_WIRE_VERSION } from './analysis-strict-wire.js';

export const SYSTEM_PROMPT = `你是Kairos V5，一个使用工具观察、回忆、预测和行动的智能体。由你决定当前问题、子目标、模式、行动与核验，框架不替你规划。
工具事实、物理预测与模型笔记严格区分。历史成功不保证现在成功；预测频率不是校准概率；文字假设若未模拟仍是未知。
缺少经验不是自动结束理由。你可以自己提出能用真实尝试回答的小问题；也可以因缺条件而保留未知。不强迫行动。
observe只读当前快照，重复未变化快照不增加经验。execute_chain中的observe或wait才经过真实观察窗口。
动作执行不等于目标完成。核对实际结果，再明确更新任务、结论或计划。无效果是本次窗口事实，不是永久不可能。
变化是否影响当前目标，与变化是否由上次行动造成，是两个不同问题。目标仍满足不证明变化之间没有因果关系；缺少已引用的受控对照或已验证条件证据时，只报告观察、时序或共现，并保留原因未知。无需先解决所有原因才能继续、修订或结束目标。
set_intent只增量保存你自己的简短笔记；省略字段保留。mode可自由切换、跳过、返回，所有模式工具相同，无必经步骤。
模式索引：orient定向当前事实；recall反查经验与条件；plan比较未执行方案；act行动并核验；explore提问与试验；review用新事实修订。模式不是行动许可。
任务ID用t开头短ID（初始用户任务t0），任务关系及完成/暂停/恢复仅由你明确更新。证据只读，用read_context取回本目标材料，不能编造引用。dataSameAs表示内容与该引用完全相同，各自时点仍独立保留。
对象别名必须原样引用。${SPATIAL_CONVENTION}
${QUERY_CONVENTION}
未执行的动作链会被真实注意力通知中断；先核对通知证据，是否恢复由你决定。同一个工具调用不能重试或自动重发；你可以为学习主动再次选择相同动作参数，那是新的真实尝试，不是把旧调用重发。
没有命令、文件、世界管理、经验写入或模型管理工具。程序/服务错误直接停止，不重试、不猜参数修复。
需要结束时调用finish，用简短结论与证据引用说明完成、仍缺经验、暂未找到方案或预算结束；用户停止和程序错误另记。不要输出或保存思维链。`;
export const MODE_PROMPTS: Readonly<Record<CognitiveMode, string>> = {
  orient: '当前模式：理解与定向。根据原始目标、最新公开场景、身体与注意力，明确公开成功标准、当前具体问题、已知和未知；由你判断是否需要补充观察。',
  recall: '当前模式：经验与条件。按期望变化反查真实历史，核对当前R2A适用度、差异和反例，明确哪些条件仍缺失；不能把历史共同出现当必要因果。',
  plan: '当前模式：规划与推演。保留当前及父任务，比较你提出的候选和物理预测，组织子目标、替代路线、部分方案或探索；不补入未观察的假想事实。',
  act: '当前模式：行动与核验。依据你自己的计划和当前公开对象给出精确动作参数；检查实际返回与此前预测，判断任务是否真正完成，必要时修订。',
  explore: '当前模式：探索与辨因。针对未知提出可检验的小问题和有区分力的尝试；对照需保持其他条件并使用同一探测动作，不能隔离时保留未解决。',
  review: '当前模式：复盘与调整。面对意外、失败、停滞或结束，比较实际证据与原假设；决定修订、恢复原任务、放弃或报告限制，不把无效果或未知当程序故障。',
};
const object = (properties: Parameters<typeof Type.Object>[0]) => Type.Object(properties, { additionalProperties: false });
const strings = () => Type.Array(Type.String());
const choice = (values: readonly string[]) => Type.Union(values.map(v => Type.Literal(v)));
const taskPatch = object({ id: Type.String({ pattern: '^t[A-Za-z0-9_-]{0,23}$' }), parentId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  objective: Type.Optional(Type.String()), question: Type.Optional(Type.String()), completionCriteria: Type.Optional(strings()),
  status: Type.Optional(choice(['open', 'active', 'paused', 'completed', 'abandoned'])), conclusion: Type.Optional(Type.String()),
  hypotheses: Type.Optional(strings()), unknowns: Type.Optional(strings()), attemptedBranches: Type.Optional(strings()),
  evidenceRefs: Type.Optional(Type.Array(Type.String(), { description: '任务笔记依据：仅接受本目标已有的不可变工具证据ID；不能放任务ID或originalUserGoal。' })) });
export const TOOL_SCHEMAS = {
  observe: object({}),
  recall: object({ desiredChange: object({ subject: Type.Optional(Type.String({ description: '历史主体：self或公开historyQuerySubject/已返回历史角色；可省略。不是body、属性名或当前o1别名。' })),
    property: Type.Optional(Type.String({ description: '真实公开属性或已返回经验中的property原名；不是通用value。' })),
    direction: Type.Optional(Type.Union(['increase', 'decrease', 'change', 'unchanged'].map(v => Type.Literal(v)), { description: '历史before到after：增加、减少、变化或不变；可省略。' })),
    value: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()], { description: '要查询的历史结果值after；不是当前值断言。' })) }),
    offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
  predict: object({ action: ACTION_SCHEMA, assumptions: Type.Optional(strings()) }),
  execute_chain: object({ actions: Type.Array(ACTION_SCHEMA, { minItems: 1 }) }),
  set_intent: object({ mode: Type.Optional(choice(COGNITIVE_MODES)), currentTaskId: Type.Optional(Type.String()),
    tasks: Type.Optional(Type.Array(taskPatch)), acknowledgeAttention: Type.Optional(strings()) }),
  read_context: object({ reference: Type.String({ description: '本目标任务ID、证据引用、originalUserGoal或originalUserConstraints' }),
    field: Type.Optional(Type.String({ description: '从该reference的公开文档根起算的JSON指针：证据/data/objects或/data/candidates/0/observedBefore，任务/parentId。不是回复或分页包装的路径；省略或空字符串为该文档根。' })),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: '所选数组按元素、所选对象按属性计数的起始位置。' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12, description: '本页数组元素数或对象属性数；根对象limit=1只读一项属性，不代表完整任务记录。' })) }),
  finish: object({ status: choice(['completed', 'needs-experience', 'no-plan', 'budget-exhausted']), report: Type.String(),
    evidenceRefs: Type.Optional(Type.Array(Type.String(), { description: '本目标报告参考材料：可省略，或引用已有任务ID、originalUserGoal、不可变工具证据ID。任务笔记和用户目标不是物理证据或预测支持。' })) }),
};
export const STRICT_TOOL_SCHEMAS = Object.fromEntries(Object.entries(TOOL_SCHEMAS).map(([name, schema]) =>
  [name, deriveStrictToolSchema(schema)])) as Record<keyof typeof TOOL_SCHEMAS, ReturnType<typeof deriveStrictToolSchema>>;
export interface AnalysisTools {
  observe(): Promise<unknown>;
  recall(desired: DesiredChange, offset: number): Promise<unknown>;
  predict(action: Action, assumptions: readonly string[]): Promise<unknown>;
  execute(actions: readonly Action[]): Promise<unknown>;
  /** Read-only current public observation and operational counters. No plan/notes duplication. */
  context(): unknown;
}
export interface AnalysisHooks {
  /** Test-driver ceiling, not a production action policy. Undefined in ordinary runs. */
  beforeModelRequest?: (completedRequests: number) => void;
  /** Isolated role test only. Runtime/new goals omit this and always start orient. */
  initialModeForTest?: CognitiveMode;
  /** Plan-authorized same-model short-input comparison; never enabled by the live runtime. */
  minimalContextForTest?: boolean;
  /** Synthetic HTTP tests only; ordinary runtime supplies neither hook. */
  apiKeyForTest?: string;
  fetchForTest?: typeof fetch;
}
interface ReportReferenceSource {
  ref: string;
  kind: EvidenceKind | 'model-note' | 'user-goal';
  source?: string;
  observationSequence?: number | null;
  activeSeconds?: number | null;
}
export class AnalysisCore {
  readonly agent: Agent;
  readonly workspace: CognitiveWorkspace;
  #fatal: Error | null = null;
  #finished: { status: string; report: string; evidenceRefs?: string[]; referenceSources: ReportReferenceSource[] } | null = null;
  #calls = 0;
  #goalCalls = 0;
  #goal = '';
  #minimalMaterial = '';
  #requestAttention: readonly string[] = [];
  #contextAttention: readonly string[] = [];
  #requestStarted = 0;
  #requestController: AbortController | null = null;
  #requestSignal: AbortSignal | null = null;
  #requestTimer: ReturnType<typeof setTimeout> | null = null;
  #requestSentAt: number | null = null;
  #firstProgressAt: number | null = null;
  #lastProgressAt: number | null = null;
  #effectiveProgressCount = 0;
  #requestDeadlineExceeded = false;
  #apiKey: string | null = null;
  #privateReasoning: string[] = [];
  constructor(readonly config: Configuration['analysis'], readonly tools: AnalysisTools,
    readonly record: (kind: string, value: unknown) => void, readonly hooks: AnalysisHooks = {}) {
    const remote = config.provider === 'deepseek';
    if (remote) assert(config.baseUrl === 'https://api.deepseek.com/beta' && config.model === 'deepseek-v4-pro', 'designated-DeepSeek-endpoint-required');
    this.workspace = new CognitiveWorkspace(remote ? args => encodeStrictToolArguments(TOOL_SCHEMAS.read_context, args) : undefined);
    this.record = (kind, value) => record(kind, publicAnalysisEvidence(value, [this.#apiKey ?? '', ...this.#privateReasoning]));
    const model: Model<'openai-completions'> = { id: remote ? config.model : LOCAL_ANALYSIS_ALIAS,
      name: remote ? 'Designated DeepSeek V4 Pro' : `Frozen local analysis ${config.context / 1024}K`, api: 'openai-completions',
      provider: remote ? 'deepseek' : 'kairos-v5-local', baseUrl: config.baseUrl, reasoning: config.nativeThinking, input: ['text'],
      contextWindow: config.context, maxTokens: config.maximumOutputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      samplingParams: analysisSampling(config),
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: remote, supportsStore: false, supportsStrictMode: false,
        maxTokensField: 'max_tokens', thinkingFormat: remote ? 'deepseek' : 'qwen-chat-template',
        requiresReasoningContentOnAssistantMessages: remote } };
    const models = createModels(); models.setProvider(createProvider({ id: model.provider, name: model.name,
      baseUrl: config.baseUrl, models: [model], auth: { apiKey: { name: remote ? 'designated-CC-Switch-provider' : 'loopback',
        resolve: async ({ credential }) => ({ auth: remote ? { apiKey: credential?.key } : {} }) } }, api: openAICompletionsApi() }));
    const evidenceResult = (kind: EvidenceKind, name: string, result: unknown, query: unknown) => {
      // The tool captured its source before await. Neither an old workspace frame nor a new body read is that source.
      const source = result as { observationSequence?: unknown; activeSeconds?: unknown } | null;
      const e = this.workspace.addEvidence(kind, name, result, query,
        typeof source?.observationSequence === 'number' ? source.observationSequence : null, true,
        typeof source?.activeSeconds === 'number' ? source.activeSeconds : null);
      return { evidenceRef: e.ref, kind, observationSequence: e.observationSequence, activeSeconds: e.activeSeconds,
        summary: this.workspace.publicSummary(e.ref).data };
    };
    const implementations: Record<string, (args: any) => Promise<unknown>> = {
      observe: async () => {
        const result = await tools.observe();
        const observation = result && typeof result === 'object' && 'publicObservation' in result ? result.publicObservation : result;
        const { evidence: e, changeSummary } = this.workspace.observe(observation);
        return { evidenceRef: e.ref, kind: e.kind, changeSummary, publicObservation: this.workspace.publicSummary(e.ref).data };
      },
      recall: async args => evidenceResult('historical-experience', 'recall', await tools.recall(args.desiredChange, args.offset ?? 0), args),
      predict: async args => { validateAction(args.action); return evidenceResult('prediction', 'predict', await tools.predict(args.action, args.assumptions ?? []), args); },
      execute_chain: async args => {
        args.actions.forEach(validateAction);
        const newAttention = this.workspace.snapshot().pendingAttention.filter(ref => !this.#requestAttention.includes(ref));
        if (newAttention.length) return { interrupted: true, remainingActionsNotExecuted: args.actions.length, attentionRefs: newAttention, actualActions: 0 };
        const result = await tools.execute(args.actions);
        if (result && typeof result === 'object' && 'publicObservation' in result) this.workspace.observe(result.publicObservation, 'current-public-frame');
        return evidenceResult('actual-action', 'execute_chain', result, args);
      },
      set_intent: async (args: IntentUpdateV1) => { const result = this.workspace.update(args); this.record('model-intent', { update: args, result }); return result; },
      read_context: async args => this.workspace.readPublic(args.reference, args.field, args.offset, args.limit),
      finish: async args => {
        const newAttention = this.workspace.snapshot().pendingAttention.filter(ref => !this.#requestAttention.includes(ref));
        if (newAttention.length) return { interrupted: true, attentionRefs: newAttention, reason: 'new-evidence-not-in-finished-request' };
        const referenceSources = (args.evidenceRefs ?? []).map((reference: string) => {
          const { ref, kind, source, observationSequence, activeSeconds } = this.workspace.readPublic(reference) as ReportReferenceSource;
          return { ref, kind, ...(source === undefined ? {} : { source }),
            ...(observationSequence === undefined ? {} : { observationSequence }),
            ...(activeSeconds === undefined ? {} : { activeSeconds }) };
        });
        this.#finished = { ...args, referenceSources }; return this.#finished;
      },
    };
    const descriptions: Record<string, string> = {
      observe: '读取公开快照及变化摘要，不行动、不等待、不产生经验。',
      recall: '按公开变化查询真实物理历史和当前条件支持，可翻页；不是未来事实。',
      predict: '对明确动作请求只读随机物理预测。assumptions仅文字假设，当前未模拟。',
      execute_chain: '恰好执行你选择的基础动作序列一次；真实注意力可中断剩余动作，不重试。',
      set_intent: '增量更新模型笔记、任务与模式；省略字段保留，证据不可改写。新增任务需objective；任务evidenceRefs仅接受不可变工具证据，不接受任务ID。确认同目标已知attention可重复，返回本次acknowledgedAttention及此前alreadyAcknowledgedAttention，未提及通知保留；确认不证明因果解释正确。',
      read_context: '从reference的公开文档根读取field；证据字段含/data，任务字段如/parentId。status=found时返回selectedValue和page及原来源，真实null也属于found；数组按元素、对象按属性分页，more给出后续页。已知公开文档无该普通字段时返回status=field-not-found及所请求reference/field、原类型/来源/时点，不含替代内容；它只表示此文档无此字段，不表示世界无经验或recall为空，下一步由你决定。包装和分页元数据不是文档内容，未读部分不自动补全；内部图/核/哈希不返回，不访问文件或旧目标。未知引用、非法参数或特殊键及程序错误仍终止调用。',
      finish: '以简短报告结束本目标；evidenceRefs是可选的本目标报告参考材料，来源种类保留，任务笔记与用户目标不升级为物理证据。不自动完成任务，也不把经验不足或一次无效果说成绝不可能。',
    };
    const sdkTools: AgentTool<any>[] = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
      name, label: name, description: descriptions[name]!, parameters: remote ? STRICT_TOOL_SCHEMAS[name as keyof typeof TOOL_SCHEMAS] : schema, executionMode: 'sequential',
      execute: async (_id: string, args: unknown) => {
        if (this.#fatal) throw this.#fatal;
        if (this.#finished) throw new Error('tool-after-finish');
        try {
          const logical = remote ? decodeStrictToolArguments(schema, args) : args;
          this.record('tool-start', { name, args: logical, argumentFormat: 'logical' });
          const result = await implementations[name]!(logical); this.record('tool-end', { name, args: logical, result });
          return { content: [{ type: 'text' as const, text: canonical(result) }], details: undefined, ...(name === 'finish' && this.#finished ? { terminate: true } : {}) };
        } catch (error) { this.fail(error as Error); throw error; }
      },
    }));
    this.agent = new Agent({
      // Analysis-backend setting only, never the Codex execution model or reasoning setting.
      initialState: { systemPrompt: this.prompt('orient'), model, tools: sdkTools, messages: [],
        thinkingLevel: remote ? config.reasoningEffort : config.nativeThinking ? 'minimal' : 'off' },
      streamFn: (m, context, options) => {
        // Preparation retains its own tokenizer errors/deadlines, not the remote generation clock.
        this.clearRequestTimer(); this.#requestStarted = performance.now(); this.#requestSentAt = null;
        this.#firstProgressAt = null; this.#lastProgressAt = null; this.#effectiveProgressCount = 0; this.#requestDeadlineExceeded = false;
        const controller = new AbortController(); this.#requestController = controller;
        const signal = AbortSignal.any(options?.signal ? [options.signal, controller.signal] : [controller.signal]);
        this.#requestSignal = signal;
        signal.addEventListener('abort', () => this.clearRequestTimer(), { once: true });
        return models.streamSimple(m, context, { ...options, signal, maxRetries: 0,
          timeoutMs: config.timeoutMs, maxTokens: config.maximumOutputTokens,
          ...(remote ? {} : { temperature: config.temperature }),
          ...(hooks.fetchForTest ? { fetch: hooks.fetchForTest } : {}) });
      },
      getApiKey: () => remote ? this.#apiKey ??= hooks.apiKeyForTest ?? readDesignatedDeepSeekCredential() : 'kairos-local-keyless',
      toolExecution: 'sequential',
      transformContext: async messages => {
        const context = this.tools.context();
        const { publicObservation, ...operational } = (context ?? {}) as Record<string, unknown>;
        if (publicObservation) this.workspace.observe(publicObservation, 'current-public-frame');
        const material = this.workspace.material(operational); this.#minimalMaterial = this.workspace.material(operational, true).text;
        this.#contextAttention = this.workspace.snapshot().pendingAttention;
        return orderAnalysisContext(messages, this.#goal, this.workspace.originalMaterial(), material, remote);
      },
      // Real Pi 0.84.2 per-turn hook, with the same Agent and the same tools in all modes.
      prepareNextTurnWithContext: ({ context }) => {
        const systemPrompt = this.prompt(this.workspace.mode); this.agent.state.systemPrompt = systemPrompt;
        return { context: { ...context, systemPrompt } };
      },
      beforeToolCall: async ({ toolCall, args }) => {
        if (this.#fatal) throw this.#fatal;
        this.record('model-tool', { name: toolCall.name, arguments: toolCall.arguments, argumentFormat: remote ? 'strict-wire' : 'logical' });
        if (canonical(toolCall.arguments) !== canonical(args)) {
          this.record('tool-arguments-rejected', { name: toolCall.name, raw: toolCall.arguments, reason: 'SDK-argument-conversion' });
          this.fail(new Error('Pi-tool-argument-coercion-rejected')); throw this.#fatal;
        }
        return undefined;
      },
      afterToolCall: async ({ isError }) => { if (isError && !this.#fatal) this.fail(new Error('Pi tool validation/execution error')); return this.#fatal ? { terminate: true } : undefined; },
      shouldStopAfterTurn: () => this.#fatal !== null || this.#finished !== null,
      onPayload: async payload => {
        if (this.#fatal) throw this.#fatal;
        this.hooks.beforeModelRequest?.(this.#goalCalls);
        const raw = payload as Record<string, unknown>;
        let fixed: Record<string, unknown>;
        if (remote) {
          assert((raw.thinking as any)?.type === 'enabled' && raw.reasoning_effort === 'high', 'Pi-DeepSeek-thinking-not-enabled');
          assert(!['temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'seed',
            'chat_template_kwargs', 'tool_choice'].some(k => raw[k] !== undefined), 'invalid-DeepSeek-wire-option');
          fixed = { ...raw, tools: nativeStrictTools(raw.tools), max_tokens: config.maximumOutputTokens };
          for (const m of (fixed.messages as any[])) if (m.role === 'assistant')
            // The provider may itself return no reasoning on a tool turn. Preserve that empty field;
            // do not require invented content. Nonempty native content remains unchanged by Pi.
            assert(typeof m.reasoning_content === 'string', 'missing-native-reasoning-transport');
        } else {
          const template = raw.chat_template_kwargs as Record<string, unknown> | undefined;
          assert(!config.nativeThinking || template?.enable_thinking === true, 'Pi-native-thinking-not-enabled');
          fixed = { ...raw, ...analysisSampling(config), max_tokens: config.maximumOutputTokens,
            chat_template_kwargs: { ...template, enable_thinking: config.nativeThinking } };
        }
        try {
          const { payload: request, audit } = await budgetPayload(fixed, this.#minimalMaterial, p => realInputTokens(p, config), config, this.hooks.minimalContextForTest);
          this.#requestSignal?.throwIfAborted();
          this.#requestAttention = this.#contextAttention;
          this.record('analysis-request', { ...audit, mode: this.workspace.mode, currentTaskId: this.workspace.currentTaskId,
            inputLimitMeaning: remote ? 'local-preparation-target' : 'local-and-service-input-hard-limit',
            preparationMilliseconds: performance.now() - this.#requestStarted,
            timeoutPolicy: 'payload-ready-then-no-effective-generation-progress', noProgressTimeoutMs: config.timeoutMs,
            minimalContextForTest: this.hooks.minimalContextForTest ?? false,
            tokenCounter: remote ? 'official-DeepSeek-V4-local-renderer' : 'llama-actual-chat-template',
            reasoningTransportMessages: (request.messages as any[]).filter(m => typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0).length,
            promptSha256: sha(this.prompt(this.workspace.mode)), schemaSha256: sha(TOOL_SCHEMAS),
            wireFormatVersion: remote ? STRICT_WIRE_VERSION : 'original-logical-tools',
            wireSchemaSha256: remote ? sha(STRICT_TOOL_SCHEMAS) : sha(TOOL_SCHEMAS), request });
          this.#calls++; this.#goalCalls++;
          // onPayload is the existing SDK boundary immediately before sending. Not a wire-arrival measurement.
          this.#requestSentAt = performance.now(); this.refreshRequestTimer(); return request;
        } catch (error) { this.record('analysis-request-rejected', { message: (error as Error).message, modelCallsThisGoal: this.#goalCalls }); throw error; }
      },
    });
    this.agent.subscribe(event => {
      if (event.type === 'message_update') {
        const progress = event.assistantMessageEvent;
        if ((progress.type === 'text_delta' || progress.type === 'thinking_delta' || progress.type === 'toolcall_delta')
          && progress.delta.length > 0 && this.#requestSentAt !== null && !this.#requestSignal?.aborted) {
          const now = performance.now();
          if (now - (this.#lastProgressAt ?? this.#requestSentAt) >= config.timeoutMs) this.expireRequest();
          else {
            // Only timestamps/counts are retained here, never private native content.
            this.#firstProgressAt ??= now; this.#lastProgressAt = now; this.#effectiveProgressCount++;
            this.refreshRequestTimer();
          }
        }
      }
      // Pi validates arguments before before/afterToolCall. Those rejected calls still emit this event.
      if (event.type === 'tool_execution_end' && event.isError) {
        this.record('tool-error', { name: event.toolName, result: event.result });
        this.fail(new Error(`Pi tool validation/execution error:${canonical(event.result)}`));
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        this.clearRequestTimer();
        const message = event.message;
        this.#privateReasoning.push(...message.content.flatMap(part => part.type === 'thinking' ? [part.thinking] : []));
        const actualInput = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
        this.record('analysis-response', { stopReason: message.stopReason, rawStopReason: message.rawStopReason, usage: message.usage,
          serviceActualInputTokens: actualInput, serviceActualTotalTokens: actualInput + message.usage.output,
          serviceBudgetMeaning: remote ? 'actual-input-plus-actual-output-and-output-hard-limits' : 'input-total-and-output-hard-limits',
          requestedModel: model.id, responseModel: message.responseModel ?? model.id,
          milliseconds: performance.now() - this.#requestStarted,
          preparationMilliseconds: (this.#requestSentAt ?? performance.now()) - this.#requestStarted,
          generationMilliseconds: this.#requestSentAt === null ? null : performance.now() - this.#requestSentAt,
          firstEffectiveProgressMilliseconds: this.#firstProgressAt === null ? null : this.#firstProgressAt - this.#requestSentAt!,
          lastEffectiveProgressMilliseconds: this.#lastProgressAt === null ? null : this.#lastProgressAt - this.#requestSentAt!,
          effectiveProgressCount: this.#effectiveProgressCount,
          timeoutPolicy: 'payload-ready-then-no-effective-generation-progress', noProgressTimeoutMs: config.timeoutMs,
          requestDeadlineExceeded: this.#requestDeadlineExceeded,
          terminationReason: this.#requestDeadlineExceeded ? 'no-effective-generation-progress-timeout' : message.rawStopReason ?? message.stopReason,
          nativeReasoningObserved: message.content.some(part => part.type === 'thinking' && part.thinking.length > 0),
          tools: message.content.filter(part => part.type === 'toolCall'), text: message.content.filter(part => part.type === 'text'), error: message.errorMessage ?? null });
        if (this.#requestDeadlineExceeded) this.#fatal ??= new Error(`analysis-request-no-progress-timeout:${config.timeoutMs}ms`);
        if (message.stopReason === 'error' || message.stopReason === 'aborted') this.#fatal ??= new Error(message.errorMessage ?? message.stopReason);
        if (message.stopReason === 'length' || message.rawStopReason === 'length') this.fail(new Error('analysis-output-truncated:length'));
        if ((!remote && actualInput > (config.maximumInputTokens ?? 6500)) || actualInput + message.usage.output > config.context
          || message.usage.output > config.maximumOutputTokens) this.fail(new Error('service-actual-token-budget-exceeded'));
      }
    });
  }
  private clearRequestTimer(): void {
    if (this.#requestTimer !== null) clearTimeout(this.#requestTimer);
    this.#requestTimer = null;
  }
  private refreshRequestTimer(): void {
    this.clearRequestTimer();
    this.#requestTimer = setTimeout(() => this.expireRequest(), this.config.timeoutMs);
  }
  private expireRequest(): void {
    this.#requestDeadlineExceeded = true; this.clearRequestTimer();
    this.#fatal ??= new Error(`analysis-request-no-progress-timeout:${this.config.timeoutMs}ms`);
    this.#requestController?.abort(this.#fatal);
  }
  private prompt(mode: CognitiveMode): string { return `${SYSTEM_PROMPT}\n${MODE_PROMPTS[mode]}${this.config.provider === 'deepseek' ? `\n${STRICT_WIRE_GUIDANCE}` : ''}`; }
  get calls(): number { return this.#calls; }
  fail(error: Error): void { this.#fatal ??= error; this.clearRequestTimer(); this.agent?.abort(); }
  wake(notice: unknown): void {
    if (!this.workspace.active || this.#finished) return;
    const n = notice as { sequence?: number };
    const e = this.workspace.addEvidence('attention', 'AttentionMonitor', notice, null, n.sequence ?? null, false);
    this.record('attention-context', { evidenceRef: e.ref, interruptedTaskId: this.workspace.currentTaskId, notice });
    this.agent.steer({ role: 'user', content: `真实注意力通知${e.ref}；原任务仍保留，完整证据在工作区。请根据事实决定后续。`, timestamp: Date.now() });
  }
  async run(goal: string, originalConstraints: readonly string[] = []): Promise<{ status: string; report: string }> {
    this.#goal = goal; this.#finished = null; this.#fatal = null; this.#goalCalls = 0; this.#requestAttention = [];
    this.workspace.startGoal(goal, originalConstraints);
    if (this.hooks.initialModeForTest) this.workspace.update({ mode: this.hooks.initialModeForTest });
    this.agent.reset(); this.agent.state.systemPrompt = this.prompt(this.workspace.mode);
    try {
      await this.agent.prompt(goal);
      if (this.#fatal) throw this.#fatal;
      if (this.agent.state.errorMessage) throw new Error(this.agent.state.errorMessage);
      assert(this.#finished, 'analysis-ended-without-finish'); return this.#finished;
    } catch (error) {
      const e = error as Error;
      const sanitized = new Error(publicAnalysisEvidence(e.message, [this.#apiKey ?? '', ...this.#privateReasoning]));
      sanitized.stack = publicAnalysisEvidence(e.stack, [this.#apiKey ?? '', ...this.#privateReasoning]);
      throw sanitized;
    } finally {
      this.clearRequestTimer(); this.#requestController = null; this.#requestSignal = null;
      // Native protocol history is live-session-only, not a recoverable checkpoint or long-term memory.
      for (const m of this.agent.state.messages) if (m.role === 'assistant') m.content = m.content.filter(p => p.type !== 'thinking');
      this.#apiKey = null; this.#privateReasoning = [];
    }
  }
}
