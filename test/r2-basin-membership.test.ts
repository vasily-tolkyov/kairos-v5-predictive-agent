import test from 'node:test';
import assert from 'node:assert/strict';
import { R2_CONFIG } from '../src/core/config.js';
import type {
  ActiveR2BasinMembershipV1,
  CausalFactorGraphStateV2,
  R2BasinMembershipResolverV1,
} from '../src/core/contracts.js';
import { ActionConditionedRuleQuery } from '../src/core/learning/action-conditioned-rule-query.js';
import { OpenCausalFactorR2A } from '../src/core/learning/open-causal-factor-r2a.js';
import { DeterministicTokenFieldEncoder } from '../src/core/learning/token-field.js';
import { PhysicalMedium3D } from '../src/core/physics/physical-medium.js';
import { vec3 } from '../src/core/vector.js';

class MutableBasinResolver implements R2BasinMembershipResolverV1 {
  readonly #memberships = new Map<string, ActiveR2BasinMembershipV1>();
  readonly #groups = new Map<string, { members: Set<string>; coordinate: number[] }>();

  add(group: string, visitId: string, coordinate: ArrayLike<number>): void {
    const current = this.#groups.get(group) ?? { members: new Set<string>(), coordinate: Array.from(coordinate) };
    current.members.add(visitId);
    current.coordinate = Array.from(coordinate);
    this.#groups.set(group, current);
    this.#refresh(group);
  }

  remove(visitId: string): void {
    const group = [...this.#groups].find(([, value]) => value.members.has(visitId))?.[0];
    if (group === undefined) return;
    this.#groups.get(group)!.members.delete(visitId);
    this.#memberships.delete(visitId);
    this.#refresh(group);
  }

  move(visitId: string, group: string, coordinate: ArrayLike<number>): void {
    this.remove(visitId);
    this.add(group, visitId, coordinate);
  }

  #refresh(group: string): void {
    const current = this.#groups.get(group)!;
    const members = [...current.members].sort();
    for (const memberId of members) this.#memberships.set(memberId, {
      version: 'ActiveR2BasinMembershipV1',
      pageId: `r2-${group}`,
      coordinate: [...current.coordinate],
      memberVisitIds: [...members],
    });
  }

  resolveActiveR2Basin(r2VisitId: string): ActiveR2BasinMembershipV1 | null {
    const membership = this.#memberships.get(r2VisitId);
    return membership === undefined ? null : structuredClone(membership);
  }
}

function fittedEncoder(): DeterministicTokenFieldEncoder {
  const encoder = new DeterministicTokenFieldEncoder();
  encoder.fit(Array.from({ length: 16 }, (_, index) => Float64Array.from(
    { length: 256 }, (_unused, feature) => (feature === 0 ? (index % 2 === 0 ? -2 : 2) : 0),
  )));
  encoder.freeze();
  return encoder;
}

function perception(sign: number): Float64Array {
  return Float64Array.from({ length: 256 }, (_unused, index) => index === 0 ? sign * 2 : 0);
}

function buildGraph(
  grouping: (index: number) => string,
  r1Page: (index: number) => string,
  count = 16,
  resolver = new MutableBasinResolver(),
): OpenCausalFactorR2A {
  const graph = new OpenCausalFactorR2A(fittedEncoder(), resolver);
  for (let index = 0; index < count; index += 1) {
    if (index > 0) graph.recover(1, true);
    const group = grouping(index);
    const visitId = `visit-${index.toString().padStart(2, '0')}`;
    const coordinate = group === 'a' ? vec3(-4, 0, 0) : group === 'b' ? vec3(4, 0, 0) : vec3(0, 0, 0);
    resolver.add(group, visitId, coordinate);
    const sign = index % 2 === 0 ? -1 : 1;
    const ticket = graph.freezeCandidatePool({
      anchorId: `anchor-${index.toString().padStart(2, '0')}`,
      eventNumber: index + 1,
      observedAt: index,
      perception: perception(sign),
      interventionKey: 'opaque-intervention',
      sourceContextId: `context-${Math.floor(index / 2) % 4}`,
      sourceContextIdentityVersion: 'CausalEvidenceContextIdV2',
      publicR1Signature: `public-${index}`,
    });
    graph.commitOutcome(ticket, {
      r2Coordinate: coordinate,
      r2PageId: `r2-${group}`,
      r2VisitId: visitId,
      trustedActualObservation: true,
      r1Trace: { pageId: r1Page(index), traceId: `opaque-r1-${index}` },
    }, index);
  }
  return graph;
}

