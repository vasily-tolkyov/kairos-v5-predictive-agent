import { randomUUID } from 'node:crypto';
import type { MinecraftBody } from '../../body.js';
import type { Action, Observation, RealEvent } from '../../contracts.js';
import type { ActionObservationScopeV1 } from '../../control/contracts.js';
import { sha } from '../../util.js';
import { anonymousObservation } from './experience.js';

export interface ActionStartPreparationWaitV1 {
  version: 'ActionStartPreparationWaitV1'; requestedSequence: number;
  requestedMonotonicMs: number; completedMonotonicMs: number; elapsedMs: number;
  timeoutMs: 50; waitAttempts: 1; outcome: 'next-frame' | 'timeout'; observedSequence: number | null;
}
export interface WorkerActionStartReceiptV1 {
  version: 'WorkerActionStartReceiptV1'; phase: 'prepared' | 'accepted' | 'refused' | 'cancelled';
  token: string; reason: string;
  preparedSequence: number | null; preparedRawDigest: string | null; preparedAnonymousDigest: string | null;
  preparedMonotonicMs: number | null;
  checkedSequence: number; checkedRawDigest: string; checkedAnonymousDigest: string; checkedMonotonicMs: number;
  elapsedMs: number | null;
  preparationWait?: ActionStartPreparationWaitV1;
}
export interface PreparedMinecraftActionStart {
  token: string; observation: Observation; precedingPassiveEvents: readonly RealEvent[];
}
export interface CancelledMinecraftActionStart {
  observation: Observation; precedingPassiveEvents: readonly RealEvent[]; actionStartReceipt: WorkerActionStartReceiptV1;
}
export type PreparedMinecraftExecution = Awaited<ReturnType<MinecraftBody['execute']>>
  & { observation: Observation; actionStartReceipt: WorkerActionStartReceiptV1 };
export interface ConditionalMinecraftBody {
  startObservation(): Promise<{ observation: Observation; precedingPassiveEvents: readonly RealEvent[] }>;
  prepareActionStart(): Promise<PreparedMinecraftActionStart>;
  executePrepared(token: string, action: Action, scope?: ActionObservationScopeV1): Promise<PreparedMinecraftExecution>;
  cancelActionStart(token: string, reason: string): Promise<CancelledMinecraftActionStart>;
}

/** A bounded, single-use transport guard, with no model, goal or policy. It
 * never suspends observation. Preparation waits once for the next real frame
 * (at most a 50 ms timer request), then captures the current frame. A stopped
 * clock uses the current measured frame; comparison still rejects any change. */
