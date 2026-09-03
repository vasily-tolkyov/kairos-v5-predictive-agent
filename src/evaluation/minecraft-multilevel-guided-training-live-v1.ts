import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Vec3 } from 'vec3';
import type { Action, ActionCue, Observation, PublicObject, RealEvent } from '../contracts.js';
import { MinecraftBody, publicButtonSelectionShapeV1 } from '../body.js';
import { Compute } from '../compute.js';
import type { ActionObservationScopeV1 } from '../control/contracts.js';
import { cueIdentity, eventRows } from '../events.js';
import type { MemoryObservationReceipt, MemorySnapshot } from '../memory.js';
import { Services, type Configuration } from '../services.js';
import { assert, canonical, fileSha, saveJson, sha } from '../util.js';

export const FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1 =
  'FROZEN_MULTILEVEL_EXPERIENCE_0256.json' as const;
export const MULTILEVEL_GUIDED_TRAINING_TIMELINE_FILENAME_V1 =
  'MULTILEVEL_GUIDED_TRAINING_TIMELINE_0256.json' as const;

export type MinecraftMultilevelGuidedTrainingModeLiveV1 =
  | 'look-plus-15-acquire'
  | 'look-plus-15-away'
  | 'look-minus-15-acquire'
  | 'look-minus-15-away'
  | 'forward-reduce-distance'
  | 'forward-blocked'
  | 'left-clear'
  | 'left-blocked'
  | 'right-clear'
  | 'right-blocked'
  | 'jump-forward-clear-one-block'
  | 'jump-forward-blocked-low-roof-high-obstacle'
  | 'interact-wired-button-opens-iron-door'
  | 'interact-visible-disconnected-button-no-door-change'
  | 'observe-state-remains'
  | 'wait-no-relevant-change';

export const MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1:
readonly MinecraftMultilevelGuidedTrainingModeLiveV1[] = Object.freeze([
  'look-plus-15-acquire', 'look-plus-15-away',
  'look-minus-15-acquire', 'look-minus-15-away',
  'forward-reduce-distance', 'forward-blocked',
  'left-clear', 'left-blocked', 'right-clear', 'right-blocked',
  'jump-forward-clear-one-block', 'jump-forward-blocked-low-roof-high-obstacle',
  'interact-wired-button-opens-iron-door',
  'interact-visible-disconnected-button-no-door-change',
  'observe-state-remains', 'wait-no-relevant-change',
]);

export const MINECRAFT_MULTILEVEL_GUIDED_TRAINING_LIVE_PRECOMMITMENT_V1 = Object.freeze({
  version: 'MinecraftMultilevelGuidedTrainingLivePrecommitmentV1' as const,
  manifestId: 'minecraft-multilevel-guided-empty-memory-live-0256-v1',
  totalEpisodes: 256 as const,
  halfBoundary: 128 as const,
  modes: 16 as const,
  repetitionsPerMode: 16 as const,
  repetitionsPerModePerHalf: 8 as const,
  initialExperience: 'empty' as const,
  initialization: 'first-128-calibrate-once' as const,
  consolidation: 'second-128-new-layouts-frozen-map' as const,
  episodeReset: 'before-each-episode-only' as const,
  disclosure: 'exactly-one-completed-real-primitive-action' as const,
  fullSolutionChains: 'forbidden' as const,
  orderingAlgorithm: 'xorshift32-fisher-yates-per-half-v1' as const,
  seed: 0x4b414952,
});

type CardinalV1 = 'north' | 'south' | 'east' | 'west';
type BlockPositionV1 = readonly [number, number, number];

export interface MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  readonly id: string;
  readonly split: 'calibration' | 'consolidation';
  readonly replication: number;
  readonly originX: number;
  readonly originZ: number;
  readonly facing: CardinalV1;
  readonly neutralMarkerMask: number;
}

/**
 * Optional representation-only fixture additions used by the hierarchical
 * runner.  They make public roles available before its one frozen event-map
 * calibration without changing the legacy guided curriculum.  In particular,
 * this profile contains no route, action sequence, or expected result.
 */
export interface MinecraftMultilevelGuidedRepresentationProfileLiveV1 {
  readonly version: 'MinecraftMultilevelGuidedRepresentationProfileLiveV1';
  readonly effectReference: 'stone-button-proxy' | 'self-and-central-obstacle';
  readonly mechanismMaterial: 'iron_bars' | 'stone_bricks' | 'smooth_stone' | null;
  readonly calibrationVocabularyPanel: boolean;
  readonly crosshairVocabularyMaterial: 'iron_bars' | 'stone_bricks' | null;
}

export interface MinecraftMultilevelGuidedTrainingEpisodeLiveV1 {
  readonly version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1';
  readonly episode: number;
  readonly half: 'first-128-calibration' | 'second-128-consolidation';
  readonly mode: MinecraftMultilevelGuidedTrainingModeLiveV1;
  readonly layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1;
  /** Singular by construction. There is deliberately no action-list field. */
  readonly action: Action;
  readonly reset: 'before-this-episode-only';
  readonly fullSolutionDisclosed: false;
  /** Absent on the legacy runner, preserving its fixture and plan identity. */
  readonly representationProfile?: MinecraftMultilevelGuidedRepresentationProfileLiveV1;
}

const CARDINALS: readonly CardinalV1[] = ['north', 'east', 'south', 'west'];

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const result = [...values], random = xorshift32(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

function layoutFor(replication: number): MinecraftMultilevelGuidedTrainingLayoutLiveV1 {
  assert(Number.isInteger(replication) && replication >= 0 && replication < 16,
    'invalid-multilevel-guided-layout-replication');
  const consolidation = replication >= 8;
  return {
    id: `multilevel-guided-live-layout-${String(replication + 1).padStart(2, '0')}`,
    split: consolidation ? 'consolidation' : 'calibration', replication,
    originX: 120 + (replication % 4) * 24,
    originZ: 120 + Math.floor(replication / 4) * 24,
    // The second half uses physically new coordinates and a rotated public layout.
    facing: CARDINALS[(replication + (consolidation ? 1 : 0)) % CARDINALS.length]!,
    neutralMarkerMask: replication % 8,
  };
}

function templateAction(mode: MinecraftMultilevelGuidedTrainingModeLiveV1,
  targetId: string): Action {
  if (mode.startsWith('look-plus'))
    return { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 } };
  if (mode.startsWith('look-minus'))
    return { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 } };
  if (mode.startsWith('forward-'))
    return { kind: 'move', parameters: { direction: 'forward', ticks: 4 } };
  if (mode.startsWith('left-'))
    return { kind: 'move', parameters: { direction: 'left', ticks: 4 } };
  if (mode.startsWith('right-'))
    return { kind: 'move', parameters: { direction: 'right', ticks: 4 } };
  if (mode.startsWith('jump-forward-'))
    return { kind: 'jump', parameters: { forward: true, ticks: 4 } };
  if (mode.startsWith('interact-'))
    return { kind: 'interact', parameters: {}, targetId };
  if (mode === 'observe-state-remains')
    return { kind: 'observe', parameters: { ticks: 5 } };
  return { kind: 'wait', parameters: { ticks: 5 } };
}

export function minecraftMultilevelGuidedTrainingPlanLiveV1():
readonly MinecraftMultilevelGuidedTrainingEpisodeLiveV1[] {
  const half = (halfIndex: 0 | 1) => {
    const start = halfIndex * 8;
    const source = Array.from({ length: 8 }, (_unused, offset) => start + offset)
      .flatMap(replication => MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1
        .map(mode => ({ replication, mode })));
    return shuffled(source, MINECRAFT_MULTILEVEL_GUIDED_TRAINING_LIVE_PRECOMMITMENT_V1.seed
      ^ (halfIndex === 0 ? 0x9e3779b9 : 0x85ebca6b));
  };
  return [...half(0), ...half(1)].map(({ replication, mode }, episode) => {
    const layout = layoutFor(replication);
    return Object.freeze({ version: 'MinecraftMultilevelGuidedTrainingEpisodeLiveV1', episode,
      half: episode < 128 ? 'first-128-calibration' : 'second-128-consolidation', mode, layout,
      action: templateAction(mode, `${layout.id}:public-stone-button`),
      reset: 'before-this-episode-only', fullSolutionDisclosed: false });
  });
}

export function minecraftMultilevelGuidedTrainingPlanIdentityLiveV1(): string {
  return sha({ precommitment: MINECRAFT_MULTILEVEL_GUIDED_TRAINING_LIVE_PRECOMMITMENT_V1,
    episodes: minecraftMultilevelGuidedTrainingPlanLiveV1() });
}

const directionFor = (side: CardinalV1): readonly [number, number] => side === 'north' ? [0, -1]
  : side === 'south' ? [0, 1] : side === 'east' ? [1, 0] : [-1, 0];
const opposite = (side: CardinalV1): CardinalV1 => side === 'north' ? 'south'
  : side === 'south' ? 'north' : side === 'east' ? 'west' : 'east';
const rightOf = (side: CardinalV1): CardinalV1 => side === 'north' ? 'east'
  : side === 'south' ? 'west' : side === 'east' ? 'south' : 'north';
const yawFor = (side: CardinalV1): number => side === 'north' ? 0 : side === 'south' ? Math.PI
  : side === 'east' ? -Math.PI / 2 : Math.PI / 2;
const blockId = (position: BlockPositionV1): string => `block:${position.join(',')}`;

