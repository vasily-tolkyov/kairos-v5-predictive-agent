import { assert } from './util.js';

/** The minimal writable-stream surface the evidence writer needs. */
export interface EvidenceLaneStreamV1 {
  write(chunk: string): boolean;
  end(callback: () => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface EvidenceLane {
  readonly name: string;
  readonly stream: EvidenceLaneStreamV1;
  lines: string[];
  head: number;
  /** True while a pump coroutine owns the lane (set synchronously, cleared by the pump itself). */
  draining: boolean;
  pumpPromise: Promise<void> | null;
  /** Wakes a drain-waiting pump when the writer fails, so end() never hangs. */
  wake?: () => void;
}

/**
 * Bounded, backpressure-aware JSONL evidence writer (PLAN-005 1.4).
 *
 * Records are enqueued synchronously so hot callers (frames, attention) never
 * await; an internal pump honours `write()` backpressure and awaits `drain`.
 * The in-memory queue is bounded: a write error or queue overflow fails the
 * run explicitly through {@link failure} — evidence is never silently dropped.
 * `write()` itself never throws, so a failed stream cannot corrupt an
 * in-flight observation or the shutdown path; the run loop surfaces the
 * failure at the next watchdog tick and the terminal classification.
 */
export class EvidenceWriterV1 {
  #failure: Error | null = null;
  readonly #lanes: readonly EvidenceLane[];
  readonly #maxQueuedLines: number;
  constructor(lanes: { readonly events: EvidenceLaneStreamV1; readonly frames: EvidenceLaneStreamV1 },
    options: { readonly maxQueuedLines?: number } = {}) {
    this.#maxQueuedLines = options.maxQueuedLines ?? 65536;
    assert(Number.isSafeInteger(this.#maxQueuedLines) && this.#maxQueuedLines > 0,
      'invalid-evidence-queue-limit');
    this.#lanes = [
      { name: 'events', stream: lanes.events, lines: [], head: 0, draining: false, pumpPromise: null },
      { name: 'frames', stream: lanes.frames, lines: [], head: 0, draining: false, pumpPromise: null },
    ];
    for (const lane of this.#lanes)
      lane.stream.on('error', error => this.#fail(new Error(`evidence-stream-error:${lane.name}:${(error as Error).message}`)));
  }
  get failure(): Error | null { return this.#failure; }
  get queuedLines(): number {
    return this.#lanes.reduce((sum, lane) => sum + (lane.lines.length - lane.head), 0);
  }
  #fail(error: Error): void {
    if (this.#failure !== null) return;
    this.#failure = error;
    for (const lane of this.#lanes) lane.wake?.();
  }
  #lane(name: 'events' | 'frames'): EvidenceLane {
    const lane = this.#lanes.find(value => value.name === name);
    assert(lane !== undefined, 'unknown-evidence-lane');
    return lane;
  }
  write(laneName: 'events' | 'frames', line: string): void {
    if (this.#failure !== null) return; // the run is already failing explicitly; never throw mid-stride
    const lane = this.#lane(laneName);
    lane.lines.push(line);
    if (lane.lines.length - lane.head > this.#maxQueuedLines) {
      this.#fail(new Error(`evidence-queue-overflow:${lane.name}`));
      return;
    }
    this.#startPump(lane);
  }
  #startPump(lane: EvidenceLane): void {
    // Set the flag synchronously: the pump body runs synchronously up to its
    // first await, so assigning its promise here would race its own exit.
    if (lane.draining) return;
    lane.draining = true;
    lane.pumpPromise = this.#pump(lane);
  }
  async #pump(lane: EvidenceLane): Promise<void> {
    try {
      while (lane.head < lane.lines.length) {
        if (this.#failure !== null) return;
        let accepted = false;
        try { accepted = lane.stream.write(lane.lines[lane.head]!); }
        catch (error) { this.#fail(error as Error); return; }
        // A false return still accepted the line (it is buffered); it only
        // asks for backpressure.  Advance, then await drain before continuing.
        lane.head++;
        if (!accepted) {
          // A writer failure (stream error or overflow on the sibling lane)
          // wakes the wait too, so a dead or silent stream can never hang the
          // shutdown path.
          await new Promise<void>(resolve => {
            lane.wake = resolve;
            lane.stream.once('drain', () => resolve());
          });
          lane.wake = undefined;
          if (this.#failure !== null) return;
        }
      }
      lane.lines = []; lane.head = 0;
    } finally {
      // No await between the loop exit and this flag clear, so a concurrent
      // write() either was consumed by the loop above or restarts the pump.
      lane.draining = false;
    }
  }
  /** Await until every accepted line has been handed to the OS. */
  async flush(): Promise<void> {
    for (const lane of this.#lanes) {
      while (lane.head < lane.lines.length || lane.draining) {
        if (this.#failure !== null) break;
        if (lane.pumpPromise !== null) await lane.pumpPromise;
        else this.#startPump(lane);
      }
    }
    if (this.#failure !== null) throw this.#failure;
  }
  /** Flush what is flushable, then end both streams.  The failure (if any) is
   * reported through {@link failure}; ending is always attempted so file
   * handles never leak into process exit. */
  async end(): Promise<void> {
    for (const lane of this.#lanes) {
      while (lane.head < lane.lines.length || lane.draining) {
        if (this.#failure !== null) break;
        if (lane.pumpPromise !== null) await lane.pumpPromise;
        else this.#startPump(lane);
      }
    }
    await Promise.all(this.#lanes.map(lane => new Promise<void>(resolve => {
      try { lane.stream.end(() => resolve()); }
      catch { resolve(); }
    })));
  }
  /** Test/diagnostic helper: lines accepted but not yet flushed, per lane. */
  pendingLines(name: 'events' | 'frames'): number {
    const lane = this.#lane(name);
    return lane.lines.length - lane.head;
  }
}
