/** Narrow V5 provenance check. It does not traverse historical evidence or open a formal world. */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSha, saveJson, sha, assert } from './util.js';
import { SYSTEM_PROMPT, TOOL_SCHEMAS } from './analysis.js';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export const OLD_FORMAL = 'D:/REACT_Transformer_REACT_Hierarchical_Physical_Medium_World_Model_V4_0_Clean/artifacts/minecraft-java-cognitive-loop-stage5-context-budget-action-decomposition-1/FORMAL_V3_ACCESS_STATE.json';
export const PROTECTED = {
  'physics/physical-medium.ts': '40610F3F8EB389C7BF9AE072447FD6661FC999D055965E9AB1085123822A266A',
  'physics/potential-page.ts': '85148419D308788F23DC82FD31899EC09357F62AA4D584598EA6104B7FC3F922',
  'prediction/prediction-clone.ts': '7E021B212D8938B5014B2B9674A2246E14A3F74930439F54E56FA6A76F5355AC',
  'config.ts': 'AE4BA6654E1789BB0471BE6D8864EE520E62B666A8B381BBA4AC55A45A99709E',
};
export async function verify(output: string): Promise<void> {
  const protectedFiles = [];
  for (const [path, expected] of Object.entries(PROTECTED)) {
    const old = await fileSha(resolve('D:/REACT_Transformer_REACT_Hierarchical_Physical_Medium_World_Model_V4_0_Clean/src', path));
    const current = await fileSha(resolve('src/core', path));
    assert(old.toUpperCase() === expected && current === old, `protected-core-identity:${path}`);
    protectedFiles.push({ path, expected, old, current });
  }
  const formal = JSON.parse(await readFile(OLD_FORMAL, 'utf8'));
  assert(formal.accessCount === 0 && formal.formalOpened === false, 'old-formal-not-sealed');
  const emptyKnowledge = JSON.parse(await readFile(resolve('state/knowledge.json'), 'utf8'));
  assert(emptyKnowledge.documents.length === 0 && emptyKnowledge.claims.length === 0, 'production-knowledge-not-empty');
  const files: string[] = ['package.json', 'package-lock.json', 'tsconfig.json', 'kairos.config.json', 'README.md'];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path); else files.push(relative(process.cwd(), path).replaceAll('\\', '/'));
    }
  }
  await walk(resolve('src')); await walk(resolve('test'));
  const manifest = await Promise.all(files.sort().map(async path => ({ path, sha256: await fileSha(path) })));
  const result = { sourceIdentity: sha(manifest), fileCount: manifest.length, protectedFiles,
    formal: { accessCount: formal.accessCount, formalOpened: formal.formalOpened, sha256: await fileSha(OLD_FORMAL) },
    promptSha256: sha(SYSTEM_PROMPT), schemaSha256: sha(TOOL_SCHEMAS), lockSha256: await fileSha('package-lock.json'),
    knowledge: { documents: 0, claims: 0, sha256: sha(emptyKnowledge) } };
  await mkdir(output, { recursive: true });
  await saveJson(resolve(output, 'IDENTITIES.json'), result);
  await writeFile(resolve(output, 'SOURCE_MANIFEST.sha256'), manifest.map(file => `${file.sha256}  ${file.path}`).join('\n') + '\n');
  const runs = [];
  for (const entry of await readdir(resolve('evidence'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('v5-')) continue;
    const directory = resolve('evidence', entry.name), counts: Record<string, number> = {}, toolCounts: Record<string, number> = {};
    const requests: unknown[] = []; let lastSequence: number | null = null, frameCount = 0, gaps = 0;
    for await (const line of createInterface({ input: createReadStream(resolve(directory, 'events.jsonl')), crlfDelay: Infinity })) {
      const record = JSON.parse(line); counts[record.kind] = (counts[record.kind] ?? 0) + 1;
      if (record.kind === 'tool-start') toolCounts[record.value.name] = (toolCounts[record.value.name] ?? 0) + 1;
      if (record.kind === 'analysis-request') requests.push(record.value);
    }
    for await (const line of createInterface({ input: createReadStream(resolve(directory, 'frames.jsonl')), crlfDelay: Infinity })) {
      const frame = JSON.parse(line).value;
      if (lastSequence !== null && frame.sequence !== lastSequence + 1) gaps++;
      lastSequence = frame.sequence; frameCount++;
    }
    let result = null;
    try { result = JSON.parse(await readFile(resolve(directory, 'RUN_RESULT.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    runs.push({ run: entry.name, counts, toolCounts, frameCount, gaps, requests, result,
      rawEventsSha256: await fileSha(resolve(directory, 'events.jsonl')), rawFramesSha256: await fileSha(resolve(directory, 'frames.jsonl')) });
  }
  await saveJson(resolve(output, 'LIVE_AUDIT.json'), { runs, derivedFrom: 'complete events.jsonl and frames.jsonl; no inferred action/learning success' });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verify(resolve(process.argv[2] ?? 'evidence/development'));
  if (process.argv.includes('--seal')) {
    const files: string[] = [], root = resolve('evidence');
    async function collect(directory: string): Promise<void> {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, item.name);
        if (item.isDirectory()) await collect(path);
        else if (item.name !== 'EVIDENCE_MANIFEST.sha256') files.push(path);
      }
    }
    await collect(root);
    const lines = await Promise.all(files.sort().map(async path => `${await fileSha(path)}  ${relative(root, path).replaceAll('\\', '/')}`));
    const target = resolve(root, 'EVIDENCE_MANIFEST.sha256');
    await writeFile(target, lines.join('\n') + '\n');
    console.log(JSON.stringify({ evidenceFiles: files.length, manifest: target, sha256: await fileSha(target) }));
  }
}