export interface MinecraftMultilevelGuidedFixtureGeometryLiveV1 {
  readonly bot: readonly [number, 64, number];
  readonly forward: readonly [number, number];
  readonly right: readonly [number, number];
  readonly yaw: number;
  readonly button: BlockPositionV1;
  readonly dropper: BlockPositionV1;
  readonly container: BlockPositionV1;
  readonly comparator: BlockPositionV1;
  readonly repeater: BlockPositionV1;
  readonly doorLower: BlockPositionV1;
  readonly doorUpper: BlockPositionV1;
  readonly reference: BlockPositionV1;
  readonly oneBlockObstacle: BlockPositionV1;
  readonly lowRoof: BlockPositionV1;
  readonly highObstacle: readonly [BlockPositionV1, BlockPositionV1];
  readonly buttonId: string;
  readonly doorId: string;
  readonly referenceId: string;
}

export interface MinecraftMultilevelGuidedFixtureBlockExpectationLiveV1 {
  readonly position: BlockPositionV1;
  readonly name: string;
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
}

export interface MinecraftMultilevelGuidedFixtureReadinessLiveV1 {
  readonly present: readonly MinecraftMultilevelGuidedFixtureBlockExpectationLiveV1[];
  readonly empty: readonly BlockPositionV1[];
}

export function minecraftMultilevelGuidedFixtureGeometryLiveV1(
  layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
): MinecraftMultilevelGuidedFixtureGeometryLiveV1 {
  const forward = directionFor(layout.facing);
  const right = [-forward[1], forward[0]] as const;
  const at = (lateral: number, forwardDistance: number, y = 64): BlockPositionV1 => [
    layout.originX + right[0] * lateral + forward[0] * forwardDistance,
    y,
    layout.originZ + right[1] * lateral + forward[1] * forwardDistance,
  ];
  const button = at(0, 3), dropper = at(0, 4), container = at(0, 5), comparator = at(0, 6);
  // The lateral reference ray clears the central two-block jump obstacle.
  // A real button pulse transfers the dropper's single item into the barrel.
  // The barrel is the persistent vanilla state; its comparator output turns
  // through a one-tick repeater and drives the lower door block directly.
  const repeater = at(1, 7), doorLower = at(2, 7), reference = at(-3, 5), obstacle = at(0, 1);
  return { bot: [layout.originX + .5, 64, layout.originZ + .5], forward, right,
    yaw: yawFor(layout.facing), button, dropper, container, comparator, repeater, doorLower,
    doorUpper: [doorLower[0], 65, doorLower[2]], reference,
    oneBlockObstacle: obstacle, lowRoof: at(0, 0, 66),
    highObstacle: [obstacle, [obstacle[0], 65, obstacle[2]]],
    buttonId: blockId(button), doorId: blockId(doorLower), referenceId: blockId(reference) };
}

export interface MinecraftFixtureCommandBatchLiveV1 {
  readonly version: 'MinecraftFixtureCommandBatchLiveV1';
  readonly boundary: 'server-fixture-only-no-controller-access';
  readonly phase: 'global-setup' | 'latch-verification-before-action' | 'before-episode';
  readonly episode: number | null;
  readonly commands: readonly string[];
}

function setBlock(position: BlockPositionV1, block: string): string {
  return `setblock ${position.join(' ')} minecraft:${block}`;
}

function positionAt(layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  lateral: number, forwardDistance: number, y = 64): BlockPositionV1 {
  const forward = directionFor(layout.facing), right = [-forward[1], forward[0]] as const;
  return [layout.originX + right[0] * lateral + forward[0] * forwardDistance,
    y, layout.originZ + right[1] * lateral + forward[1] * forwardDistance];
}

function neutralMarkerPositions(
  layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
): readonly BlockPositionV1[] {
  return [positionAt(layout, -2, 6), positionAt(layout, 0, 8), positionAt(layout, 3, 5)];
}

const NEUTRAL_CONTEXT_BLOCKS_LIVE_V1 = Object.freeze([
  'white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool',
  'yellow_wool', 'lime_wool', 'pink_wool', 'gray_wool',
]);

function neutralContextBlock(layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
  markerIndex = 0): string {
  // Every marker family is an injective, collision-equivalent layout variant.
  // Thus whichever side of the 63-ray public fan remains visible still carries
  // eight genuinely different public contexts; no absolute coordinate is used.
  return NEUTRAL_CONTEXT_BLOCKS_LIVE_V1[
    (layout.neutralMarkerMask + markerIndex * 3) % NEUTRAL_CONTEXT_BLOCKS_LIVE_V1.length]!;
}

export interface MinecraftMultilevelGuidedVocabularyPanelLiveV1 {
  readonly ironBars: readonly BlockPositionV1[];
  readonly stoneBricks: readonly BlockPositionV1[];
  readonly crosshairDistractor: BlockPositionV1;
  readonly proxyButton: BlockPositionV1;
  readonly proxySupport: BlockPositionV1;
}

/**
 * A blocked training contrast starts at the actual contact boundary, rather
 * than spending most of its four-tick action merely approaching the blocker.
 * The matching clear arm uses the identical start pose.  This is fixture
 * geometry only: the position is never an R1 coordinate or a planning hint.
 */
export function minecraftMultilevelGuidedFixtureBotPositionLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout),
): readonly [number, 64, number] {
  if (!episode.representationProfile) return geometry.bot;
  // Iron bars stop the four-tick forward action after roughly 0.64 blocks
  // from the ordinary start.  Beginning 0.40 blocks closer leaves a real
  // collision interval while keeping a lateral public ray outside the bar's
  // narrow selection shape.  The matched clear arm uses the same pose.
  const contactOffset = episode.mode.startsWith('forward-') ? .4
    : episode.mode.startsWith('jump-forward-') ? .2 : 0;
  // A side-clear episode and its blocked contrast share this same slight
  // side offset.  Four real movement ticks can then leave the central
  // obstacle's forward corridor, while the contrast meets a real side wall.
  const lateralOffset = episode.mode.startsWith('left-') ? -.2
    : episode.mode.startsWith('right-') ? .2 : 0;
  return [geometry.bot[0] + geometry.forward[0] * contactOffset
      + geometry.right[0] * lateralOffset, 64,
    geometry.bot[2] + geometry.forward[1] * contactOffset
      + geometry.right[1] * lateralOffset];
}

/**
 * A front-facing 5x4 + 4x4 public panel has enough redundancy to cover the
 * heldout 15-bar and 12-brick ordinals even when the proxy or crosshair
 * distractor occludes a ray. It exists only in representation-calibration
 * observe/wait episodes: no movement or interaction is paired with it.
 */
export function minecraftMultilevelGuidedVocabularyPanelLiveV1(
  layout: MinecraftMultilevelGuidedTrainingLayoutLiveV1,
): MinecraftMultilevelGuidedVocabularyPanelLiveV1 {
  // Keep the movement-effect subject on a real lateral sight line, separate
  // from the public mechanism whose condition R2A must learn.
  const proxyButton = positionAt(layout, -1, 6, 65);
  const proxySupport = positionAt(layout, -1, 7, 65);
  const reserved = new Set([proxyButton.join(','), proxySupport.join(',')]);
  const ironBars = Array.from({ length: 4 }, (_unused, height) =>
    Array.from({ length: 5 }, (_other, lateral) =>
      positionAt(layout, lateral - 4, 7, 64 + height))).flat()
    .filter(position => !reserved.has(position.join(',')));
  const stoneBricks = Array.from({ length: 4 }, (_unused, height) =>
    Array.from({ length: 4 }, (_other, lateral) =>
      positionAt(layout, lateral + 1, 7, 64 + height))).flat()
    .filter(position => !reserved.has(position.join(',')));
  return Object.freeze({ ironBars: Object.freeze(ironBars), stoneBricks: Object.freeze(stoneBricks),
    crosshairDistractor: positionAt(layout, 0, 3),
    proxyButton, proxySupport });
}

function mechanismMaterialLiveV1(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1): string {
  if (!episode.representationProfile) return neutralContextBlock(episode.layout);
  assert(episode.representationProfile.mechanismMaterial,
    `guided-representation-profile-missing-mechanism:${episode.mode}`);
  return episode.representationProfile.mechanismMaterial;
}

function calibrationCrosshairConnectionsLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
): readonly BlockPositionV1[] {
  if (!episode.representationProfile?.calibrationVocabularyPanel
    || episode.representationProfile.crosshairVocabularyMaterial !== 'iron_bars') return [];
  // Join the targeted bar on the two lateral sides and the side away from the
  // observer.  The target therefore stays the first ray hit.  Rotating the
  // same public arrangement through four cardinal layouts gives every world
  // connection property both a real true and false observation.
  return [positionAt(episode.layout, -1, 3), positionAt(episode.layout, 1, 3),
    positionAt(episode.layout, 0, 4)];
}

function publicMechanismExtensionLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
): readonly BlockPositionV1[] {
  if (!episode.representationProfile) return [];
  const publicOneBlockExtension = () => [positionAt(episode.layout, 1, 1, 64),
    positionAt(episode.layout, 1, 2, 64),
    positionAt(episode.layout, 1, 3, 64), positionAt(episode.layout, 1, 3, 65)];
  if (episode.mode === 'forward-blocked') {
    // The central lower bar remains the real collision surface.  Extending
    // the same structure on the side opposite the effect proxy makes the
    // obstruction publicly visible without placing an answer-bearing marker
    // above the central ray or hiding the proxy behind it.
    return publicOneBlockExtension();
  }
  if (episode.mode.startsWith('left-') || episode.mode.startsWith('right-')) {
    if (episode.mode === 'left-clear' || episode.mode === 'right-clear') return [];
    const side = episode.mode === 'left-blocked' ? -1 : 1;
    return Array.from({ length: 3 }, (_unused, forwardDistance) =>
      ([positionAt(episode.layout, side, forwardDistance, 64),
        positionAt(episode.layout, side, forwardDistance, 65)] as const)).flat();
  }
  if (episode.mode === 'jump-forward-clear-one-block') return publicOneBlockExtension();
  if (episode.mode === 'jump-forward-blocked-low-roof-high-obstacle') {
    // A single ceiling cell directly above the start really blocks a jump,
    // but it can fall between the sparse public rays.  This is the same real
    // low-ceiling mechanism extended into a short canopy, not a marker or an
    // action label: it both constrains the body and becomes publicly visible.
    const canopy = Array.from({ length: 3 }, (_unused, lateral) =>
      Array.from({ length: 3 }, (_other, forwardDistance) =>
      positionAt(episode.layout, lateral - 1, forwardDistance, 66))).flat();
    return [...publicOneBlockExtension(), ...canopy];
  }
  return [];
}

