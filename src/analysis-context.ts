import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Configuration } from './services.js';
import { assert, canonical, sha } from './util.js';
import { deepSeekInputTokens } from './analysis-provider.js';

export const MAXIMUM_INPUT_TOKENS = 6500;
export interface WireMessage { role: string; content?: unknown; tool_calls?: readonly { id: string }[]; tool_call_id?: string; [key: string]: unknown; }
export interface ContextBudgetAudit { inputTokens: number; outputTokens: number; context: number; limit: number;
  tokenizationPasses: number; removedInteractionGroups: number; compactTaskIndex: boolean; payloadSha256: string; }

export function cleanTranscript(messages: AgentMessage[], originalGoal: string, includedRefs: readonly string[], retainNativeThinking = false): AgentMessage[] {
  return messages.flatMap((message, index): AgentMessage[] => {
    if (index === 0 && message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content : message.content
        .filter(part => part.type === 'text').map(part => part.text).join('');
      if (text === originalGoal) return [];
    }
    if (message.role === 'assistant') return [retainNativeThinking ? message : { ...message, content: message.content.filter(c => c.type !== 'thinking') }];
    // Explicitly requested public detail is not the default workspace summary. Keep its complete tool pair.
    if (message.role === 'toolResult' && message.toolName === 'read_context') return [message];
    if (message.role === 'toolResult') return [{ ...message, content: message.content.map(c => {
      if (c.type !== 'text') return c;
      let parsed: { evidenceRef?: string; reference?: string }; try { parsed = JSON.parse(c.text); } catch { return c; }
      const ref = parsed.evidenceRef ?? parsed.reference;
      return ref && includedRefs.includes(ref)
        ? { ...c, text: canonical({ evidenceRef: ref, materialLocation: '历史交互之后的当前工作区材料（只存一份，引用仍指向本次采集）' }) } : c;
    }) }];
    return [message];
  });
}
/** The original user request precedes history; acquired current state never pretends to precede its causes. */
export function orderAnalysisContext(messages: AgentMessage[], originalGoal: string, originalMaterial: string,
  material: { text: string; evidenceRefs: readonly string[] }, retainNativeThinking = false): AgentMessage[] {
  return [{ role: 'user', content: originalMaterial, timestamp: Date.now() },
    ...cleanTranscript(messages, originalGoal, material.evidenceRefs, retainNativeThinking),
    { role: 'user', content: material.text, timestamp: Date.now() }];
}
/** Verify/remove whole assistant + tool-result groups, never orphaning a tool call. */
export function interactionGroups(messages: readonly WireMessage[]): WireMessage[][] {
  const groups: WireMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      const group = groups.at(-1);
      assert(group?.[0]?.role === 'assistant', 'orphan-tool-result');
      group.push(message);
    } else groups.push([message]);
  }
  for (const group of groups) {
    const calls = group[0]!.tool_calls ?? [], results = group.slice(1);
    assert(calls.length === results.length && new Set(calls.map(c => c.id)).size === calls.length
      && calls.every(call => results.filter(result => result.tool_call_id === call.id).length === 1), 'tool-call-pairing-error');
  }
  return groups;
}
export async function realInputTokens(payload: Record<string, unknown>, config: Configuration['analysis']): Promise<number> {
  if (config.provider === 'deepseek') return deepSeekInputTokens(payload, config);
  const post = async (path: string, body: unknown): Promise<any> => {
    const result = await fetch(new URL(path, config.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeoutMs) });
    if (!result.ok) throw new Error(`llama-context-endpoint:${path}:${result.status}:${await result.text()}`);
    return result.json();
  };
  const template = payload.chat_template_kwargs as Record<string, unknown> | undefined;
  assert(typeof template?.enable_thinking === 'boolean' && template.enable_thinking === config.nativeThinking,
    'analysis-template-thinking-mismatch');
  const rendered = await post('/apply-template', { messages: payload.messages, tools: payload.tools,
    add_generation_prompt: true, chat_template_kwargs: template, enable_thinking: template.enable_thinking });
  assert(typeof rendered.prompt === 'string', 'llama-template-missing-prompt');
  const tokenized = await post('/tokenize', { content: rendered.prompt, add_special: false });
  assert(Array.isArray(tokenized.tokens), 'llama-tokenizer-missing-tokens');
  return tokenized.tokens.length;
}
export async function budgetPayload(payload: Record<string, unknown>, minimalMaterial: string,
  count: (payload: Record<string, unknown>) => Promise<number>, config: Pick<Configuration['analysis'], 'context' | 'maximumOutputTokens' | 'maximumInputTokens'>,
  minimalContextForTest = false): Promise<{ payload: Record<string, unknown>; audit: ContextBudgetAudit }> {
  assert(payload.max_tokens === config.maximumOutputTokens, 'analysis-output-budget-mismatch');
  const limit = config.maximumInputTokens ?? MAXIMUM_INPUT_TOKENS;
  const messages = payload.messages as WireMessage[];
  // Production has an immutable goal header AND the current workspace at the tail.
  // Header-only callers retain their existing compact-index presentation contract.
  const header = messages.findIndex(m => m.role === 'user');
  assert(header >= 0, 'missing-workspace-message');
  const hasTail = messages.length > header + 1 && messages.at(-1)!.role === 'user';
  const fixed = messages.slice(0, header + 1), tail = hasTail ? messages.slice(-1) : [];
  const groups = interactionGroups(messages.slice(header + 1, hasTail ? -1 : undefined));
  const latestToolIndex = groups.findLastIndex(group => (group[0]?.tool_calls?.length ?? 0) > 0);
  // Removing only a PREFIX also retains any attention/user messages after the latest tool pair.
  const maximumRemoval = Math.max(0, latestToolIndex >= 0 ? latestToolIndex : groups.length - 1);
  let tokenizationPasses = 0;
  type Counted = { payload: Record<string, unknown>; inputTokens: number; removed: number; compact: boolean };
  const counted = new Map<string, Counted>();
  const evaluate = async (removed: number, compact = false): Promise<Counted> => {
    const key = `${removed}:${compact}`, previous = counted.get(key); if (previous) return previous;
    const candidateFixed = fixed.slice(), candidateTail = tail.slice();
    if (compact) {
      if (hasTail) candidateTail[0] = { ...candidateTail[0]!, content: minimalMaterial };
      else candidateFixed[header] = { ...candidateFixed[header]!, content: minimalMaterial };
    }
    const candidate = { ...payload, messages: [...candidateFixed, ...groups.slice(removed).flat(), ...candidateTail] };
    const inputTokens = await count(candidate); tokenizationPasses++;
    const result = { payload: candidate, inputTokens, removed, compact }; counted.set(key, result); return result;
  };
  const finish = (result: Counted) => {
    assert(result.inputTokens + config.maximumOutputTokens <= config.context, 'analysis-total-context-budget-exceeded');
    return { payload: result.payload, audit: { inputTokens: result.inputTokens, outputTokens: config.maximumOutputTokens,
      context: config.context, limit, tokenizationPasses, removedInteractionGroups: result.removed,
      compactTaskIndex: result.compact, payloadSha256: sha(result.payload) } };
  };
  if (!minimalContextForTest) {
    const full = await evaluate(0); if (full.inputTokens <= limit) return finish(full);
    let low = 0, high = maximumRemoval;
    const mandatory = await evaluate(high);
    if (mandatory.inputTokens <= limit) {
      // Every candidate is counted by the real tokenizer; no token subtraction or estimated budget.
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2), candidate = await evaluate(middle);
        if (candidate.inputTokens <= limit) high = middle; else low = middle;
      }
      return finish(await evaluate(high));
    }
  }
  const compact = await evaluate(maximumRemoval, true);
  if (compact.inputTokens <= limit) return finish(compact);
  throw new Error(`context-budget-exceeded:mandatory-input=${compact.inputTokens}:limit=${limit}:removed-groups=${maximumRemoval}`);
}
