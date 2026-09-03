import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block, Shape } from 'prismarine-block';
import type { Action, ActionCue, BodyResult, Observation, PublicObject, RealEvent } from './contracts.js';
import { actionObservationTrackedIdsV1, cueFor, realEventHierarchyContinuityV1 } from './events.js';
import { assert, sha } from './util.js';
import { validateAction } from './action-contract.js';
import { publicLayoutContextId } from './public-context.js';
import type { ActionObservationScopeV1, ActionOfferV1, GoalPredicateV1,
  PublicActionRequirementKindV2, PublicActionRequirementV2 } from './control/contracts.js';

const tuple = (value: { x: number; y: number; z: number }): readonly [number, number, number] => [value.x, value.y, value.z];
const direction = (yaw: number, pitch: number) => new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
type PublicRaycastBlock = Block & { readonly face?: number; readonly intersect?: Vec3 };
type PublicRaycastIteratorV1 = {
  intersect(shapes: readonly Shape[], position: Vec3): { readonly face: number; readonly pos: Vec3 } | null;
};
type PublicContinuityBindingV1 =
  | { readonly kind: 'block'; readonly id: string; readonly position: Vec3 }
  | { readonly kind: 'entity'; readonly id: string; readonly entityId: number };

const sixteenths = (shape: Shape): Shape => shape.map(value => value / 16) as Shape;

export function publicButtonSelectionShapeV1(
  properties: Readonly<Record<string, unknown>>,
): Shape | null {
  const face = properties.face, facing = properties.facing;
  const depth = properties.powered === true || properties.powered === 'true' ? 1 : 2;
  if (!['floor', 'wall', 'ceiling'].includes(String(face))
    || !['north', 'south', 'east', 'west'].includes(String(facing))) return null;
  if (face === 'floor' || face === 'ceiling') {
    const y0 = face === 'floor' ? 0 : 16 - depth, y1 = face === 'floor' ? depth : 16;
    return sixteenths(facing === 'north' || facing === 'south'
      ? [5, y0, 6, 11, y1, 10] : [6, y0, 5, 10, y1, 11]);
  }
  // Wall buttons sit at the voxel edge adjacent to their support. `facing`
  // points away from that support, so the outline occupies the opposite edge.
  if (facing === 'north') return sixteenths([5, 6, 16 - depth, 11, 10, 16]);
  if (facing === 'south') return sixteenths([5, 6, 0, 11, 10, depth]);
  if (facing === 'east') return sixteenths([0, 6, 5, depth, 10, 11]);
  return sixteenths([16 - depth, 6, 5, 16, 10, 11]);
}

/**
 * prismarine-block exposes collision shapes, while a Minecraft crosshair uses
 * selection/outline shapes. Vanilla buttons have no collision but do have a
 * state-dependent outline. Use that exact 1/16-unit ButtonBlock/model AABB;
 * unknown empty-collision blocks remain transparent until an authoritative
 * outline is available, so this repair cannot manufacture broad occlusion.
 */
export function publicBlockSelectionShapesV1(
  block: Pick<Block, 'name' | 'shapes' | 'getProperties'>,
): readonly Shape[] {
  if (block.shapes.length > 0) return block.shapes;
  if (!block.name.endsWith('_button')) return [];
  const shape = publicButtonSelectionShapeV1(
    block.getProperties() as Readonly<Record<string, unknown>>);
  return shape ? [shape] : [];
}

/** One DDA traversal owns both visibility and the exact interaction hit. */
export function publicBlockRaycastV1(world: Bot['world'], from: Vec3,
  rayDirection: Vec3, range: number): PublicRaycastBlock | null {
  const matcher = ((block: Block, iterator: PublicRaycastIteratorV1): boolean => {
    const intersect = iterator.intersect(publicBlockSelectionShapesV1(block), block.position);
    if (!intersect) return false;
    (block as Block & { face: number }).face = intersect.face;
    (block as Block & { intersect: Vec3 }).intersect = intersect.pos;
    return true;
  }) as (block: Block) => boolean;
  return world.raycast(from, rayDirection, range, matcher) as PublicRaycastBlock | null;
}

