import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileSha, assert, saveJson } from './util.js';
import type { JointTransientControlFieldConfigV2 } from './control/contracts.js';

export interface Configuration {
  readonly version: 'KairosV5PhysicalControlConfigV2';
  readonly minecraft: { readonly version: '1.21.4'; readonly host: '127.0.0.1'; readonly port: number;
    readonly username: string; readonly java: string; readonly serverJar: string };
  readonly control: JointTransientControlFieldConfigV2;
  readonly actionBudget: number;
  readonly initializationEvents: 128;
  readonly viewer: { readonly enabled: boolean; readonly host: '127.0.0.1'; readonly port: number; readonly dashboardPort: number };
  readonly stateRoot: string; readonly evidenceRoot: string; readonly runtimeRoot: string;
}

export type MinecraftFixtureModeV1 = 'legacy-door' | 'empty';

export async function loadConfiguration(): Promise<Configuration> {
  const config = JSON.parse(await readFile(resolve('kairos.config.json'), 'utf8')) as Configuration;
  assert(config.version === 'KairosV5PhysicalControlConfigV2' && config.minecraft.version === '1.21.4'
    && config.minecraft.host === '127.0.0.1' && config.initializationEvents === 128
    && Number.isInteger(config.actionBudget) && config.actionBudget > 0
    && config.control.version === 'JointTransientControlFieldConfigV2', 'invalid-V5-physical-control-configuration');
  return config;
}

