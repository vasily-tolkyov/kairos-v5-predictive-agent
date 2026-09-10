/**
 * Event-loop stall watchdog (PLAN-005 1.6).
 *
 * A timer measures how late each tick actually fires; the lateness is the
 * event-loop stall.  A stall beyond `recordThresholdMs` is written as a
 * first-class `stall` evidence record (with the measured duration).  When the
 * accumulated back-to-back stall exceeds `stopThresholdMs`, the watchdog
 * requests one protective checkpoint and then a clean stop, so a saturating
 * run ends as `stall-protective-stop` with evidence instead of a silent death.
 * It also polls the evidence writer's failure channel so a broken evidence
 * stream stops the run promptly and explicitly.
 *
 * The watchdog never throws and never touches physics; all thresholds are
 * constructor parameters with conservative production defaults.
 */
export interface StallWatchdogOptionsV1 {
  /** Measurement cadence.  Production default 1000 ms. */
  readonly intervalMs?: number;
  /** Stall evidence record threshold.  Production default 5000 ms. */
  readonly recordThresholdMs?: number;
  /** Sustained-stall protective stop threshold.  Production default 25000 ms. */
  readonly stopThresholdMs?: number;
  readonly record: (kind: string, value: unknown) => void;
  /** Protective checkpoint invoked once before the protective stop. */
  readonly checkpoint: () => Promise<void>;
  /** Clean-stop trigger (same path as operator stop). */
  readonly stop: () => void;
  /** Current evidence-writer failure, if any. */
  readonly evidenceFailure: () => Error | null;
  /** Called once when an evidence-writer failure is first observed. */
  readonly onEvidenceFailure: (error: Error) => void;
}

export class StallWatchdogV1 {
  readonly #options: Required<Pick<StallWatchdogOptionsV1, 'intervalMs' | 'recordThresholdMs' | 'stopThresholdMs'>>
    & StallWatchdogOptionsV1;
  #timer: NodeJS.Timeout | null = null;
  #last = 0;
  #sustainedStallMs = 0;
  #tickBusy = false;
  #protectiveStopTriggered = false;
  #evidenceFailureObserved = false;
  constructor(options: StallWatchdogOptionsV1) {
    this.#options = { intervalMs: options.intervalMs ?? 1000,
      recordThresholdMs: options.recordThresholdMs ?? 5000,
      stopThresholdMs: options.stopThresholdMs ?? 25000, ...options };
  }
  get protectiveStopTriggered(): boolean { return this.#protectiveStopTriggered; }
  start(): void {
    if (this.#timer !== null) return;
    this.#last = Date.now();
    this.#timer = setInterval(() => { void this.#tick(); }, this.#options.intervalMs);
    this.#timer.unref();
  }
  async #tick(): Promise<void> {
    if (this.#tickBusy) return;
    this.#tickBusy = true;
    try {
      const now = Date.now();
      const lagMs = now - this.#last - this.#options.intervalMs;
      this.#last = now;
      const evidenceFailure = this.#options.evidenceFailure();
      if (evidenceFailure !== null && !this.#evidenceFailureObserved) {
        this.#evidenceFailureObserved = true;
        this.#options.onEvidenceFailure(evidenceFailure);
      }
      if (lagMs <= this.#options.recordThresholdMs) { this.#sustainedStallMs = 0; return; }
      this.#sustainedStallMs += lagMs;
      this.#options.record('stall', { stallMs: lagMs, sustainedStallMs: this.#sustainedStallMs,
        measuredAt: new Date(now).toISOString() });
      if (this.#sustainedStallMs > this.#options.stopThresholdMs && !this.#protectiveStopTriggered) {
        this.#protectiveStopTriggered = true;
        this.#options.record('stall-protective-stop', { sustainedStallMs: this.#sustainedStallMs });
        try { await this.#options.checkpoint(); }
        catch (error) {
          this.#options.record('stall-checkpoint-failed',
            { message: error instanceof Error ? error.message : String(error) });
        } finally { this.#options.stop(); }
      }
    } finally { this.#tickBusy = false; }
  }
  dispose(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}