export function exactPublicBlockHit(block: PublicRaycastBlock): { direction: Vec3; cursor: Vec3 } {
  const directions = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1),
    new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)];
  assert(Number.isInteger(block.face) && block.face! >= 0 && block.face! < directions.length && block.intersect,
    'public-block-ray-hit-missing');
  const cursor = block.intersect.minus(block.position);
  assert([cursor.x, cursor.y, cursor.z].every(value => Number.isFinite(value) && value >= -1e-6 && value <= 1 + 1e-6),
    'public-block-ray-hit-outside-target');
  return { direction: directions[block.face!]!, cursor };
}
export function publicBlockInteractionPacket(block: PublicRaycastBlock,
  hit: ReturnType<typeof exactPublicBlockHit>, sequence: number) {
  assert(Number.isInteger(sequence) && sequence >= 0, 'invalid-public-block-interaction-sequence');
  const direction = hit.direction.y < 0 ? 0 : hit.direction.y > 0 ? 1 : hit.direction.z < 0 ? 2
    : hit.direction.z > 0 ? 3 : hit.direction.x < 0 ? 4 : 5;
  return { hand: 0, location: block.position, direction, cursorX: hit.cursor.x, cursorY: hit.cursor.y,
    cursorZ: hit.cursor.z, insideBlock: false, worldBorderHit: false, sequence };
}
export interface BodyConfiguration { host: '127.0.0.1'; port: number; username: string; worldId: string;
  sessionId?: string; activeSecondsOffset?: number; }

/**
 * Describe only the body's current public preconditions for a primitive action.
 *
 * This function deliberately returns no proposed action, direction, subgoal, or
 * method for satisfying a missing condition. Planning remains outside the body.
 */
