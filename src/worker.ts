import { parentPort } from 'node:worker_threads';
import { PhysicalMemory, type MemorySnapshot } from './memory.js';
import type { ActionCue, DesiredChange, Observation, RealEvent } from './contracts.js';
import { sha } from './util.js';

let memory = new PhysicalMemory();
parentPort!.on('message', (message: { id: number; method: string; args: unknown[] }) => {
  try {
    const args = message.args; let value: unknown;
    switch (message.method) {
      case 'observe': value = memory.observe(args[0] as RealEvent); break;
      case 'advance': memory.advanceTo(args[0] as number); value = null; break;
      case 'recall': value = memory.recall(args[0] as DesiredChange, args[1] as Observation, args[2] as number); break;
      case 'predict': value = memory.predict(args[0] as ActionCue, args[1] as Observation, args[2] as Parameters<PhysicalMemory['predict']>[2]); break;
      case 'snapshot': value = memory.snapshot(); break;
      case 'restore': memory = PhysicalMemory.restore(args[0] as MemorySnapshot); value = { writes: memory.writes }; break;
      case 'status': value = { ready: memory.ready, writes: memory.writes, bufferedEvents: memory.bufferedEvents,
        mapSha256: memory.mapSha256 }; break;
      case 'hash': value = sha(memory.snapshot()); break;
      default: throw new Error(`unknown-worker-method:${message.method}`);
    }
    parentPort!.postMessage({ id: message.id, value });
  } catch (error) {
    const value = error as Error;
    parentPort!.postMessage({ id: message.id, error: { message: value.message, stack: value.stack } });
  }
});
