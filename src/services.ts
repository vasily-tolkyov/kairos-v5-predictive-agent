import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileSha, assert, saveJson } from './util.js';
import { verifyDeepSeekTokenizer, DEEPSEEK_CREDENTIAL_SOURCE } from './analysis-provider.js';

interface AnalysisConfigurationBase {
  model: string; baseUrl: string; context: number; maximumInputTokens?: number;
  maximumOutputTokens: number; nativeThinking: boolean; timeoutMs: number;
}
export interface LocalAnalysisConfiguration extends AnalysisConfigurationBase {
  provider?: 'llama.cpp'; modelSha256: string; llama: string; llamaSha256: string;
  temperature: number; topP: number; topK: number; minP: number; presencePenalty: number; seed: number;
}
export interface DeepSeekAnalysisConfiguration extends AnalysisConfigurationBase {
  provider: 'deepseek'; reasoningEffort: 'high'; python: string; tokenizerRoot: string;
}

export interface Configuration {
  version: 'KairosV5Config'; minecraft: { version: '1.21.4'; host: '127.0.0.1'; port: number; username: string; java: string; serverJar: string };
  analysis: LocalAnalysisConfiguration | DeepSeekAnalysisConfiguration;
  actionBudget: number; initializationEvents: number; viewer: { enabled: boolean; host: '127.0.0.1'; port: number; dashboardPort: number };
  stateRoot: string; evidenceRoot: string; runtimeRoot: string;
}
export async function loadConfiguration(): Promise<Configuration> {
  const config = JSON.parse(await readFile(resolve('kairos.config.json'), 'utf8')) as Configuration;
  const a = config.analysis;
  assert(config.version === 'KairosV5Config' && config.minecraft.version === '1.21.4'
    && typeof a.nativeThinking === 'boolean' && Number.isInteger(a.context) && a.context > 0
    && Number.isInteger(a.maximumOutputTokens) && a.maximumOutputTokens > 0 && a.maximumOutputTokens < a.context
    && a.timeoutMs > 0, 'invalid-V5-configuration');
  if (a.provider === 'deepseek') assert(a.baseUrl === 'https://api.deepseek.com/beta' && a.model === 'deepseek-v4-pro'
    && a.nativeThinking && a.reasoningEffort === 'high' && a.context === 65536 && a.maximumInputTokens === 24000
    && a.maximumOutputTokens === 32768 && a.timeoutMs === 120000, 'invalid-designated-DeepSeek-configuration');
  else assert(Number.isFinite(a.temperature) && a.temperature >= 0 && a.topP > 0 && a.topP <= 1
    && Number.isInteger(a.topK) && a.topK >= 0 && a.minP >= 0 && a.minP <= 1
    && Number.isFinite(a.presencePenalty) && Number.isInteger(a.seed), 'invalid-local-analysis-configuration');
  assert(config.initializationEvents === 128, 'V5-calibration-requires-new-128-events'); return config;
}
/** The same explicit profile supplies both the local server and Pi request defaults. */
export function analysisSampling(a: Configuration['analysis']): Record<string, number> {
  if (a.provider === 'deepseek') return {};
  return { temperature: a.temperature, top_p: a.topP, top_k: a.topK, min_p: a.minP,
    presence_penalty: a.presencePenalty, seed: a.seed };
}
/** Transport alias does not claim a parameter count; the verified GGUF identifies the model. */
export const LOCAL_ANALYSIS_ALIAS = 'kairos-v5-local-analysis';
export function analysisServerArguments(a: Configuration['analysis']): string[] {
  assert(a.provider !== 'deepseek', 'remote-analysis-has-no-local-server');
  assert(new URL(a.baseUrl).hostname === '127.0.0.1', 'analysis-not-loopback');
  return ['--model', a.model, '--alias', LOCAL_ANALYSIS_ALIAS, '--host', '127.0.0.1', '--port', new URL(a.baseUrl).port,
    '--ctx-size', String(a.context), '--parallel', '1', '--n-predict', String(a.maximumOutputTokens),
    '--temp', String(a.temperature), '--top-p', String(a.topP), '--top-k', String(a.topK), '--min-p', String(a.minP),
    '--presence-penalty', String(a.presencePenalty), '--seed', String(a.seed), '--gpu-layers', 'auto', '--fit', 'on', '--jinja',
    '--reasoning', a.nativeThinking ? 'on' : 'off', '--reasoning-format', 'deepseek', '--no-webui'];
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
  server: OwnedProcess | null = null; analysis: OwnedProcess | null = null;
  #analysisIdentity: Record<string, unknown> | null = null;
  constructor(readonly config: Configuration, readonly runRoot: string, readonly evidence: string) {}
  async #verifyAnalysis(): Promise<Record<string, unknown>> {
    if (this.#analysisIdentity) return this.#analysisIdentity;
    const c = this.config;
    if (c.analysis.provider === 'deepseek') {
      this.#analysisIdentity = { provider: 'deepseek', requestedModel: c.analysis.model, baseUrl: c.analysis.baseUrl,
        remoteWeightsLocallyVerifiable: false, tokenizer: await verifyDeepSeekTokenizer(c.analysis),
        credentialSource: DEEPSEEK_CREDENTIAL_SOURCE };
      return this.#analysisIdentity;
    }
    const modelHash = await fileSha(c.analysis.model), binaryHash = await fileSha(c.analysis.llama);
    assert(modelHash.toUpperCase() === c.analysis.modelSha256 && binaryHash.toUpperCase() === c.analysis.llamaSha256, 'frozen-model-identity-mismatch');
    this.#analysisIdentity = { modelHash, binaryHash }; return this.#analysisIdentity;
  }
  async start(): Promise<void> {
    const c = this.config, tmp = resolve(this.runRoot, 'tmp'), serverRoot = resolve(this.runRoot, 'minecraft');
    await mkdir(tmp, { recursive: true }); await mkdir(serverRoot, { recursive: true }); await mkdir(this.evidence, { recursive: true });
    const analysisIdentity = await this.#verifyAnalysis();
    await copyFile(c.minecraft.serverJar, resolve(serverRoot, 'server.jar'));
    await writeFile(resolve(serverRoot, 'eula.txt'), 'eula=true\n');
    await saveJson(resolve(serverRoot, 'whitelist.json'), [offlineProfile(c.minecraft.username)]);
    await writeFile(resolve(serverRoot, 'server.properties'), [
      'server-ip=127.0.0.1', `server-port=${c.minecraft.port}`, 'online-mode=false', 'white-list=true',
      'max-players=1', 'enable-rcon=false', 'enable-query=false', 'level-type=minecraft:flat',
      `level-seed=${Date.now()}`, 'level-name=world-v5', 'gamemode=survival', 'difficulty=peaceful',
      'spawn-protection=0', 'view-distance=4', 'simulation-distance=4', 'sync-chunk-writes=true',
    ].join('\n') + '\n');
    await saveJson(resolve(this.evidence, 'INSTALLATION_IDENTITIES.json'), { analysisIdentity,
      serverSha256: await fileSha(resolve(serverRoot, 'server.jar')), configuration: c, writableRoot: this.runRoot });
    this.server = new OwnedProcess(c.minecraft.java, [`-Djava.io.tmpdir=${tmp}`, '-Xms1G', '-Xmx2G', '-jar', 'server.jar', 'nogui'],
      serverRoot, resolve(this.evidence, 'minecraft-server.log'), tmp);
    await this.server.ready(/Done \([^\n]+\)!/);
    await this.#fixture();
    await this.startAnalysis();
  }
  /** Same frozen backend, without starting Minecraft for the independent task-context qualification. */
  async startAnalysis(): Promise<void> {
    assert(this.analysis === null, 'analysis-already-started');
    const c = this.config, tmp = resolve(this.runRoot, 'tmp');
    await mkdir(tmp, { recursive: true }); await mkdir(this.evidence, { recursive: true });
    const identity = await this.#verifyAnalysis();
    if (c.analysis.provider === 'deepseek') {
      await saveJson(resolve(this.evidence, 'OWNED_SERVICES.json'), { serverPid: this.server?.child.pid ?? null,
        analysisPid: null, localAnalysisStarted: false, ...identity });
      return; // No remote health/generation probe; the first task is the first real API request.
    }
    assert(new URL(c.analysis.baseUrl).hostname === '127.0.0.1', 'analysis-not-loopback');
    const analysisRoot = resolve(this.runRoot, 'analysis'); await mkdir(analysisRoot, { recursive: true });
    const args = analysisServerArguments(c.analysis);
    this.analysis = new OwnedProcess(c.analysis.llama, args, analysisRoot, resolve(this.evidence, 'llama-server.log'), tmp);
    await this.analysis.ready(/server is listening|listening on|HTTP server listening/i);
    const health = await fetch(new URL('/health', c.analysis.baseUrl)); assert(health.ok, `llama-health:${health.status}`);
    await saveJson(resolve(this.evidence, 'OWNED_SERVICES.json'), { serverPid: this.server?.child.pid ?? null, analysisPid: this.analysis.child.pid, args, ...identity });
  }
  async #fixture(): Promise<void> {
    const s = this.server!;
    // Static fixture only. No bot observations, goals, future outcomes, or action callbacks reach the console.
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
      'setblock -5 64 13 minecraft:glass', 'setblock 7 64 14 minecraft:copper_block',
      'setworldspawn 2 64 12'];
    for (const command of commands) s.command(command);
    await delay(2000);
    await saveJson(resolve(this.evidence, 'FIXTURE_SETUP.json'), { kind: 'static-real-redstone-latching-copper-bulb-comparator',
      commands, modelAccess: false, dynamicRuleCallbacks: false });
  }
  async placeBot(): Promise<void> {
    this.server!.command(`tp ${this.config.minecraft.username} 2.5 64 12.5 180 0`);
    await delay(1500);
  }
  async changeVisibleCondition(): Promise<void> {
    // A declared experiment intervention, not a response to a chosen action or prediction.
    this.server!.command('fill -2 64 9 6 65 9 minecraft:glass'); await delay(500);
  }
  async stop(): Promise<void> { await this.server?.stop('stop'); await this.analysis?.stop(); }
}
