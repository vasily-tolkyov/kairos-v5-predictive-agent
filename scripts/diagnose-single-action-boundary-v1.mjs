/** Anonymous synthetic counterexample; never a production experience source. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { saveJson } from '../dist/src/util.js';

const output = process.argv[2];
if (!output) throw new Error('new-output-directory-required');
await mkdir(output, { recursive: false });
const baselineSource = process.argv[3];
let Medium = DistributedPhysicalMedium3DV1;
if (baselineSource) {
  const ts = (await import('typescript')).default;
  const source = await readFile(baselineSource, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
  const resolved = compiled.replace(/from\s+(["'])(\.[^"']+)\1/g, (_match, _quote, specifier) =>
    `from ${JSON.stringify(pathToFileURL(resolve('dist/src/core/physics', specifier)).href)}`);
  Medium = (await import(`data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`))
    .DistributedPhysicalMedium3DV1;
}
const populations = [[1, 2, 3, 4], [100, 101, 102, 103],
  [1000, 1001, 1002, 1003], [2000, 2001, 2002, 2003]];
const [s0, cue, s1, s2] = populations;
const medium = new Medium({ name: 'anonymous-single-action-boundary' });
for (let repetition = 0; repetition < 16; repetition++) {
  for (const [index, sequence] of [[0, [s0, cue, s1]], [1, [s1, cue, s2]]]) {
    medium.applyEpisode({ version: 'DistributedEpisodeV1',
      traceId: `synthetic-${repetition}-${index}`, provenance: 'trusted-real-event',
      pulses: sequence.map((sites, ordinal) => ({ version: 'SparseFieldPulseV1',
        offset: ordinal * .04, drives: sites.map(siteId => ({ siteId, intensity: 1 })) })) });
  }
}
const stored = medium.snapshot();
const resting = { ...stored, sites: stored.sites.map(site => ({ ...site, activation: 0 })) };
const variants = [
  ['unaltered-field', resting],
  ['incoming-command-bonds-ablated', { ...resting, learnedBonds: resting.learnedBonds
    .filter(bond => bond.kind !== 'plastic-directed' || !cue.includes(bond.toSiteId)) }],
];
const rows = [];
for (const [variant, state] of variants) {
  const subject = Medium.fromSnapshot(state);
  const before = canonicalStreamSha256(subject.snapshot());
  for (let index = 0; index < 8; index++) {
    const result = subject.probeConditionedSequence(s0, [cue], BigInt(index + 1), 180);
    const core = new Set(result.coreSiteIds);
    const fraction = members => members.filter(site => core.has(site)).length / members.length;
    rows.push({ variant, seed: index + 1, suppliedActionPulseCount: 1,
      firstResultCoverage: fraction(s1), secondResultCoverage: fraction(s2),
      falseSingleActionResult: !result.ambiguous && fraction(s2) >= .75,
      ambiguous: result.ambiguous, core: result.coreSiteIds,
      assemblyId: result.coactivationAssemblyId ?? null,
      directedTransportMass: result.run.directedTransportMass });
    await saveJson(resolve(output, `${variant}-${index + 1}.json`), result);
  }
  if (before !== canonicalStreamSha256(subject.snapshot())) throw new Error('query-wrote-medium');
}
const result = { baselineSource: baselineSource ?? null,
  syntheticDiagnosticOnly: true, gameCalls: 0, productionWrites: 0,
  interventionsAreDiagnosticAblationsNotRepairs: true, rows,
  falseSingleActionResults: rows.filter(row => row.variant === 'unaltered-field'
    && row.falseSingleActionResult).length };
await saveJson(resolve(output, 'RESULT.json'), result);
console.log(JSON.stringify(result));
process.exitCode = result.falseSingleActionResults > 0 ? 1 : 0;
