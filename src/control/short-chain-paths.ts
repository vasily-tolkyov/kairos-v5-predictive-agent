import type { ControlWorkspaceSnapshotV2 } from './workspace.js';

/** Enumerate existing dependency paths only. No action names, desired values,
 * path finding in Minecraft, or implicit parent resumption are involved. */
export function physicalDependencyPathsV1(startNodeId: string,
  workspace: ControlWorkspaceSnapshotV2): readonly (readonly string[])[] {
  const nodes = new Map(workspace.nodes.map(value => [value.node.nodeId, value.node]));
  const paths: string[][] = [];
  const visit = (id: string, physical: string[], seen: Set<string>) => {
    if (seen.has(id)) return;
    const nextSeen = new Set(seen).add(id), node = nodes.get(id);
    if (!node) return;
    const path = node.kind === 'experienced' || node.kind === 'factor-transition' ? [...physical, id] : physical;
    if (path.length > 3) return;
    if (id !== startNodeId && path.length > 1 && node.kind === 'experienced'
      && node.objectiveNodeId === workspace.rootNodeId) { paths.push(path); return; }
    for (const edge of workspace.dependencies.filter(value => value.requiredNodeId === id))
      visit(edge.dependentNodeId, path, nextSeen);
  };
  visit(startNodeId, [], new Set());
  return [...new Map(paths.map(path => [JSON.stringify(path), path])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}
