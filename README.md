# Kairos V5 Joint Physical-Control Agent V2

This V5 line has no language-model or Pi analysis core. Its durable physical
experience system remains R1/R2/R2A, while R3 remains a transient condition
query. Current-goal reasoning is performed by one fast-decaying joint field
whose competitors are complete `operation × branch` sites.

## Runtime

```text
public Minecraft observation
        ↓
grounded observable goal → goal difference + persistent dependency graph
        ↓
R1/R2/R2A effect recall ↔ condition comparison ↔ PredictionClone rollout
        ↓
one global operation-by-branch competition
        ↓
one current body action → complete real observation window → physical learning
        ↑
prediction violation / unknown change interrupts the transient branch competition
```

The joint field has no Minecraft rule names. It simultaneously binds opaque
physical evidence, condition state, rollout progress, uncertainty, attention,
novelty and narrow nonsemantic control habits. It acts only after one complete
site persists above both threshold and margin. No convergence means `unknown`;
there is no argmax or staged-order fallback.

`ControlWorkspaceV2` keeps a live dependency graph rather than a parent/child
task stack. A changed observation invalidates stale conditions and predictions;
the surviving graph then re-enters the same competition. The runtime only
passes events, dispatches the winning port operation, and returns its result.

## Current validation status

Publication snapshot: 2026-08-30.

- Clean TypeScript build: passed.
- Complete source test run: **127/127 passed**, 0 skipped.
- Opaque two-step dependency tasks: **32/32** completed the required
  `alpha -> beta -> verification-observe` chain under cue, candidate and offer-order permutations.
- Opaque three-step dependency tasks: **64/64** completed
  `gamma -> alpha -> beta -> verification-observe` while retaining the live dependency graph.
- One frozen Minecraft heldout batch: **4/4 goal-verified** on unseen layouts using the same
  128-event physical baseline and empty control-habit state per case. The observed action chains were
  `look -> interact -> observe`, direct `interact -> observe`, and an attention-interrupted reorientation chain.
- Invalid interactions, stale executions and script-generated subgoals in that batch: **0**.

The Minecraft result demonstrates control over already learned physical affordances; it does not yet
demonstrate autonomous discovery of arbitrary new interactions, unrestricted open-world continual learning,
or human-level general reasoning. New public R2A feature ordinals outside the frozen representation still
require a new representation identity and clean rebuild.

## Boundaries

- Minecraft coordinates are public world facts and never become R1 coordinates.
- A grounded goal can mention only a currently public subject and public observable.
- Historical success is not current support.  R1, R2, and production-eligible R2A evidence must all still survive.
- An exact action cue represented by physical evidence has no duplicate
  exploration site that could bypass its condition or rollout gates.
- Hypothetical states contain only changes actually read from random Clone trajectories; everything else stays unknown.
- Only complete real body or passive-observation events write experience.
- Control fields, attention, queries, predictions, and the dashboard are read-only with respect to physical memory.
- Checkpoints written by the retired language-model runtime are rejected by the new runtime.
- `ControlHabitWeightsV1` stores only operation-pair and graph-relation weights.
  It cannot store Minecraft types, object IDs, action kinds, goals, coordinates
  or result labels, and it cannot make a hard-ineligible site executable.

## Commands

```powershell
npm install --ignore-scripts
npm run build
npm test
npm start -- --bootstrap-only
```

An explicit continuation must use a `KairosV5PhysicalControlRuntimeV1` `EXPERIENCE_LATEST.json` pointer:

```powershell
npm start -- --experience-pointer D:\path\to\EXPERIENCE_LATEST.json
```

The default run creates a new isolated Minecraft world and empty physical
memory. It first explores until 128 complete real events have formed the
one-time event map. The V2 heldout evaluator is separate: it restores a frozen
128-event physical snapshot into independent case workers and starts every case
with zero habit weights. It never retrains the frozen baseline.

The first-person viewer is `http://127.0.0.1:3000/` and the read-only physical/control dashboard is `http://127.0.0.1:3002/` while a run is active.
