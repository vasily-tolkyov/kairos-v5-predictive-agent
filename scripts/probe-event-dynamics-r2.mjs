import { canonical } from '../dist/src/util.js';
import { fileURLToPath } from 'node:url';
import { eventRows } from '../dist/src/events.js';
import { DistanceEmbedding } from '../dist/src/distance-embedding.js';
import { ObservationGate, emptyFirewallRejections, emptyLeakageAudit } from '../dist/src/core/firewall.js';
import { PathProjector } from '../dist/src/core/learning/path-projector.js';
import { R1_CONFIG, R2_CONFIG } from '../dist/src/core/config.js';
import { reconstructAttempt017RealEventsV1 } from '../dist/src/evaluation/rebuild-attempt017-physical-memory-v2.js';

const source = fileURLToPath(new URL('../evidence/minecraft-guided-affordance-v1-attempt-017-heldout-public-visibility-setup/', import.meta.url));
const { events } = await reconstructAttempt017RealEventsV1(source);

function dynamicsRows(event) {
  const ordinary = eventRows(event);
  const initial = new Map();
  const current = new Map();
  const changedKeys = new Set();
  const rows = ordinary.rows.map((ordinaryRow, index) => {
    const row = { 'event/elapsed': ordinaryRow['event/elapsed'] ?? 0 };
    for (const [key, value] of Object.entries(ordinaryRow)) {
      if (key.startsWith('cue/')) row[key] = value;
    }
    for (const change of ordinary.changes[index]) {
      const key = `${change.subject}/${change.property}`;
      if (!initial.has(key)) initial.set(key, change.before);
      current.set(key, change.after); changedKeys.add(key);
    }
    for (const key of [...changedKeys].sort()) {
      const before = initial.get(key), after = current.get(key);
      if (typeof before === 'number' && typeof after === 'number') {
        row[`change/${key}/numeric-delta`] = after - before;
      } else {
        row[`change/${key}/${canonical(before)}->${canonical(after)}`] = 1;
      }
    }
    if (index === ordinary.rows.length - 1 && ordinary.changes.flat().every(values => values.length === 0)) {
      row['event/no-public-change-within-window'] = 1;
    }
    return row;
  });
  return rows;
}

const series = events.map(event => ({ event, rows: dynamicsRows(event) }));
const embedding = DistanceEmbedding.fit(series.flatMap(value => value.rows));
let maximumAdjacentGap = 0;
const unscaled = series.map(value => value.rows.map(row => embedding.encode(row).coordinate));
for (const points of unscaled) for (let index = 1; index < points.length; index++) {
  maximumAdjacentGap = Math.max(maximumAdjacentGap,
    Math.hypot(...points[index].map((coordinate, axis) => coordinate - points[index - 1][axis])));
}
const scaledEmbedding = new DistanceEmbedding({ ...embedding.state,
  scale: R1_CONFIG.kernelWidth * .4 / maximumAdjacentGap });
const trajectories = series.map(value => value.rows.map(row => new Float64Array(scaledEmbedding.encode(row).coordinate)));
const gate = new ObservationGate(emptyLeakageAudit(), emptyFirewallRejections());
const trusted = trajectories.map((trajectory, index) => gate.admit({ trajectory,
  perception: new Float64Array([index]),
  r1State: { position: trajectory[0], velocity: new Float64Array(trajectory[1].map((value, axis) => value - trajectory[0][axis])),
    causalPrefix: trajectory.slice(0, 2), observedAt: events[index].frames.at(-1).activeSeconds,
    numericAttributes: new Float64Array() },
  provenance: { actualObservation: true, publicOnly: true, causallyAvailable: true,
    containsSimulatorPrivate: false, containsFutureObservation: false, containsSemanticRuleOrResult: false } }));
const projector = new PathProjector(); projector.fit(trusted);
const points = trusted.map(value => projector.projectTrustedPath(value));

function label(event) {
  const changes = eventRows(event).changes.flat();
  if (event.cue.kind === 'look') {
    const acquired = changes.some(change => change.subject === 'crosshair'
      && change.property === 'visible' && change.after === true);
    return `look ${event.cue.parameters.yawDegrees} ${acquired ? 'acquire' : 'away'}`;
  }
  if (event.cue.kind === 'interact') {
    const note = changes.find(change => change.property === 'note');
    return `interact ${canonical(note?.before)}>${canonical(note?.after)}`;
  }
  return event.cue.kind;
}

const parent = points.map((_, index) => index);
const find = value => parent[value] === value ? value : (parent[value] = find(parent[value]));
const radius = R2_CONFIG.kernelWidth * R2_CONFIG.basinRadiusScale;
for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
  if (Math.hypot(...points[left].map((value, axis) => value - points[right][axis])) > radius) continue;
  const a = find(left), b = find(right); if (a !== b) parent[b] = a;
}
const components = new Map();
for (let index = 0; index < points.length; index++) {
  const root = find(index), value = components.get(root) ?? { size: 0, modes: {} };
  value.size++; const mode = label(events[index]); value.modes[mode] = (value.modes[mode] ?? 0) + 1;
  components.set(root, value);
}
console.log(JSON.stringify({ input: 'public-event-dynamics-only', eventCount: events.length,
  maximumAdjacentGap, resolution: projector.exportState().resolution,
  components: [...components.values()].sort((left, right) => right.size - left.size),
  mixedComponents: [...components.values()].filter(value => Object.keys(value.modes).length > 1) }, null, 2));
