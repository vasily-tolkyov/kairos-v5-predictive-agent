import type { DistributedBondStateV1, DistributedMediumSnapshotV1 }
  from './distributed-physical-contracts.js';

export interface AnonymousPhysicalScanThresholdsV1 {
  readonly siteSupportMass: number;
  readonly potentialDepth: number;
  readonly localBondSupportMass: number;
  readonly directedBondSupportMass: number;
  readonly directedConductance: number;
}

export interface AnonymousPhysicalBasinV1 {
  readonly basinId: string;
  readonly coreSiteIds: readonly number[];
  readonly meanPotentialDepth: number;
  readonly meanSupportMass: number;
  readonly internalSymmetricCoupling: number;
  readonly internalLocalBondCount: number;
  readonly incomingConductance: number;
  readonly outgoingConductance: number;
}

export interface AnonymousTerminalAttractorV1 extends AnonymousPhysicalBasinV1 {
  readonly attractorId: string;
  readonly incomingBasinIds: readonly string[];
}

export interface AnonymousDirectedCorridorV1 {
  readonly corridorId: string;
  readonly prefixBasinId: string;
  readonly prefixCoreSiteIds: readonly number[];
  readonly terminalAttractorIds: readonly string[];
  readonly traversedBasinIds: readonly string[];
  readonly directedBonds: readonly {
    readonly fromSiteId: number;
    readonly toSiteId: number;
    readonly directedConductance: number;
    readonly supportMass: number;
  }[];
  readonly forwardConductance: number;
  readonly reverseConductance: number;
  readonly reverseRejectionRate: number;
}

export interface AnonymousPhysicalStructureScanV1 {
  readonly version: 'AnonymousPhysicalStructureScanV1';
  readonly thresholds: AnonymousPhysicalScanThresholdsV1;
  readonly qualifiedSiteCount: number;
  readonly qualifiedDirectedBondCount: number;
  readonly basins: readonly AnonymousPhysicalBasinV1[];
  readonly terminalAttractors: readonly AnonymousTerminalAttractorV1[];
  readonly sharedPrefixCorridors: readonly AnonymousDirectedCorridorV1[];
}

interface ComponentEdgeV1 {
  readonly from: number;
  readonly to: number;
  readonly bonds: readonly DistributedBondStateV1[];
  readonly conductance: number;
}

// Two independent real episodes are the first point at which R2A may expose a
// provisional repeated structure.  A singleton remains in the medium and its
// footprint ledger, but does not enter the expensive stable-pattern scanner.
// This is an absolute local evidence scale; unrelated wells elsewhere in the
// same continuous medium cannot raise or lower it.
const PROVISIONAL_EVENT_SUPPORT = 2;

/** IEEE-754 accumulation can place an otherwise active physical quantity a
 * few ulps below the substrate's absolute activity floor.  This comparison
 * admits only that representational error; it does not add an empirical slack
 * band or compare one locality with the strength of an unrelated locality. */
function meetsPhysicalFloor(value: number, floor: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(floor)) return false;
  const roundoff = Number.EPSILON * 8 * Math.max(1, Math.abs(value), Math.abs(floor));
  return value >= floor || floor - value <= roundoff;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function edgeKey(from: number, to: number): string {
  return `${from}>${to}`;
}

function orderedUnique(values: Iterable<number>): readonly number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Discover anonymous physical basins and branch corridors from the substrate
 * itself.  The scanner deliberately reads only site field state and learned
 * bonds.  It does not consult afferent names, trace records, action cues,
 * outcome annotations, or any external index.
 */
