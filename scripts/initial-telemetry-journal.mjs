/** Preserve actual transport records preceding the declared initial frame.
 * These are initialization evidence only, never newly invented event windows. */
export class InitialTelemetryJournal {
  #marked = false;
  capture(batch, initialSequence) {
    if (!batch) return null;
    const records = batch.records.filter(record => (record.kind === 'frame'
      ? record.observation.sequence : record.edge.clock.observationSequence) < initialSequence);
    if (this.#marked && !records.length) return null;
    this.#marked = true;
    return { version: 'InitialTelemetryArchive1', initialSequence,
      deliveredThroughOrder: batch.deliveredThroughOrder, receivedThroughOrder: batch.receivedThroughOrder, records };
  }
}
