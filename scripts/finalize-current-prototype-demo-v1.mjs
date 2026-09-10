/** One scoped post-run record. Does not run the model, game, or physical core. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), output = resolve('evidence/current-prototype-evidence-demo-v2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = async path => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
};
// Checkpoint digests cover canonical JSON, excluding the file's newline frame.
const canonicalFileHash = async path => {
  const bytes = await readFile(path); assert.equal(bytes.at(-1), 10);
  return hash(bytes.subarray(0, -1));
};
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (name, value) => writeFile(resolve(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sourceFiles = [...new Set(execFileSync('rg', ['--files', 'src', 'test', 'scripts', 'docs'],
  { encoding: 'utf8' }).trim().split(/\r?\n/).map(path => path.replaceAll('\\', '/'))
  .concat(['README.md', 'package.json', 'package-lock.json', 'kairos.config.json', 'tsconfig.json']))].sort();
const sourceRows = [];
for (const path of sourceFiles) sourceRows.push(`${await fileHash(path)}  ${path}`);
const sourceManifest = sourceRows.join('\n') + '\n';
await writeFile(resolve(output, 'SOURCE_MANIFEST_V2.sha256'), sourceManifest, { flag: 'wx' });

const foundation = resolve('evidence/current-single-interaction-arrival-assessment-v1');
const pointerPath = resolve(foundation, 'EXPERIENCE_LATEST.json');
const pointer = await json(pointerPath), manifest = await json(resolve(foundation, pointer.filename));
assert.equal(await fileHash(pointerPath), '7811b58cc8c534c59f2546e9b8f59b6e6f0939d57d395311f6c84f9367a5a232');
assert.equal(await canonicalFileHash(resolve(foundation, pointer.filename)), pointer.manifestSha256);
assert.equal(manifest.sha256, pointer.sha256);
const components = [];
const leaves = node => node.kind === 'leaf' ? [node] : node.children.flatMap(entry => leaves(entry.child));
for (const segment of manifest.segments) {
  for (const part of segment.paged ? leaves(segment.paged) : [segment]) {
    const path = resolve(foundation, 'experience-0128.segments', part.filename);
    const digest = await canonicalFileHash(path);
    assert.equal(digest, part.sha256); assert.equal((await stat(path)).size, part.bytes);
    components.push({ filename: part.filename, sha256: digest, bytes: part.bytes });
  }
}
const formalPath = 'D:/REACT_Transformer_REACT_Hierarchical_Physical_Medium_World_Model_V4_0_Clean/artifacts/minecraft-java-cognitive-loop-stage5-context-budget-action-decomposition-1/FORMAL_V3_ACCESS_STATE.json';
const formal = await json(formalPath), formalSha256 = await fileHash(formalPath);
assert.equal(formal.accessCount, 0); assert.equal(formal.formalOpened, false);
assert.equal(formalSha256, '1a28b87a23ae08b6f597708becef14f5e2b61bbe76ad2ee779141e8e6b7a88df');
const goalDir = 'evidence/current-grounded-note-optimized-v1';
const exploreDir = 'evidence/current-prototype-exploration-v1';
const goal = await json(`${goalDir}/RUN_RESULT.json`);
const goalAudit = await json(`${goalDir}/PHYSICAL_DRIVE_AUDIT.json`);
const goalIntegrity = await json(`${goalDir}/RECORD_INTEGRITY_AUDIT_V2.json`);
const exploreIntegrity = await json(`${exploreDir}/RECORD_INTEGRITY_AUDIT_V2.json`);
assert(goalAudit.passed && goalIntegrity.integrityPassed && goalIntegrity.controllerDoubleVerification);
assert(exploreIntegrity.integrityPassed);
const url = 'http://127.0.0.1:3014/';
const response = await fetch(url), served = Buffer.from(await response.arrayBuffer());
assert.equal(response.status, 200);
assert.equal(hash(served), await fileHash(resolve(output, 'index.html')));
const post = await fetch(url, { method: 'POST', body: '{}' }); assert.equal(post.status, 405);
const result = { version: 'CurrentPrototypeDemonstrationAuditV1',
  status: 'validated-basic-real-exploration-and-direct-physically-grounded-goal',
  notGeneralMultistepQualification: true,
  currentSource: { files: sourceFiles.length, manifestFile: 'SOURCE_MANIFEST_V2.sha256', manifestSha256: hash(sourceManifest),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyWorktreePreserved: true, sourceIdentityCapturedAfterRunNotAClaimOfCleanGitCommit: true },
  frozenFoundation: { canonicalSnapshotSha256: pointer.sha256, manifestSha256: pointer.manifestSha256,
    eventCount: pointer.eventCount, verifiedComponents: components },
  goal: { status: goal.result.status, durationMs: goal.durationMs, actions: goal.newActions,
    events: goal.newEvents, frames: goalAudit.frameCount, predictedRealGoalTransitions: goalAudit.predictedRealGoalTransitions,
    verificationSequences: goalIntegrity.verifiedGoalSequences, hashes: goalIntegrity.hashes },
  exploration: { actions: exploreIntegrity.actions.length, frames: exploreIntegrity.frames,
    kinds: exploreIntegrity.actions.map(action => action.action.kind), hashes: exploreIntegrity.hashes,
    newInitializationQualified: false },
  presentation: { url, getStatus: response.status, postStatus: post.status,
    htmlSha256: hash(served), readOnly: true, recordedSchematicNotLiveVideo: true,
    visualPixelInspection: false, interactionChecks: { actions: 10, frames: 169 } },
  formal: { accessCount: formal.accessCount, formalOpened: formal.formalOpened, sha256: formalSha256 },
  knownUnqualifiedExtension: 'current-grounded-note-yaw-plus15-v1',
  gameCallsByFinalizer: 0, physicalWritesByFinalizer: 0, githubPushed: false };
await save('FINAL_AUDIT.json', result);
const inputs = [
  `${goalDir}/RUN_RESULT.json`, `${goalDir}/PHYSICAL_DRIVE_AUDIT.json`, `${goalDir}/RECORD_INTEGRITY_AUDIT_V2.json`,
  `${goalDir}/events.jsonl`, `${goalDir}/frames.jsonl`, `${goalDir}/FROZEN_DEVELOPMENT_PLAN.json`,
  `${exploreDir}/RUN_RESULT.json`, `${exploreDir}/RECORD_INTEGRITY_AUDIT_V2.json`, `${exploreDir}/events.jsonl`, `${exploreDir}/frames.jsonl`,
  'evidence/current-grounded-note-heldout-v2/RUN_RESULT.json',
  'evidence/current-grounded-note-heldout-v2/PHYSICAL_DRIVE_AUDIT.json',
  'evidence/current-grounded-note-heldout-v2/R1_QUALIFICATION_REFERENCE.json',
  'evidence/current-grounded-note-heldout-v2/R1_QUALIFICATION_OPTIMIZED.json',
  'evidence/current-grounded-note-yaw-plus15-v1/RUN_RESULT.json',
  'evidence/current-single-interaction-arrival-assessment-v1/ASSESSMENT_RESULT.json',
  'evidence/current-single-interaction-arrival-assessment-v1/EXPERIENCE_LATEST.json',
];
const manifestRows = [];
for (const path of [...inputs.map(path => resolve(path)), ...(await readdir(output)).map(name => resolve(output, name))].sort()) {
  const rel = relative(root, path).replaceAll('\\', '/');
  manifestRows.push(`${await fileHash(path)}  ${rel}`);
}
const evidenceManifest = manifestRows.join('\n') + '\n';
await writeFile(resolve(output, 'EVIDENCE_MANIFEST.sha256'), evidenceManifest, { flag: 'wx' });
for (const line of manifestRows) assert.equal(await fileHash(resolve(root, line.slice(66))), line.slice(0, 64));
console.log(JSON.stringify({ status: result.status, sourceFiles: sourceFiles.length,
  sourceManifestSha256: hash(sourceManifest), evidenceFiles: manifestRows.length,
  evidenceManifestSha256: hash(evidenceManifest), frozenComponents: components.length, mismatches: 0, url }));
