import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const { values } = parseArgs({ options: { java: { type: 'string' }, server: { type: 'string' },
  output: { type: 'string' }, build: { type: 'string' }, port: { type: 'string', default: '25632' },
  expectation: { type: 'string' } } });
assert(values.java && values.server && values.output && values.build);
assert(['overshoot', 'exact'].includes(values.expectation));
const root = resolve(values.output), build = resolve(values.build); await mkdir(root);
const { Services } = await import(pathToFileURL(resolve(build, 'src/services.js')).href);
const { MinecraftBody } = await import(pathToFileURL(resolve(build, 'src/body.js')).href);
const { validateEvent } = await import(pathToFileURL(resolve(build, 'src/events.js')).href);
const config = { minecraft: { version: '1.21.4', host: '127.0.0.1', port: Number(values.port),
  username: 'KairosMotor', java: resolve(values.java), serverJar: resolve(values.server) } };
const runtimeRoot = resolve(root, 'runtime'), services = new Services(config, runtimeRoot, resolve(root, 'server-evidence'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { version: 'NativeMotorCatchupCalibration1', status: 'running', build, runtimeRoot,
  startedAt: new Date().toISOString(), expectation: values.expectation,
  scope: 'Evaluator-selected isolated native actuator calibration. No learner, autonomous trials or learned writes.',
  autonomousTrials: 0, learningWrites: 0,
  scriptSha256: sha(await readFile(new URL(import.meta.url))),
  bodySha256: sha(await readFile(resolve(build, 'src/body.js'))), trials: [] };
const commands = [], windows = [], records = []; let body;
const command = text => { commands.push(text); services.command(text); };
try {
  await services.start('empty', { difficulty: 'peaceful' });
  command('fill -12 63 -12 12 63 12 bedrock'); command('difficulty');
  body = new MinecraftBody({ ...config.minecraft, worldId: 'isolated-motor-catchup-calibration' },
    (kind, value) => { if (kind !== 'frame') records.push({ kind, value }); });
  await body.ready();
  for (let round = 0; round < 3; round++) for (const load of [false, true]) {
    command('tp KairosMotor .5 64 .5 180 0'); await delay(700);
    assert.equal(body.bot.getControlState('forward'), false);
    const trial = { round, load, requestedTicks: 4, injectedBlockMilliseconds: load ? 230 : 0,
      before: body.latest().self, pressedTicks: 0, observedPhysicsTicks: 0, controls: [], releases: [] };
    let injected = false;
    // This listener runs after the SDK simulation but BEFORE the body's frame
    // callback can release controls. It independently counts what was pressed
    // during the step, for both old and repaired actors.
    const physics = () => {
      const pressed = body.bot.getControlState('forward');
      trial.observedPhysicsTicks++; if (pressed) trial.pressedTicks++;
      trial.controls.push({ ordinal: trial.observedPhysicsTicks, pressed });
    };
    const frame = () => {
      if (!load || injected || trial.observedPhysicsTicks !== 3) return;
      injected = true; const start = performance.now();
      while (performance.now() - start < trial.injectedBlockMilliseconds) { /* controlled local load */ }
      trial.actualBlockMilliseconds = performance.now() - start;
    };
    const recordStart = records.length;
    body.bot.prependListener('physicsTick', physics); body.on('frame', frame);
    let receipt;
    try { receipt = await body.execute({ kind: 'move', parameters: { direction: 'forward', ticks: 4 } }); }
    finally { body.bot.off('physicsTick', physics); body.off('frame', frame); }
    assert(receipt.event); validateEvent(receipt.event); windows.push(receipt.event);
    trial.releases = records.slice(recordStart).filter(record => record.kind === 'body-motor-release').map(record => record.value);
    trial.eventId = receipt.event.id; trial.after = receipt.event.frames.at(-1).self;
    trial.displacement = Math.hypot(...trial.after.position.map((value, i) => value - trial.before.position[i]));
    trial.terminationReason = receipt.result.terminationReason;
    assert.equal(injected, load); assert.equal(body.bot.getControlState('forward'), false);
    report.trials.push(trial); command('data get entity KairosMotor Pos'); await delay(250);
    await writeFile(resolve(root, 'progress.json'), JSON.stringify(report, null, 2) + '\n');
  }
  const log = await readFile(resolve(root, 'server-evidence/minecraft-server.log'), 'utf8');
  assert(/difficulty is Peaceful/i.test(log), 'engine did not independently confirm peaceful difficulty');
  report.enginePositionReplies = [...log.matchAll(/KairosMotor has the following entity data: (.+)/g)].map(match => match[1]);
  assert.equal(report.enginePositionReplies.length, report.trials.length);
  report.engineDifficulty = 'peaceful';
  report.loadedPressedTicks = report.trials.filter(trial => trial.load).map(trial => trial.pressedTicks);
  report.unloadedPressedTicks = report.trials.filter(trial => !trial.load).map(trial => trial.pressedTicks);
  if (values.expectation === 'exact') assert(report.trials.every(trial => trial.pressedTicks === 4));
  else assert(report.trials.some(trial => trial.load && trial.pressedTicks > 4), 'old actor did not reproduce the suspected defect');
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1; }
finally {
  await body?.close(); await services.stop(); report.stoppedAt = new Date().toISOString();
  await writeFile(resolve(root, 'setup.json'), JSON.stringify({ scope: report.scope, commands }, null, 2) + '\n');
  const bytes = gzipSync(JSON.stringify(windows)); report.windowsSha256 = sha(bytes);
  await writeFile(resolve(root, 'windows.json.gz'), bytes);
  await writeFile(resolve(root, 'body-records.json'), JSON.stringify(records, null, 2) + '\n');
  await writeFile(resolve(root, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: root, ...report, trials: report.trials.map(({ controls, before, after, ...trial }) => trial) }));
}
