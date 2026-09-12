# Kairos — Experience-Driven Control Prototype

The next-stage continuing agent is under active evaluation. See
[the engineering record](docs/next-stage-engineering.md) for current changes,
verified tests, native failures and remaining acceptance requirements. This
repository does not yet demonstrate lifelong open-world autonomy.

Kairos forms provisional surface tracks from anonymous sensory samples, learns
from actual sensor/motor windows, chooses exploratory actions, and searches its
learned predictions for measured goals. No Minecraft recipes, supplied action
effects, task solutions, or stored action sequences enter its current learner.

## Perception repair

The Minecraft adapter now supplies a **25 × 19 RGBD array**. RGB values come
from the installed renderer's actual texture atlas; distance comes from the
first physical ray intersection. Engine block names and object IDs remain on
the renderer/actuator side. The learner receives anonymous surface hypotheses.

Spatial continuity and appearance create groups. Temporal registration uses
observer motion and overlapping samples to maintain an anchor. Occluded tracks
remain hypotheses and are excluded from current visible measurements. An
anchor reset changes its coordinate epoch; differences across that reset are
not learned as physical motion. Unbounded surfaces do not supply unsupported
tangential motion measurements. Measured plane displacements also supply
directional constraints: independent views identify a motion vector only when
its information matrix has adequate support. Attention selects the object and
motor response jointly, using measured uncertainty and learned camera changes.

This is an engineered **color/range sensor plus body pose and proprioception**,
not full Minecraft client rendering or a vision-only agent. Entities, lighting,
transparent-material rendering, full HUD reading, and visual odometry are outside
the current sensor. Entity actions cannot be bound to unrendered entities.
The next-stage adapter additionally reads visible hotbar counts and approximate
block-item colors, without item names or hidden inventory slots.

## Learning and planning

- `src/perception.ts`: anonymous grouping, revisable identity, attention, and
  measurement continuity.
- `src/experience-medium.ts`: continuous local receptors and small nonlinear
  populations with learned readouts. Numeric channels compare constant and
  conditional predictions of state or change. Category predictions compare a
  classifier with a nonlinear readout. Selection uses prediction errors
  measured **before** each real learning update.
- `src/experience-agent.ts`: experience-driven exploration and bounded model
  search. It executes the first predicted action, observes its actual outcome,
  and replans. A later sequence of observations must confirm the goal.
- `src/adapters/minecraft/experience.ts`: sensory/actuator boundary; only
  currently sensed, supported target bindings reach the controller.
- `scripts/minecraft-body-connection.mjs`: independent body acquisition and
  network I/O, so model computation cannot suspend the physical connection.

Missing channels mask their measurements instead of discarding the whole
event. Prediction propagates uncertainty from missing inputs; copied unknown
values cannot certify a goal or silently become known future inputs. Object
IDs, world offsets, chronology labels, and goal descriptions do not parameterize
the learned circuits. Numeric receptors do not silently clip values at 16.

These are numerical learning algorithms and a simulated neural representation.
They do not establish biological equivalence or learning in physical hardware.
Confidence gates are engineering estimates, not guarantees or calibrated
success probabilities.

When a goal has no supported plan, the agent can use a learned, low-confidence
hypothesis to select a physical probe. These predictions remain unaccepted and
have no supported fields. Such actions are logged as exploration; only actual
later measurements can establish success. No goal or imagined outcome trains
the medium.

## Evidence and reproduction

See [the perception repair and live assessment](docs/perception-repair-2026-09-10.md)
for the completed runs, unsuccessful iterations, exact scope, and remaining
limitations. Synthetic conditional tasks and live Minecraft results are reported
separately. The earlier failed fixed-layout implementation remains documented
in [the preceding assessment](docs/minecraft-experience-evaluation-2026-09-10.md).

Node.js 24 or later is required:

```sh
npm ci --ignore-scripts
npm run test:experience
npm run test:capabilities -- --output ./evidence/synthetic
npm run minecraft:experience:live -- \
  --java /absolute/path/to/java21 \
  --server /absolute/path/to/server-1.21.4.jar \
  --output ./evidence/new-live-run --training 768 --adaptation 128
```

The live evaluator uses static native fixtures and changes starting conditions
only between episodes. The agent selects the actions. Frozen tests prohibit
learning and exploration fallback; authoritative server queries occur only
after a trial and never train the learner. Optional `--rotate-holdout`,
`--obstacle-challenge`, and `--novel-layout` extend the transfer tests.
`--online-obstacle` adds a separately labeled test with real feedback learning
after the frozen obstacle test, followed by a retention test. All writes, action windows,
goal checks, setup commands, checkpoints, and source hashes are recorded.

To connect to an already configured running server:

```sh
npm run build
npm start -- --output ./evidence/new-exploration --actions 256
npm start -- --output ./evidence/new-goal --actions 12 \
  --restore ./evidence/new-exploration/session.json.gz --goal /absolute/path/goal.json
```

The continuing checkpoint format is `ExperienceSession1`, containing a
`KairosExperienceMediumV10` medium. V9 media can initialize the new session;
older experience and lattice formats are rejected. Original RGBD
windows can be reprocessed with `scripts/reprocess-visual-experience.mjs`;
`scripts/recover-experience-journal.mjs` recovers a matching checkpoint's missing
journal tail without duplicate learning. Neither operation creates new physical
experience. Output files/directories must be new.

## Scope

The prototype has fixed receptor/network capacity, limited sensory resolution,
bounded planning depth, and imperfect identity/geometry estimates. Basic motor
composition does not establish resource crafting, arbitrary language goals,
navigation through unknown terrain, complete object discovery, or lifelong
learning. Generalization claims must be restricted to the tested changes.

Legacy lattice code is retained for explicit historical comparison through
`start:legacy` and `test:capabilities:legacy`. Broad historical test groups include
missing replay assets and an unresolved opt-in legacy G5 integration; they are
not evidence for the new prototype. The obsolete fixed-layout live evaluator
has been removed; Git history retains it.