/**
 * Resolve the guided attention reference from objects that are actually
 * public in the sealed pre-action frame.  A close collision block can sit
 * below the camera fan; in that case a visible, physically connected part of
 * the same fixture is used.  No result label or hidden block lookup enters
 * this selection.
 */
export function minecraftMultilevelGuidedPublicReferenceIdLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1,
  observation: Observation,
): string | null {
  const central = centralObstacleReference(episode, geometry);
  if (central) {
    const candidates = [central, ...publicMechanismExtensionLiveV1(episode)];
    const visible = candidates.find(position => objectAt(observation, blockId(position)));
    return visible ? blockId(visible) : null;
  }
  const fallback = episode.representationProfile
    ? minecraftMultilevelGuidedVocabularyPanelLiveV1(episode.layout).proxyButton
    : geometry.reference;
  return blockId(fallback);
}

function centralObstacleReference(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1): BlockPositionV1 | null {
  if (episode.mode.startsWith('left-') || episode.mode.startsWith('right-'))
    return [geometry.oneBlockObstacle[0], 65, geometry.oneBlockObstacle[2]];
  if (episode.mode === 'forward-blocked' || episode.mode === 'jump-forward-clear-one-block')
    return geometry.oneBlockObstacle;
  if (episode.mode === 'jump-forward-blocked-low-roof-high-obstacle')
    return geometry.highObstacle[1];
  return null;
}

export function minecraftMultilevelGuidedFixtureInitialViewLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1): { yaw: number; pitch: number } {
  const buttonFixture = episode.mode.startsWith('look-') || episode.mode.startsWith('interact-');
  const vocabularyTarget = episode.representationProfile?.crosshairVocabularyMaterial
    ? minecraftMultilevelGuidedVocabularyPanelLiveV1(episode.layout).crosshairDistractor : null;
  // The legacy fixture aimed at its tracked obstacle.  The hierarchical
  // profile keeps the neutral forward view: the central side obstacle starts
  // publicly visible but can genuinely leave the camera fan during a clear
  // lateral move.  That elementary visibility transition must therefore be
  // present in the real 128-atom calibration rather than first appearing
  // after the event map freezes.
  const obstacle = episode.representationProfile
    ? null : centralObstacleReference(episode, geometry);
  if (!buttonFixture && !obstacle && !vocabularyTarget) return { yaw: geometry.yaw, pitch: 0 };
  const bot = minecraftMultilevelGuidedFixtureBotPositionLiveV1(episode, geometry);
  const eye = new Vec3(bot[0], bot[1] + 1.62, bot[2]);
  const focus = vocabularyTarget ?? obstacle ?? geometry.button;
  let target = new Vec3(focus[0] + .5, focus[1] + .5, focus[2] + .5);
  if (buttonFixture) {
    const outline = publicButtonSelectionShapeV1({ face: 'wall',
      facing: opposite(episode.layout.facing), powered: false });
    assert(outline, 'guided-button-outline-unavailable');
    target = new Vec3(focus[0] + (outline[0] + outline[3]) / 2,
      focus[1] + (outline[1] + outline[4]) / 2,
      focus[2] + (outline[2] + outline[5]) / 2);
  }
  const delta = target.minus(eye);
  const exactYaw = Math.atan2(-delta.x, -delta.z);
  const offsetDegrees = episode.mode === 'look-plus-15-acquire' ? -15
    : episode.mode === 'look-minus-15-acquire' ? 15 : 0;
  return { yaw: exactYaw + offsetDegrees * Math.PI / 180,
    pitch: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) };
}

/** The client-side facts which form the reset-before-action command barrier. */
export function minecraftMultilevelGuidedFixtureReadinessLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
): MinecraftMultilevelGuidedFixtureReadinessLiveV1 {
  const layout = episode.layout;
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(layout);
  const representation = episode.representationProfile;
  const vocabulary = minecraftMultilevelGuidedVocabularyPanelLiveV1(layout);
  const present: MinecraftMultilevelGuidedFixtureBlockExpectationLiveV1[] = representation
    ? [{ position: vocabulary.proxyButton, name: 'stone_button',
      properties: { face: 'wall', facing: opposite(layout.facing), powered: false } },
    { position: vocabulary.proxySupport, name: 'quartz_block' }]
    : [{ position: geometry.reference, name: 'copper_bulb',
      properties: { lit: false, powered: false } }];
  for (let x = layout.originX - 9; x <= layout.originX + 9; x++)
    for (let z = layout.originZ - 9; z <= layout.originZ + 9; z++)
      present.push({ position: [x, 63, z], name: 'smooth_stone' });
  neutralMarkerPositions(layout).forEach((position, index) => {
    const name = neutralContextBlock(layout, index);
    present.push({ position, name }, { position: [position[0], 65, position[2]], name });
  });
  if (representation?.calibrationVocabularyPanel) {
    assert(representation.crosshairVocabularyMaterial,
      'guided-calibration-panel-requires-one-public-material');
    [...vocabulary.ironBars, ...vocabulary.stoneBricks].forEach(position =>
      present.push({ position, name: representation.crosshairVocabularyMaterial! }));
  }
  if (representation?.crosshairVocabularyMaterial)
    present.push({ position: vocabulary.crosshairDistractor,
      name: representation.crosshairVocabularyMaterial });
  calibrationCrosshairConnectionsLiveV1(episode).forEach(position =>
    present.push({ position, name: 'iron_bars' }));

  const buttonFixture = episode.mode.startsWith('look-') || episode.mode.startsWith('interact-');
  if (buttonFixture) {
    const wired = episode.mode === 'interact-wired-button-opens-iron-door';
    present.push({ position: geometry.button, name: 'stone_button',
      properties: { face: 'wall', facing: opposite(layout.facing), powered: false } });
    if (wired) present.push(
      { position: geometry.dropper, name: 'dropper',
        properties: { facing: layout.facing, triggered: false } },
      { position: geometry.container, name: 'barrel',
        properties: { facing: layout.facing, open: false } });
    else present.push({ position: geometry.dropper, name: 'quartz_block' });
  }
  if (episode.mode.startsWith('interact-')) {
    present.push({ position: geometry.doorLower, name: 'iron_door',
      properties: { facing: layout.facing, half: 'lower', hinge: 'left',
        open: false, powered: false } },
    { position: geometry.doorUpper, name: 'iron_door',
      properties: { facing: layout.facing, half: 'upper', hinge: 'left',
        open: false, powered: false } });
  }
  if (episode.mode === 'interact-wired-button-opens-iron-door') {
    present.push({ position: geometry.comparator, name: 'comparator',
      properties: { facing: opposite(layout.facing), mode: 'compare', powered: false } });
    present.push({ position: positionAt(layout, 0, 7), name: 'redstone_wire',
      properties: { power: '0' } },
    { position: geometry.repeater, name: 'repeater',
      // prismarine-block exposes enum-backed numeric block-state values as strings.
      properties: { delay: '1', facing: opposite(rightOf(layout.facing)),
        locked: false, powered: false } });
  }
  if (episode.mode === 'forward-blocked'
    || episode.mode === 'jump-forward-clear-one-block'
    || episode.mode === 'jump-forward-blocked-low-roof-high-obstacle')
    present.push({ position: geometry.oneBlockObstacle, name: mechanismMaterialLiveV1(episode) });
  if (episode.mode.startsWith('left-') || episode.mode.startsWith('right-')) {
    present.push({ position: geometry.oneBlockObstacle, name: 'iron_bars' });
    present.push({ position: [geometry.oneBlockObstacle[0], 65, geometry.oneBlockObstacle[2]],
      name: 'iron_bars' });
  }
  if (episode.mode === 'left-blocked')
    present.push({ position: positionAt(layout, -1, 0),
      name: representation ? mechanismMaterialLiveV1(episode) : 'smooth_stone' });
  if (episode.mode === 'right-blocked')
    present.push({ position: positionAt(layout, 1, 0),
      name: representation ? mechanismMaterialLiveV1(episode) : 'smooth_stone' });
  if (episode.mode === 'jump-forward-blocked-low-roof-high-obstacle') {
    // The hierarchical profile uses the same smooth-stone mechanism as the
    // successful jump, but combines a one-block obstacle with a low roof. It
    // leaves the public sight line open; the legacy fixture keeps its full
    // two-block obstacle unchanged.
    if (!representation)
      present.push({ position: geometry.highObstacle[1], name: mechanismMaterialLiveV1(episode) });
    present.push({ position: geometry.lowRoof, name: 'smooth_stone' });
  }
  publicMechanismExtensionLiveV1(episode).forEach(position => {
    if (!present.some(value => value.position.join(',') === position.join(',')))
      present.push({ position, name: mechanismMaterialLiveV1(episode) });
  });
  const occupied = new Set(present.map(value => value.position.join(',')));
  const empty: BlockPositionV1[] = [];
  // The command boundary first clears this entire cuboid. Checking every cell,
  // including the layer below the rebuilt floor, makes a same-pose/same-layout
  // episode wait for the actual client reset instead of accepting stale blocks.
  for (let x = layout.originX - 9; x <= layout.originX + 9; x++)
    for (let y = 62; y <= 69; y++)
      for (let z = layout.originZ - 9; z <= layout.originZ + 9; z++) {
        const position = [x, y, z] as const;
        if (!occupied.has(position.join(','))) empty.push(position);
      }
  return { present, empty };
}

