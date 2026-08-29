import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import mineflayer, { type Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { Action, BodyResult, Observation, PublicObject, RealEvent } from './contracts.js';
import { cueFor } from './events.js';
import { assert, sha } from './util.js';
import { validateAction } from './analysis-actions.js';
import { publicLayoutContextId } from './public-context.js';

const tuple = (value: { x: number; y: number; z: number }): readonly [number, number, number] => [value.x, value.y, value.z];
const direction = (yaw: number, pitch: number) => new Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
export interface BodyConfiguration { host: '127.0.0.1'; port: number; username: string; worldId: string;
  sessionId?: string; activeSecondsOffset?: number; }
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
  #objects = new Map<string, { object: PublicObject; target: unknown }>();
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
  #capture(): Observation {
    this.#sequence++;
    const entity = this.bot.entity, position = entity.position, eye = position.offset(0, 1.62, 0);
    const objects = new Map<string, { object: PublicObject; target: unknown }>();
    // Only first ray intersections enter public input; loaded occluded blocks never enter the mirror.
    for (let h = -4; h <= 4; h++) for (let v = -3; v <= 3; v++) {
      const block = this.bot.world.raycast(eye, direction(entity.yaw + h * .14, entity.pitch + v * .16), 8) as unknown as Block | null;
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
      const occluder = this.bot.world.raycast(eye, delta.scaled(1 / distance), distance) as unknown as Block | null;
      if (occluder && occluder.position.distanceTo(eye) < distance - .6) continue;
      const id = `entity:${other.id}`;
      objects.set(id, { object: { id, type: other.name ?? other.type, relativePosition: tuple(other.position.minus(position)), properties: {} }, target: other });
    }
    // Mineflayer's helper rejects exact zero yaw/pitch through a truthiness check; use its same physical ray directly.
    const cursor = this.bot.world.raycast(eye, direction(entity.yaw, entity.pitch), 4.5) as unknown as Block | null;
    const targetId = cursor ? `block:${cursor.position.x},${cursor.position.y},${cursor.position.z}` : null;
    if (cursor && targetId) objects.set(targetId, { object: { id: targetId, type: cursor.name,
      relativePosition: tuple(cursor.position.plus(new Vec3(.5, .5, .5)).minus(position)), properties: { ...cursor.getProperties() } }, target: cursor });
    this.#objects = objects;
    const visible = [...objects.values()].map(value => value.object);
    return Object.freeze({ sequence: this.#sequence, activeSeconds: this.session.activeSeconds(this.#sequence),
      self: { position: tuple(position), yaw: entity.yaw, pitch: entity.pitch,
        properties: { onGround: entity.onGround, health: this.bot.health, food: this.bot.food,
          selectedSlot: this.bot.quickBarSlot, heldItem: this.bot.heldItem?.name ?? null,
          velocityX: entity.velocity.x, velocityY: entity.velocity.y, velocityZ: entity.velocity.z } },
      objects: visible, targetId,
      contextId: publicLayoutContextId(this.bot.game.dimension, visible) });
  }
  observationForAnalysis(): unknown {
    const frame = this.latest();
    return { sequence: frame.sequence, body: { ...frame.self.properties, yawDegrees: frame.self.yaw * 180 / Math.PI,
      pitchDegrees: frame.self.pitch * 180 / Math.PI }, objects: frame.objects.map(object => ({ ...object,
        relativePosition: object.relativePosition.map(value => Number(value.toFixed(3))) })), crosshair: frame.targetId,
      primitiveActionsForExecuteChain: { observe: 'ticks 1..100 (real observation window, distinct from the snapshot tool)', wait: 'ticks 1..100', look: 'relative yawDegrees/pitchDegrees -90..90',
        move: 'direction forward/back/left/right; ticks 1..20', jump: 'forward boolean; ticks 1..20',
        interact: 'targetId must still be the public crosshair block', attack: 'visible non-player crosshair entity only',
        break: 'current visible crosshair block', place: 'current visible support block and face', 'select-hotbar': 'slot 0..8' } };
  }
  async execute(action: Action): Promise<{ result: BodyResult; event: RealEvent | null }> {
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
        case 'interact': this.#physicalCalls++; await this.bot.activateBlock(this.#objects.get(action.targetId!)!.target as Parameters<Bot['activateBlock']>[0]); await this.waitTicks(1); break;
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
      let stable = 0; const stabilizationStart = this.#sequence;
      while (stable < 3 && this.#sequence - stabilizationStart < 80) {
        const before = this.latest(); await this.waitTicks(1); const after = this.latest();
        const moved = Math.hypot(...after.self.position.map((v, i) => v - before.self.position[i]!));
        const objectChanged = after.objects.some(object => {
          const earlier = before.objects.find(value => value.id === object.id);
          if (!earlier) return true;
          const displacement = Math.hypot(...object.relativePosition.map((v, i) => v - earlier.relativePosition[i]!
            + after.self.position[i]! - before.self.position[i]!));
          return displacement > .001 || sha(object.properties) !== sha(earlier.properties);
        }) || before.objects.some(object => !after.objects.some(value => value.id === object.id));
        stable = moved < .001 && !objectChanged ? stable + 1 : 0;
      }
      await this.waitTicks(2);
      const receipt = { ...result(true, 'completed'), terminationReason: stable >= 3 && digEnd?.reason !== 'observation-limit' ? 'stable' as const : 'observation-limit' as const };
      const frames = this.frames.filter(frame => frame.sequence >= start.sequence && frame.sequence <= receipt.endSequence);
      this.#eventNumber++;
      const event: RealEvent = { version: 'RealEventV5', id: this.session.eventId(this.#eventNumber), cue: cueFor(action, start),
        frames, trackedIds: ['self', ...new Set(frames.flatMap(frame => frame.objects.map(object => object.id)))],
        bodyResult: receipt, provenance: 'executed-real-body', complete: true };
      if (digEnd) this.record('dig-attempt', { targetId: action.targetId, startSequence: start.sequence, startCrosshair: start.targetId,
        forceEndSequence: digEnd.sequence, forceEndCrosshair: digEnd.crosshair, forceEndReason: digEnd.reason,
        endSequence: receipt.endSequence, endCrosshair: this.latest().targetId, terminationReason: receipt.terminationReason });
      this.record('body-result', receipt); return { result: receipt, event };
    } finally { this.bot.clearControlStates(); if (action.kind !== 'break' || this.bot.targetDigBlock) this.bot.stopDigging(); this.#executing = false; }
  }
  async close(): Promise<void> { this.#closed = true; this.bot.clearControlStates(); this.bot.stopDigging(); this.bot.quit('V5 run ended'); }
}
