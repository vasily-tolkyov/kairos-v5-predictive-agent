import type { Observation } from '../contracts.js';
import { sha } from '../util.js';

export interface ActivePredictionContextV1 {
  readonly publicRevision: number;
  readonly actionRevision: number;
  readonly observationSequence: number;
  readonly observationIdentity: string;
}

/** Transient feedback cursor, not a task planner or an experience store.
 * Sequence-only frames preserve a query. A -> B -> A still invalidates it. */
export class ActiveControlTrajectoryV1 {
  #latestSequence = 0;
  #identity = '';
  #publicRevision = 0;
  #actionRevision = 0;
  #lastActionEventId: string | null = null;
  #query: { requestId: string; nodeId: string; context: ActivePredictionContextV1 } | null = null;
  #mediumVersion: string | null = null;
  #deviations = 0;

  accept(observation: Observation): void {
    if (observation.sequence <= this.#latestSequence) return;
    const identity = sha({ self: observation.self, objects: observation.objects, targetId: observation.targetId });
    if (identity !== this.#identity) this.#publicRevision++;
    this.#identity = identity; this.#latestSequence = observation.sequence;
  }
  capture(): ActivePredictionContextV1 {
    return { publicRevision: this.#publicRevision, actionRevision: this.#actionRevision,
      observationSequence: this.#latestSequence, observationIdentity: this.#identity };
  }
  current(context: ActivePredictionContextV1): boolean {
    return context.publicRevision === this.#publicRevision && context.actionRevision === this.#actionRevision;
  }
  begin(requestId: string, nodeId: string): ActivePredictionContextV1 {
    const context = this.capture(); this.#query = { requestId, nodeId, context }; return context;
  }
  end(mediumVersion: string | null): void { this.#query = null; this.#mediumVersion = mediumVersion; }
  action(eventId: string): void { this.#actionRevision++; this.#lastActionEventId = eventId; }
  deviation(): void { this.#publicRevision++; this.#deviations++; }
  snapshot() {
    return { version: 'ActiveControlTrajectoryV1' as const, ...this.capture(),
      mediumVersion: this.#mediumVersion, lastActionEventId: this.#lastActionEventId,
      pending: this.#query, deviationCount: this.#deviations };
  }
}