function fixtureCommands(episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  username: string): string[] {
  assert(/^[A-Za-z0-9_]{1,16}$/.test(username), 'unsafe-minecraft-username-for-fixture-command');
  const layout = episode.layout, geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(layout);
  const representation = episode.representationProfile;
  const vocabulary = minecraftMultilevelGuidedVocabularyPanelLiveV1(layout);
  const commands = [
    `fill ${layout.originX - 9} 62 ${layout.originZ - 9} ${layout.originX + 9} 69 ${layout.originZ + 9} air`,
    // Replacing a previously filled container with air releases its real item.
    // The reset owns that debris, so remove it before rebuilding the next
    // single-action fixture.  Otherwise reset artefacts can become a new
    // public event feature and correctly miss the frozen event map.
    'kill @e[type=minecraft:item]',
    `fill ${layout.originX - 9} 63 ${layout.originZ - 9} ${layout.originX + 9} 63 ${layout.originZ + 9} minecraft:smooth_stone`,
  ];
  if (representation) commands.push(
    setBlock(vocabulary.proxySupport, 'quartz_block'),
    setBlock(vocabulary.proxyButton,
      `stone_button[face=wall,facing=${opposite(layout.facing)},powered=false]`));
  else commands.push(setBlock(geometry.reference, 'copper_bulb[lit=false,powered=false]'));
  // At least one variant bit remains public beside either the central high
  // obstacle or the offset door; the markers never carry an affordance label.
  const markerPositions = neutralMarkerPositions(layout);
  markerPositions.forEach((position, index) => {
    const type = neutralContextBlock(layout, index);
    commands.push(setBlock(position, type), setBlock([position[0], 65, position[2]], type));
  });
  if (representation?.calibrationVocabularyPanel) {
    assert(representation.crosshairVocabularyMaterial,
      'guided-calibration-panel-requires-one-public-material');
    [...vocabulary.ironBars, ...vocabulary.stoneBricks].forEach(position =>
      commands.push(setBlock(position, representation.crosshairVocabularyMaterial!)));
  }
  if (representation?.crosshairVocabularyMaterial)
    commands.push(setBlock(vocabulary.crosshairDistractor,
      representation.crosshairVocabularyMaterial));
  calibrationCrosshairConnectionsLiveV1(episode).forEach(position =>
    commands.push(setBlock(position, 'iron_bars')));
  const buttonFixture = episode.mode.startsWith('look-') || episode.mode.startsWith('interact-');
  if (buttonFixture) {
    const wired = episode.mode === 'interact-wired-button-opens-iron-door';
    commands.push(setBlock(geometry.dropper, wired
      ? `dropper[facing=${layout.facing},triggered=false]`
        + '{Items:[{Slot:0b,id:"minecraft:cobblestone",count:1}]}'
      : 'quartz_block'));
    if (wired) commands.push(setBlock(geometry.container,
      `barrel[facing=${layout.facing},open=false]`));
    commands.push(setBlock(geometry.button,
      `stone_button[face=wall,facing=${opposite(layout.facing)},powered=false]`));
  }
  if (episode.mode.startsWith('interact-')) {
    commands.push(setBlock(geometry.doorLower,
      `iron_door[facing=${layout.facing},half=lower,hinge=left,open=false,powered=false]`));
    commands.push(setBlock(geometry.doorUpper,
      `iron_door[facing=${layout.facing},half=upper,hinge=left,open=false,powered=false]`));
  }
  if (episode.mode === 'interact-wired-button-opens-iron-door') {
    commands.push(setBlock(geometry.comparator,
      `comparator[facing=${opposite(layout.facing)},mode=compare,powered=false]`));
    commands.push(setBlock(positionAt(layout, 0, 7), 'redstone_wire'),
      setBlock(geometry.repeater,
        `repeater[delay=1,facing=${opposite(rightOf(layout.facing))},locked=false,powered=false]`));
  }
  if (episode.mode === 'forward-blocked')
    commands.push(setBlock(geometry.oneBlockObstacle, mechanismMaterialLiveV1(episode)));
  if (episode.mode.startsWith('left-') || episode.mode.startsWith('right-')) {
    commands.push(setBlock(geometry.oneBlockObstacle, 'iron_bars'));
    commands.push(setBlock([geometry.oneBlockObstacle[0], 65, geometry.oneBlockObstacle[2]], 'iron_bars'));
  }
  if (episode.mode === 'left-blocked')
    commands.push(setBlock(positionAt(layout, -1, 0),
      representation ? mechanismMaterialLiveV1(episode) : 'smooth_stone'));
  if (episode.mode === 'right-blocked')
    commands.push(setBlock(positionAt(layout, 1, 0),
      representation ? mechanismMaterialLiveV1(episode) : 'smooth_stone'));
  if (episode.mode === 'jump-forward-clear-one-block')
    commands.push(setBlock(geometry.oneBlockObstacle, mechanismMaterialLiveV1(episode)));
  if (episode.mode === 'jump-forward-blocked-low-roof-high-obstacle') {
    commands.push(setBlock(geometry.highObstacle[0], mechanismMaterialLiveV1(episode)));
    if (!representation)
      commands.push(setBlock(geometry.highObstacle[1], mechanismMaterialLiveV1(episode)));
    commands.push(setBlock(geometry.lowRoof, 'smooth_stone'));
  }
  publicMechanismExtensionLiveV1(episode).forEach(position =>
    commands.push(setBlock(position, mechanismMaterialLiveV1(episode))));
  // Orientation is part of the before-episode server reset, not a hidden client action.
  const view = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
  const { yaw: notchYaw, pitch: notchPitch } = minecraftTeleportViewLiveV1(view);
  commands.push(`tp ${username} ${minecraftMultilevelGuidedFixtureBotPositionLiveV1(
    episode, geometry).join(' ')} ${notchYaw} ${notchPitch}`);
  return commands;
}

export function minecraftMultilevelGuidedGlobalCommandsLiveV1(): MinecraftFixtureCommandBatchLiveV1 {
  return { version: 'MinecraftFixtureCommandBatchLiveV1',
    boundary: 'server-fixture-only-no-controller-access', phase: 'global-setup', episode: null,
    commands: ['setworldspawn 1000 64 1000', 'gamerule spawnRadius 0',
      'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false',
      'gamerule doMobSpawning false', 'time set noon', 'forceload add 104 104 208 208'] };
}

export function minecraftMultilevelGuidedFixtureCommandsLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  username: string,
  phase: MinecraftFixtureCommandBatchLiveV1['phase'] = 'before-episode',
): MinecraftFixtureCommandBatchLiveV1 {
  assert(phase === 'before-episode' || phase === 'latch-verification-before-action',
    'fixture-reset-must-be-before-an-action');
  return { version: 'MinecraftFixtureCommandBatchLiveV1',
    boundary: 'server-fixture-only-no-controller-access', phase,
    episode: phase === 'before-episode' ? episode.episode : null,
    commands: fixtureCommands(episode, username) };
}

export interface MinecraftFixtureCommandSinkLiveV1 { command(command: string): void; }

export function applyMinecraftFixtureCommandBatchLiveV1(
  sink: MinecraftFixtureCommandSinkLiveV1,
  batch: MinecraftFixtureCommandBatchLiveV1,
): void {
  assert(batch.boundary === 'server-fixture-only-no-controller-access'
    && ['global-setup', 'latch-verification-before-action', 'before-episode'].includes(batch.phase),
  'invalid-fixture-command-boundary');
  for (const command of batch.commands) {
    assert(!/[\r\n;]/.test(command) && !/command_block|^execute\b|^function\b|^schedule\b/i.test(command),
      'forbidden-dynamic-fixture-command');
    assert(/^(?:fill|setblock|tp|gamerule|time set|forceload add|setworldspawn)\s/.test(command)
      || command === 'kill @e[type=minecraft:item]',
      'command-outside-static-fixture-boundary');
    sink.command(command);
  }
}

function objectAt(observation: Observation, id: string): PublicObject | null {
  return observation.objects.find(object => object.id === id) ?? null;
}

interface MinecraftFixtureViewLiveV1 { readonly yaw: number; readonly pitch: number; }

function angleDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function minecraftTeleportViewLiveV1(view: MinecraftFixtureViewLiveV1):
{ readonly yaw: number; readonly pitch: number } {
  return { yaw: ((180 - view.yaw * 180 / Math.PI) % 360 + 360) % 360,
    pitch: -view.pitch * 180 / Math.PI };
}

/**
 * The stale-frame barrier runs before the next fixture is built, so it must
 * rotate the bot at its current safe position.  Teleporting to the future
 * fixture pose here can drop the bot through an as-yet-unbuilt floor.
 */
export function minecraftMultilevelGuidedStagingTeleportCommandLiveV1(
  username: string, currentPosition: readonly number[], staging: MinecraftFixtureViewLiveV1,
): string {
  const serverView = minecraftTeleportViewLiveV1(staging);
  return `tp ${username} ${currentPosition.join(' ')} ${serverView.yaw} ${serverView.pitch}`;
}

function poseMatches(observation: Observation, expectedPosition: readonly number[],
  expected: MinecraftFixtureViewLiveV1): boolean {
  return Math.hypot(...observation.self.position.map((value, index) =>
    value - expectedPosition[index]!)) < .2
    && observation.self.properties.onGround === true
    && angleDistance(observation.self.yaw, expected.yaw) < .03
    && angleDistance(observation.self.pitch, expected.pitch) < .03;
}

