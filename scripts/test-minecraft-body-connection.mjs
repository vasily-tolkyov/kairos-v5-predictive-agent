import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { MinecraftBodyConnection } from './minecraft-body-connection.mjs';

// Real worker transport faults, with no Minecraft world or capability credit.
const worker = exitOnRequest => new Worker(`
  const {parentPort} = require('node:worker_threads');
  parentPort.on('message', ({id,method}) => {
    if(method === 'ready') {
      parentPort.postMessage({kind:'frame',value:{sequence:1,activeSeconds:.05,self:{position:[0,0,0]},objects:[]}});
      parentPort.postMessage({id,value:true});
    } else if(method === 'waitForObservationAfter') {
      if(${exitOnRequest}) process.exit(2);
      parentPort.postMessage({kind:'fault',error:'controlled-consumer-fault'});
    } else if(method === 'close') {
      parentPort.postMessage({kind:'test-close-received',value:true});
      parentPort.postMessage({id,value:null});
    }
  });`, { eval: true });

test('faulted transport keeps its exact cached evidence separate from live observations and still closes gracefully', async () => {
  const records = [], body = new MinecraftBodyConnection({}, kind => records.push(kind), () => worker(false));
  try {
    await body.ready(); assert.equal(body.latest().sequence, 1);
    await assert.rejects(body.waitForObservationAfter(1), /controlled-consumer-fault/);
    assert.throws(() => body.latest(), /controlled-consumer-fault/);
    const last = body.lastReceivedObservationForEvidence();
    assert.equal(last.observation.sequence, 1); assert.equal(last.freshFinalObservation, false);
    last.observation.sequence = 2;
    assert.equal(body.lastReceivedObservationForEvidence().observation.sequence, 1);
    await body.close(); assert(records.includes('test-close-received'));
    await body.close();
  } finally { await body.close(); }
});

test('an exited worker rejects the pending operation and cleanup does not wait for an impossible reply', async () => {
  const body = new MinecraftBodyConnection({}, () => {}, () => worker(true));
  try {
    await body.ready();
    await assert.rejects(body.waitForObservationAfter(1), /minecraft-body-worker-exited:2/);
    assert.throws(() => body.latest(), /minecraft-body-worker-exited:2/);
    await body.close();
  } finally { await body.close(); }
});
