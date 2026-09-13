import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// The active continuing prototype and its real body boundary. Historical
// distributed-model suites remain separate and are not reported by this gate.
const names = ['open-world', 'experience-prototype', 'perception', 'minecraft-experience', 'prototype-boundary',
  'grounded-goal', 'body-action-requirements', 'exact-public-block-hit', 'public-action-requirement-bridge',
  'dig-action-window', 'interact-observation-window', 'body-motor-window', 'entity-retina', 'block-optics', 'passive-experience', 'new-visible-surface', 'prediction-ranges',
  'contextual-support-domain', 'measured-motor-learning', 'action-start', 'worker-action-start', 'window-calibration'];
// Match the already documented serial integration protocol. Native planning
// deadlines and every existing test assertion remain unchanged.
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...names.map(name => resolve('dist/test', name + '.test.js'))], { stdio: 'inherit' });
child.once('error', error => { throw error; });
const [code, signal] = await new Promise(done => child.once('exit', (code, signal) => done([code, signal])));
if (signal) throw new Error('next-stage-tests-interrupted:' + signal);
process.exitCode = code ?? 1;
