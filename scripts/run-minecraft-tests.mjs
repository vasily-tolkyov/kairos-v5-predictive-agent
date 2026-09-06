import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const testRoot = resolve('dist', 'test');
const files = (await readdir(testRoot)).filter(name => name.startsWith('minecraft-')
  && name.endsWith('.test.js')).sort().map(name => resolve(testRoot, name));
if (files.length === 0) throw new Error('minecraft-test-set-empty');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.once('error', error => { throw error; });
const [code, signal] = await new Promise(resolveExit =>
  child.once('exit', (exitCode, exitSignal) => resolveExit([exitCode, exitSignal])));
if (signal) throw new Error(`minecraft-tests-signal:${signal}`);
process.exitCode = code ?? 1;
