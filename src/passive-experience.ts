import type { Observation, RealEvent } from './contracts.js';
import { validateEvent } from './events.js';

/** Actual intervals with no commanded motor. Pausing collection at a motor
 * boundary prevents its effects from also being learned as passive change.
 * There is no interpolation across absent frames or a suspended interval. */
export class PassiveExperienceWindows {
  #frames: Observation[] = [];
  #counter = 0;
  constructor(readonly stream: string, readonly emit: (event: RealEvent) => void,
    readonly intervals = 10) {
    if (!stream || !Number.isSafeInteger(intervals) || intervals < 1 || intervals > 100)
      throw new Error('invalid-passive-window-configuration');
  }
  resume(frame: Observation): void { this.#frames = [frame]; }
  accept(frame: Observation): void {
    if (!this.#frames.length) return;
    const last = this.#frames.at(-1)!;
    if (last.sequence === frame.sequence) return;
    if (frame.sequence !== last.sequence + 1 || frame.activeSeconds <= last.activeSeconds)
      throw new Error('passive-observation-gap');
    this.#frames.push(frame);
    if (this.#frames.length > this.intervals) this.flush();
  }
  flush(): void {
    if (this.#frames.length < 2) return;
    const frames = this.#frames;
    const event: RealEvent = { version: 'RealEventV5', id: `${this.stream}:passive:event-${++this.#counter}`,
      cue: { kind: 'passive', parameters: { ticks: frames.length - 1 }, targetRole: null },
      frames, trackedIds: ['self', ...new Set(frames.flatMap(frame => frame.objects.map(object => object.id)))],
      bodyResult: null, provenance: 'observed-passive', complete: true };
    validateEvent(event); this.emit(event); this.#frames = [frames.at(-1)!];
  }
  suspend(): void { this.flush(); this.#frames = []; }
}
