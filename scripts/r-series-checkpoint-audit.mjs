import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'evidence/r-series-complete-prototype-v1');
mkdirSync(output, { recursive: true });
const mode = process.argv[2] ?? 'baseline';
if (!['baseline', 'final', 'final-refresh', 'final-refresh-2', 'final-refresh-3', 'final-refresh-4', 'final-refresh-5', 'final-refresh-6'].includes(mode)) throw new Error('unknown audit mode');
const digest = value => createHash('sha256').update(value).digest('hex').toUpperCase();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = git('ls-files').split(/\r?\n/).filter(path => /^(src|test|scripts|docs)\//.test(path)
  || ['package.json', 'package-lock.json', 'tsconfig.json', 'kairos.config.json', 'README.md'].includes(path));
const manifest = files.map(path => ({ path, sha256: digest(readFileSync(join(root, path))) }));
const protectedPaths = ['src/core/physics/distributed-physical-medium.ts',
  'src/core/physics/distributed-physical-contracts.ts', 'src/core/prediction/distributed-prediction-clone.ts',
  'src/core/random.ts', 'src/core/config.ts'];
const record = { version: 'RSeriesEngineeringAuditV1', mode, head: git('rev-parse', 'HEAD'),
  branch: git('branch', '--show-current'), remote: git('remote', 'get-url', 'origin'),
  protected: manifest.filter(item => protectedPaths.includes(item.path)), files: manifest };
const targetName = mode === 'final-refresh' ? 'FINAL_IDENTITY_REFRESH'
  : mode === 'final-refresh-2' ? 'FINAL_IDENTITY_REFRESH_2'
  : mode === 'final-refresh-3' ? 'FINAL_IDENTITY_REFRESH_3'
  : mode === 'final-refresh-4' ? 'FINAL_IDENTITY_REFRESH_4'
  : mode === 'final-refresh-5' ? 'FINAL_IDENTITY_REFRESH_5'
  : mode === 'final-refresh-6' ? 'FINAL_IDENTITY_REFRESH_6' : mode.toUpperCase();
const target = join(output, `${targetName}_IDENTITY.json`);
if (existsSync(target)) throw new Error(`audit-already-exists:${target}`);
if (mode === 'baseline') {
  const zip = join(output, 'RECOVERY_BASELINE.zip');
  if (existsSync(zip)) throw new Error('recovery-zip-already-exists');
  execFileSync('git', ['archive', '--format=zip', `--output=${zip}`, 'HEAD'], { cwd: root });
  record.recovery = { file: 'RECOVERY_BASELINE.zip', sha256: digest(readFileSync(zip)) };
  chmodSync(zip, 0o444);
} else {
  const baseline = JSON.parse(readFileSync(join(output, 'BASELINE_IDENTITY.json'), 'utf8'));
  record.protectedMismatches = baseline.protected.filter(item =>
    record.protected.find(current => current.path === item.path)?.sha256 !== item.sha256);
  if (record.protectedMismatches.length) throw new Error('protected-core-changed');
}
writeFileSync(target, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ mode, files: files.length, head: record.head,
  recordSha256: digest(readFileSync(target)), protectedMismatches: record.protectedMismatches ?? [] }));