export class MinecraftActionStartProtocol {
  #prepared: (PreparedMinecraftActionStart & { rawDigest: string; anonymousDigest: string; at: number;
    preparationWait: ActionStartPreparationWaitV1 }) | null = null;
  #preparing: AbortController | null = null;
  #retained: readonly RealEvent[] = [];
  #executing = false;
  constructor(readonly body: Pick<MinecraftBody, 'latest' | 'takePassiveEvents' | 'execute'> & {
    waitForObservationAfter(sequence: number, options: { timeoutMs: number; signal?: AbortSignal }): Promise<Observation | null> },
    readonly record: (receipt: WorkerActionStartReceiptV1) => void = () => {}) {}
  #receipt(phase: WorkerActionStartReceiptV1['phase'], token: string, reason: string,
    prepared = this.#prepared): WorkerActionStartReceiptV1 {
    const current = this.body.latest(), now = performance.now();
    const receipt: WorkerActionStartReceiptV1 = { version: 'WorkerActionStartReceiptV1', phase, token, reason,
      preparedSequence: prepared?.observation.sequence ?? null, preparedRawDigest: prepared?.rawDigest ?? null,
      preparedAnonymousDigest: prepared?.anonymousDigest ?? null, preparedMonotonicMs: prepared?.at ?? null,
      checkedSequence: current.sequence, checkedRawDigest: sha(current), checkedAnonymousDigest: sha(anonymousObservation(current)),
      checkedMonotonicMs: now, elapsedMs: prepared ? now - prepared.at : null,
      ...(prepared ? { preparationWait: prepared.preparationWait } : {}) };
    this.record(receipt); return receipt;
  }
  drainPassiveEvents(): readonly RealEvent[] {
    if (this.#executing) throw new Error('cannot-drain-passive-observation-during-a-motor');
    if (this.#preparing) throw new Error('cannot-drain-passive-observation-during-preparation');
    const events = [...this.#retained, ...this.body.takePassiveEvents()]; this.#retained = []; return events;
  }
  startObservation(): { observation: Observation; precedingPassiveEvents: readonly RealEvent[] } {
    const precedingPassiveEvents = this.drainPassiveEvents();
    return { observation: this.body.latest(), precedingPassiveEvents };
  }
  invalidate(reason: string): void {
    this.#preparing?.abort(new Error('action-start-preparation-' + reason)); this.#preparing = null;
    if (!this.#prepared) return;
    this.#receipt('cancelled', this.#prepared.token, reason);
    this.#retained = [...this.#retained, ...this.#prepared.precedingPassiveEvents]; this.#prepared = null;
  }
  async prepareActionStart(): Promise<PreparedMinecraftActionStart> {
    if (this.#executing) throw new Error('body-already-executing');
    this.invalidate('superseded');
    const controller = new AbortController(); this.#preparing = controller;
    try {
      const requestedSequence = this.body.latest().sequence, requestedMonotonicMs = performance.now();
      const observed = await this.body.waitForObservationAfter(requestedSequence, { timeoutMs: 50, signal: controller.signal });
      if (controller.signal.aborted) throw controller.signal.reason;
      const completedMonotonicMs = performance.now();
      const preparationWait: ActionStartPreparationWaitV1 = { version: 'ActionStartPreparationWaitV1',
        requestedSequence, requestedMonotonicMs, completedMonotonicMs, elapsedMs: completedMonotonicMs - requestedMonotonicMs,
        timeoutMs: 50, waitAttempts: 1, outcome: observed ? 'next-frame' : 'timeout', observedSequence: observed?.sequence ?? null };
      this.#preparing = null;
      // Drain and capture together after the wait, including any synchronous
      // catch-up frames. There is no second wait and no execution retry.
      const precedingPassiveEvents = this.drainPassiveEvents(), observation = this.body.latest();
      const prepared = { token: randomUUID(), observation, precedingPassiveEvents, preparationWait,
        rawDigest: sha(observation), anonymousDigest: sha(anonymousObservation(observation)), at: performance.now() };
      this.#prepared = prepared; this.#receipt('prepared', prepared.token, 'prepared');
      return { token: prepared.token, observation, precedingPassiveEvents };
    } finally { if (this.#preparing === controller) this.#preparing = null; }
  }
  cancelActionStart(token: string, reason: string): CancelledMinecraftActionStart {
    if (this.#executing) throw new Error('body-already-executing');
    if (this.#preparing) throw new Error('body-preparing-action-start');
    const prepared = this.#prepared?.token === token ? this.#prepared : null;
    if (prepared) this.#prepared = null;
    try {
      const actionStartReceipt = this.#receipt(prepared ? 'cancelled' : 'refused', token,
        prepared ? reason : 'unknown-action-start-token', prepared);
      return { observation: this.body.latest(), actionStartReceipt,
        precedingPassiveEvents: [...(prepared?.precedingPassiveEvents ?? []),
          ...(prepared || !this.#prepared ? this.drainPassiveEvents() : [])] };
    } catch (error) {
      this.#retained = [...this.#retained, ...(prepared?.precedingPassiveEvents ?? [])]; throw error;
    }
  }
  async executePrepared(token: string, action: Action, scope?: ActionObservationScopeV1): Promise<PreparedMinecraftExecution> {
    if (this.#executing) throw new Error('body-already-executing');
    if (this.#preparing) throw new Error('body-preparing-action-start');
    const prepared = this.#prepared?.token === token ? this.#prepared : null;
    if (prepared) this.#prepared = null; // Consumed even on mismatch or exception.
    try {
      const current = this.body.latest();
      if (!prepared || prepared.observation.sequence !== current.sequence || prepared.rawDigest !== sha(current)) {
        const actionStartReceipt = this.#receipt('refused', token,
          prepared ? 'action-start-expired' : 'unknown-action-start-token', prepared);
        return { observation: current, actionStartReceipt, event: null,
          result: { action, executed: false, status: 'unavailable', startSequence: current.sequence, endSequence: current.sequence },
          precedingPassiveEvents: [...(prepared?.precedingPassiveEvents ?? []),
            ...(prepared || !this.#prepared ? this.drainPassiveEvents() : [])] };
      }
      const actionStartReceipt = this.#receipt('accepted', token, 'matched', prepared);
      // No await between the comparison above and the body's own start capture.
      this.#executing = true;
      const receipt = await this.body.execute(action, scope);
      return { ...receipt, observation: this.body.latest(), actionStartReceipt,
        precedingPassiveEvents: [...prepared.precedingPassiveEvents, ...receipt.precedingPassiveEvents ?? []] };
    } catch (error) {
      this.#retained = [...this.#retained, ...(prepared?.precedingPassiveEvents ?? [])]; throw error;
    } finally { this.#executing = false; }
  }
  async execute(action: Action, scope?: ActionObservationScopeV1): ReturnType<MinecraftBody['execute']> {
    if (this.#executing) throw new Error('body-already-executing');
    this.invalidate('unprepared-execution');
    const retained = this.#retained; this.#retained = []; this.#executing = true;
    try {
      const receipt = await this.body.execute(action, scope);
      return { ...receipt, precedingPassiveEvents: [...retained, ...receipt.precedingPassiveEvents ?? []] };
    } catch (error) { this.#retained = [...this.#retained, ...retained]; throw error; }
    finally { this.#executing = false; }
  }
}