export function scanAnonymousPhysicalStructureV1(
  snapshot: DistributedMediumSnapshotV1,
): AnonymousPhysicalStructureScanV1 {
  if (snapshot.version !== 'DistributedMediumSnapshotV1') throw new Error('unsupported-distributed-medium-snapshot');
  const minimum = snapshot.config.minimumActiveMagnitude;
  const localBonds = snapshot.learnedBonds.filter(bond => bond.kind === 'local');
  const directedBonds = snapshot.learnedBonds.filter(bond => bond.kind === 'plastic-directed');
  // Structure discovery reads every locally repeated trace.  Stronger
  // production qualification (8 events, 4 contexts, perturbation return and
  // intervention evidence) remains downstream.  A global percentile would
  // make an unchanged local branch disappear merely because another,
  // unrelated region of the same continuous medium became deeper.
  const thresholds: AnonymousPhysicalScanThresholdsV1 = {
    siteSupportMass: Math.max(minimum, PROVISIONAL_EVENT_SUPPORT),
    potentialDepth: Math.max(minimum,
      snapshot.config.potentialLearningRate * PROVISIONAL_EVENT_SUPPORT),
    localBondSupportMass: Math.max(minimum, PROVISIONAL_EVENT_SUPPORT),
    directedBondSupportMass: Math.max(minimum, PROVISIONAL_EVENT_SUPPORT),
    directedConductance: Math.max(minimum,
      snapshot.config.directedLearningRate * PROVISIONAL_EVENT_SUPPORT),
  };

  const qualifiedSites = new Set(snapshot.sites
    .filter(site => meetsPhysicalFloor(site.supportMass, thresholds.siteSupportMass)
      && meetsPhysicalFloor(site.potentialDepth, thresholds.potentialDepth))
    .map(site => site.siteId));
  const parent = new Map<number, number>([...qualifiedSites].map(siteId => [siteId, siteId]));
  const find = (siteId: number): number => {
    const current = parent.get(siteId);
    if (current === undefined) throw new Error(`unknown-qualified-site:${siteId}`);
    if (current === siteId) return current;
    const root = find(current); parent.set(siteId, root); return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left), rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent.set(Math.max(leftRoot, rightRoot), Math.min(leftRoot, rightRoot));
  };
  const qualifiedLocalBonds = localBonds.filter(bond => qualifiedSites.has(bond.fromSiteId)
    && qualifiedSites.has(bond.toSiteId)
    && meetsPhysicalFloor(bond.supportMass, thresholds.localBondSupportMass)
    && meetsPhysicalFloor(bond.symmetricCoupling, minimum));
  for (const bond of qualifiedLocalBonds) union(bond.fromSiteId, bond.toSiteId);

  const grouped = new Map<number, number[]>();
  for (const siteId of [...qualifiedSites].sort((left, right) => left - right)) {
    const root = find(siteId), values = grouped.get(root) ?? [];
    values.push(siteId); grouped.set(root, values);
  }
  const groups = [...grouped.values()]
    .map(values => [...values].sort((left, right) => left - right))
    .sort((left, right) => left[0]! - right[0]!);
  const componentBySite = new Map<number, number>();
  groups.forEach((sites, component) => sites.forEach(siteId => componentBySite.set(siteId, component)));

  const qualifiedDirected = directedBonds.filter(bond => qualifiedSites.has(bond.fromSiteId)
    && qualifiedSites.has(bond.toSiteId)
    && meetsPhysicalFloor(bond.supportMass, thresholds.directedBondSupportMass)
    && meetsPhysicalFloor(bond.directedConductance, thresholds.directedConductance));
  const edgeBonds = new Map<string, DistributedBondStateV1[]>();
  for (const bond of qualifiedDirected) {
    const from = componentBySite.get(bond.fromSiteId)!, to = componentBySite.get(bond.toSiteId)!;
    if (from === to) continue;
    const key = edgeKey(from, to), values = edgeBonds.get(key) ?? [];
    values.push(bond); edgeBonds.set(key, values);
  }
  const edges: ComponentEdgeV1[] = [...edgeBonds]
    .map(([key, bonds]) => {
      const [from, to] = key.split('>').map(Number) as [number, number];
      return { from, to,
        bonds: [...bonds].sort((left, right) => left.fromSiteId - right.fromSiteId
          || left.toSiteId - right.toSiteId),
        conductance: bonds.reduce((sum, bond) => sum + bond.directedConductance, 0) };
    })
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const outgoing = new Map<number, ComponentEdgeV1[]>(), incoming = new Map<number, ComponentEdgeV1[]>();
  const edgeByKey = new Map<string, ComponentEdgeV1>();
  for (const edge of edges) {
    edgeByKey.set(edgeKey(edge.from, edge.to), edge);
    const out = outgoing.get(edge.from) ?? []; out.push(edge); outgoing.set(edge.from, out);
    const into = incoming.get(edge.to) ?? []; into.push(edge); incoming.set(edge.to, into);
  }
  const siteById = new Map(snapshot.sites.map(site => [site.siteId, site]));
  const internalSymmetricCoupling = groups.map(() => 0);
  const internalLocalBondCount = groups.map(() => 0);
  for (const bond of qualifiedLocalBonds) {
    const from = componentBySite.get(bond.fromSiteId), to = componentBySite.get(bond.toSiteId);
    if (from === undefined || from !== to) continue;
    internalSymmetricCoupling[from]! += bond.symmetricCoupling;
    internalLocalBondCount[from]! += 1;
  }
  const basins: AnonymousPhysicalBasinV1[] = groups.map((siteIds, component) => {
    return { basinId: `anonymous-basin-${String(component + 1).padStart(4, '0')}`,
      coreSiteIds: siteIds,
      meanPotentialDepth: mean(siteIds.map(siteId => siteById.get(siteId)!.potentialDepth)),
      meanSupportMass: mean(siteIds.map(siteId => siteById.get(siteId)!.supportMass)),
      internalSymmetricCoupling: internalSymmetricCoupling[component]!,
      internalLocalBondCount: internalLocalBondCount[component]!,
      incomingConductance: (incoming.get(component) ?? []).reduce((sum, edge) => sum + edge.conductance, 0),
      outgoingConductance: (outgoing.get(component) ?? []).reduce((sum, edge) => sum + edge.conductance, 0) };
  });
  const terminalComponents = groups.map((_, index) => index)
    .filter(component => (incoming.get(component)?.length ?? 0) > 0
      && (outgoing.get(component)?.length ?? 0) === 0);
  const attractorIdByComponent = new Map<number, string>();
  const terminalAttractors: AnonymousTerminalAttractorV1[] = terminalComponents.map((component, index) => {
    const attractorId = `anonymous-attractor-${String(index + 1).padStart(4, '0')}`;
    attractorIdByComponent.set(component, attractorId);
    return { ...basins[component]!, attractorId,
      incomingBasinIds: orderedUnique((incoming.get(component) ?? []).map(edge => edge.from))
        .map(source => basins[source]!.basinId) };
  });

  const reachableTerminals = (start: number): { readonly terminals: readonly number[];
    readonly traversed: readonly number[]; readonly traversedEdges: readonly ComponentEdgeV1[] } => {
    const seen = new Set<number>([start]), traversedEdges = new Map<string, ComponentEdgeV1>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of outgoing.get(current) ?? []) {
        traversedEdges.set(edgeKey(edge.from, edge.to), edge);
        if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
      }
    }
    return { terminals: terminalComponents.filter(component => seen.has(component)),
      traversed: [...seen].sort((left, right) => left - right),
      traversedEdges: [...traversedEdges.values()].sort((left, right) => left.from - right.from || left.to - right.to) };
  };

  const sharedPrefixCorridors: AnonymousDirectedCorridorV1[] = [];
  for (let component = 0; component < groups.length; component += 1) {
    // A real shared prefix may have a single immediate successor and branch
    // only several physical populations later.  Requiring an immediate
    // out-degree of two discards precisely those temporally extended prefixes
    // and leaves condition-to-terminal eligibility shortcuts as false entry
    // points.  Reachability across learned directed bonds is the physical
    // criterion; the caller still has to bind the chosen ancestor to an
    // actually observed member footprint.
    if ((outgoing.get(component)?.length ?? 0) === 0) continue;
    const reach = reachableTerminals(component);
    if (reach.terminals.length < 2) continue;
    const forwardConductance = reach.traversedEdges.reduce((sum, edge) => sum + edge.conductance, 0);
    const reverseConductance = reach.traversedEdges.reduce((sum, edge) =>
      sum + (edgeByKey.get(edgeKey(edge.to, edge.from))?.conductance ?? 0), 0);
    const relevantBonds = reach.traversedEdges.flatMap(edge => edge.bonds)
      .map(bond => ({ fromSiteId: bond.fromSiteId, toSiteId: bond.toSiteId,
        directedConductance: bond.directedConductance, supportMass: bond.supportMass }))
      .sort((left, right) => left.fromSiteId - right.fromSiteId || left.toSiteId - right.toSiteId);
    sharedPrefixCorridors.push({
      corridorId: `anonymous-corridor-${String(sharedPrefixCorridors.length + 1).padStart(4, '0')}`,
      prefixBasinId: basins[component]!.basinId,
      prefixCoreSiteIds: basins[component]!.coreSiteIds,
      terminalAttractorIds: reach.terminals.map(value => attractorIdByComponent.get(value)!),
      traversedBasinIds: reach.traversed.map(value => basins[value]!.basinId),
      directedBonds: relevantBonds,
      forwardConductance,
      reverseConductance,
      reverseRejectionRate: forwardConductance <= 0 ? 0
        : Math.max(0, Math.min(1, 1 - reverseConductance / forwardConductance)),
    });
  }

  return { version: 'AnonymousPhysicalStructureScanV1', thresholds,
    qualifiedSiteCount: qualifiedSites.size,
    qualifiedDirectedBondCount: qualifiedDirected.length,
    basins, terminalAttractors, sharedPrefixCorridors };
}
