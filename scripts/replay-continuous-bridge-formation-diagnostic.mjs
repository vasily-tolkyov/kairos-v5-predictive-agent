import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { actionObservationTrackedIdsV1, cueIdentity, realEventHierarchyContinuityV1 }
  from '../dist/src/events.js';
import { HIERARCHICAL_MEMORY_SEMANTICS_V1, HIERARCHICAL_MEMORY_VERSION_V1,
  HierarchicalPhysicalMemoryV1, rebuildHierarchicalUpperLayersV1 }
  from '../dist/src/hierarchical-memory.js';
import {
  minecraftHierarchicalContinuousBridgeCurriculumLiveV1,
  selectMinecraftHierarchicalContinuousBridgeRelationsLiveV1,
} from '../dist/src/evaluation/minecraft-hierarchical-continuous-bridge-curriculum-live-v1.js';
import {
  minecraftMultilevelGuidedFixtureGeometryLiveV1,
  minecraftMultilevelGuidedVocabularyPanelLiveV1,
} from '../dist/src/evaluation/minecraft-multilevel-guided-training-live-v1.js';
import { canonical, sha } from '../dist/src/util.js';

const project = resolve(import.meta.dirname, '..');
const evidenceName = process.argv[2];
if (!/^hierarchical-continuous-bridge-curriculum-live-v1-attempt-[0-9]{3}$/.test(evidenceName ?? ''))
  throw new Error('formation-replay-evidence-name-required');
const outputTag = process.argv[3] ?? 'PHYSICAL_PATTERN_V2';
if (!/^[A-Z0-9_]+$/.test(outputTag)) throw new Error('formation-replay-output-tag-invalid');
const evidence = resolve(project, 'evidence', evidenceName);
const source = resolve(project, 'evidence', 'hierarchical-multilevel-goal-chain-live-v1-attempt-017',
  'REBUILT_ROLE_BOUND_HIERARCHICAL_EXPERIENCE.json');
const parseLines = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const results = parseLines(resolve(evidence, 'events.jsonl'))
  .filter(value => value.kind === 'body-result').map(value => value.value);
const frames = new Map(parseLines(resolve(evidence, 'frames.jsonl'))
  .filter(value => value.kind === 'frame').map(value => [value.value.sequence, value.value]));
const plan = minecraftHierarchicalContinuousBridgeCurriculumLiveV1();
const formationActionCount = plan.formation.reduce((sum, fragment) => sum + fragment.atoms.length, 0);
const validatedActionCount = formationActionCount
  + plan.validations.reduce((sum, fragment) => sum + fragment.atoms.length, 0);
const replayFragments = results.length === formationActionCount ? plan.formation
  : results.length === validatedActionCount ? [...plan.formation, ...plan.validations] : null;
if (!replayFragments) throw new Error(
  `formation-replay-body-result-cardinality:${results.length}:${formationActionCount}:${validatedActionCount}`);
const flat = replayFragments.flatMap(fragment => fragment.atoms.map((atom, atomIndex) =>
  ({ fragment, atom, atomIndex })));

const referenceId = fragment => {
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(fragment.layout);
  if (fragment.family.startsWith('look-')) return geometry.buttonId;
  if (fragment.family === 'forward-approach-disconnected-interact')
    return `block:${minecraftMultilevelGuidedVocabularyPanelLiveV1(fragment.layout).proxyButton.join(',')}`;
  if (fragment.direction) return `block:${[
    geometry.oneBlockObstacle[0], 65, geometry.oneBlockObstacle[2],
  ].join(',')}`;
  if (fragment.family === 'jump-clear-distance-progress') {
    return `block:${geometry.oneBlockObstacle.join(',')}`;
  }
  return `block:${geometry.highObstacle[1].join(',')}`;
};

const sourceSnapshot = JSON.parse(readFileSync(source, 'utf8'));
if (sourceSnapshot.version !== 'KairosV5HierarchicalMemoryV10')
  throw new Error('formation-replay-source-is-not-audited-V10');
const cleanSourceInput = { ...sourceSnapshot,
  version: HIERARCHICAL_MEMORY_VERSION_V1,
  hierarchy: HIERARCHICAL_MEMORY_SEMANTICS_V1,
  r2a: null,
  hierarchyInterventionLedger: [] };