/**
 * The server command boundary is complete only after a run of real public
 * frames newer than the command.  A single matching frame may still be the
 * stale pre-command pose when consecutive fixtures happen to share a pose.
 */
export function minecraftMultilevelGuidedPoseWindowSettledLiveV1(
  observations: readonly Observation[], afterSequence: number,
  expectedPosition: readonly number[], expected: MinecraftFixtureViewLiveV1,
  stableTicks = 5,
): boolean {
  if (observations.length < stableTicks) return false;
  const window = observations.slice(-stableTicks);
  return window.every((observation, index) => observation.sequence > afterSequence
    && (index === 0 || observation.sequence > window[index - 1]!.sequence)
    && poseMatches(observation, expectedPosition, expected));
}

async function waitForPose(body: MinecraftBody, expectedPosition: readonly number[],
  expected: MinecraftFixtureViewLiveV1, afterSequence: number, stableTicks = 5): Promise<void> {
  const observations: Observation[] = [];
  for (let tick = 0; tick < 120; tick++) {
    const observation = body.latest();
    if (observations.at(-1)?.sequence !== observation.sequence) observations.push(observation);
    if (minecraftMultilevelGuidedPoseWindowSettledLiveV1(observations, afterSequence,
      expectedPosition, expected, stableTicks)) return;
    await body.waitTicks(1);
  }
  throw new Error('guided-fixture-teleport-pose-did-not-settle');
}

async function establishFixturePoseCommandBarrier(body: MinecraftBody,
  services: MinecraftFixtureCommandSinkLiveV1,
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1): Promise<void> {
  const expected = minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry);
  const current = body.latest();
  const position = current.self.position;
  const positive = { yaw: expected.yaw + Math.PI / 2, pitch: expected.pitch };
  const negative = { yaw: expected.yaw - Math.PI / 2, pitch: expected.pitch };
  const staging = angleDistance(current.self.yaw, positive.yaw) >= .25 ? positive : negative;
  const boundary = current.sequence;
  applyMinecraftFixtureCommandBatchLiveV1(services, {
    version: 'MinecraftFixtureCommandBatchLiveV1',
    boundary: 'server-fixture-only-no-controller-access',
    phase: 'before-episode',
    episode: episode.episode,
    commands: [minecraftMultilevelGuidedStagingTeleportCommandLiveV1(
      body.bot.username, position, staging)],
  });
  await waitForPose(body, position, staging, boundary, 2);
}

async function waitForFixtureReady(body: MinecraftBody,
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1): Promise<void> {
  const expected = minecraftMultilevelGuidedFixtureReadinessLiveV1(episode);
  let stableTicks = 0;
  for (let tick = 0; tick < 120; tick++) {
    const present = expected.present.every(value => {
      const block = body.bot.blockAt(new Vec3(...value.position));
      if (block?.name !== value.name) return false;
      const properties = block.getProperties() as Readonly<Record<string, unknown>>;
      return Object.entries(value.properties ?? {}).every(([key, expectedValue]) =>
        properties[key] === expectedValue);
    });
    const empty = expected.empty.every(position =>
      body.bot.blockAt(new Vec3(...position))?.name === 'air');
    stableTicks = present && empty ? stableTicks + 1 : 0;
    if (stableTicks >= 3) return;
    await body.waitTicks(1);
  }
  throw new Error(`guided-fixture-reset-command-barrier-failed:${episode.episode}:${episode.mode}`);
}

export interface PreparedMinecraftMultilevelGuidedFixtureLiveV1 {
  readonly geometry: MinecraftMultilevelGuidedFixtureGeometryLiveV1;
  readonly observation: Observation;
  readonly buttonId: string | null;
  readonly doorId: string | null;
  readonly referenceId: string;
}

export async function prepareMinecraftMultilevelGuidedFixtureLiveV1(services: MinecraftFixtureCommandSinkLiveV1,
  body: MinecraftBody,
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  phase: 'before-episode' | 'latch-verification-before-action' = 'before-episode',
): Promise<PreparedMinecraftMultilevelGuidedFixtureLiveV1> {
  const geometry = minecraftMultilevelGuidedFixtureGeometryLiveV1(episode.layout);
  await establishFixturePoseCommandBarrier(body, services, episode, geometry);
  const batch = minecraftMultilevelGuidedFixtureCommandsLiveV1(episode, body.bot.username, phase);
  const finalPoseBoundary = body.latest().sequence;
  applyMinecraftFixtureCommandBatchLiveV1(services, batch);
  await waitForPose(body, minecraftMultilevelGuidedFixtureBotPositionLiveV1(episode, geometry),
    minecraftMultilevelGuidedFixtureInitialViewLiveV1(episode, geometry), finalPoseBoundary);
  await waitForFixtureReady(body, episode);
  const hasButton = episode.mode.startsWith('look-') || episode.mode.startsWith('interact-');
  await body.waitTicks(4);
  const observation = structuredClone(body.latest());
  const referenceId = minecraftMultilevelGuidedPublicReferenceIdLiveV1(
    episode, geometry, observation);
  // Look learns only the button transition; interaction learns button -> door.
  // Their unrelated lateral copper reference may legitimately be outside the
  // sampled public fan and must not become a hidden readiness dependency.
  if (!hasButton) assert(referenceId && objectAt(observation, referenceId),
    'guided-fixture-reference-not-public');
  if (episode.representationProfile?.calibrationVocabularyPanel) {
    const count = (type: string) => observation.objects.filter(object => object.type === type).length;
    const material = episode.representationProfile.crosshairVocabularyMaterial;
    const minimum = material === 'iron_bars' ? 15 : 12;
    assert(material && count(material) >= minimum,
      `guided-calibration-vocabulary-panel-not-public:${material}:${material ? count(material) : 0}`);
  }
  if (episode.representationProfile?.crosshairVocabularyMaterial) {
    const target = observation.objects.find(object => object.id === observation.targetId);
    assert(target?.type === episode.representationProfile.crosshairVocabularyMaterial,
      `guided-calibration-crosshair-vocabulary-not-public:${episode.representationProfile.crosshairVocabularyMaterial}`);
  }
  if (hasButton) {
    assert(objectAt(observation, geometry.buttonId), 'guided-fixture-button-not-public');
    const initiallyAimed = observation.targetId === geometry.buttonId;
    if (episode.mode.endsWith('-acquire')) assert(!initiallyAimed, 'guided-look-acquire-started-on-button');
    else assert(initiallyAimed, 'guided-button-fixture-not-under-public-crosshair');
  }
  if (episode.mode.startsWith('interact-')) {
    const door = objectAt(observation, geometry.doorId);
    assert(door?.type === 'iron_door' && door.properties.open === false,
      'guided-interaction-door-not-public-and-closed');
  }
  return { geometry, observation, buttonId: hasButton ? geometry.buttonId : null,
    doorId: episode.mode.startsWith('interact-') ? geometry.doorId : null,
    referenceId: referenceId ?? geometry.referenceId };
}

export function minecraftMultilevelGuidedActionScopeLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  fixture: Pick<PreparedMinecraftMultilevelGuidedFixtureLiveV1, 'buttonId' | 'doorId' | 'referenceId'>,
): ActionObservationScopeV1 {
  const referencedPublicObjectIds = episode.mode.startsWith('interact-')
    ? [fixture.doorId] : episode.mode.startsWith('look-') ? [fixture.buttonId] : [fixture.referenceId];
  assert(referencedPublicObjectIds.every((id): id is string => typeof id === 'string' && id.length > 0),
    'guided-action-scope-missing-public-reference');
  return { version: 'ActionObservationScopeV1', referencedPublicObjectIds };
}

export function materializeMinecraftMultilevelGuidedActionLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  fixture: Pick<PreparedMinecraftMultilevelGuidedFixtureLiveV1, 'buttonId'>,
): Action {
  if (!episode.mode.startsWith('interact-')) return structuredClone(episode.action);
  assert(fixture.buttonId, 'guided-interact-action-missing-public-button');
  return { kind: 'interact', parameters: {}, targetId: fixture.buttonId };
}

function valuesFor(event: RealEvent, id: string, property: string): unknown[] {
  return event.frames.flatMap(frame => {
    const object = objectAt(frame, id); return object ? [object.properties[property]] : [];
  });
}

function observedObjectsFor(event: RealEvent, id: string) {
  return event.frames.flatMap(frame => {
    const object = objectAt(frame, id); return object ? [object] : [];
  });
}

function projectedDisplacements(event: RealEvent, axis: readonly [number, number]): number[] {
  const start = event.frames[0]!.self.position;
  return event.frames.map(frame => (frame.self.position[0] - start[0]) * axis[0]
    + (frame.self.position[2] - start[2]) * axis[1]);
}

