/** Presentation only. Reads sealed evidence; no Runtime, body, or writer port. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const [goalDirectory, explorationDirectory, outputDirectory] = process.argv.slice(2);
if (!outputDirectory) throw new Error('goal-exploration-new-demo-directory-required');
const digest = async path => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const readRows = async path => {
  const result = [];
  for await (const line of createInterface({ input: createReadStream(path) })) if (line) result.push(JSON.parse(line));
  return result;
};
const audit = JSON.parse(await readFile(resolve(goalDirectory, 'PHYSICAL_DRIVE_AUDIT.json'), 'utf8'));
if (!audit.passed || audit.eventsSha256 !== await digest(resolve(goalDirectory, 'events.jsonl'))
  || audit.framesSha256 !== await digest(resolve(goalDirectory, 'frames.jsonl')))
  throw new Error('recorded-demo-needs-intact-passed-physical-drive-audit');
const cases = [];
for (const [title, directory] of [['经验与预测驱动的目标动作', goalDirectory], ['从空经验开始自主探索', explorationDirectory]]) {
  const recordIntegrity = JSON.parse(await readFile(resolve(directory, 'RECORD_INTEGRITY_AUDIT_V2.json'), 'utf8'));
  if (!recordIntegrity.integrityPassed || recordIntegrity.hashes.events !== await digest(resolve(directory, 'events.jsonl'))
    || recordIntegrity.hashes.frames !== await digest(resolve(directory, 'frames.jsonl')))
    throw new Error('recorded-demo-needs-intact-runtime-integrity-audit');
  const rows = await readRows(resolve(directory, 'events.jsonl'));
  const events = rows.filter(r => r.kind === 'real-event').map(r => r.value), steps = [];
  let decision;
  for (const row of rows) {
    if (row.kind === 'joint-control-decision') decision = row.value;
    if (row.kind !== 'control-action-result') continue;
    const body = row.value, event = events.find(e => e.id === body.result.eventId);
    if (!event) throw new Error('recorded-action-event-not-found');
    const selected = audit.selectedActions?.find(a => a.eventId === event.id);
    steps.push({ eventId: event.id, action: body.offer.action, executed: body.result.executed,
      decision: decision.lastDecision,
      field: decision.field.sites.map(site => ({ id: site.siteId, operation: site.operation,
        activation: site.activation, drives: site.drives, eligible: site.hardEligible })),
      dependencies: decision.workspace.dependencies.map(edge => ({
        kind: edge.kind, from: edge.requiredNodeId, to: edge.dependentNodeId })),
      evidence: selected ? { physical: selected.physicallyQualifiedDirectGoalAction,
        samples: selected.validSamples, progress: selected.progressFraction,
        r1: selected.physicalEvidence?.r1.active, r2: selected.physicalEvidence?.r2.active,
        r2a: selected.physicalEvidence?.r2a.evidenceGrade,
        applicability: selected.physicalEvidence?.r2a.applicability,
        physicalReferences: selected.physicalEvidence } : null,
      frames: event.frames, receipt: event.bodyResult });
  }
  if (steps.length !== events.filter(e => e.bodyResult?.executed).length)
    throw new Error('recorded-demo-missing-action-decision');
  cases.push({ title, steps, source: resolve(directory), eventsSha256: await digest(resolve(directory, 'events.jsonl')),
    goal: rows.find(r => r.kind === 'final-goal-injected')?.value.goal ?? null,
    recordIntegrity: { passed: recordIntegrity.integrityPassed, frames: recordIntegrity.frames,
      sampledFrames: recordIntegrity.sampledFrames, frameMismatches: recordIntegrity.frameMismatches,
      controllerDoubleVerification: recordIntegrity.controllerDoubleVerification } });
}
const data = { version: 'RecordedPrototypeEvidenceDemoV1', cases,
  limits: '真实公开记录的示意回放，不是录屏、正在发生的游戏或通用多层推理证明。页面没有行动、训练或写入权限。',
  audit: { passed: audit.passed, continuityErrors: audit.continuityErrors,
    frameMismatches: audit.frameMismatches, predictedRealGoalTransitions: audit.predictedRealGoalTransitions,
    sourceFrames: audit.frameCount } };
await mkdir(outputDirectory, { recursive: false });
const template = await readFile(resolve(dirname(fileURLToPath(import.meta.url)),
  '../docs/recorded-prototype-demo-template.html'), 'utf8');
const json = JSON.stringify(data).replaceAll('<', '\\u003c');
await writeFile(resolve(outputDirectory, 'index.html'), template.replace('/*__EVIDENCE__*/', json), { flag: 'wx' });
await writeFile(resolve(outputDirectory, 'DEMO_SOURCES.json'), JSON.stringify(data, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ artifact: resolve(outputDirectory, 'index.html'),
  cases: cases.map(c => ({ title: c.title, actions: c.steps.length })), bytes: Buffer.byteLength(template) + Buffer.byteLength(json) }));
