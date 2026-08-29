import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DeepSeekAnalysisConfiguration } from './services.js';
import { assert, fileSha } from './util.js';

export const DEEPSEEK_CREDENTIAL_SOURCE = {
  database: 'C:/Users/86139/.cc-switch/cc-switch.db', providerId: 'e9e98742-d903-437b-8dc9-e3bce014b3fd',
  appType: 'claude', name: 'DeepSeek', field: 'settings_config.env.ANTHROPIC_AUTH_TOKEN', readOnly: true,
} as const;
export const DEEPSEEK_TOKENIZER_REVISION = '3c6b30435c8590933c489be0c5200691559e0576';
export const DEEPSEEK_TOKENIZER_FILES: Readonly<Record<string, string>> = {
  'tokenizer.json': '8F9F37CA37FDC4F5FD36D5CF4D3B0E8392EDB4E894FD10CC0D70B4957C8633CF',
  'encoding/encoding_dsv4.py': 'ABC0D26120250DDA0AE077DC64AA28836026E61E970854AAEB792445E6A0DDE6',
  LICENSE: 'F2C6C602815669D292889E5BE8C802F2ED950653B77999B1584E8E6AED25D040',
};
/** Read exactly the user-designated row; neither enumerate providers nor alter SQLite. */
export function readDesignatedDeepSeekCredential(): string {
  const s = DEEPSEEK_CREDENTIAL_SOURCE;
  const db = new DatabaseSync(s.database, { readOnly: true });
  try {
    const row = db.prepare('SELECT settings_config FROM providers WHERE id = ? AND app_type = ? AND name = ?')
      .get(s.providerId, s.appType, s.name);
    assert(row && typeof row.settings_config === 'string', 'designated-DeepSeek-provider-not-found');
    const key = JSON.parse(row.settings_config).env?.ANTHROPIC_AUTH_TOKEN;
    assert(typeof key === 'string' && key.length > 0 && !/\s/.test(key), 'designated-DeepSeek-credential-unavailable');
    return key;
  } catch (error) {
    // SQLite and malformed-provider failures must never print the row or an exception containing its text.
    const code = (error as Error).message;
    throw new Error(code.startsWith('designated-DeepSeek-') ? code : 'designated-DeepSeek-credential-read-error');
  } finally { db.close(); }
}
export async function verifyDeepSeekTokenizer(config: DeepSeekAnalysisConfiguration): Promise<unknown> {
  const files = [];
  for (const [name, expected] of Object.entries(DEEPSEEK_TOKENIZER_FILES)) {
    const actual = await fileSha(resolve(config.tokenizerRoot, name));
    assert(actual.toUpperCase() === expected, `official-tokenizer-identity-mismatch:${name}`);
    files.push({ name, sha256: actual });
  }
  return { revision: DEEPSEEK_TOKENIZER_REVISION, files, weightsDownloaded: false };
}
/** Only stdin carries the actual request; stdout is an integer, never prompt or reasoning text. */
export async function deepSeekInputTokens(payload: Record<string, unknown>, config: DeepSeekAnalysisConfiguration): Promise<number> {
  const tmp = resolve('tmp/analysis-deepseek-backend-v1'); await mkdir(tmp, { recursive: true });
  return new Promise((accept, reject) => {
    const child = spawn(config.python, ['-B', '-X', 'utf8', resolve('src/deepseek-token-count.py')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TEMP: tmp, TMP: tmp, PYTHONDONTWRITEBYTECODE: '1', HF_HOME: tmp, TOKENIZERS_PARALLELISM: 'false' },
    });
    let output = '', error = '';
    const deadline = setTimeout(() => { child.kill(); reject(new Error('official-tokenizer-timeout')); }, config.timeoutMs);
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { error += String(data); });
    child.once('error', () => { clearTimeout(deadline); reject(new Error('official-tokenizer-process-unavailable')); });
    child.stdin.on('error', () => {}); // The process exit below reports failure; never echo input into an error.
    child.once('close', code => {
      clearTimeout(deadline);
      if (code !== 0 || !/^\d+\s*$/.test(output)) {
        // The Python boundary prints exception class only, not its message or a traceback.
        const category = /^tokenizer-error:[A-Za-z]+\s*$/.test(error) ? error.trim() : 'tokenizer-process-error';
        reject(new Error(`${category}:exit=${code}`)); return;
      }
      accept(Number(output.trim()));
    });
    child.stdin.end(JSON.stringify({ root: resolve(config.tokenizerRoot), payload }));
  });
}
/** Public evidence is deliberately different from the in-memory native wire transcript. */
export function publicAnalysisEvidence(value: unknown, privateValues: readonly string[] = []): any {
  if (typeof value === 'string') {
    let result = value;
    for (const secret of privateValues) if (secret) {
      result = result.replaceAll(secret, '[private-content-omitted]')
        .replaceAll(JSON.stringify(secret).slice(1, -1), '[private-content-omitted]');
    }
    return result.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [credential-omitted]');
  }
  if (Array.isArray(value)) return value.map(v => publicAnalysisEvidence(v, privateValues));
  if (value && typeof value === 'object') {
    if ((value as any).type === 'thinking') return { type: 'thinking', bodyOmitted: true };
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => !['reasoning_content', 'reasoning_text',
      'authorization', 'Authorization', 'apiKey', 'api_key'].includes(k) && !(k === 'reasoning' && typeof v !== 'number'))
      .map(([k, v]) => [k, publicAnalysisEvidence(v, privateValues)]));
  }
  return value;
}
