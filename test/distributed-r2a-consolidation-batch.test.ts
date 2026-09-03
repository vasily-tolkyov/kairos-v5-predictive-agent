import test from 'node:test';
import assert from 'node:assert/strict';
import { DistributedR2APhysicalPatternLearnerV2 }
  from '../src/core/learning/distributed-r2a-physical.js';
import type { DistributedR2ContinuousEventV1 }
  from '../src/core/learning/distributed-r2-contracts.js';
import { sha } from '../src/util.js';

/** A small anonymous, complete R2 event.  It is deliberately not a semantic
 * curriculum: the test only needs enough real event boundaries to cross the
 * learner's existing consolidation cadence. */
function event(index: number): DistributedR2ContinuousEventV1 {
  const eventId = `batch-event-${index}`;
  const pulses = [[10, 11], [20, 21], [30, 31]] as const;
  return {
    version: 'DistributedR2ContinuousEventV1', eventId,
    atomIds: [`${eventId}:prefix`, `${eventId}:action`],
    sourceEventIds: [`${eventId}:source-prefix`, `${eventId}:source-action`],
    orderedExperienceIdentities: ['batch-prefix', 'batch-action'],
    orderedEpisodePatternIds: ['batch-prefix-pattern', 'batch-action-pattern'],
    dependencyIds: ['batch-process'], contextIds: [`batch-context-${index % 8}`],
    completion: 'complete', boundaryReason: 'public-process-resolved', learningEligible: true,
    physicalFootprint: {
      version: 'DistributedTraceFootprintV1', traceId: `r2-${eventId}`,
      footprintId: `r2-${eventId}`, depositedAt: index,
      siteIds: [...new Set(pulses.flat())], pulseSiteIds: pulses,
      bondReferences: [], directedBondIds: [], pulseCount: pulses.length, supportMass: 1,
    },
    processChanges: [{ subject: 'batch-object', property: 'state', before: false, after: true,
      observationIndex: index, meaning: 'observed-co-occurrence' }],
    terminalChanges: [{ subject: 'batch-object', property: 'state', before: false, after: true,
      observationIndex: index, meaning: 'observed-co-occurrence' }],
    beforePublicSignals: ['batch-condition:value'],
    beforeSignalTimeline: [['batch-condition:value']],
    beforePublicSignalOccurrences: [{ signalId: 'batch-condition:value',
      pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 }],
    beforeSignalTimelineOccurrences: [[{ signalId: 'batch-condition:value',
      pulseOrdinal: 0, channelOrdinal: 0, receptorOrdinal: 0 }]],
    physicalPulseSiteIds: pulses,
    atomPulseRanges: [
      { atomId: `${eventId}:prefix`, startPulseIndex: 0, endPulseIndexExclusive: 1 },
      { atomId: `${eventId}:action`, startPulseIndex: 1, endPulseIndexExclusive: 3 },
    ],
    patternSha256: sha({ version: 'batch-event', index }),
  };
}

function feed(learner: DistributedR2APhysicalPatternLearnerV2, count: number): void {
  for (let index = 0; index < count; index += 1) learner.observe(event(index));
}

test('explicit R2A batch coalesces cadence consolidations without deferring event deposits', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  learner.beginDeferredConsolidationBatchV1();
  assert.deepEqual(learner.consolidationBatchStatusV1(), {
    version: 'DistributedR2AConsolidationBatchStatusV1', active: true,
    pending: false, deferredBoundaryCount: 0,
  });

  feed(learner, 15);
  assert.deepEqual(learner.consolidationBatchStatusV1(), {
    version: 'DistributedR2AConsolidationBatchStatusV1', active: true,
    pending: false, deferredBoundaryCount: 0,
  });
  assert.equal(learner.consolidationPerformanceAuditV1().consolidationPassCount, 0);

  learner.observe(event(15));
  learner.observe(event(16));
  learner.observe(event(17));
  learner.observe(event(18));
  learner.observe(event(19));
  learner.observe(event(20));
  learner.observe(event(21));
  learner.observe(event(22));
  learner.observe(event(23));
  assert.deepEqual(learner.consolidationBatchStatusV1(), {
    version: 'DistributedR2AConsolidationBatchStatusV1', active: true,
    pending: true, deferredBoundaryCount: 2,
  });
  assert.equal(learner.consolidationPerformanceAuditV1().consolidationPassCount, 0,
    'consolidation ran inside an explicitly deferred batch');

  const receipt = learner.endDeferredConsolidationBatchV1();
  assert.deepEqual(receipt, {
    version: 'DistributedR2AConsolidationBatchReceiptV1',
    deferredBoundaryCount: 2, consolidated: true,
  });
  assert.deepEqual(learner.consolidationBatchStatusV1(), {
    version: 'DistributedR2AConsolidationBatchStatusV1', active: false,
    pending: false, deferredBoundaryCount: 0,
  });
  assert.equal(learner.consolidationPerformanceAuditV1().consolidationPassCount, 1);
  assert.equal(learner.snapshot().eventInputs.length, 24,
    'deferral must not drop or postpone physical event deposits');
  assert.throws(() => learner.endDeferredConsolidationBatchV1(),
    /R2A-consolidation-batch-not-active/);
});

test('default event cadence remains unchanged when no explicit batch is open', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  feed(learner, 24);
  assert.equal(learner.consolidationPerformanceAuditV1().consolidationPassCount, 2);
});

test('nested deferred consolidation batches are rejected instead of hiding an unmatched close', () => {
  const learner = new DistributedR2APhysicalPatternLearnerV2(() => true);
  learner.beginDeferredConsolidationBatchV1();
  assert.throws(() => learner.beginDeferredConsolidationBatchV1(),
    /R2A-consolidation-batch-already-active/);
  learner.endDeferredConsolidationBatchV1();
});
