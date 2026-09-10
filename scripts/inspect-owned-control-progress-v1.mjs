import { writeFile } from 'node:fs/promises';
const endpoints = await (await fetch('http://127.0.0.1:9229/json/list')).json();
if (endpoints.length !== 1) throw new Error('owned-inspector-target-not-unique');
const socket = new WebSocket(endpoints[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0, onPaused;
const paused = new Promise(resolve => { onPaused = resolve; }), pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Debugger.paused') onPaused(message.params);
  const waiter = pending.get(message.id); if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
try {
  await send('Debugger.enable'); await send('Debugger.pause');
  const state = await paused;
  const frame = state.callFrames.find(frame => frame.functionName === '#run');
  const report = { stack: state.callFrames.map(frame => ({ name: frame.functionName, location: frame.location })) };
  if (frame) report.control = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId,
    expression: `JSON.stringify({cycles,mode,firstSatisfiedSequence,timeline:this.environment.timeline,
      records:this.environment.records.slice(-2)})`, returnByValue: true,
    throwOnSideEffect: true });
  const rebuilding = state.callFrames.find(frame => frame.functionName === '#rediscoverPhysicalIndexes');
  if (rebuilding) report.rebuilding = await send('Debugger.evaluateOnCallFrame', {
    callFrameId: rebuilding.callFrameId,
    expression: 'JSON.stringify({branchCount:physicalBranches.length,activeInputCount:activeInputs.length,branchId:branch.branchId})',
    returnByValue: true, throwOnSideEffect: true,
  });
  const selection = state.callFrames.find(frame => frame.functionName === '#selectionRates');
  if (selection) report.selection = await send('Debugger.evaluateOnCallFrame', {
    callFrameId: selection.callFrameId,
    expression: `JSON.stringify({counts,queries:queries.length, branches:branches.map(b=>({
      id:b.branchId,core:b.attractor.coreSiteIds.length,envelope:b.topologicalEnvelopeSiteIds.length,
      otherCoreOverlap:branches.map(c=>b.attractor.coreSiteIds.filter(x=>c.attractor.coreSiteIds.includes(x)).length),
      otherEnvelopeOverlap:branches.map(c=>b.topologicalEnvelopeSiteIds.filter(x=>c.topologicalEnvelopeSiteIds.includes(x)).length)
    }))})`, returnByValue: true, throwOnSideEffect: true,
  });
  if (!process.argv[2]) throw new Error('new-audit-path-required');
  await writeFile(process.argv[2], JSON.stringify(report), { flag: 'wx' });
  const control = report.control?.result?.value ? JSON.parse(report.control.result.value) : null;
  console.log(JSON.stringify({ stack: report.stack.map(frame => frame.name),
    rebuilding: report.rebuilding, selection: report.selection,
    cycles: control?.cycles, mode: control?.mode, timeline: control?.timeline,
    records: control?.records?.map(record => ({ kind: record.kind,
      operation: record.value?.decision?.operation ?? record.value?.operation,
      nodeId: record.value?.decision?.nodeId ?? record.value?.nodeId })) }));
} finally {
  await send('Debugger.resume'); await send('Debugger.disable'); socket.close();
}