export function assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  fixture: Pick<PreparedMinecraftMultilevelGuidedFixtureLiveV1,
    'geometry' | 'buttonId' | 'doorId' | 'referenceId'>,
  event: RealEvent,
): void {
  assert(event.provenance === 'executed-real-body' && event.complete
    && event.bodyResult?.executed && event.bodyResult.status === 'completed',
  `guided-episode-not-one-completed-real-action:${episode.episode}`);
  const action = materializeMinecraftMultilevelGuidedActionLiveV1(episode, fixture);
  assert(canonical(event.bodyResult.action) === canonical(action)
    && event.cue.kind === action.kind, `guided-episode-action-mismatch:${episode.episode}`);
  const first = event.frames[0]!, last = event.frames.at(-1)!;
  const startButton = fixture.buttonId ? objectAt(first, fixture.buttonId) : null;
  const finalTarget = last.targetId ? objectAt(last, last.targetId) : null;
  if (episode.mode.endsWith('-acquire')) {
    assert(first.targetId !== fixture.buttonId && finalTarget?.type === 'stone_button',
      `guided-look-did-not-acquire-button:${episode.episode}`);
  }
  if (episode.mode.endsWith('-away')) {
    assert(startButton?.type === 'stone_button' && first.targetId === fixture.buttonId
      && finalTarget?.type !== 'stone_button', `guided-look-did-not-leave-button:${episode.episode}`);
  }
  const forward = projectedDisplacements(event, fixture.geometry.forward);
  const right = projectedDisplacements(event, fixture.geometry.right);
  const finalForward = forward.at(-1)!, finalRight = right.at(-1)!;
  if (episode.mode === 'forward-reduce-distance') {
    const before = objectAt(first, fixture.referenceId), after = objectAt(last, fixture.referenceId);
    assert(before && after
      && Math.hypot(...after.relativePosition) < Math.hypot(...before.relativePosition) - .02
      && finalForward > .04, `guided-forward-did-not-reduce-public-distance:${episode.episode}`);
  }
  if (episode.mode === 'forward-blocked')
    assert(Math.max(...forward.map(Math.abs)) <= .26, `guided-forward-block-not-observed:${episode.episode}`);
  if (episode.mode === 'left-clear') {
    const observed = observedObjectsFor(event, fixture.referenceId);
    const before = observed[0], after = observed.at(-1);
    const beforeRight = before ? before.relativePosition[0] * fixture.geometry.right[0]
      + before.relativePosition[2] * fixture.geometry.right[1] : 0;
    const afterRight = after ? after.relativePosition[0] * fixture.geometry.right[0]
      + after.relativePosition[2] * fixture.geometry.right[1] : 0;
    assert(before && after && finalRight < -.04 && afterRight > beforeRight + .25,
      `guided-left-clear-did-not-open-forward-corridor:${episode.episode}`);
  }
  if (episode.mode === 'left-blocked')
    assert(Math.max(...right.map(Math.abs)) <= .26, `guided-left-block-not-observed:${episode.episode}`);
  if (episode.mode === 'right-clear') {
    const observed = observedObjectsFor(event, fixture.referenceId);
    const before = observed[0], after = observed.at(-1);
    const beforeRight = before ? before.relativePosition[0] * fixture.geometry.right[0]
      + before.relativePosition[2] * fixture.geometry.right[1] : 0;
    const afterRight = after ? after.relativePosition[0] * fixture.geometry.right[0]
      + after.relativePosition[2] * fixture.geometry.right[1] : 0;
    assert(before && after && finalRight > .04 && afterRight < beforeRight - .25,
      `guided-right-clear-did-not-open-forward-corridor:${episode.episode}`);
  }
  if (episode.mode === 'right-blocked')
    assert(Math.max(...right.map(Math.abs)) <= .26, `guided-right-block-not-observed:${episode.episode}`);
  const startY = first.self.position[1];
  const verticalExcursion = Math.max(...event.frames.map(frame => frame.self.position[1] - startY));
  if (episode.mode === 'jump-forward-clear-one-block')
    assert(verticalExcursion >= .5 && Math.max(...forward) > .20,
      `guided-jump-did-not-clear-one-block:${episode.episode}`);
  if (episode.mode === 'jump-forward-blocked-low-roof-high-obstacle')
    assert(verticalExcursion <= .35 && Math.max(...forward.map(Math.abs)) <= .26,
      `guided-low-roof-high-obstacle-did-not-block-jump:${episode.episode}`);
  if (episode.mode === 'interact-wired-button-opens-iron-door') {
    assert(fixture.doorId, 'guided-wired-door-id-missing');
    const doorValues = valuesFor(event, fixture.doorId, 'open');
    const changes = eventRows(event).changes.flat();
    assert(doorValues[0] === false && doorValues.at(-1) === true
      && changes.some(change => change.subject.startsWith('iron_door#')
        && change.property === 'open' && change.before === false && change.after === true),
    `guided-wired-button-did-not-open-door:${episode.episode}`);
  }
  if (episode.mode === 'interact-visible-disconnected-button-no-door-change') {
    assert(fixture.buttonId && first.targetId === fixture.buttonId && fixture.doorId,
      'guided-disconnected-button-was-not-visible-and-targeted');
    const doorValues = valuesFor(event, fixture.doorId, 'open');
    assert(doorValues.length >= 2 && doorValues.every(value => value === false),
      `guided-disconnected-button-changed-door:${episode.episode}`);
  }
  if (episode.mode === 'observe-state-remains' || episode.mode === 'wait-no-relevant-change') {
    const before = objectAt(first, fixture.referenceId), after = objectAt(last, fixture.referenceId);
    const displacement = Math.hypot(...last.self.position.map((value, index) => value - first.self.position[index]!));
    assert(before && after && canonical(before.properties) === canonical(after.properties)
      && Math.abs(Math.hypot(...before.relativePosition) - Math.hypot(...after.relativePosition)) < .02
      && displacement < .02 && Math.abs(last.self.yaw - first.self.yaw) < .01
      && Math.abs(last.self.pitch - first.self.pitch) < .01,
    `guided-${episode.mode}-had-relevant-change:${episode.episode}`);
  }
}

export interface MinecraftMultilevelGuidedBodyPortLiveV1 {
  execute(action: Action, scope?: ActionObservationScopeV1):
    Promise<{ result: { readonly executed: boolean }; event: RealEvent | null }>;
}
export interface MinecraftMultilevelGuidedMemoryPortLiveV1 {
  observe(event: RealEvent): Promise<MemoryObservationReceipt>;
}

export async function executeMinecraftMultilevelGuidedEpisodeLiveV1(
  episode: MinecraftMultilevelGuidedTrainingEpisodeLiveV1,
  fixture: PreparedMinecraftMultilevelGuidedFixtureLiveV1,
  body: MinecraftMultilevelGuidedBodyPortLiveV1,
  memory: MinecraftMultilevelGuidedMemoryPortLiveV1,
): Promise<{ readonly action: Action; readonly scope: ActionObservationScopeV1;
  readonly event: RealEvent; readonly receipt: MemoryObservationReceipt }> {
  const action = materializeMinecraftMultilevelGuidedActionLiveV1(episode, fixture);
  const scope = minecraftMultilevelGuidedActionScopeLiveV1(episode, fixture);
  // This is the sole execute call in one episode. Fixture commands have already ended.
  const execution = await body.execute(action, scope);
  assert(execution.result.executed && execution.event,
    `guided-single-real-action-failed:${episode.episode}:${episode.mode}`);
  assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(episode, fixture, execution.event);
  const receipt = await memory.observe(execution.event);
  return { action, scope, event: execution.event, receipt };
}

export const MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1 = Object.freeze({
  'look-plus-15': { kind: 'look', parameters: { yawDegrees: 15, pitchDegrees: 0 }, targetRole: null },
  'look-minus-15': { kind: 'look', parameters: { yawDegrees: -15, pitchDegrees: 0 }, targetRole: null },
  'move-forward': { kind: 'move', parameters: { direction: 'forward', ticks: 4 }, targetRole: null },
  'move-left': { kind: 'move', parameters: { direction: 'left', ticks: 4 }, targetRole: null },
  'move-right': { kind: 'move', parameters: { direction: 'right', ticks: 4 }, targetRole: null },
  'jump-forward': { kind: 'jump', parameters: { forward: true, ticks: 4 }, targetRole: null },
  'interact-stone-button': { kind: 'interact', parameters: {}, targetRole: 'stone_button' },
} satisfies Readonly<Record<string, ActionCue>>);

export function minecraftMultilevelProductionR2ARelationsByCoreCueLiveV1(
  snapshot: MemorySnapshot,
): Readonly<Record<keyof typeof MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1,
  readonly string[]>> {
  assert(snapshot.r2a, 'guided-frozen-snapshot-missing-r2a');
  const production = snapshot.r2a.hyperedges.filter(edge => edge.factorIds.length === 1
    ? edge.state === 'stable' : edge.state === 'minimal-under-tested-interventions');
  const entries = Object.entries(MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1)
    .map(([name, cue]) => {
      const relationIds = production.filter(edge => edge.interventionKey === cueIdentity(cue))
        .map(edge => edge.hyperedgeId).sort();
      assert(relationIds.length > 0, `guided-production-r2a-missing-core-cue:${name}`);
      return [name, relationIds] as const;
    });
  return Object.fromEntries(entries) as unknown as Readonly<Record<
    keyof typeof MINECRAFT_MULTILEVEL_GUIDED_PRODUCTION_CORE_CUES_LIVE_V1, readonly string[]>>;
}

export interface FrozenMultilevelExperienceIdentityLiveV1 {
  readonly version: 'FrozenMultilevelExperienceIdentityLiveV1';
  readonly filename: typeof FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1;
  readonly writes: 256;
  readonly realEventCount: 256;
  readonly mapSha256: string;
  readonly snapshotSha256: string;
  readonly trainingPlanSha256: string;
  readonly productionR2ARelationIdsByCoreCue: ReturnType<
    typeof minecraftMultilevelProductionR2ARelationsByCoreCueLiveV1>;
  readonly qualificationExecuted: false;
}