export function describeActionRequirement(actionCue: ActionCue,
  observation: Observation): PublicActionRequirementV2 {
  const actionKind = actionCue.kind;
  assert(actionKind !== 'passive', 'passive-cue-has-no-body-action-requirement');
  const crosshairTarget = observation.targetId === null ? null
    : observation.objects.find(object => object.id === observation.targetId) ?? null;
  const publicKind = (id: string): 'block' | 'entity' | null => id.startsWith('block:') ? 'block'
    : id.startsWith('entity:') ? 'entity' : null;
  const requiredTargetKind = actionKind === 'attack' ? 'entity'
    : actionKind === 'interact' || actionKind === 'break' || actionKind === 'place' ? 'block' : null;
  const candidates = requiredTargetKind === null ? [] : observation.objects.filter(object =>
    publicKind(object.id) === requiredTargetKind
    && (actionCue.targetRole === null || object.type === actionCue.targetRole));
  // With a role-bearing learned cue the body may ground a missing public fact
  // only when exactly one currently public object has that role. It does not
  // choose between several objects or suggest how to reach the unique one.
  const uniqueTarget = candidates.length === 1 ? candidates[0]! : actionCue.targetRole === null
    && crosshairTarget && publicKind(crosshairTarget.id) === requiredTargetKind ? crosshairTarget : null;
  const targetKind = crosshairTarget ? publicKind(crosshairTarget.id) : null;
  const required: PublicActionRequirementKindV2[] = [];
  if (actionKind === 'attack') required.push('public-crosshair-entity');
  else if (actionKind === 'interact' || actionKind === 'break' || actionKind === 'place')
    required.push('public-crosshair-block');
  if (requiredTargetKind !== null) required.push('public-unique-target-within-interaction-distance');
  if (actionKind === 'place') required.push('public-held-item');
  const heldItem = observation.self.properties.heldItem;
  const missing = required.filter(requirement => {
    if (requirement === 'public-crosshair-block')
      return targetKind !== 'block' || !uniqueTarget || crosshairTarget?.id !== uniqueTarget.id;
    if (requirement === 'public-crosshair-entity')
      return targetKind !== 'entity' || !uniqueTarget || crosshairTarget?.id !== uniqueTarget.id;
    if (requirement === 'public-unique-target-within-interaction-distance')
      return !uniqueTarget || Math.hypot(...uniqueTarget.relativePosition) > 4.5;
    return typeof heldItem !== 'string' || heldItem.length === 0;
  });
  const uniqueTargetKind = uniqueTarget ? publicKind(uniqueTarget.id) : null;
  const targetBinding = uniqueTarget && uniqueTargetKind
    ? { objectId: uniqueTarget.id, objectType: uniqueTarget.type, publicKind: uniqueTargetKind,
      observationSequence: observation.sequence } as const
    : null;
  const predicates: GoalPredicateV1[] = [];
  if (required.includes('public-crosshair-block') || required.includes('public-crosshair-entity'))
    predicates.push({ version: 'GoalPredicateV1', id: 'public-crosshair-target', subject: { kind: 'crosshair' },
      observable: actionCue.targetRole === null ? 'visible' : 'type', comparator: 'equals',
      target: actionCue.targetRole ?? true });
  if (required.includes('public-unique-target-within-interaction-distance') && uniqueTarget)
    predicates.push({ version: 'GoalPredicateV1', id: 'public-target-within-interaction-distance',
      subject: { kind: 'public-object', id: uniqueTarget.id, expectedType: uniqueTarget.type },
      observable: 'relativeDistance', comparator: 'within', lower: 0, upper: 4.5 });
  if (required.includes('public-held-item')) predicates.push({ version: 'GoalPredicateV1', id: 'public-held-item',
    subject: { kind: 'self' }, observable: 'properties.heldItem', comparator: 'not-equals', target: null });
  const goal = predicates.length === 0 ? null : {
    version: 'GroundedGoalV1' as const,
    id: `public-action-requirement:${sha({ actionCue, predicates })}`,
    expression: predicates.length === 1 ? { kind: 'predicate' as const, predicate: predicates[0]! }
      : { kind: 'all' as const, children: predicates.map(predicate => ({ kind: 'predicate' as const, predicate })) },
  };
  return Object.freeze({ version: 'PublicActionRequirementV2', actionCue: structuredClone(actionCue),
    observationSequence: observation.sequence, satisfied: missing.length === 0,
    required: Object.freeze(required), missing: Object.freeze(missing), goal, targetBinding });
}
/** Session-local sequence, continuous experienced time. Offline wall time is not an input. */
export class BodySession {
  constructor(readonly activeSecondsOffset = 0, readonly id: string = randomUUID()) {
    assert(Number.isFinite(activeSecondsOffset) && activeSecondsOffset >= 0, 'invalid-experience-time-offset');
    assert(id.length > 0, 'missing-body-session-id');
  }
  activeSeconds(sequence: number): number {
    assert(Number.isInteger(sequence) && sequence > 0, 'invalid-physical-tick-sequence');
    return this.activeSecondsOffset + sequence * .05;
  }
  eventId(number: number): string { return `${this.id}:event-${number}`; }
}
/** This is the sole live-body owner. It has no model, forecast, rules, or action fallback. */
export class MinecraftBody extends EventEmitter {
  readonly bot: Bot;
  readonly session: BodySession;
  readonly frames: Observation[] = [];
  #sequence = 0;
  #fatal: Error | null = null;
  #closed = false;
  #executing = false;
  #eventNumber = 0;
  #physicalCalls = 0;
  #blockInteractionSequence = 0;
  #objects = new Map<string, { object: PublicObject; target: unknown }>();
  // The currently grounded action/goal scope is a public observation
  // continuity binding, not a hidden-world subscription.  Only objects that
  // were already public when execute() accepted the action can enter it.
  #publicContinuityBindings = new Map<string, PublicContinuityBindingV1>();
  constructor(configuration: BodyConfiguration, readonly record: (kind: string, value: unknown) => void) {
    super(); this.session = new BodySession(configuration.activeSecondsOffset, configuration.sessionId);
    assert(configuration.host === '127.0.0.1', 'only-isolated-loopback-world');
    this.bot = mineflayer.createBot({ host: configuration.host, port: configuration.port, username: configuration.username,
      version: '1.21.4', auth: 'offline', hideErrors: false, viewDistance: 'short' });
    this.bot.on('error', error => this.#fail(error));
    this.bot.on('kicked', reason => this.#fail(new Error(`Minecraft kicked: ${JSON.stringify(reason)}`)));
    this.bot.on('end', reason => { if (!this.#closed) this.#fail(new Error(`Minecraft disconnected: ${reason}`)); });
    this.bot.on('physicsTick', () => {
      if (this.#closed || this.#fatal || !this.bot.entity) return;
      try { const frame = this.#capture(); this.frames.push(frame);
        if (this.frames.length > 24000) this.frames.shift();
        this.record('frame', frame); this.emit('frame', frame);
      } catch (error) { this.#fail(error as Error); }
    });
    // An unsupported UI is a real body outcome, not permission to operate inventory.
    this.bot.on('windowOpen', window => this.bot.closeWindow(window));
  }
  #fail(error: Error): void { this.#fatal ??= error; this.emit('fault', error); }
  check(): void { if (this.#fatal) throw this.#fatal; }
  get executing(): boolean { return this.#executing; }
  get physicalCalls(): number { return this.#physicalCalls; }
  latest(): Observation { this.check(); const frame = this.frames.at(-1); assert(frame, 'no-real-public-frame'); return frame; }
  async ready(): Promise<void> { await this.#until(() => this.frames.length >= 3, 120_000); }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    this.check();
    const current = this.frames.at(-1);
    if (current && current.sequence > sequence) return structuredClone(current);
    return new Promise<Observation>((resolve, reject) => {
      const cleanup = () => { this.off('frame', frame); this.off('fault', fault); };
      const frame = (observation: Observation) => {
        if (observation.sequence <= sequence) return;
        cleanup(); resolve(structuredClone(observation));
      };
      const fault = (error: Error) => { cleanup(); reject(error); };
      this.on('frame', frame); this.on('fault', fault);
      try {
        this.check();
        const latest = this.frames.at(-1);
        if (latest && latest.sequence > sequence) frame(latest);
      } catch (error) { fault(error as Error); }
    });
  }
  async #until(predicate: () => boolean, timeout: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted || predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.off('frame', frame); this.off('fault', fail); signal?.removeEventListener('abort', cancel); };
      const frame = () => { if (predicate()) { cleanup(); resolve(); } };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const cancel = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => fail(new Error('Minecraft real-frame timeout')), timeout);
      this.on('frame', frame); this.on('fault', fail); signal?.addEventListener('abort', cancel, { once: true });
      if (this.#fatal) fail(this.#fatal); else if (signal?.aborted) cancel();
    });
  }
  async waitTicks(count: number, signal?: AbortSignal): Promise<void> {
    this.check(); const start = this.#sequence;
    await this.#until(() => this.#sequence >= start + count, Math.max(10_000, count * 200), signal); this.check();
  }
  async #digWithinWindow(target: Parameters<Bot['dig']>[0]): Promise<'completed' | 'observation-limit'> {
    const controller = new AbortController();
    const window = this.waitTicks(200, controller.signal).then(() => ({ kind: 'observation-limit' as const }),
      (error: unknown) => ({ kind: 'error' as const, error }));
    const failure: { occurred: boolean; error?: unknown } = { occurred: false };
    try {
      // The model already chose the public crosshair target. Dig must not turn the body again.
      const digging = this.bot.dig(target, 'ignore').then(() => ({ kind: 'completed' as const }), (error: unknown) => {
        failure.occurred = true; failure.error = error; return { kind: 'error' as const, error };
      });
      const first = await Promise.race([digging, window]); this.check();
      if (first.kind === 'error') throw first.error;
      if (first.kind === 'completed') return 'completed';
      // A rejection already received before our stop is never reclassified as our cancellation.
      if (failure.occurred) throw failure.error;
      let canceledByThisStop = false;
      const aborted = (block: Block) => { if (block === target) canceledByThisStop = true; };
      this.bot.on('diggingAborted', aborted);
      try {
        this.bot.stopDigging();
        const stopped = await digging; this.check();
        // Mineflayer 4.37.1 emits this event for the same block and rejects with this explicit error.
        if (stopped.kind === 'error' && !(canceledByThisStop && stopped.error instanceof Error && stopped.error.message === 'Digging aborted'))
          throw stopped.error;
      } finally { this.bot.off('diggingAborted', aborted); }
      return 'observation-limit';
    } finally { controller.abort(); } // No old frame listener/timer survives a completed or failed dig.
  }
  #replacePublicContinuityBindings(action: Action, scope: ActionObservationScopeV1 | undefined,
    observation: Observation): readonly string[] {
    const requested = [...new Set([action.targetId, ...(scope?.referencedPublicObjectIds ?? [])]
      .filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const next = new Map<string, PublicContinuityBindingV1>();
    for (const id of requested) {
      if (!observation.objects.some(object => object.id === id)) continue;
      const block = /^block:(-?\d+),(-?\d+),(-?\d+)$/.exec(id);
      if (block) {
        next.set(id, { kind: 'block', id,
          position: new Vec3(Number(block[1]), Number(block[2]), Number(block[3])) });
        continue;
      }
      const entity = /^entity:(\d+)$/.exec(id);
      if (entity) next.set(id, { kind: 'entity', id, entityId: Number(entity[1]) });
    }
    this.#publicContinuityBindings = next;
    return [...next.keys()];
  }
  #appendPublicContinuityObjects(objects: Map<string, { object: PublicObject; target: unknown }>,
    bodyPosition: Vec3, eye: Vec3, yaw: number, pitch: number): void {
    const camera = direction(yaw, pitch);
    for (const binding of this.#publicContinuityBindings.values()) {
      if (objects.has(binding.id)) continue;
      if (binding.kind === 'entity') {
        // Entity public visibility already uses its current center, FOV and
        // block occlusion above.  Missing entities are not reintroduced from
        // the loaded entity table.
        continue;
      }
      const center = binding.position.offset(.5, .5, .5), delta = center.minus(eye);
      const distance = delta.norm();
      if (distance < .01 || distance > 8) continue;
      const ray = delta.scaled(1 / distance);
      if (camera.dot(ray) < .70) continue;
      // Continue an already-public coordinate only while the path to that
      // coordinate is still public.  A rotated/open outline may yield no hit;
      // a different nearer block is an occluder and closes the observation.
      const occluder = publicBlockRaycastV1(this.bot.world, eye, ray, distance + .01);
      const occluderId = occluder
        ? `block:${occluder.position.x},${occluder.position.y},${occluder.position.z}` : null;
      if (occluder && occluderId !== binding.id
        && occluder.position.plus(new Vec3(.5, .5, .5)).distanceTo(eye) < distance - .05) continue;
      const block = this.bot.blockAt(binding.position);
      if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;
      objects.set(binding.id, { object: { id: binding.id, type: block.name,
        relativePosition: tuple(block.position.plus(new Vec3(.5, .5, .5)).minus(bodyPosition)),
        properties: { ...block.getProperties() } }, target: block });
    }
  }
  #capture(): Observation {
    this.#sequence++;
    const entity = this.bot.entity, position = entity.position, eye = position.offset(0, 1.62, 0);
    const objects = new Map<string, { object: PublicObject; target: unknown }>();
    // Only first ray intersections enter public input; loaded occluded blocks never enter the mirror.
    for (let h = -4; h <= 4; h++) for (let v = -3; v <= 3; v++) {
      const block = publicBlockRaycastV1(this.bot.world, eye,
        direction(entity.yaw + h * .14, entity.pitch + v * .16), 8);
      if (!block) continue;
      const id = `block:${block.position.x},${block.position.y},${block.position.z}`;
      objects.set(id, { object: { id, type: block.name, relativePosition: tuple(block.position.plus(new Vec3(.5, .5, .5)).minus(position)),
        properties: { ...block.getProperties() } }, target: block });
    }
    for (const other of Object.values(this.bot.entities)) {
      if (other.id === entity.id || other.type === 'player') continue;
      const center = other.position.offset(0, (other.height ?? 1) * .5, 0), delta = center.minus(eye), distance = delta.norm();
      if (distance > 8 || distance < .01) continue;
      if (direction(entity.yaw, entity.pitch).dot(delta.scaled(1 / distance)) < .70) continue;
      const occluder = publicBlockRaycastV1(this.bot.world, eye,
        delta.scaled(1 / distance), distance);
      if (occluder && occluder.position.distanceTo(eye) < distance - .6) continue;
      const id = `entity:${other.id}`;
      objects.set(id, { object: { id, type: other.name ?? other.type, relativePosition: tuple(other.position.minus(position)), properties: {} }, target: other });
    }
    this.#appendPublicContinuityObjects(objects, position, eye, entity.yaw, entity.pitch);
    // Mineflayer's helper rejects exact zero yaw/pitch through a truthiness check; use its same physical ray directly.
    const cursor = publicBlockRaycastV1(this.bot.world, eye,
      direction(entity.yaw, entity.pitch), 4.5);
    const entityCursor = this.bot.entityAtCursor(3.5);
    const blockDistance = cursor ? cursor.position.plus(new Vec3(.5, .5, .5)).distanceTo(eye) : Number.POSITIVE_INFINITY;
    const entityDistance = entityCursor && entityCursor.type !== 'player' ? entityCursor.position.distanceTo(eye) : Number.POSITIVE_INFINITY;
    const targetId = entityDistance < blockDistance ? `entity:${entityCursor!.id}`
      : cursor ? `block:${cursor.position.x},${cursor.position.y},${cursor.position.z}` : null;
    if (cursor) {
      const id = `block:${cursor.position.x},${cursor.position.y},${cursor.position.z}`;
      objects.set(id, { object: { id, type: cursor.name,
        relativePosition: tuple(cursor.position.plus(new Vec3(.5, .5, .5)).minus(position)), properties: { ...cursor.getProperties() } }, target: cursor });
    }
    if (entityCursor && entityCursor.type !== 'player' && targetId === `entity:${entityCursor.id}`) {
      objects.set(targetId, { object: { id: targetId, type: entityCursor.name ?? entityCursor.type,
        relativePosition: tuple(entityCursor.position.minus(position)), properties: {} }, target: entityCursor });
    }
    this.#objects = objects;
    const visible = [...objects.values()].map(value => value.object);
    return Object.freeze({ sequence: this.#sequence, activeSeconds: this.session.activeSeconds(this.#sequence),
      self: { position: tuple(position), yaw: entity.yaw, pitch: entity.pitch,
        properties: { onGround: entity.onGround, health: this.bot.health, food: this.bot.food,
          selectedSlot: this.bot.quickBarSlot, heldItem: this.bot.heldItem?.name ?? null,
          gameMode: this.bot.game.gameMode,
          velocityX: entity.velocity.x, velocityY: entity.velocity.y, velocityZ: entity.velocity.z } },
      objects: visible, targetId,
      contextId: publicLayoutContextId(this.bot.game.dimension, visible) });
  }
  listActionOffers(observation: Observation = this.latest()): readonly ActionOfferV1[] {
    // Offers are the immutable action catalogue belonging to this captured
    // public frame. Minecraft may advance while physical reasoning runs; the
    // runtime rebinds the selected cue against the latest frame immediately
    // before execution. Requiring the captured frame to still be globally
    // latest here would break the observation+offers event boundary.
    const actions: Action[] = [
      { kind: 'observe', parameters: { ticks: 5 } }, { kind: 'observe', parameters: { ticks: 20 } },
      { kind: 'wait', parameters: { ticks: 5 } }, { kind: 'wait', parameters: { ticks: 20 } },
      { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } },
      { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } },
      { kind: 'look', parameters: { yawDegrees: 0, pitchDegrees: -15 } },
      { kind: 'look', parameters: { yawDegrees: 0, pitchDegrees: 15 } },
      ...['forward', 'back', 'left', 'right'].map(direction => ({ kind: 'move' as const, parameters: { direction, ticks: 4 } })),
      { kind: 'jump', parameters: { forward: false, ticks: 4 } },
      { kind: 'jump', parameters: { forward: true, ticks: 4 } },
      ...Array.from({ length: 9 }, (_, slot) => ({ kind: 'select-hotbar' as const, parameters: { slot } })),
    ];
    const target = observation.targetId ? observation.objects.find(object => object.id === observation.targetId) : null;
    if (target?.id.startsWith('entity:')) actions.push({ kind: 'attack', parameters: {}, targetId: target.id });
    if (target?.id.startsWith('block:')) {
      actions.push({ kind: 'interact', parameters: {}, targetId: target.id },
        { kind: 'break', parameters: {}, targetId: target.id });
      if (typeof observation.self.properties.heldItem === 'string') for (const face of ['up', 'north', 'south', 'east', 'west'])
        actions.push({ kind: 'place', parameters: { face }, targetId: target.id });
    }
    return actions.map(action => { validateAction(action); return { version: 'ActionOfferV1',
      offerId: sha({ observationSequence: observation.sequence, action }), observationSequence: observation.sequence,
      action: structuredClone(action), cue: cueFor(action, observation) }; });
  }
  describeActionRequirement(actionCue: ActionCue,
    observation: Observation = this.latest()): PublicActionRequirementV2 {
    // Requirements belong to the same immutable observation envelope as the
    // action offers.  They describe only what was publicly missing at that
    // frame; execute() still rebinds the selected real target against the
    // newest frame before touching Minecraft.
    return describeActionRequirement(actionCue, observation);
  }
  async execute(action: Action, observationScope?: ActionObservationScopeV1): Promise<{ result: BodyResult; event: RealEvent | null }> {
    this.check(); validateAction(action); assert(!this.#executing, 'body-already-executing'); this.#executing = true;
    const start = this.latest();
    const result = (executed: boolean, status: BodyResult['status']): BodyResult => ({ action, executed, status,
      startSequence: start.sequence, endSequence: this.latest().sequence });
    const integer = (key: string, min: number, max: number, fallback: number) => {
      const value = action.parameters[key] ?? fallback; assert(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, `invalid-${key}`); return value;
    };
    let digEnd: { sequence: number; crosshair: string | null; reason: 'completed' | 'observation-limit' } | null = null;
    try {
      if (['interact', 'break', 'place', 'attack'].includes(action.kind)) {
        const bound = this.#objects.get(action.targetId ?? '');
        if (!bound || (action.kind !== 'attack' && start.targetId !== action.targetId)) return { result: result(false, 'no-target'), event: null };
        if (Math.hypot(...bound.object.relativePosition) > 4.5) return { result: result(false, 'out-of-reach'), event: null };
      }
      const continuityIds = this.#replacePublicContinuityBindings(action, observationScope, start);
      const explicitlyReferencedIds = (observationScope?.referencedPublicObjectIds ?? [])
        .filter(id => continuityIds.includes(id));
      const interactOutcomeIds = explicitlyReferencedIds.length > 0 ? explicitlyReferencedIds
        : action.targetId && continuityIds.includes(action.targetId) ? [action.targetId] : [];
      switch (action.kind) {
        case 'observe': case 'wait': await this.waitTicks(integer('ticks', 1, 100, 5)); break;
        case 'look': {
          const yaw = Number(action.parameters.yawDegrees), pitch = Number(action.parameters.pitchDegrees);
          assert(Number.isFinite(yaw) && Number.isFinite(pitch) && Math.abs(yaw) <= 90 && Math.abs(pitch) <= 90, 'invalid-look-angles');
          this.#physicalCalls++; await this.bot.look(this.bot.entity.yaw + yaw * Math.PI / 180,
            Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.bot.entity.pitch + pitch * Math.PI / 180)), false);
          await this.waitTicks(1); break;
        }
        case 'move': {
          const key = String(action.parameters.direction); assert(['forward', 'back', 'left', 'right'].includes(key), 'invalid-move-direction');
          this.#physicalCalls++; this.bot.setControlState(key as 'forward', true); await this.waitTicks(integer('ticks', 1, 20, 4)); break;
        }
        case 'jump': this.#physicalCalls++; this.bot.setControlState('jump', true);
          if (action.parameters.forward === true) this.bot.setControlState('forward', true);
          await this.waitTicks(1); this.bot.setControlState('jump', false); await this.waitTicks(integer('ticks', 1, 20, 4)); break;
        case 'select-hotbar': this.#physicalCalls++; this.bot.setQuickBarSlot(integer('slot', 0, 8, 0)); await this.waitTicks(1); break;
        case 'interact': {
          this.#physicalCalls++;
          const block = this.#objects.get(action.targetId!)!.target as PublicRaycastBlock;
          const hit = exactPublicBlockHit(block);
          const packet = publicBlockInteractionPacket(block, hit, this.#blockInteractionSequence++);
          this.record('block-interaction-attempt', { targetId: action.targetId, observationSequence: start.sequence,
            face: block.face, intersect: block.intersect, packet });
          this.bot._client.write('block_place', packet); this.bot.swingArm('right'); await this.waitTicks(1); break;
        }
        case 'break': {
          this.#physicalCalls++;
          this.record('dig-attempt-start', { sequence: start.sequence, targetId: action.targetId, crosshair: start.targetId });
          const reason = await this.#digWithinWindow(this.#objects.get(action.targetId!)!.target as Parameters<Bot['dig']>[0]);
          const end = this.latest(); digEnd = { sequence: end.sequence, crosshair: end.targetId, reason }; break;
        }
        case 'attack': {
          const target = this.bot.entityAtCursor(3.5);
          if (!target || target.type === 'player' || `entity:${target.id}` !== action.targetId) return { result: result(false, 'no-target'), event: null };
          this.#physicalCalls++; this.bot.attack(target); await this.waitTicks(1); break;
        }
        case 'place': {
          if (!this.bot.heldItem) return { result: result(false, 'unavailable'), event: null };
          const face = action.parameters.face; const faces: Record<string, Vec3> = { up: new Vec3(0, 1, 0), north: new Vec3(0, 0, -1), south: new Vec3(0, 0, 1), east: new Vec3(1, 0, 0), west: new Vec3(-1, 0, 0) };
          assert(typeof face === 'string' && faces[face], 'invalid-place-face');
          this.#physicalCalls++; await this.bot.placeBlock(this.#objects.get(action.targetId!)!.target as Parameters<Bot['placeBlock']>[0], faces[face]!); break;
        }
        default: throw new Error(`unsupported-body-action:${action.kind}`);
      }
      this.bot.clearControlStates();
      // Stable completion is observed, not assumed from a successful API return.
      let stable = 0, interactEffectObserved = false; const stabilizationStart = this.#sequence;
      const objectChanged = (before: Observation, after: Observation, id: string): boolean => {
        const earlier = before.objects.find(value => value.id === id);
        const later = after.objects.find(value => value.id === id);
        if (!earlier || !later) return earlier !== later;
        const displacement = Math.hypot(...later.relativePosition.map((value, index) => value
          - earlier.relativePosition[index]! + after.self.position[index]! - before.self.position[index]!));
        return displacement > .001 || later.type !== earlier.type
          || sha(later.properties) !== sha(earlier.properties);
      };
      while (stable < 3 && this.#sequence - stabilizationStart < 80) {
        const before = this.latest(); await this.waitTicks(1); const after = this.latest();
        const moved = Math.hypot(...after.self.position.map((v, i) => v - before.self.position[i]!));
        const anyObjectChanged = after.objects.some(object => {
          const earlier = before.objects.find(value => value.id === object.id);
          if (!earlier) return true;
          const displacement = Math.hypot(...object.relativePosition.map((v, i) => v - earlier.relativePosition[i]!
            + after.self.position[i]! - before.self.position[i]!));
          return displacement > .001 || sha(object.properties) !== sha(earlier.properties);
        }) || before.objects.some(object => !after.objects.some(value => value.id === object.id));
        if (action.kind === 'interact') {
          if (!interactEffectObserved)
            interactEffectObserved = interactOutcomeIds.some(id => objectChanged(start, after, id));
          const scopedStable = continuityIds.every(id => !objectChanged(before, after, id));
          // One full stone-button pulse fits inside 24 physical ticks, while
          // the same rule also covers other asynchronous public interaction
          // results.  No referenced effect is a real no-effect event and runs
          // normally to the explicit 80-tick observation ceiling.
          stable = interactEffectObserved && this.#sequence - stabilizationStart >= 24
            && moved < .001 && scopedStable ? stable + 1 : 0;
        } else stable = moved < .001 && !anyObjectChanged ? stable + 1 : 0;
      }
      const observationWindowExhausted = this.#sequence - stabilizationStart >= 80;
      await this.waitTicks(2);
      const terminationReason: NonNullable<BodyResult['terminationReason']> = stable >= 3
        && digEnd?.reason !== 'observation-limit' ? 'stable'
        : action.kind === 'interact' && !interactEffectObserved && observationWindowExhausted
          ? 'no-effect-window-complete' : 'observation-limit';
      const receipt = { ...result(true, 'completed'), terminationReason };
      const frames = this.frames.filter(frame => frame.sequence >= start.sequence && frame.sequence <= receipt.endSequence);
      this.#eventNumber++;
      const eventWithoutContinuity: RealEvent = { version: 'RealEventV5', id: this.session.eventId(this.#eventNumber), cue: cueFor(action, start),
        // The body only applies an observation scope selected mechanically by
        // already-grounded goals. Runtime may append objects actually noticed
        // by attention inside this same action window before committing it.
        trackedIds: actionObservationTrackedIdsV1(action.targetId, observationScope, [], frames), frames,
        bodyResult: receipt, provenance: 'executed-real-body', complete: true };
      const event: RealEvent = { ...eventWithoutContinuity,
        hierarchyContinuity: realEventHierarchyContinuityV1(eventWithoutContinuity, this.session.id) };
      if (digEnd) this.record('dig-attempt', { targetId: action.targetId, startSequence: start.sequence, startCrosshair: start.targetId,
        forceEndSequence: digEnd.sequence, forceEndCrosshair: digEnd.crosshair, forceEndReason: digEnd.reason,
        endSequence: receipt.endSequence, endCrosshair: this.latest().targetId, terminationReason: receipt.terminationReason });
      this.record('body-result', receipt); return { result: receipt, event };
    } finally { this.bot.clearControlStates(); if (action.kind !== 'break' || this.bot.targetDigBlock) this.bot.stopDigging(); this.#executing = false; }
  }
  async close(): Promise<void> { this.#closed = true; this.bot.clearControlStates(); this.bot.stopDigging(); this.bot.quit('V5 run ended'); }
}
