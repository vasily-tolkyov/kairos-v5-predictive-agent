/** Attach only to an explicitly started loopback inspector; no runtime evaluation. */
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('profile-output-required');
const endpoints = await (await fetch('http://127.0.0.1:9229/json/list')).json();
if (endpoints.length !== 1) throw new Error('inspector-target-not-unique');
const socket = new WebSocket(endpoints[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const waiter = pending.get(message.id); pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
};
const send = (method) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method }));
});
try {
  await send('Profiler.enable'); await send('Profiler.start'); await delay(10000);
  const { profile } = await send('Profiler.stop');
  await writeFile(values.output, JSON.stringify(profile), { flag: 'wx' });
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const counts = new Map();
  profile.samples.forEach((id, index) => {
    const node = byId.get(id), frame = node.callFrame;
    const key = `${frame.functionName} ${frame.url}:${frame.lineNumber + 1}`;
    counts.set(key, (counts.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0));
  });
  console.log(JSON.stringify([...counts].sort((a,b) => b[1]-a[1]).slice(0, 25), null, 2));
  await send('Profiler.disable');
} finally { socket.close(); }
