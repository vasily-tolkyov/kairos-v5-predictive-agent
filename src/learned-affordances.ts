import type { Action, Observation } from './contracts.js';
import type { ActionOfferV1 } from './control/contracts.js';
import { ContextualReadout, type ContextualReadoutSnapshot } from './contextual-readout.js';
import { experienceInputs, experienceInputBounds, motorIdentity } from './experience-medium.js';
import { cueFor } from './events.js';
import { sha } from './util.js';

interface Motor { action: Omit<Action, 'targetId'>; targeted: boolean }
export interface LearnedAffordancesSnapshot { version: 'LearnedAffordances1'; motors: [string, Motor][];
  readout: ContextualReadoutSnapshot }

/** Learn when a previously encountered motor port is available from complete
 * actual offer sets. This never asks an environment to evaluate imagined state
 * and never stores its implementation of a prerequisite. */
export class LearnedAffordances {
  #motors = new Map<string, Motor>();
  #readout = new ContextualReadout();
  #lastObservation: { sequence: number; digest: string } | null = null;
  observe(observation: Observation, offers: readonly ActionOfferV1[]): void {
    if (observation.predictionSupport || observation.predictionContext || observation.predictionBounds) throw new Error('imagined-affordance-evidence');
    if (offers.some(offer => offer.observationSequence !== observation.sequence)) throw new Error('stale-affordance-evidence');
    const digest = sha({ state: experienceInputs(observation, observation.objects.find(o => o.id === observation.targetId)),
      offers: offers.map(offer => motorIdentity(offer.cue)).sort() });
    if (this.#lastObservation?.sequence === observation.sequence) {
      if (this.#lastObservation.digest !== digest) throw new Error('conflicting-affordance-observation');
      return;
    }
    this.#lastObservation = { sequence: observation.sequence, digest };
    for (const offer of offers) {
      const id = motorIdentity(offer.cue);
      if (!this.#motors.has(id) && this.#motors.size >= 128) throw new Error('motor-port-capacity-exceeded');
      this.#motors.set(id, { action: { kind: offer.action.kind, parameters: { ...offer.action.parameters } },
        targeted: offer.action.targetId !== undefined });
    }
    const available = new Set(offers.map(offer => motorIdentity(offer.cue)));
    const input = experienceInputs(observation, observation.objects.find(o => o.id === observation.targetId));
    // Absence means unavailable only for ports already encountered, never for
    // imagined actions or an API catalogue the learner has not observed.
    for (const id of this.#motors.keys()) this.#readout.observe(id, input, [['available', false, available.has(id)]]);
  }
  imagined(observation: Observation): readonly ActionOfferV1[] {
    const input = experienceInputs(observation, observation.objects.find(o => o.id === observation.targetId));
    return [...this.#motors].flatMap(([id, motor]) => {
      const value = this.#readout.read(id, 'available', input,
        experienceInputBounds(observation, observation.objects.find(o => o.id === observation.targetId)));
      if (!value?.supported || value.value !== true) return [];
      if (motor.targeted && (!observation.targetId || observation.predictionSupport
        && !observation.predictionSupport.includes('targetId'))) return [];
      const action: Action = { ...motor.action, ...(motor.targeted ? { targetId: observation.targetId! } : {}) };
      return [{ version: 'ActionOfferV1' as const, offerId: sha({ imagined: true, action, sequence: observation.sequence }),
        observationSequence: observation.sequence, action, cue: cueFor(action, observation) }];
    });
  }
  get size(): number { return this.#motors.size; }
  snapshot(): LearnedAffordancesSnapshot { return { version: 'LearnedAffordances1', motors: structuredClone([...this.#motors]),
    readout: this.#readout.snapshot() }; }
  static restore(state: LearnedAffordancesSnapshot): LearnedAffordances {
    if (state.version !== 'LearnedAffordances1' || state.motors.length > 128
      || new Set(state.motors.map(([id]) => id)).size !== state.motors.length) throw new Error('invalid-affordance-snapshot');
    const model = new LearnedAffordances(); model.#motors = new Map(structuredClone(state.motors));
    model.#readout = ContextualReadout.restore(state.readout); return model;
  }
}
