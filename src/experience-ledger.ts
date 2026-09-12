import { createHash } from 'node:crypto';

/** Exact recent identity checks plus a bounded conservative retired filter.
 * A possible old event is refused, never relearned. False positives are an
 * explicit missed-learning outcome, not a false guarantee of exact replay. */
export class ExperienceLedger {
  #recent = new Map<string, string>();
  #streams = new Map<string, number>();
  #retired: Uint8Array;
  constructor(readonly capacity = 4096, retired?: string, recent: [string, string][] = [], streams?: [string, number][]) {
    if (!Number.isSafeInteger(capacity) || capacity < 8) throw new Error('invalid-ledger-capacity');
    this.#retired = retired ? Uint8Array.from(Buffer.from(retired, 'base64')) : new Uint8Array(1 << 19);
    if (this.#retired.length !== 1 << 19 || recent.length > capacity || new Set(recent.map(([id]) => id)).size !== recent.length)
      throw new Error('invalid-experience-ledger');
    this.#recent = new Map(recent);
    if (streams && (streams.length > 64 || new Set(streams.map(([id]) => id)).size !== streams.length
      || streams.some(([, n]) => !Number.isSafeInteger(n) || n < 1))) throw new Error('invalid-event-stream-ledger');
    this.#streams = new Map(streams ?? []);
    if (!streams) for (const [id] of recent) {
      const stream = this.#stream(id);
      if (stream) this.#rememberStream(stream);
    }
  }
  #rememberStream([id, counter]: [string, number]): void {
    this.#streams.set(id, Math.max(counter, this.#streams.get(id) ?? 0));
    if (this.#streams.size > 64) {
      const oldest = this.#streams.keys().next().value!;
      for (const bit of this.#bits('stream:' + oldest)) this.#retired[bit >>> 3]! |= 1 << (bit & 7);
      this.#streams.delete(oldest);
    }
  }
  #stream(id: string): [string, number] | null {
    // BodySession emits strictly increasing event counters. Out-of-order
    // historical replay must start from its earlier checkpoint, not relabel
    // old physical events as new observations.
    const match = /^(.*):event-([1-9][0-9]*)$/.exec(id), counter = Number(match?.[2]);
    return match && Number.isSafeInteger(counter) ? [match[1]!, counter] : null;
  }
  #bits(id: string): number[] {
    const digest = createHash('sha256').update(id).digest();
    return [0, 4, 8, 12].map(i => digest.readUInt32LE(i) % (this.#retired.length * 8));
  }
  check(id: string, digest: string): 'new' | 'duplicate' | 'retired-or-collision' {
    const known = this.#recent.get(id);
    if (known !== undefined) {
      if (known !== digest) throw new Error('experience-event-id-conflict');
      return 'duplicate';
    }
    const stream = this.#stream(id);
    if (stream) {
      const cursor = this.#streams.get(stream[0]);
      if (cursor !== undefined) return stream[1] <= cursor ? 'retired-or-collision' : 'new';
      if (this.#bits('stream:' + stream[0]).every(bit => this.#retired[bit >>> 3]! & (1 << (bit & 7))))
        return 'retired-or-collision';
    }
    return this.#bits(id).every(bit => this.#retired[bit >>> 3]! & (1 << (bit & 7))) ? 'retired-or-collision' : 'new';
  }
  commit(id: string, digest: string): void {
    this.#recent.set(id, digest);
    const stream = this.#stream(id);
    if (stream) this.#rememberStream(stream);
    if (this.#recent.size > this.capacity) {
      const oldest = this.#recent.keys().next().value!;
      if (!this.#stream(oldest)) for (const bit of this.#bits(oldest)) this.#retired[bit >>> 3]! |= 1 << (bit & 7);
      this.#recent.delete(oldest);
    }
  }
  snapshot() { return { capacity: this.capacity, retired: Buffer.from(this.#retired).toString('base64'),
    recent: [...this.#recent], streams: [...this.#streams] }; }
}