export function frozenMultilevelExperienceIdentityLiveV1(
  snapshot: MemorySnapshot,
): FrozenMultilevelExperienceIdentityLiveV1 {
  assert(snapshot.version === 'KairosV5MemoryV4' && snapshot.writes === 256
    && snapshot.seenEventIds.length === 256 && snapshot.pendingInitialization.length === 0
    && snapshot.eventMap && snapshot.projector && snapshot.tokenEncoder && snapshot.r2a,
  'invalid-frozen-multilevel-experience-0256');
  return { version: 'FrozenMultilevelExperienceIdentityLiveV1',
    filename: FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1, writes: 256, realEventCount: 256,
    mapSha256: sha(snapshot.eventMap), snapshotSha256: sha(snapshot),
    trainingPlanSha256: minecraftMultilevelGuidedTrainingPlanIdentityLiveV1(),
    productionR2ARelationIdsByCoreCue: minecraftMultilevelProductionR2ARelationsByCoreCueLiveV1(snapshot),
    qualificationExecuted: false };
}

interface MemoryStatusLiveV1 {
  readonly ready: boolean;
  readonly bufferedEvents: number;
  readonly writes: number;
  readonly mapSha256: string | null;
}

export interface MinecraftMultilevelGuidedTrainingLiveResultV1 {
  readonly version: 'MinecraftMultilevelGuidedTrainingLiveResultV1';
  readonly servicesStartedWith: 'empty';
  readonly latchVerification: { readonly persistentTicks: 200; readonly doorStayedOpen: true;
    readonly verificationActions: 1; readonly excludedFromTraining: true;
    readonly beforeTraining: true; readonly eventId: string; readonly action: Action;
    readonly learnedEvents: 0; readonly controllerAccess: false };
  readonly training: {
    readonly realEvents: 256;
    readonly completedActions: 256;
    readonly resetsBeforeEpisodes: 256;
    readonly modeCounts: Readonly<Record<string, number>>;
    readonly contextCountsByMode: Readonly<Record<string, number>>;
    readonly statusAfter128: MemoryStatusLiveV1;
    readonly statusAfter256: MemoryStatusLiveV1;
    readonly mapSha256After128: string;
    readonly mapSha256After256: string;
    readonly productionR2ARelationIdsByCoreCue: FrozenMultilevelExperienceIdentityLiveV1[
      'productionR2ARelationIdsByCoreCue'];
  };
  readonly artifacts: {
    readonly planSha256: string;
    readonly timelineFile: typeof MULTILEVEL_GUIDED_TRAINING_TIMELINE_FILENAME_V1;
    readonly timelineFileSha256: string;
    readonly frozenFile: typeof FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1;
    readonly frozenSnapshotSha256: string;
    readonly frozenFileSha256: string;
    readonly qualificationExecuted: false;
  };
}

export async function runMinecraftMultilevelGuidedTrainingLiveV1(
  config: Configuration,
  evidence: string,
): Promise<MinecraftMultilevelGuidedTrainingLiveResultV1> {
  await mkdir(evidence, { recursive: true });
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown) => (kind === 'frame' ? frames : events)
    .write(canonical({ kind, value }) + '\n');
  const runRoot = resolve(config.runtimeRoot, `multilevel-guided-training-live-${Date.now()}`);
  const services = new Services(config, runRoot, evidence), compute = new Compute();
  let body: MinecraftBody | null = null;
  try {
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft, worldId: 'multilevel-guided-training-live-v1' }, record);
    await body.ready();
    applyMinecraftFixtureCommandBatchLiveV1(services, minecraftMultilevelGuidedGlobalCommandsLiveV1());
    await body.waitTicks(60);
    const initialStatus = await compute.call<MemoryStatusLiveV1>('status');
    assert(!initialStatus.ready && initialStatus.bufferedEvents === 0 && initialStatus.writes === 0
      && initialStatus.mapSha256 === null, 'guided-training-did-not-start-from-empty-memory');

    const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
    const latchEpisode = plan.find(episode =>
      episode.mode === 'interact-wired-button-opens-iron-door')!;
    const latchFixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(services, body, latchEpisode,
      'latch-verification-before-action');
    const latchAction = materializeMinecraftMultilevelGuidedActionLiveV1(latchEpisode, latchFixture);
    const latchScope = minecraftMultilevelGuidedActionScopeLiveV1(latchEpisode, latchFixture);
    const latchExecution = await body.execute(latchAction, latchScope);
    assert(latchExecution.event && latchExecution.result.executed,
      'vanilla-copper-bulb-latch-verification-action-failed');
    assertMinecraftMultilevelGuidedTrainingOutcomeLiveV1(latchEpisode, latchFixture, latchExecution.event);
    await body.waitTicks(200);
    const heldDoor = objectAt(body.latest(), latchFixture.doorId!);
    assert(heldDoor?.properties.open === true,
      'vanilla-container-comparator-latch-did-not-hold-200-ticks');
    const afterVerification = await compute.call<MemoryStatusLiveV1>('status');
    assert(!afterVerification.ready && afterVerification.writes === 0
      && afterVerification.bufferedEvents === 0, 'latch-verification-entered-learning-memory');
    const latchVerification = { persistentTicks: 200 as const, doorStayedOpen: true as const,
      verificationActions: 1 as const, excludedFromTraining: true as const,
      beforeTraining: true as const, eventId: latchExecution.event.id,
      action: latchAction, learnedEvents: 0 as const, controllerAccess: false as const };
    await saveJson(resolve(evidence, 'LATCH_VERIFICATION.json'), latchVerification);

    const timeline: unknown[] = [], modeCounts: Record<string, number> = {};
    const contexts = new Map<MinecraftMultilevelGuidedTrainingModeLiveV1, Set<string>>();
    const halfContexts = new Map<string, Set<string>>();
    let completedActions = 0, resetsBeforeEpisodes = 0;
    let statusAfter128: MemoryStatusLiveV1 | null = null;
    const memoryPort: MinecraftMultilevelGuidedMemoryPortLiveV1 = {
      observe: event => compute.call<MemoryObservationReceipt>('observe', event),
    };
    for (const episode of plan) {
      // No server command is issued after the action; the next mutation is this next episode's reset.
      const fixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(services, body, episode, 'before-episode');
      resetsBeforeEpisodes++;
      const result = await executeMinecraftMultilevelGuidedEpisodeLiveV1(
        episode, fixture, body, memoryPort);
      completedActions++;
      modeCounts[episode.mode] = (modeCounts[episode.mode] ?? 0) + 1;
      const contextId = result.event.frames[0]!.contextId;
      const modeContexts = contexts.get(episode.mode) ?? new Set<string>();
      modeContexts.add(contextId); contexts.set(episode.mode, modeContexts);
      const halfContextKey = `${episode.half}:${episode.mode}`;
      const perHalf = halfContexts.get(halfContextKey) ?? new Set<string>();
      perHalf.add(contextId); halfContexts.set(halfContextKey, perHalf);
      if (episode.episode < 127) {
        assert(result.receipt.status === 'initialization-buffer' && result.receipt.writes === 0
          && result.receipt.buffered === episode.episode + 1 && result.receipt.mapSha256 === null,
        `guided-initialization-boundary-violated:${episode.episode}`);
      } else if (episode.episode === 127) {
        assert(result.receipt.status === 'real-event-deposited' && result.receipt.writes === 128
          && result.receipt.buffered === 0 && result.receipt.mapSha256,
        'guided-first-128-did-not-calibrate-once');
        statusAfter128 = await compute.call<MemoryStatusLiveV1>('status');
        assert(statusAfter128.ready && statusAfter128.writes === 128
          && statusAfter128.bufferedEvents === 0 && statusAfter128.mapSha256,
        'guided-memory-not-ready-at-exact-128-boundary');
      } else {
        assert(statusAfter128?.mapSha256 && result.receipt.status === 'real-event-deposited'
          && result.receipt.representationRejection === null
          && result.receipt.writes === episode.episode + 1
          && result.receipt.mapSha256 === statusAfter128.mapSha256,
        `guided-consolidation-changed-or-missed-frozen-map:${episode.episode}`);
      }
      const entry = { version: 'MinecraftMultilevelGuidedTrainingTimelineEntryLiveV1', episode,
        resetBeforeEpisode: true, completedActionCount: 1, action: result.action, scope: result.scope,
        eventId: result.event.id, observationWindow: [result.event.frames[0]!.sequence,
          result.event.frames.at(-1)!.sequence], contextId, receipt: result.receipt,
        changes: eventRows(result.event).changes.flat(), fullSolutionDisclosed: false };
      timeline.push(entry); record('multilevel-guided-training-event', entry);
    }
    assert(statusAfter128?.mapSha256, 'guided-missing-128-boundary-status');
    assert(completedActions === 256 && resetsBeforeEpisodes === 256 && timeline.length === 256,
      'guided-training-action-reset-or-timeline-cardinality');
    for (const mode of MINECRAFT_MULTILEVEL_GUIDED_TRAINING_MODES_LIVE_V1) {
      assert(modeCounts[mode] === 16, `guided-mode-count-not-16:${mode}`);
      assert((contexts.get(mode)?.size ?? 0) >= 8, `guided-mode-public-contexts-below-eight:${mode}`);
      for (const half of ['first-128-calibration', 'second-128-consolidation'] as const)
        assert((halfContexts.get(`${half}:${mode}`)?.size ?? 0) >= 8,
          `guided-mode-half-public-contexts-below-eight:${half}:${mode}`);
    }
    const statusAfter256 = await compute.call<MemoryStatusLiveV1>('status');
    assert(statusAfter256.ready && statusAfter256.writes === 256
      && statusAfter256.bufferedEvents === 0
      && statusAfter256.mapSha256 === statusAfter128.mapSha256,
    'guided-256-consolidation-status-invalid');
    const frozen = await compute.call<MemorySnapshot>('snapshot');
    const identity = frozenMultilevelExperienceIdentityLiveV1(frozen);
    assert(identity.mapSha256 === statusAfter128.mapSha256,
      'guided-frozen-snapshot-map-identity-mismatch');

    const timelinePath = resolve(evidence, MULTILEVEL_GUIDED_TRAINING_TIMELINE_FILENAME_V1);
    const frozenPath = resolve(evidence, FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1);
    // The immutable content identity exists before any later read-only qualification can begin.
    const frozenSnapshotSha256 = identity.snapshotSha256;
    await saveJson(timelinePath, timeline);
    await saveJson(frozenPath, frozen);
    const [timelineFileSha256, frozenFileSha256] = await Promise.all([
      fileSha(timelinePath), fileSha(frozenPath),
    ]);
    const result: MinecraftMultilevelGuidedTrainingLiveResultV1 = {
      version: 'MinecraftMultilevelGuidedTrainingLiveResultV1', servicesStartedWith: 'empty',
      latchVerification,
      training: { realEvents: 256, completedActions: 256, resetsBeforeEpisodes: 256,
        modeCounts, contextCountsByMode: Object.fromEntries([...contexts]
          .map(([mode, ids]) => [mode, ids.size])), statusAfter128, statusAfter256,
        mapSha256After128: statusAfter128.mapSha256,
        mapSha256After256: statusAfter256.mapSha256!,
        productionR2ARelationIdsByCoreCue: identity.productionR2ARelationIdsByCoreCue },
      artifacts: { planSha256: identity.trainingPlanSha256,
        timelineFile: MULTILEVEL_GUIDED_TRAINING_TIMELINE_FILENAME_V1, timelineFileSha256,
        frozenFile: FROZEN_MULTILEVEL_EXPERIENCE_FILENAME_V1,
        frozenSnapshotSha256, frozenFileSha256, qualificationExecuted: false },
    };
    await saveJson(resolve(evidence, 'MULTILEVEL_GUIDED_TRAINING_RESULT.json'), result);
    return result;
  } finally {
    await body?.close(); await compute.close(); await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)),
      new Promise<void>(done => frames.end(done))]);
  }
}

