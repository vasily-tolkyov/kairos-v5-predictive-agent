import { EventEmitter } from 'node:events';
import { BodySession, describeActionRequirement } from '../src/body.js';
import type { Action, ActionCue, BodyResult, Observation, RealEvent } from '../src/contracts.js';
import { cueFor, realEventHierarchyContinuityV1 } from '../src/events.js';
import { sha } from '../src/util.js';
import type { ActionObservationScopeV1, ActionOfferV1 } from '../src/control/contracts.js';

/**
 * Deterministic in-memory MinecraftBody stand-in for PLAN-005 fault-injection
 * and soak tests — no Minecraft, no network.  It mirrors the real body's
 * observable contract: physics frames on an asynchronous pump, executed
 * events with real change windows, connection-loss classification, and an
 * idempotent close that releases pending waiters.
 */
export class SyntheticBody extends EventEmitter {
  static #instances = 0;
  readonly session = new BodySession(0, `synthetic-${++SyntheticBody.#instances}`);
  readonly frames: Observation[] = [];
  #sequence = 0;
  #eventNumber = 0;
  #fatal: Error | null = null;
  #connectionFailure: Error | null = null;
  #closed = false;
  #closeCount = 0;
  #pump: NodeJS.Timeout | null = null;
  #disconnectAfterFrames: number | null = null;
  #disconnectOnNextExecute: number | null = null;
  readonly #stateFlips: ReadonlySet<number>;
  readonly #yawFlips: ReadonlySet<number>;
  constructor(readonly record: (kind: string, value: unknown) => void,
    changes: { readonly stateAt?: readonly number[]; readonly yawAt?: readonly number[] } = {}) {
    super();
    // Sparse, deterministic property flips: only a few attention windows ever
    // contain a change, so physics cost per synthetic run stays bounded while
    // notices, captures and passive commits are all exercised.
    this.#stateFlips = new Set(changes.stateAt ?? [60]);
    this.#yawFlips = new Set(changes.yawAt ?? [80]);
  }
  get connectionFailure(): Error | null { return this.#connectionFailure; }
  get closeCount(): number { return this.#closeCount; }
  get closed(): boolean { return this.#closed; }
  check(): void { if (this.#fatal) throw this.#fatal; }
  latest(): Observation {
    this.check();
    const frame = this.frames.at(-1);
    if (!frame) throw new Error('no-real-public-frame');
    return frame;
  }
  /** Arm a connection drop once `count` further frames have been emitted. */
  armDisconnectAfterFrames(count: number): void { this.#disconnectAfterFrames = count; }
  /** Arm a connection drop in the middle of the next execute() frame wait. */
  armDisconnectDuringNextExecute(count = 1): void { this.#disconnectOnNextExecute = count; }
  /** Continuous physics pump (25 ms per frame — 2x the live 50ms physicsTick). */
  startPump(): void {
    if (this.#pump !== null) return;
    this.#pump = setInterval(() => {
      if (this.#closed || this.#fatal) return;
      this.pushFrame();
    }, 25);
  }
  pushFrame(): Observation {
    this.#sequence++;
    const frame: Observation = { sequence: this.#sequence,
      activeSeconds: this.session.activeSeconds(this.#sequence),
      self: { position: [0, 0, 0],
        yaw: [...this.#yawFlips].filter(flip => flip <= this.#sequence).length % 2 === 1 ? .3 : 0,
        pitch: 0, properties: { health: 20 } },
      objects: [{ id: 'block:1,0,0', type: 'opaque-block', relativePosition: [1, 0, 0],
        properties: { state: [...this.#stateFlips].filter(flip => flip <= this.#sequence).length % 2 === 1 } }],
      targetId: 'block:1,0,0', contextId: 'synthetic-public-context' };
    this.frames.push(frame);
    if (this.frames.length > 24000) this.frames.shift();
    this.record('frame', frame);
    this.emit('frame', frame);
    if (this.#disconnectAfterFrames !== null && --this.#disconnectAfterFrames <= 0) {
      this.#disconnectAfterFrames = null;
      this.disconnect();
    }
    return frame;
  }
  disconnect(): void {
    if (this.#connectionFailure !== null) return;
    this.#connectionFailure = new Error('Minecraft disconnected: synthetic-fault-injection');
    this.#fatal = this.#connectionFailure;
    this.emit('fault', this.#connectionFailure);
  }
  async ready(): Promise<void> {
    this.pushFrame(); this.pushFrame(); this.pushFrame();
    this.startPump();
  }
  async waitForObservationAfter(sequence: number): Promise<Observation> {
    this.check();
    const current = this.frames.at(-1);
    if (current && current.sequence > sequence) return structuredClone(current);
    return new Promise<Observation>((resolve, reject) => {
      const cleanup = () => { this.off('frame', onFrame); this.off('fault', onFault); };
      const onFrame = (observation: Observation) => {
        if (observation.sequence <= sequence) return;
        cleanup(); resolve(structuredClone(observation));
      };
      const onFault = (error: Error) => { cleanup(); reject(error); };
      this.on('frame', onFrame); this.on('fault', onFault);
    });
  }
  listActionOffers(observation: Observation): readonly ActionOfferV1[] {
    const action: Action = { kind: 'wait', parameters: { ticks: 1 } };
    return [{ version: 'ActionOfferV1',
      offerId: sha({ observationSequence: observation.sequence, action }),
      observationSequence: observation.sequence, action: structuredClone(action),
      cue: cueFor(action, observation) }];
  }
  describeActionRequirement(actionCue: ActionCue, observation: Observation) {
    return describeActionRequirement(actionCue, observation);
  }
  async execute(action: Action, _scope?: ActionObservationScopeV1):
    Promise<{ result: BodyResult; event: RealEvent | null }> {
    this.check();
    if (this.#disconnectOnNextExecute !== null) {
      const count = this.#disconnectOnNextExecute;
      this.#disconnectOnNextExecute = null;
      this.armDisconnectAfterFrames(count);
    }
    const start = this.latest();
    // The event completes only when newer real frames arrive; a disconnect
    // mid-wait rejects exactly like the live body's pending wait does.
    await new Promise<void>((resolve, reject) => {
      let produced = 0;
      const onFault = (error: Error) => { clearInterval(timer); reject(error); };
      const timer = setInterval(() => {
        if (this.#fatal) { clearInterval(timer); this.off('fault', onFault); reject(this.#fatal); return; }
        this.pushFrame(); produced++;
        if (produced >= 3) { clearInterval(timer); this.off('fault', onFault); resolve(); }
      }, 2);
      this.on('fault', onFault);
    });
    const end = this.latest();
    const frames = this.frames.filter(frame =>
      frame.sequence >= start.sequence && frame.sequence <= end.sequence);
    const result: BodyResult = { action, executed: true, status: 'completed',
      startSequence: start.sequence, endSequence: end.sequence };
    const raw: RealEvent = { version: 'RealEventV5', id: this.session.eventId(++this.#eventNumber),
      cue: cueFor(action, start), frames, trackedIds: ['self', 'block:1,0,0'],
      bodyResult: result, provenance: 'executed-real-body', complete: true };
    const event: RealEvent = { ...raw,
      hierarchyContinuity: realEventHierarchyContinuityV1(raw, this.session.id) };
    return { result, event };
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true; this.#closeCount++;
    if (this.#pump !== null) clearInterval(this.#pump);
    this.#pump = null;
    this.emit('fault', new Error('minecraft-body-closed'));
  }
}