const rebuiltSourceUpper = rebuildHierarchicalUpperLayersV1(cleanSourceInput);
const memory = HierarchicalPhysicalMemoryV1.restore({ ...cleanSourceInput,
  r2Store: rebuiltSourceUpper.r2Store, r2a: rebuiltSourceUpper.r2a });
const timeline = [];
let resultIndex = 0;
for (const fragment of replayFragments) {
  const events = [];
  for (let atomIndex = 0; atomIndex < fragment.atoms.length; atomIndex++, resultIndex++) {
    const atom = fragment.atoms[atomIndex], bodyResult = results[resultIndex];
    if (cueIdentity({ kind: bodyResult.action.kind, parameters: bodyResult.action.parameters,
      targetRole: atom.cue.targetRole }) !== cueIdentity(atom.cue))
      throw new Error(`formation-replay-cue-mismatch:${fragment.fragmentId}:${atomIndex}`);
    const eventFrames = [];
    for (let sequence = bodyResult.startSequence; sequence <= bodyResult.endSequence; sequence++) {
      const frame = frames.get(sequence);
      if (!frame) throw new Error(`formation-replay-frame-missing:${sequence}`);
      eventFrames.push(frame);
    }
    const scope = { version: 'ActionObservationScopeV1',
      referencedPublicObjectIds: [referenceId(fragment)] };
    const bare = { version: 'RealEventV5', id: `formation-replay:${resultIndex + 1}`,
      cue: structuredClone(atom.cue), frames: eventFrames,
      trackedIds: actionObservationTrackedIdsV1(bodyResult.action.targetId, scope, [], eventFrames),
      bodyResult: structuredClone(bodyResult), provenance: 'executed-real-body', complete: true };
    events.push({ ...bare, hierarchyContinuity: realEventHierarchyContinuityV1(
      bare, 'formation-replay-session', atomIndex === 0 ? 'reset' : 'continuous') });
  }
  for (const event of events) {
    let receipt;
    try { receipt = memory.observe(event); }
    catch (error) {
      throw new Error(`formation-replay-observe-failed:${fragment.fragmentId}:${event.id}:${error.message}`,
        { cause: error });
    }
    if (receipt.representationRejection !== null)
      throw new Error(`formation-replay-unrepresented:${fragment.fragmentId}:${canonical(receipt.representationRejection)}`);
  }
  const snapshot = memory.snapshot(), ids = events.map(value => value.id);
  const matches = snapshot.r2Store.events.filter(value => value.completion === 'complete'
    && canonical(value.sourceEventIds) === canonical(ids));
  if (matches.length !== 1) throw new Error(`formation-replay-r2-missing:${fragment.fragmentId}:${matches.length}`);
  timeline.push({ fragmentId: fragment.fragmentId, eventIds: ids, r2EventId: matches[0].eventId,
    orderedExperienceIdentities: events.map(value => cueIdentity(value.cue)) });
}
const snapshot = memory.snapshot();
const timelineByFragment = new Map(timeline.map(value => [value.fragmentId, value]));
const comparisons = [
  ['left-A-vs-B', 'left', 'B', 0],
  ['left-A-vs-C', 'left', 'C', 1],
  ['right-A-vs-B', 'right', 'B', 0],
  ['right-A-vs-C', 'right', 'C', 1],
  ['jump-clear-vs-blocked', null, null, 0],
];
const comparisonAudit = comparisons.map(([comparison, direction, contrastVariant, branchAtomIndex]) => {
  const targetFragments = direction === null
    ? plan.formation.filter(value => value.family === 'jump-clear-distance-progress')
    : plan.formation.filter(value => value.direction === direction
      && value.family === 'side-A-clear-then-forward-clear');
  const contrastFragments = direction === null
    ? plan.formation.filter(value => value.family === 'jump-blocked-no-distance-progress')
    : plan.formation.filter(value => value.direction === direction
      && value.family === (contrastVariant === 'B'
        ? 'side-B-blocked-then-forward-blocked'
        : 'side-C-clear-then-forward-extension-blocked'));
  const eventIds = fragments => fragments.map(value => timelineByFragment.get(value.fragmentId).r2EventId);
  const targetEventIds = eventIds(targetFragments), contrastEventIds = eventIds(contrastFragments);
  const containing = ids => snapshot.r2a.patterns.filter(pattern =>
    ids.every(id => pattern.memberEventIds.includes(id)));
  const targetPatterns = containing(targetEventIds), contrastPatterns = containing(contrastEventIds);
  const exactNextActionIdentity = cueIdentity(targetFragments[0].atoms[branchAtomIndex].cue);
  const targetPatternIds = new Set(targetPatterns.map(value => value.patternId));
  const contrastPatternIds = new Set(contrastPatterns.map(value => value.patternId));
  const related = snapshot.r2a.relations.filter(value =>
    (targetPatternIds.has(value.targetPatternId)
      && value.contrastPatternIds.some(id => contrastPatternIds.has(id)))
    || (contrastPatternIds.has(value.targetPatternId)
      && value.contrastPatternIds.some(id => targetPatternIds.has(id))));
  return { comparison, branchAtomIndex, exactNextActionIdentity,
    targetFragments: targetFragments.map(value => value.fragmentId),
    contrastFragments: contrastFragments.map(value => value.fragmentId),
    targetEventIds, contrastEventIds,
    targetPatterns: targetPatterns.map(value => ({ patternId: value.patternId,
      grade: value.grade, supportCount: value.supportCount,
      orderedExperienceIdentities: value.orderedExperienceIdentities,
      orderedTransitionTopologyIds: value.orderedTransitionTopologyIds })),
    contrastPatterns: contrastPatterns.map(value => ({ patternId: value.patternId,
      grade: value.grade, supportCount: value.supportCount,
      orderedExperienceIdentities: value.orderedExperienceIdentities,
      orderedTransitionTopologyIds: value.orderedTransitionTopologyIds })),
    relatedRelations: related.map(value => ({ relationId: value.relationId,
      targetPatternId: value.targetPatternId, contrastPatternIds: value.contrastPatternIds,
      branchAtomIndex: value.branchAtomIndex,
      exactNextActionIdentity: value.exactNextActionIdentity,
      grade: value.grade, formedAtEventId: value.formedAtEventId,
      predictiveSinceEventId: value.predictiveSinceEventId,
      supportEventIds: value.supportEventIds,
      contradictionEventIds: value.contradictionEventIds,
      validationEventIds: value.validationEventIds,
      validationCorrectCount: value.validationCorrectCount,
      validationContextIds: value.validationContextIds,
      factorIds: value.factorIds })) };
});
const formationTimeline = timeline.filter(value => plan.formation.some(fragment =>
  fragment.fragmentId === value.fragmentId));
