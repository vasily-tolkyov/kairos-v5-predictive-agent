import { Worker } from 'node:worker_threads';

/** The only compute worker is a physical-model owner, never another agent. */
export class Compute {
  readonly worker = new Worker(new URL('./worker.js', import.meta.url));
  #id = 0;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #closed = false;
  constructor() {
    this.worker.on('message', message => {
      const pending = this.#pending.get(message.id); if (!pending) return; this.#pending.delete(message.id);
      if (message.error) { const error = new Error(message.error.message); error.stack = message.error.stack; pending.reject(error); }
      else pending.resolve(message.value);
    });
    this.worker.on('error', error => { for (const p of this.#pending.values()) p.reject(error); this.#pending.clear(); });
    this.worker.on('exit', code => { if (!this.#closed) for (const p of this.#pending.values()) p.reject(new Error(`physical-worker-exited:${code}`)); });
  }
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) => { const id = ++this.#id;
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ id, method, args }); });
  }
  async close(): Promise<void> { this.#closed = true; await this.worker.terminate(); }
}