test('R2 visit resolution returns the complete chained basin defensively', () => {
  const medium = new PhysicalMedium3D(R2_CONFIG);
  const pageId = medium.createPage();
  const visits = [0, 1.6, 3.2, 4.8, 6.4].map((x, index) => {
    const visitId = `visit-${index}`;
    medium.depositVisit(pageId, vec3(x, 0, 0), 1, visitId);
    return visitId;
  });
  const first = medium.basinContainingTrace(pageId, visits[0]!);
  assert(first);
  assert.deepEqual(first.memberVisitIds, visits);
  assert.deepEqual(first.memberTraceIds, visits);
  assert(Math.abs(first.coordinate[0]! - 3.2) < 1e-9,
    'test fixture no longer places the endpoint beyond one basin radius from its centroid');
  (first.memberTraceIds as string[]).splice(0);
  (first.memberVisitIds as string[]).splice(0);
  first.coordinate[0] = 99;
  const reread = medium.basinContainingTrace(pageId, visits[0]!);
  assert(reread);
  assert.deepEqual(reread.memberVisitIds, visits);
  assert.deepEqual(reread.memberTraceIds, visits);
  assert(Math.abs(reread.coordinate[0]! - 3.2) < 1e-9);
});

test('R2 visit membership excludes roads and rejects duplicated or recovered visit identity', () => {
  const medium = new PhysicalMedium3D(R2_CONFIG);
  const pageId = medium.createPage();
  medium.depositVisit(pageId, vec3(0, 0, 0), 1, 'visit');
  medium.depositOrderedTrajectory(pageId, [vec3(.1, 0, 0), vec3(.2, 0, 0)], 1, 'road');
  const basin = medium.basinContainingVisit(pageId, 'visit');
  assert(basin);
  assert.deepEqual(basin.memberVisitIds, ['visit']);
  assert(basin.memberTraceIds.includes('road'));

  const ambiguousPage = medium.createPage();
  medium.depositVisit(ambiguousPage, vec3(-10, 0, 0), 1, 'duplicated');
  medium.depositVisit(ambiguousPage, vec3(10, 0, 0), 1, 'duplicated');
  assert.equal(medium.basinContainingVisit(ambiguousPage, 'duplicated'), null);
  medium.recoverTrace(pageId, 'visit', 1e9);
  assert.equal(medium.basinContainingVisit(pageId, 'visit'), null);
});

test('action query binds an endpoint visit to exact basin membership, not nearest centroid', () => {
  const medium = new PhysicalMedium3D(R2_CONFIG);
  const pageId = medium.createPage();
  const visitIds = [0, 1.6, 3.2, 4.8, 6.4].map((x, index) => {
    const visitId = `coactivation-${index}`;
    medium.depositVisit(pageId, vec3(x, 0, 0), 1, visitId);
    return visitId;
  });
  const query = new ActionConditionedRuleQuery().query(
    medium,
    pageId,
    [{ pageId: 'r1-page', traceId: 'r1-trace', experienceAnchorId: 'anchor' }],
    [{
      coactivationId: visitIds[0]!, r2Coordinate: vec3(0, 0, 0), experienceAnchorId: 'anchor',
      r1Trace: { pageId: 'r1-page', traceId: 'r1-trace' }, observedAt: 0,
      initialStrength: 1, currentStrength: 1,
    }],
    () => true,
    { scoreByOutcomeMode: new Map(), outcomeCoordinates: new Map(), matches: [], relationIds: [] },
    false,
  );
  assert.equal(query.query.contributions.length, 1);
  assert.deepEqual(query.query.r2Basins[0]!.memberVisitIds, visitIds);
});

