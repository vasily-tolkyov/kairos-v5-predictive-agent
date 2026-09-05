# Kairos V5 Hierarchical Physical-Control Agent

This branch has no LLM or Pi analysis core. Its production memory path is the
new hierarchy below; the former `PhysicalMemory`/`PathProjector` R2 and old R2A
checkpoints remain in the repository only so historical evidence can be read.

```text
complete real action/passive window
        ↓
R1 — one discrete experience atom and its internal physical trace
        ↓ real public continuity only
R2 — one ordered road made from two or more R1 atoms
        ↓ repeated independent roads, prospective validation and contrasts
R2A — stable ordered patterns, opaque factors and graded evidence
        ↓ current public perception only
R3 — transient applicability query
        ↓
joint operation × branch control field → one real body action
```

## Memory semantics

- Minecraft world coordinates, R1 coordinates, R2 coordinates and R2A
  coordinates are distinct types and are never converted into one another.
- R1 is written after a complete trusted real observation window. A censored
  event remains auditable but cannot support effect recall.
- R2 is not written per action. It is committed atomically only when a real
  continuous process containing at least two R1 atoms closes. Reset, gap,
  disconnect or external takeover breaks the road; an isolated atom remains
  only in R1.
- A first R2 road is only evidence. R2A creates a weak pattern after repeated
  independent roads and reaches `predictive-stable` only after at least eight
  complete events across four public contexts with prospective validation.
- Result factors are discovered only between comparable ordered prefixes with
  the same exact next action and registered competing suffixes. Nearby R2
  points alone do not imply the same result or a cause.
- `predictive-stable` supports prediction and reversible low-risk exploration.
  Only matched, preregistered real interventions can reach
  `intervention-supported`, the grade used for high-confidence goal action.
- R3, PredictionClone, control fields, attention and viewers are read-only.
  Only complete real body/passive events update long-term memory.

## Control semantics

`ControlWorkspaceV2` retains a dependency graph while
`JointTransientControlFieldV2` lets all eligible `operation × branch` sites
compete together. The dispatcher has no scripted sequence such as “recall,
then compare, then predict”. A changed observation invalidates stale current
conditions and predictions; no convergence remains `unknown`.

The physical reasoning interface separates atomic effects from continuous
patterns: `recallAtomicEffect`, `recallContinuousPattern`,
`compareCurrentFactors`, `predictContinuation`, and
`recallFactorTransition`.

## Checkpoints and migration

The current protocol identities are kept in one source registry and are
intentionally exact:

| Component | Canonical version |
| --- | --- |
| Runtime pointer | `KairosV5DistributedPhysicalRuntimeV1` |
| Memory snapshot | `KairosV5DistributedPhysicalMemoryV3` |
| Memory semantics | `distributed-R1-attractor_R2-site-fibre-continuity_R2A-physical-branch-field_R3-transient-current-input` |
| Public context | `V5PublicRelativeLayoutV1` |
| Configuration | `KairosV5PhysicalControlConfigV2` |

The default writable checkpoint remains `KairosV5DistributedPhysicalMemoryV3`.
An explicitly enabled timescale run may use the additive
`KairosV5DistributedPhysicalMemoryV4` bundle, whose pointer names the exact
timescale-law identity. V3 and V4 writers reject cross-version overwrite, and
V4 restore is a separate entry point; ordinary runs never silently upgrade.
Both contain the frozen R1 representation, R1 atoms, the real-continuity
replay ledger, R2 roads, R2A stable-pattern graph and preregistered
intervention ledger. Upper layers are deterministically replayed and checked
on restore.

Old `KairosV5MemoryV4`, `PathProjectorStateV4` and
`CausalFactorGraphStateV3` are not migrated into production. Old Minecraft
evaluation commands are deliberately named `audit:legacy:*`; they cannot be
used as evidence for this hierarchy.

## Engineering update (2026-09)

The PLAN-001 repair set is present in this checkout and has been reviewed as a
single source change set; its final full-suite result remains recorded in the
project log rather than being rerun during the current upgrade. PLAN-002 now
adds revision-scoped read-only substrate reuse and explicit, exact seed-batch
interfaces for measured worker parallelism. The default reasoning path is
unchanged and remains serial (`parallelism=1`). DESIGN-006 temporal-fidelity
and DESIGN-003a capacity probes are additive evaluation tools only; neither
has been run or allowed to write production memory in this upgrade.

The distributed medium's engineering readout is an implementation-level
attractor measurement (terminal residence, return and escape), not by itself
a proof of a REACT mathematical fixed-point anchor. Likewise, control-field
weights are fixed field laws in this protocol; learned meta-representation,
multi-timescale recovery and capacity mechanisms remain later, separately
gated designs.

## Commands

```powershell
npm install --ignore-scripts
npm run build
npm test
npm start -- --bootstrap-only
```

An explicit continuation must use a `KairosV5DistributedPhysicalRuntimeV1`
pointer whose memory payload is `KairosV5DistributedPhysicalMemoryV3`:

```powershell
npm start -- --experience-pointer D:\path\to\EXPERIENCE_LATEST.json
```

The first-person viewer is `http://127.0.0.1:3000/` and the read-only
physical/control dashboard is `http://127.0.0.1:3002/` while a run is active.

## Current evidence boundary

The hierarchy and neutral continuous-event experiments are implemented. The
planned Minecraft `note=2` batch is intentionally not started: its read-only
preflight shows that a categorical note transition changes at least two
one-hot public factors, while the current intervention protocol accepts one
factor only. In addition, eight post-registration events provide four
non-reusable matched pairs, enough to certify at most one factor. The current
classification is `blocked-by-r2a-factor-identification`, not a Minecraft or
body failure. Old reset-style single-action data may populate R1 only and must
never be concatenated into fictitious R2 roads.