let selection = null, selectionError = null;
try { selection = selectMinecraftHierarchicalContinuousBridgeRelationsLiveV1(
  snapshot, plan, formationTimeline); }
catch (error) { selectionError = { name: error.name, message: error.message, stack: error.stack }; }
const audit = { version: 'ContinuousBridgeFormationReplayDiagnosticV1', evidenceName,
  replayedPhase: results.length === formationActionCount ? 'formation' : 'prospective-validation',
  sourceSnapshotSha256: sha(JSON.parse(readFileSync(source, 'utf8'))),
  bodyResults: results.length, replayedR1Atoms: snapshot.r1Store.atoms.length,
  replayedR2Events: snapshot.r2Store.events.length,
  patterns: snapshot.r2a.patterns.map(value => ({ patternId: value.patternId,
    grade: value.grade, supportCount: value.supportCount, memberEventIds: value.memberEventIds,
    orderedExperienceIdentities: value.orderedExperienceIdentities,
    orderedTransitionTopologyIds: value.orderedTransitionTopologyIds })),
  factors: snapshot.r2a.factors, relations: snapshot.r2a.relations,
  comparisonAudit, selection, selectionError, replaySnapshotCanonicalSha256: sha(snapshot) };
writeFileSync(resolve(evidence, `FORMATION_REPLAY_${outputTag}_SNAPSHOT.json`), `${canonical(snapshot)}\n`,
  { flag: 'wx' });
writeFileSync(resolve(evidence, `FORMATION_REPLAY_${outputTag}_DIAGNOSTIC.json`), `${canonical(audit)}\n`,
  { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ evidenceName, bodyResults: results.length,
  r1Atoms: audit.replayedR1Atoms, r2Events: audit.replayedR2Events,
  patternCount: audit.patterns.length, factorCount: audit.factors.length,
  relationCount: audit.relations.length, selectionError }, null, 2)}\n`);
if (selectionError) process.exitCode = 1;
