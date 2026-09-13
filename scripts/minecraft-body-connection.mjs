import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MinecraftBody, PhysicalTelemetryQueue, describeActionRequirement } from '../dist/src/body.js';
import { MinecraftActionStartProtocol } from '../dist/src/adapters/minecraft/action-start.js';

// The physical connection has its own clock. Expensive learning, cloning and
// serialization must not suspend Minecraft's keepalives or sensor acquisition.
// The worker owns only the existing body, never a policy or a server command.
if (!isMainThread) {
  const body = new MinecraftBody(workerData, (kind, value) => parentPort.postMessage({ kind, value }));
  const starts = new MinecraftActionStartProtocol(body,
    value => parentPort.postMessage({ kind: 'body-action-start', value }));
  body.on('fault', error => parentPort.postMessage({ kind: 'fault', error: String(error.message) }));
  parentPort.on('message', async ({ id, method, args }) => {
    try {
      if (!['ready', 'startObservation', 'execute', 'takePassiveEvents', 'prepareActionStart', 'executePrepared', 'cancelActionStart',
        'waitForObservationAfter', 'close'].includes(method))
        throw new Error('unsupported-body-operation');
      if (method === 'close') starts.invalidate('body-closed');
      const value = await (method === 'takePassiveEvents' ? starts.drainPassiveEvents()
        : ['startObservation', 'execute', 'prepareActionStart', 'executePrepared', 'cancelActionStart'].includes(method)
          ? starts[method](...args) : body[method](...args));
      parentPort.postMessage({ id, value, observation: method === 'close' ? null : body.latest() });
    } catch (error) { parentPort.postMessage({ id, error: String(error.stack ?? error) }); }
  });
}

export class MinecraftBodyConnection {
  #worker;
  #pending = new Map();
  #sequence = 0;
  #observation = null;
  #observationReceivedMonotonicMs = null;
  #fatal = null;
  #closing = false;
  #exited = false;
  #telemetry = null;
  #record;
  constructor(configuration, record = () => {}, createWorker = data => new Worker(new URL(import.meta.url), { workerData: data })) {
    this.#record = record;
    this.#worker = createWorker(configuration);
    const fail = error => {
      if (this.#closing) return;
      this.#fatal ??= error;
      for (const pending of this.#pending.values()) pending.reject(this.#fatal);
      this.#pending.clear();
    };
    this.#worker.on('error', fail);
    this.#worker.on('exit', code => { this.#exited = true; fail(new Error('minecraft-body-worker-exited:' + code)); });
    this.#worker.on('message', message => {
      if (message.kind === 'frame') {
        this.#acceptObservation(message.value);
        if (this.#telemetry) try { this.#telemetry.push({ kind: 'frame', observation: message.value, source: 'worker-frame' }); }
        catch (error) { fail(error); }
      }
      else if (message.kind === 'fault') fail(new Error(message.error));
      else if (message.kind) {
        if (message.kind === 'body-motor-edge' && this.#telemetry)
          try { this.#telemetry.push({ kind: 'motor-edge', edge: message.value }); } catch (error) { fail(error); }
        record(message.kind, message.value);
      }
      else {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.observation) this.#acceptObservation(message.observation);
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
      }
    });
  }
  #acceptObservation(observation) {
    if (!this.#observation || observation.sequence > this.#observation.sequence) {
      this.#observation = observation; this.#observationReceivedMonotonicMs = performance.now();
    }
  }
  #call(method, ...args) {
    if (this.#fatal && method !== 'close') return Promise.reject(this.#fatal);
    if (this.#exited) return Promise.reject(this.#fatal ?? new Error('minecraft-body-worker-exited'));
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ id, method, args });
    });
  }
  latest() {
    if (this.#fatal) throw this.#fatal;
    if (!this.#observation) throw new Error('no-real-public-frame');
    return this.#observation;
  }
  lastReceivedObservationForEvidence() {
    return { version: 'LastReceivedBodyEvidence1', observation: this.#observation ? structuredClone(this.#observation) : null,
      receivedMonotonicMs: this.#observationReceivedMonotonicMs, connectionFault: this.#fatal ? String(this.#fatal.message) : null,
      freshFinalObservation: false };
  }
  // Off by default: legacy consumers keep only latest and do not accumulate a
  // silently unconsumed frame inbox. The cached anchor retains its original
  // receipt time and is explicitly distinguished from subsequent worker frames.
  startPhysicalTelemetry(limits) {
    if (this.#telemetry) throw new Error('physical-telemetry-already-started');
    this.#telemetry = new PhysicalTelemetryQueue(limits);
    if (this.#observation) this.#telemetry.push({ kind: 'frame', observation: this.#observation, source: 'cached-anchor' },
      this.#observationReceivedMonotonicMs);
    return { version: 'PhysicalTelemetryStartV1', afterObservationSequence: this.#observation?.sequence ?? null,
      limits: this.#telemetry.limits };
  }
  takePhysicalTelemetry() {
    if (!this.#telemetry) throw new Error('physical-telemetry-not-started');
    const batch = this.#telemetry.take();
    if (batch.gap) this.#record('physical-telemetry-gap', batch.gap);
    return batch;
  }
  takePhysicalTelemetryThrough(observation) {
    if (!this.#telemetry) throw new Error('physical-telemetry-not-started');
    const batch = this.#telemetry.takeThroughObservation(observation);
    if (batch.gap || batch.boundaryMissing) this.#record('physical-telemetry-gap', {
      ...batch.gap, boundaryMissing: batch.boundaryMissing ?? false, requestedSequence: observation.sequence });
    return batch;
  }
  stopPhysicalTelemetry() {
    const batch = this.takePhysicalTelemetry(); this.#telemetry = null; return batch;
  }
  ready() { return this.#call('ready'); }
  startObservation() { return this.#call('startObservation'); }
  listActionOffers(observation = this.latest()) { return MinecraftBody.actionOffers(observation); }
  describeActionRequirement(cue, observation = this.latest()) { return describeActionRequirement(cue, observation); }
  execute(action, scope) { return this.#call('execute', action, scope); }
  takePassiveEvents() { return this.#call('takePassiveEvents'); }
  prepareActionStart() { return this.#call('prepareActionStart'); }
  executePrepared(token, action, scope) { return this.#call('executePrepared', token, action, scope); }
  cancelActionStart(token, reason) { return this.#call('cancelActionStart', token, reason); }
  waitForObservationAfter(sequence) { return this.#call('waitForObservationAfter', sequence); }
  async close() {
    if (this.#closing) return;
    this.#closing = true;
    let timeout;
    try {
      if (!this.#exited) await Promise.race([this.#call('close'), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('minecraft-body-close-timeout')), 5000);
      })]);
    }
    finally {
      clearTimeout(timeout);
      for (const pending of this.#pending.values()) pending.reject(new Error('minecraft-body-closed'));
      this.#pending.clear();
      await this.#worker.terminate();
    }
  }
}