/** Java's offline profile is case-sensitive. A console name lookup may lowercase the name. */
export function offlineProfile(name: string): { name: string; uuid: string } {
  const digest = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  digest[6] = (digest[6]! & 0x0f) | 0x30; digest[8] = (digest[8]! & 0x3f) | 0x80;
  const h = digest.toString('hex');
  return { name, uuid: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}

class OwnedProcess {
  readonly child: ChildProcessWithoutNullStreams;
  #output = '';
  #error: Error | null = null;
  constructor(executable: string, args: string[], cwd: string, logPath: string, temporary: string) {
    this.child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TEMP: temporary, TMP: temporary } });
    const stream = createWriteStream(logPath, { flags: 'wx' });
    this.child.stdout.on('data', chunk => { this.#output = (this.#output + String(chunk)).slice(-50000); stream.write(chunk); });
    this.child.stderr.on('data', chunk => { this.#output = (this.#output + String(chunk)).slice(-50000); stream.write(chunk); });
    this.child.once('exit', () => stream.end());
    this.child.once('error', error => { this.#error = error; stream.end(); });
  }
  command(command: string): void { assert(this.child.exitCode === null, 'owned-process-exited'); this.child.stdin.write(command + '\n'); }
  async ready(pattern: RegExp, milliseconds = 120000): Promise<void> {
    const until = Date.now() + milliseconds;
    while (!pattern.test(this.#output)) {
      if (this.#error) throw this.#error;
      if (this.child.exitCode !== null) throw new Error(`owned-process-exited:${this.child.exitCode}:${this.#output.slice(-4000)}`);
      if (Date.now() > until) throw new Error(`owned-process-readiness-timeout:${this.#output.slice(-4000)}`);
      await delay(200);
    }
  }
  async stop(command?: string): Promise<void> {
    if (this.#error || this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (command) this.child.stdin.write(command + '\n'); else this.child.kill();
    const until = Date.now() + 15000;
    while (this.child.exitCode === null && Date.now() < until) await delay(100);
    if (this.child.exitCode === null) this.child.kill();
  }
}

export class Services {
  server: OwnedProcess | null = null;
  constructor(readonly config: Configuration, readonly runRoot: string, readonly evidence: string) {}
  async start(fixture: MinecraftFixtureModeV1 = 'legacy-door'): Promise<void> {
    const c = this.config, tmp = resolve(this.runRoot, 'tmp'), serverRoot = resolve(this.runRoot, 'minecraft');
    await mkdir(tmp, { recursive: true }); await mkdir(serverRoot, { recursive: true }); await mkdir(this.evidence, { recursive: true });
    await copyFile(c.minecraft.serverJar, resolve(serverRoot, 'server.jar'));
    await writeFile(resolve(serverRoot, 'eula.txt'), 'eula=true\n');
    await saveJson(resolve(serverRoot, 'whitelist.json'), [offlineProfile(c.minecraft.username)]);
    await writeFile(resolve(serverRoot, 'server.properties'), [
      'server-ip=127.0.0.1', `server-port=${c.minecraft.port}`, 'online-mode=false', 'white-list=true',
      'max-players=1', 'enable-rcon=false', 'enable-query=false', 'level-type=minecraft:flat',
      `level-seed=${Date.now()}`, 'level-name=world-v5-physical-control', 'gamemode=survival', 'difficulty=peaceful',
      'spawn-protection=0', 'view-distance=4', 'simulation-distance=4', 'sync-chunk-writes=true',
    ].join('\n') + '\n');
    await saveJson(resolve(this.evidence, 'INSTALLATION_IDENTITIES.json'), {
      serverSha256: await fileSha(resolve(serverRoot, 'server.jar')), configuration: c, writableRoot: this.runRoot,
      externalDecisionServices: 0,
    });
    this.server = new OwnedProcess(c.minecraft.java, [`-Djava.io.tmpdir=${tmp}`, '-Xms1G', '-Xmx2G', '-jar', 'server.jar', 'nogui'],
      serverRoot, resolve(this.evidence, 'minecraft-server.log'), tmp);
    await this.server.ready(/Done \([^\n]+\)!/);
    if (fixture === 'legacy-door') await this.#fixture();
    else await saveJson(resolve(this.evidence, 'FIXTURE_SETUP.json'), {
      kind: 'empty-evaluation-world', controllerAccess: false, dynamicRuleCallbacks: false,
    });
  }
  /** Evaluation setup boundary. Commands are never exposed to the controller or body. */
  command(command: string): void { this.server!.command(command); }
  async #fixture(): Promise<void> {
    const server = this.server!;
    const commands = ['gamerule spawnRadius 0', 'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false',
      'gamerule doMobSpawning false', 'time set noon', 'forceload add -16 -16 16 32',
      'fill -12 63 -8 12 63 24 minecraft:smooth_stone', 'fill -12 64 -8 12 71 24 air',
      'fill -8 64 0 8 66 0 minecraft:bricks',
      'setblock 2 64 0 minecraft:iron_door[facing=south,half=lower,hinge=left,open=false]',
      'setblock 2 65 0 minecraft:iron_door[facing=south,half=upper,hinge=left,open=false]',
      'setblock 2 64 4 minecraft:copper_bulb[lit=false,powered=false]',
      'setblock 2 64 5 minecraft:stone_button[face=wall,facing=south,powered=false]',
      'setblock 2 64 3 minecraft:comparator[facing=north,mode=compare,powered=false]',
      'setblock 2 64 2 minecraft:redstone_wire', 'setblock 2 64 1 minecraft:redstone_wire',
      'fill 0 64 8 4 64 8 minecraft:stone_slab[type=bottom]',
      'setblock -4 64 5 minecraft:quartz_block', 'setblock 6 64 6 minecraft:oak_planks',
      'setblock -5 64 13 minecraft:glass', 'setblock 7 64 14 minecraft:copper_block', 'setworldspawn 2 64 12'];
    for (const command of commands) server.command(command);
    await delay(2000);
    await saveJson(resolve(this.evidence, 'FIXTURE_SETUP.json'), { kind: 'static-real-redstone-latching-copper-bulb-comparator',
      commands, controllerAccess: false, dynamicRuleCallbacks: false });
  }
  async placeBot(): Promise<void> { this.server!.command(`tp ${this.config.minecraft.username} 2.5 64 12.5 180 0`); await delay(1500); }
  async changeVisibleCondition(): Promise<void> {
    this.server!.command('fill -2 64 9 6 65 9 minecraft:glass'); await delay(500);
  }
  async stop(): Promise<void> { await this.server?.stop('stop'); }
}
