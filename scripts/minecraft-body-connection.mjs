import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MinecraftBody, describeActionRequirement } from '../dist/src/body.js';

// The physical connection has its own clock. Expensive learning, cloning and
// serialization must not suspend Minecraft's keepalives or sensor acquisition.
// The worker owns only the existing body, never a policy or a server command.
if (!isMainThread) {
  const body = new MinecraftBody(workerData, (kind, value) => parentPort.postMessage({ kind, value }));
  body.on('fault', error => parentPort.postMessage({ kind: 'fault', error: String(error.message) }));
  parentPort.on('message', async ({ id, method, args }) => {
    try {
      if (!['ready', 'execute', 'takePassiveEvents', 'waitForObservationAfter', 'close'].includes(method))
        throw new Error('unsupported-body-operation');
      const value = await body[method](...args);
      parentPort.postMessage({ id, value, observation: method === 'close' ? null : body.latest() });
    } catch (error) { parentPort.postMessage({ id, error: String(error.stack ?? error) }); }
  });
}

export class MinecraftBodyConnection {
  #worker;
  #pending = new Map();
  #sequence = 0;
  #observation = null;
  #fatal = null;
  #closing = false;
  constructor(configuration, record = () => {}) {
    this.#worker = new Worker(new URL(import.meta.url), { workerData: configuration });
    const fail = error => {
      if (this.#closing) return;
      this.#fatal ??= error;
      for (const pending of this.#pending.values()) pending.reject(this.#fatal);
      this.#pending.clear();
    };
    this.#worker.on('error', fail);
    this.#worker.on('exit', code => fail(new Error('minecraft-body-worker-exited:' + code)));
    this.#worker.on('message', message => {
      if (message.kind === 'frame') this.#observation = message.value;
      else if (message.kind === 'fault') fail(new Error(message.error));
      else if (message.kind) record(message.kind, message.value);
      else {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.observation) this.#observation = message.observation;
        if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
      }
    });
  }
  #call(method, ...args) {
    if (this.#fatal) return Promise.reject(this.#fatal);
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
  ready() { return this.#call('ready'); }
  listActionOffers(observation = this.latest()) { return MinecraftBody.actionOffers(observation); }
  describeActionRequirement(cue, observation = this.latest()) { return describeActionRequirement(cue, observation); }
  execute(action, scope) { return this.#call('execute', action, scope); }
  takePassiveEvents() { return this.#call('takePassiveEvents'); }
  waitForObservationAfter(sequence) { return this.#call('waitForObservationAfter', sequence); }
  async close() {
    if (this.#closing) return;
    this.#closing = true;
    try { await this.#call('close'); }
    finally {
      for (const pending of this.#pending.values()) pending.reject(new Error('minecraft-body-closed'));
      this.#pending.clear();
      await this.#worker.terminate();
    }
  }
}