test('R2A result identity is invariant to R1 page permutation', () => {
  const left = buildGraph((index) => index % 2 === 0 ? 'a' : 'b', (index) => `page-${index % 3}`);
  const right = buildGraph((index) => index % 2 === 0 ? 'a' : 'b', (index) => `permuted-${(index * 5) % 7}`);
  assert.deepEqual(left.exportState(), right.exportState());
  assert(left.exportState().eventSummaries.every((event) => !('r1Trace' in event)));
  assert(left.productionRelationsForAudit().length > 0,
    'page-permutation fixture did not form a production relation to compare');
});

test('five-to-four mixed outcomes cannot become a production relation', () => {
  const graph = buildGraph((index) => index < 5 ? 'a' : 'b', () => 'irrelevant-r1-page', 9);
  assert(graph.exportState().factorNodes.length > 0 && graph.exportState().hyperedges.length > 0);
  assert.deepEqual(graph.productionRelationsForAudit(), []);
});

test('physically collided outcomes fail closed instead of being split by input or R1 page', () => {
  const graph = buildGraph(() => 'collision', (index) => `r1-${index % 2}`);
  assert(graph.exportState().factorNodes.length > 0 && graph.exportState().hyperedges.length > 0);
  assert.deepEqual(graph.productionRelationsForAudit(), []);
  assert(graph.exportState().factorNodes.every((node) => node.r2SelectionGain < 0.20));
});

test('an edge follows all surviving source visits and fails closed when they physically split', () => {
  const resolver = new MutableBasinResolver();
  const graph = buildGraph((index) => index % 2 === 0 ? 'a' : 'b', () => 'irrelevant', 16, resolver);
  const relation = graph.productionRelationsForAudit()[0];
  assert(relation);
  const representative = relation.targetR2VisitId;
  resolver.remove(representative);
  graph.recover(0, true);
  const afterRecovery = graph.productionRelationsForAudit().find((edge) => edge.hyperedgeId === relation.hyperedgeId);
  assert(afterRecovery, 'one recovered representative erased other surviving physical evidence');
  assert.notEqual(afterRecovery.targetR2VisitId, representative);

  const sourceEventId = afterRecovery.sourceEventIds[0]!;
  const eventNumber = Number(sourceEventId.slice('event-'.length));
  const sourceVisit = graph.exportState().eventSummaries.find((event) => event.eventNumber === eventNumber)!.r2VisitId;
  resolver.move(sourceVisit, 'split', vec3(20, 0, 0));
  graph.recover(0, true);
  assert.equal(graph.productionRelationsForAudit().some((edge) => edge.hyperedgeId === relation.hyperedgeId), false,
    'sources split across current physical basins remained production eligible');
});

test('controlled evidence cannot manufacture an edge from an unknown visit', () => {
  const graph = buildGraph((index) => index % 2 === 0 ? 'a' : 'b', () => 'irrelevant');
  const relation = graph.productionRelationsForAudit()[0];
  assert(relation);
  const before = graph.exportState().hyperedges.length;
  assert.throws(() => graph.recordControlledIntervention({
    pairId: 'pair-unknown', factorIds: relation.factorIds,
    interventionKey: relation.interventionKey, targetR2VisitId: 'unknown-visit',
    targetR2Coordinate: vec3(0, 0, 0), sourceContextId: 'controlled-context',
    supported: true, trustedActualObservation: true,
    baselineProbeActionId: 'same-probe', interventionProbeActionId: 'same-probe',
    changedFactorId: relation.factorIds[0]!, observedChangedFactorIds: [relation.factorIds[0]!],
    selectionDrop: .5,
  }), /no unambiguous active R2 basin/);
  assert.equal(graph.exportState().hyperedges.length, before);
});

test('CausalFactorGraphStateV2 is audit-only and cannot be restored writable', () => {
  const resolver = new MutableBasinResolver();
  const empty = new OpenCausalFactorR2A(fittedEncoder(), resolver).exportState();
  const legacy = { ...empty, version: 'CausalFactorGraphStateV2' } as unknown as CausalFactorGraphStateV2;
  assert.throws(() => new OpenCausalFactorR2A(fittedEncoder(), resolver, legacy), /audit-only/);
});
