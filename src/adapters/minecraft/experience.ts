import type { MinecraftBody } from '../../body.js';
import type { Observation, PublicValue, RealEvent } from '../../contracts.js';
import type { ActionOfferV1, GroundedGoalV1 } from '../../control/contracts.js';
import type { ExperienceEnvironment } from '../../experience-agent.js';
import { cueFor } from '../../events.js';
import { perceptualObjects } from '../../perception.js';

export function anonymousObservation(observation: Observation): Observation {
  if (!observation.perception) return observation; // Explicit synthetic/legacy measurement adapters.
  const { retinalTargetId: _binding, ...sensed } = observation;
  const { heldItem: _item, gameMode: _mode, ...remaining } = observation.self.properties;
  const properties: Record<string, PublicValue> = { ...remaining };
  for (const [index, slot] of (observation.hotbarSensation?.slots ?? []).entries()) {
    properties[`hotbarCount${index}`] = slot.count;
    if (slot.color) slot.color.forEach((value, axis) => properties[`hotbarColor${index}_${axis}`] = value);
  }
  const held = observation.hotbarSensation?.slots[Number(properties.selectedSlot)];
  if (held) {
    properties.gripCount = held.count;
    if (held.color) held.color.forEach((value, axis) => properties[`gripColor${axis}`] = value);
  }
  return { ...sensed, contextId: 'anonymous-sensing', self: { ...observation.self, properties },
    objects: perceptualObjects(observation.perception), targetId: observation.perception.gazeId };
}

/** Only public observations, currently available motor offers and actual body
 * receipts cross this adapter. Server commands and fixture mechanisms do not. */
export class MinecraftExperienceEnvironment implements ExperienceEnvironment {
  #rawFrames = new WeakMap<Observation, Observation>();
  #anonymous(raw: Observation): Observation {
    const observation = anonymousObservation(raw); this.#rawFrames.set(observation, raw); return observation;
  }
  // Physiological preferences are part of this body's calibration, not
  // learned action effects. The controller receives no remedy or recipe.
  // Each numeric channel is still unknown until the body measures it.
  readonly maintenanceGoals: readonly GroundedGoalV1[] = ['health', 'food', 'oxygen'].map(property => ({
    version: 'GroundedGoalV1', id: 'body-' + property, expression: { kind: 'predicate', predicate: {
      version: 'GoalPredicateV1', id: 'maintain-' + property, subject: { kind: 'self' },
      observable: `properties.${property}`, comparator: 'greater-than', target: 18, tolerance: 1e-6,
      residualScale: 20 } } }));
  constructor(readonly body: Pick<MinecraftBody,
    'latest' | 'listActionOffers' | 'describeActionRequirement' | 'execute' | 'waitForObservationAfter'>
    & Partial<Pick<MinecraftBody, 'takePassiveEvents'>>) {}
  #passive(event: RealEvent): RealEvent {
    const frames = event.frames.map(frame => this.#anonymous(frame));
    return { ...event, frames, attentionId: frames[0]!.perception?.attendedId,
      trackedIds: ['self', ...new Set(frames.flatMap(frame => frame.objects.map(object => object.id)))],
      hierarchyContinuity: undefined };
  }
  async drainPassiveEvents(): Promise<readonly RealEvent[]> {
    return (await this.body.takePassiveEvents?.() ?? []).map(event => this.#passive(event));
  }
  #available(offer: ActionOfferV1, observation: Observation): boolean {
    const id = offer.action.targetId;
    if (!id) return this.body.describeActionRequirement(offer.cue, observation).satisfied;
    const target = observation.objects.find(object => object.id === id);
    if (id !== observation.targetId || !target
      || (offer.cue.targetRole !== null && offer.cue.targetRole !== target.type)) return false;
    // A current motor offer already names the exact cursor target. The legacy
    // type-only recall check would reject it whenever another visible block
    // shares its type. Validate the binding above, then check cursor/reach facts.
    return this.body.describeActionRequirement({ ...offer.cue, targetRole: null }, observation).satisfied;
  }
  #visuallyBound(offer: ActionOfferV1, observation: Observation): boolean {
    if (!observation.perception || !offer.action.targetId) return true;
    return observation.retinalTargetId === undefined ? offer.action.targetId.startsWith('block:')
      : observation.retinalTargetId === offer.action.targetId;
  }
  async observe(): Promise<Observation> { return this.#anonymous(this.body.latest()); }
  #offersFor(raw: Observation, observation: Observation): readonly ActionOfferV1[] {
    return this.body.listActionOffers(raw).filter(offer =>
      this.#available(offer, raw))
      .filter(offer => this.#visuallyBound(offer, raw))
      .filter(offer => !offer.action.targetId || observation.targetId !== null)
      .map(offer => {
        const action = { ...offer.action, ...(offer.action.targetId ? { targetId: observation.targetId! } : {}) };
        return { ...offer, action, cue: cueFor(action, observation), observationSequence: observation.sequence };
      });
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    const raw = this.#rawFrames.get(observation);
    if (!raw) throw new Error('action-offers-require-an-actually-observed-frame');
    return this.#offersFor(raw, observation);
  }
  async executeOffer(offer: ActionOfferV1): ReturnType<ExperienceEnvironment['executeOffer']> {
    const current = this.body.latest(), perceived = this.#anonymous(current);
    const fresh = this.body.listActionOffers(current).find(value =>
      value.action.kind === offer.action.kind && JSON.stringify(value.action.parameters) === JSON.stringify(offer.action.parameters)
      && this.#visuallyBound(value, current)
      && this.#available(value, current)
      && (!value.action.targetId || offer.action.targetId === perceived.targetId));
    if (!fresh) return { executed: false, observation: perceived, event: null };
    const receipt = await this.body.execute(fresh.action, {
      version: 'ActionObservationScopeV1', referencedPublicObjectIds: current.objects.map(object => object.id),
    });
    const precedingPassiveEvents = receipt.precedingPassiveEvents?.map(event => this.#passive(event));
    if (!receipt.event || !current.perception) {
      const observation = this.#anonymous(this.body.latest()), first = receipt.event?.frames[0];
      return { executed: receipt.result.executed, observation, event: receipt.event, precedingPassiveEvents,
        ...(first ? { availableOffers: this.#offersFor(first, this.#anonymous(first)) } : {}) };
    }
    const frames = receipt.event.frames.map(frame => this.#anonymous(frame));
    // Losing an observational focus does not invalidate an unrelated motor.
    // Explicit null masks it; it must not silently select a new object later.
    const attentionId = offer.attentionId === undefined ? undefined
      : frames[0]!.objects.some(object => object.id === offer.attentionId) ? offer.attentionId : null;
    const action = { ...receipt.result.action, ...(receipt.result.action.targetId ? { targetId: frames[0]!.targetId! } : {}) };
    const event = { ...receipt.event, frames, attentionId, cue: cueFor(action, frames[0]!),
      trackedIds: ['self', ...new Set(frames.flatMap(frame => [attentionId, frame.perception?.attendedId, frame.targetId]
        .filter((id): id is string => typeof id === 'string')))],
      bodyResult: { ...receipt.result, action }, hierarchyContinuity: undefined };
    return { executed: receipt.result.executed, observation: frames.at(-1)!, event, precedingPassiveEvents,
      availableOffers: this.#offersFor(receipt.event.frames[0]!, frames[0]!) };
  }
  waitForObservationAfter(sequence: number): Promise<Observation> {
    return this.body.waitForObservationAfter(sequence).then(frame => this.#anonymous(frame));
  }
}
