# DESIGN-002 V4 owner/worker seam evidence (2026-09)

## Scope

This tranche is an additive, opt-in seam. It does not switch the Runtime to
the V2 time law, change the V3 checkpoint, or write any production memory.

- `DistributedHierarchicalTimescaleOwnerV1` keeps R1/R2/R2A medium references
  and their V2 clocks aligned.
- `KairosV5DistributedPhysicalMemoryV4` carries the three protocol envelopes
  without changing V3 serialization.
- `Compute`/`worker` expose explicit V4 enable, measured advance, snapshot and
  restore calls. The ordinary Runtime saver remains V3-only.
- Same-time measurements are handled; mid-interval measurements affect only
  the post-observation segment; all layer inputs are validated before mutation.

## Focused verification

Command:

```text
npm run build --silent
node --test dist/test/compute-timescale-v4-bridge.test.js dist/test/distributed-hierarchical-memory-v4-timescale.test.js dist/test/distributed-hierarchical-timescale-owner.test.js
```

Result: build exit `0`; `9/9` focused tests passed, `0` failed, `0` skipped.
The focused test process took approximately `9.06 s`; the worker round trip
used one short-lived Node worker and no external service.
The worker test performed a real V4 snapshot → restore → snapshot round trip.

## V4 bundle persistence seam

The runtime now has separate `saveExperienceBundleV4` and
`restoreExperienceV4` entry points. A V4 pointer carries the exact memory
version and the frozen timescale-law identity; the existing V3 entry points
continue to read and write only V3 snapshots. A directory already owned by
one protocol version rejects a writer from the other version, so an explicit
timescale run cannot silently overwrite a legacy checkpoint. The main runtime
entry point selects V4 only when the pointer declares the V4 version; an
ordinary run remains V3.

Focused persistence verification is in
`test/runtime-v4-timescale-persistence.test.ts`: V4 save/restore and V3/V4
cross-overwrite rejection pass together with the existing habit-persistence
regressions (`6/6`, skipped `0`).

## Boundary and failure classification

- Implementation defects found and fixed: same-time measurement drop,
  cross-layer partial mutation, and retroactive application of a mid-interval
  measurement. Each has a minimal regression test.
- Theory/contract boundary retained: `RuntimeMeasuredSalienceV2` is still a
  staged trusted-runtime seam, not a public authority claim; runtime-private
  construction is required before production migration.
- Deferred: arousal/encoding-gain deposit wiring, replay writer, V4 pointer
  runtime measurement ingress, arousal/encoding-gain deposit wiring, replay
  writer, and E1–E7 re-qualification.

## State and resource boundary

No Minecraft, model service, Formal run, training, or production snapshot was
started. The focused worker test uses empty media only; no durable physical
experience was written. No dependency or protected physics file changed.
