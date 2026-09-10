import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { distributedPublicSignalChannelIdV1 } from '../dist/src/core/learning/distributed-r2.js';
import { sha } from '../dist/src/util.js';
import { loadSnapshotFromDisk } from '../dist/src/runtime.js';
import { canonicalStreamSha256 } from '../dist/src/util-stream.js';
import { physicalActivationResidenceMatchV1, physicalResidenceMatchV1 }
  from '../dist/src/core/prediction/distributed-prediction-clone.js';

if (!process.argv[2] || !process.argv[3]) throw new Error('input-and-new-output-required');
const { snapshot } = process.argv[2].endsWith('.gz')
  ? JSON.parse(gunzipSync(await readFile(process.argv[2])))
  : await loadSnapshotFromDisk(process.argv[2]);
const state = snapshot.r2a;
const substrate = { ...state.medium, sites: state.medium.sites.map(site => ({ ...site, activation: 0 })) };
const medium = DistributedPhysicalMedium3DV1.fromSnapshot(substrate);
const before = canonicalStreamSha256(medium.snapshot());
const reports = [];
let assessments = state.interventions;
const plansIndex = process.argv.indexOf('--plans');
if (plansIndex >= 0) {
  const declared = JSON.parse(await readFile(process.argv[plansIndex + 1], 'utf8'));
  assessments = declared.interventionPlans.flatMap(pair => {
    const baseline = state.eventInputs.find(value => value.eventId === pair.baselineR2EventId);
    const intervention = state.eventInputs.find(value => value.eventId === pair.interventionR2EventId);
    const relations = state.relations.filter(relation => state.patterns.find(pattern =>
      pattern.patternId === relation.patternId)?.memberR2EventIds.includes(pair.interventionR2EventId));
    return relations.flatMap(relation => relation.factors.filter(factor =>
      factor.afferentSiteIds.some(site => intervention.conditionSiteIds.includes(site))
      && !factor.afferentSiteIds.some(site => baseline.conditionSiteIds.includes(site)))
      .map(factor => ({ ...pair, relationId: relation.relationId, changedFactorId: factor.factorId })));
  });
}
if (assessments.length === 0) throw new Error('no-actual-pair-with-a-field-derived-relation');
for (const relationId of [...new Set(assessments.map(value => value.relationId))].slice(0, process.argv.includes('--first') ? 1 : undefined)) {
  const assessment = assessments.find(value => value.relationId === relationId);
  const relation = state.relations.find(value => value.relationId === relationId);
  const pattern = state.patterns.find(value => value.patternId === relation.patternId);
  const input = state.eventInputs.find(value => value.eventId === assessment.interventionR2EventId);
  const baselineInput = state.eventInputs.find(value => value.eventId === assessment.baselineR2EventId);
  const factor = relation.factors.find(value => value.factorId === assessment.changedFactorId);
  const variable = new Set(state.conditionBindings.filter(binding => factor.sourceChannelIds
    .includes(distributedPublicSignalChannelIdV1(binding.signalId))).flatMap(value => value.siteIds));
  const actualRoute = input.reachableContinuationPulseDrives;
  const sourcePrefix = process.argv.includes('--exact-route') ? actualRoute.slice(1, -1)
    : pattern.corridor.orderedPrefixPulseDrives;
  const prefix = sourcePrefix.map(pulse =>
    pulse.filter(drive => !variable.has(drive.siteId))).filter(pulse => pulse.length);
  const action = pattern.corridor.actionPulseDrives.at(-1);
  // The R1 atom contract is [actual before-state, exact action cue, outcomes...].
  // Its projected action cue is known before the outcome; no terminal pulse enters.
  const projectedCue = input.projectedPulseDrives[input.nextActionPrefixPulseDrives.length + 1];
  const projectedBefore = input.projectedPulseDrives[input.nextActionPrefixPulseDrives.length];
  const conditions = input.conditionDrives;
  const modes = process.argv.includes('--decompose-input')
    ? ['observed-intervention', 'observed-baseline', 'factor-ablated',
      'factor-only-intervention', 'factor-only-baseline', 'action-only-intervention',
      'action-only-baseline', 'factor-and-action-intervention', 'factor-and-action-baseline']
    : process.argv.includes('--contrasting-state')
      ? ['observed-intervention', 'observed-baseline'] : ['observed-intervention', 'factor-ablated'];
  for (const mode of modes) {
    const ablated = mode === 'factor-ablated';
    const factorOnly = process.argv.includes('--factor-only') || mode.startsWith('factor-only-')
      || mode.startsWith('factor-and-action-');
    const actionOnly = process.argv.includes('--action-only') || mode.startsWith('action-only-')
      || mode.startsWith('factor-and-action-');
    const measuredCurrent = mode.endsWith('baseline') ? baselineInput.conditionDrives
      : ablated ? conditions.filter(drive => !variable.has(drive.siteId)) : conditions;
    // An explicitly labelled diagnostic input lesion, not a production query
    // or qualification result. It locates whether the shared boundary or the
    // repeated prefix dominates the physically measured variable.
    const current = factorOnly
      ? measuredCurrent.filter(drive => variable.has(drive.siteId)) : measuredCurrent;
    const started = performance.now();
    const seed = BigInt(state.seedHex) ^ 0x696e74657276656en ^ 1n;
    const queryPulses = [...(actionOnly ? [] : prefix), action,
      ...(process.argv.includes('--projected-known-boundary') ? [projectedBefore, projectedCue]
        : process.argv.includes('--projected-cue') ? [projectedCue] : [])];
    const domain = [...new Set(state.patterns.flatMap(value => value.attractor.coreSiteIds))];
    const readout = process.argv.includes('--population-readout')
      ? current.length
        ? medium.probeConditionedSequenceAtReadout(current, queryPulses, pattern.attractor.coreSiteIds, domain, seed, 180)
        : medium.probeSequentialAtReadout(queryPulses, pattern.attractor.coreSiteIds, domain, seed, 180)
      : current.length ? medium.probeConditionedSequence(current, queryPulses, seed, 180)
        : medium.probeSequential(queryPulses, seed, 180);
    const target = new Set(pattern.attractor.coreSiteIds);
    const physicalBranches = [...new Map(state.patterns.map(value =>
      [value.physicalBranchId ?? value.patternId, value])).entries()];
    const universe = [...new Set(physicalBranches.flatMap(([, value]) => value.attractor.coreSiteIds))];
    const report = { relationId, patternId: pattern.patternId, ablated, mode,
      durationMs: performance.now() - started, conditionCount: current.length,
      prefixCounts: prefix.map(pulse => pulse.length), actionCount: action.length,
      expectedCoreCount: target.size, expectedAssembly: pattern.attractor.coactivationAssemblyId,
      rawProfileScores: physicalBranches.map(([branchId, value]) => ({ branchId,
        profile: physicalActivationResidenceMatchV1(readout.terminalActivations ?? [],
          value.attractor.terminalActivations ?? [], value.attractor.coreSiteIds, universe),
        core: physicalResidenceMatchV1(readout.coreSiteIds, value.attractor.coreSiteIds),
        assemblyEqual: readout.coactivationAssemblyId === value.attractor.coactivationAssemblyId })),
      actualCoreCount: readout.coreSiteIds.length, actualAssembly: readout.coactivationAssemblyId,
      targetOverlap: readout.coreSiteIds.filter(siteId => target.has(siteId)).length,
      dwell: readout.dwellSteps, escape: readout.escapeRate, ambiguous: readout.ambiguous,
      evidence: readout.evidenceLevel, directedTransport: readout.run.directedTransportMass,
      readout, queryRoute: process.argv.includes('--exact-route') ? 'deposited-pre-action-route' : 'legacy-projected-prefix',
      inputLesionDiagnostic: { factorOnly, actionOnly,
        projectedKnownBoundary: process.argv.includes('--projected-known-boundary'), notQualificationEvidence: true },
      actualCoreActionOverlap: readout.coreSiteIds.filter(site => action.some(drive => drive.siteId === site)).length,
      actualCoreConditionOverlap: readout.coreSiteIds.filter(site => current.some(drive => drive.siteId === site)).length };
    reports.push(report);
    const { readout: _raw, expectedAssembly, actualAssembly, ...summary } = report;
    console.log(JSON.stringify({ ...summary, expectedAssembly: expectedAssembly && sha(expectedAssembly),
      actualAssembly: actualAssembly && sha(actualAssembly) }));
  }
}
const after = canonicalStreamSha256(medium.snapshot());
await writeFile(process.argv[3], JSON.stringify({ before, after, readOnly: before === after, reports }), { flag: 'wx' });
if (before !== after) throw new Error('probe-mutated-substrate');
