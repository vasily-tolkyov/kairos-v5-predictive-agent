import type { Observation, RealEvent, XYZ } from './contracts.js';
import { createHash } from 'node:crypto';
import type { ActionOfferV1 } from './control/contracts.js';
import { ContextualReadout, type ContextualReadoutSnapshot } from './contextual-readout.js';
import { ExperienceLedger } from './experience-ledger.js';
import { validateEvent } from './events.js';
import { bodyToWorld, worldToBody } from './perception.js';
import { sha } from './util.js';

// A separately identified, endpoint-only stage-one learner. It has no route,
// collision rule, task label, world identity, old-model support or imagined
// training. The existing readout induces all response partitions from data.
export function movementInputs(observation: Observation): Record<string, number> {
  const input: Record<string, number> = {}, view = observation.sensation;
  if (view) for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
    let sum = 0, count = 0;
    for (let y = Math.floor(row * view.height / 2); y < Math.floor((row + 1) * view.height / 2); y++)
      for (let x = Math.floor(col * view.width / 3); x < Math.floor((col + 1) * view.width / 3); x++) {
        const value = view.samples[(y * view.width + x) * 4 + 3]!;
        sum += value < 0 ? view.range : value; count++;
      }
    input[`depth/${row}/${col}`] = sum / Math.max(1, count);
  }
  const properties = observation.self.properties;
  if (['velocityX', 'velocityY', 'velocityZ'].every(key => typeof properties[key] === 'number')) {
    const velocity = worldToBody(['velocityX', 'velocityY', 'velocityZ'].map(key => Number(properties[key])), observation.self.yaw);
    input['velocity/forward'] = velocity[0]; input['velocity/lateral'] = velocity[1];
  }
  return input;
}
const identity = (offer: Pick<ActionOfferV1, 'cue'>) => sha({ kind: offer.cue.kind, parameters: offer.cue.parameters });
export const movementOffers = (offers: readonly ActionOfferV1[]) => offers.filter(offer => offer.action.kind === 'move'
  && offer.action.parameters.ticks === 4 && ['forward', 'back', 'left', 'right'].includes(String(offer.action.parameters.direction)));
export interface StageOneMovementSnapshot {
  version: 'StageOneMovement2'; writes: number; contexts: ContextualReadoutSnapshot;
  ledger: ReturnType<ExperienceLedger['snapshot']>;
}
export class StageOneMovement {
  #contexts = new ContextualReadout(128); #ledger = new ExperienceLedger(512); #writes = 0;
  get writes() { return this.#writes; }
  predict(observation: Observation, offer: ActionOfferV1) {
    const input = movementInputs(observation), motor = identity(offer);
    const forward = this.#contexts.read(motor, 'forward', input), lateral = this.#contexts.read(motor, 'lateral', input);
    const displacement = forward && lateral ? bodyToWorld([Number(forward.value), Number(lateral.value), 0], observation.self.yaw) : null;
    return { version: 'StageOneMovementPrediction1' as const, input, motor, forward, lateral, displacement,
      supported: Boolean(forward?.supported && lateral?.supported),
      samples: Math.min(forward?.samples ?? 0, lateral?.samples ?? 0) };
  }
  observe(event: RealEvent) {
    validateEvent(event);
    if (event.frames.some(frame => frame.predictionSupport !== undefined || frame.predictionBounds !== undefined
      || frame.predictionContext !== undefined)) throw new Error('stage-one-requires-measured-frames');
    // The original event is archived as these exact JSON bytes. A byte digest
    // avoids sorting every nested sensory object and RGBD frame. Reordering
    // bytes under the same event ID is conservatively a conflict, not another
    // calibration window. V2 keeps this identity policy separate from V1.
    const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const seen = this.#ledger.check(event.id, digest);
    if (seen !== 'new') return { learned: false, reason: seen };
    const receipt = event.bodyResult?.motorReceipt;
    if (event.provenance !== 'executed-real-body' || !event.bodyResult?.executed || event.cue.kind !== 'move'
      || event.cue.parameters.ticks !== 4 || !receipt || !receipt.pressSucceeded || !receipt.releaseSucceeded
      || receipt.actualTicks !== 4 || receipt.actualSeconds !== .2)
      return { learned: false, reason: 'not-a-complete-measured-four-tick-move' };
    const first = event.frames[0]!, last = event.frames.at(-1)!;
    const delta = worldToBody(last.self.position.map((value, i) => value - first.self.position[i]!), first.self.yaw);
    const input = movementInputs(first), motor = identity({ cue: event.cue });
    this.#contexts.observeWindow(motor, event.id, [{ input, targets: [['forward', 0, delta[0]], ['lateral', 0, delta[1]]] }]);
    this.#ledger.commit(event.id, digest); this.#writes++;
    return { learned: true, reason: null, sourceEventSha256: digest, input, target: delta };
  }
  snapshot(): StageOneMovementSnapshot {
    return { version: 'StageOneMovement2', writes: this.#writes, contexts: this.#contexts.snapshot(), ledger: this.#ledger.snapshot() };
  }
  static restore(snapshot: StageOneMovementSnapshot) {
    if (snapshot.version !== 'StageOneMovement2' || !Number.isSafeInteger(snapshot.writes) || snapshot.writes < 0
      || snapshot.contexts.capacity !== 128 || snapshot.ledger.capacity !== 512) throw new Error('invalid-stage-one-model');
    const result = new StageOneMovement(); result.#contexts = ContextualReadout.restore(snapshot.contexts);
    result.#ledger = new ExperienceLedger(512, snapshot.ledger.retired, snapshot.ledger.recent, snapshot.ledger.streams);
    result.#writes = snapshot.writes; return result;
  }
}

export class StageOneController {
  #choices = 0;
  constructor(readonly model: StageOneMovement, readonly seed: number) {}
  choose(observation: Observation, available: readonly ActionOfferV1[], goal: XYZ | null) {
    const ordinal = this.#choices++, distance = (position: XYZ) => goal
      ? Math.hypot(position[0] - goal[0], position[2] - goal[2]) : 0;
    const candidates = movementOffers(available).map(offer => {
      const prediction = this.model.predict(observation, offer);
      const next = prediction.displacement ? observation.self.position.map((value, i) => value + prediction.displacement![i]!) as unknown as XYZ : null;
      return { offer, prediction, gain: next && prediction.supported ? distance(observation.self.position) - distance(next) : null,
        curiosity: 1 / (1 + prediction.samples) + Number(!prediction.supported),
        tie: sha({ seed: this.seed, ordinal, motor: prediction.motor }) };
    });
    // A terminal-only goal ranks learned, supported one-step effects. When
    // none offers progress, use uncertainty-driven physical probes. Unknown
    // effects never receive a hand-written motor-to-coordinate transformation.
    const useful = goal ? candidates.filter(value => value.gain !== null && value.gain > .01) : [];
    const ranked = useful.length ? useful.sort((a, b) => b.gain! - a.gain! || a.tie.localeCompare(b.tie, 'en'))
      : candidates.sort((a, b) => b.curiosity - a.curiosity || a.tie.localeCompare(b.tie, 'en'));
    return ranked[0] ? { ...ranked[0], ordinal, mode: useful.length ? 'learned-progress' : 'physical-probe', candidates } : null;
  }
}
