# Peaceful native evidence, 2026-09-13

This record distinguishes actual Minecraft execution, offline diagnostics,
synthetic tests and engineering hypotheses. Read
[the continuation report](../native-continuation-2026-09-13.md) for results and
limitations. Source branch: `codex/native-continuation-20260913` in
`vasily-tolkyov/kairos-v5-predictive-agent`, draft PR #2. No overall acceptance of
long-term autonomous learning or open causal multistage competence is claimed.

The later [motor timing comparison](motor-catchup-comparison.json) reproduces
and repairs an actuator catch-up defect. Its separate supplementary artifact
contains twelve evaluator-selected calibration actions, with no learner or
autonomous trials. The main package and its source snapshot remain unchanged;
the supplement contains the later R6 actor and diagnosis. The current source
passes 131 integrated checks.

Verified downloads are attached to the repository's
[draft evidence Release](https://github.com/vasily-tolkyov/kairos-v5-predictive-agent/releases/tag/untagged-058e772adc21382f71bc).
[artifact.json](artifact.json) records exact sizes, local SHA256 and matching
GitHub asset digests. Draft access requires the repository owner's access.
The original 2,073,229,124-byte package contains 42,651 verified files; the
2,701,785-byte motor supplement contains 327. Preserve both manifests when
extracting the supplement over the main package.

## What the raw package preserves

- Original reports, model snapshots, decision/receipt journals, active and passive
  sensory windows and engine audit logs for each registered stopped run.
- Exact stopped-world archives, archive proofs, and the checkpoint registry
  binding their hashes to every original world member.
- Immutable compiled actor copies with per-file manifests, protocols, commands,
  audit outputs and failed as well as successful verification logs.
- Current source and inspection/preparation utilities. Actor freeze manifests
  identify experimental code even when the source branch later advances.

`EVIDENCE-MANIFEST.json` records each packaged path, size and SHA256. The sidecar
`*.zip.sha256.json` binds the ZIP itself. Every member is reopened and verified
after packaging. Mutable runtime directories, dependencies and Java/server
binaries are excluded. A live model sample is labelled as such and does not
constitute a stopped-world checkpoint or another physical trial.

The normal-mode R1/R2 failures and isolated entity calibration predate the
peaceful-first experiments. The calibration used one evaluator-selected action;
its data was not added to the learner. The raw traces are retained for diagnosis,
not combined with autonomous peaceful results. Synthetic fixtures likewise add
zero native trials.

## Reproduce a stopped-state audit

Extract the evidence package into its own project directory, preserving relative
paths. Install the locked Node dependencies and build the included source before
running an inspector. The original experiments used Minecraft Java 1.21.4 and
Java 21. A new run needs those separately; the read-only archive audit does not
start Minecraft.

```text
npm ci
npm run build
node scripts/audit-native-continuing.mjs evidence/peaceful-natural-retained-frozen retained-audit.json
node scripts/audit-stopped-minecraft-enclosure.mjs evidence/peaceful-causal-continuation causal-audit.json
node scripts/audit-native-goal-progress.mjs evidence/peaceful-natural-retained-frozen peaceful-heldout-reach-20260913 progress-audit.json
```

Choose new output names. Preserve the original reports, paths and provenance;
an original absolute runtime path is historical metadata and must not be edited
to point at a later world. The inspectors read the verified archived world.

## Relocate a world for a new continuation

The registry provides a portable preparation route without rewriting historical
provenance or modifying model/world bytes:

```text
python scripts/prepare-rescued-native-checkpoint.py --registry docs/native-evidence-2026-09-13/checkpoint-registry.json --evidence-root evidence --run peaceful-natural-initial --output evidence/relocated-initial
```

This operation verifies all identities before creating a new predecessor, performs
zero game actions, and does not count as another unfamiliar world. Use a new
experiment output and an explicitly selected immutable actor when continuing.
The original `--continue` command paths identify the exact predecessor used in
the experiment; equivalent local paths from this preparation are needed after
relocation. `--restore` is different: it transfers experience and clears old-world
task ownership, and must not be substituted for same-world continuation.

No protocol provides an action recipe or prescribed subgoal sequence. Goal
definitions, engine identities, imagined outcomes, audit data and success labels
are not learner training inputs. Counts of learning writes, exploratory block
removal, hypothetical plans and supported predicted causal execution are separate
measurements.

When continuing a custom task, pass its exact existing goal file with `--goal`.
Omitting it is rejected by the current harness before engine startup; historical
actor copies may instead add a default task. See the preserved launch deviation.
The retention protocol separately replaces only learned state in an unused
initial-world copy, preserving all nonlearning fields and world bytes. Its
preparation record is not a new physical trial.

Current harness runs can pin their exact selected input file using
`--expected-session-sha256 HASH`. The bytes are checked before decoding or
starting the game and the actual digest is recorded as `checkpointInput`.
Wait for preparation to finish and verify the world files as well; a model
digest alone cannot protect a concurrently changing world. The immutable R6
harness predates this guard and motor-release journal forwarding. Its isolated
calibration records releases directly, while the later task check relies on
its completed external preflight and exact frozen actor hashes.

The [R6 frozen comparison](retention-r6-comparison.json) is now stopped: 191
actions, zero writes/deaths, unchanged learned digest, goal still pending and
zero supported task plans. Its separate registry includes the valid candidate
and one excluded premature launch. These are two additional stopped entries
of the same initial scene, not two new independent worlds. The R6 retention
package overlays the primary and motor packages and keeps the two main
manifests; preserve or rename an existing root `EVIDENCE-MANIFEST.json` before
extracting a later package with its own manifest.