export interface MinecraftMultilevelGuidedLatchDiagnosticLiveV1 {
  readonly version: 'MinecraftMultilevelGuidedLatchDiagnosticLiveV1';
  readonly commandBlockFree: true;
  readonly learningWrites: 0;
  readonly wired: {
    readonly actionExecuted: true;
    readonly publicDoorBefore: false;
    readonly publicDoorAtEventEnd: true;
    readonly publicDoorAfter200Ticks: true;
    readonly eventDoorTransitionObserved: true;
    readonly eventWindow: readonly [number, number];
    readonly componentsAfter200Ticks: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  };
  readonly disconnected: {
    readonly actionExecuted: true;
    readonly publicDoorBefore: false;
    readonly publicDoorAtEventEnd: false;
    readonly publicDoorAfter200Ticks: false;
    readonly eventDoorTransitionObserved: false;
    readonly eventWindow: readonly [number, number];
  };
}

/**
 * A bounded real-body fixture diagnostic.  It exercises only the vanilla
 * latch and its disconnected control, never starts Compute and therefore
 * cannot deposit an experience.  It exists so a fixture fault can be checked
 * without accidentally launching the 256-episode curriculum.
 */
export async function runMinecraftMultilevelGuidedLatchDiagnosticLiveV1(
  config: Configuration,
  evidence: string,
): Promise<MinecraftMultilevelGuidedLatchDiagnosticLiveV1> {
  await mkdir(evidence, { recursive: true });
  const events = createWriteStream(resolve(evidence, 'events.jsonl'), { flags: 'wx' });
  const frames = createWriteStream(resolve(evidence, 'frames.jsonl'), { flags: 'wx' });
  const record = (kind: string, value: unknown) => (kind === 'frame' ? frames : events)
    .write(canonical({ kind, value }) + '\n');
  const services = new Services(config,
    resolve(config.runtimeRoot, `multilevel-guided-latch-diagnostic-${Date.now()}`), evidence);
  let body: MinecraftBody | null = null;
  try {
    await services.start('empty');
    body = new MinecraftBody({ ...config.minecraft,
      worldId: 'multilevel-guided-latch-diagnostic-v1' }, record);
    await body.ready();
    applyMinecraftFixtureCommandBatchLiveV1(services,
      minecraftMultilevelGuidedGlobalCommandsLiveV1());
    await body.waitTicks(60);
    const plan = minecraftMultilevelGuidedTrainingPlanLiveV1();
    const wiredEpisode = plan.find(value =>
      value.mode === 'interact-wired-button-opens-iron-door')!;
    const wiredFixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(services, body, wiredEpisode,
      'latch-verification-before-action');
    const wiredBefore = objectAt(wiredFixture.observation, wiredFixture.doorId!);
    const wiredExecution = await body.execute(
      materializeMinecraftMultilevelGuidedActionLiveV1(wiredEpisode, wiredFixture),
      minecraftMultilevelGuidedActionScopeLiveV1(wiredEpisode, wiredFixture));
    assert(wiredExecution.result.executed && wiredExecution.event,
      'guided-latch-diagnostic-wired-action-failed');
    const wiredEvent = wiredExecution.event;
    const wiredEventDoor = objectAt(wiredEvent.frames.at(-1)!, wiredFixture.doorId!);
    const wiredEventChanged = eventRows(wiredEvent).changes.flat().some(change =>
      change.subject.startsWith('iron_door#') && change.property === 'open'
      && change.before === false && change.after === true);
    await body.waitTicks(200);
    const wiredHeldDoor = objectAt(body.latest(), wiredFixture.doorId!);
    const component = (position: BlockPositionV1, expected: string) => {
      const block = body!.bot.blockAt(new Vec3(...position));
      assert(block?.name === expected, `guided-latch-diagnostic-component-missing:${expected}`);
      return block.getProperties() as Readonly<Record<string, unknown>>;
    };
    const componentsAfter200Ticks = {
      dropper: component(wiredFixture.geometry.dropper, 'dropper'),
      container: component(wiredFixture.geometry.container, 'barrel'),
      comparator: component(wiredFixture.geometry.comparator, 'comparator'),
      wire: component(positionAt(wiredEpisode.layout, 0, 7), 'redstone_wire'),
      repeater: component(wiredFixture.geometry.repeater, 'repeater'),
      door: component(wiredFixture.geometry.doorLower, 'iron_door'),
    };

    const disconnectedEpisode = plan.find(value =>
      value.mode === 'interact-visible-disconnected-button-no-door-change')!;
    const disconnectedFixture = await prepareMinecraftMultilevelGuidedFixtureLiveV1(services, body, disconnectedEpisode,
      'latch-verification-before-action');
    const disconnectedBefore = objectAt(disconnectedFixture.observation,
      disconnectedFixture.doorId!);
    const disconnectedExecution = await body.execute(
      materializeMinecraftMultilevelGuidedActionLiveV1(disconnectedEpisode, disconnectedFixture),
      minecraftMultilevelGuidedActionScopeLiveV1(disconnectedEpisode, disconnectedFixture));
    assert(disconnectedExecution.result.executed && disconnectedExecution.event,
      'guided-latch-diagnostic-disconnected-action-failed');
    const disconnectedEvent = disconnectedExecution.event;
    const disconnectedEventDoor = objectAt(disconnectedEvent.frames.at(-1)!,
      disconnectedFixture.doorId!);
    const disconnectedChanged = eventRows(disconnectedEvent).changes.flat().some(change =>
      change.subject.startsWith('iron_door#') && change.property === 'open'
      && change.before === false && change.after === true);
    await body.waitTicks(200);
    const disconnectedHeldDoor = objectAt(body.latest(), disconnectedFixture.doorId!);

    const actual = {
      version: 'MinecraftMultilevelGuidedLatchDiagnosticLiveV1' as const,
      commandBlockFree: true as const,
      learningWrites: 0 as const,
      wired: { actionExecuted: true as const,
        publicDoorBefore: wiredBefore?.properties.open === true,
        publicDoorAtEventEnd: wiredEventDoor?.properties.open === true,
        publicDoorAfter200Ticks: wiredHeldDoor?.properties.open === true,
        eventDoorTransitionObserved: wiredEventChanged,
        eventWindow: [wiredEvent.frames[0]!.sequence,
          wiredEvent.frames.at(-1)!.sequence] as const,
        componentsAfter200Ticks },
      disconnected: { actionExecuted: true as const,
        publicDoorBefore: disconnectedBefore?.properties.open === true,
        publicDoorAtEventEnd: disconnectedEventDoor?.properties.open === true,
        publicDoorAfter200Ticks: disconnectedHeldDoor?.properties.open === true,
        eventDoorTransitionObserved: disconnectedChanged,
        eventWindow: [disconnectedEvent.frames[0]!.sequence,
          disconnectedEvent.frames.at(-1)!.sequence] as const },
    };
    await saveJson(resolve(evidence, 'LATCH_DIAGNOSTIC_RESULT.json'), actual);
    assert(actual.wired.publicDoorBefore === false
      && actual.wired.publicDoorAtEventEnd === true
      && actual.wired.publicDoorAfter200Ticks === true
      && actual.wired.eventDoorTransitionObserved,
    'guided-latch-diagnostic-wired-public-outcome-failed');
    assert(actual.disconnected.publicDoorBefore === false
      && actual.disconnected.publicDoorAtEventEnd === false
      && actual.disconnected.publicDoorAfter200Ticks === false
      && !actual.disconnected.eventDoorTransitionObserved,
    'guided-latch-diagnostic-disconnected-public-outcome-failed');
    return actual as MinecraftMultilevelGuidedLatchDiagnosticLiveV1;
  } finally {
    await body?.close(); await services.stop();
    await Promise.all([new Promise<void>(done => events.end(done)),
      new Promise<void>(done => frames.end(done))]);
  }
}
