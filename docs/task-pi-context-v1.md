# Task-based Pi context V1

One frozen 4B / 8K backend and one Pi 0.84.2 `Agent`. `set_intent` is an incremental model-note update. The root goal starts in `orient`; only explicit model updates choose `recall`, `plan`, `act`, `explore`, or `review`. The same seven tools remain available in every mode. Neither this module nor the harness generates or completes a subgoal.

`CognitiveWorkspaceV1` holds goal-local tasks and immutable `CognitiveEvidenceV1` records. `read_context(reference)` reads exactly one task or evidence reference from this goal. Observation, historical experience, stochastic prediction, actual action return and attention notification are different evidence kinds. A model conclusion cannot replace any of them. Workspaces are saved with the existing runtime snapshots, not restored as executable actions.

Context uses the actual llama.cpp template and tokenizer, including tool schemas. The hard input limit is 6500, context 8192, output 768. Relevant references, the current public frame, original goal/current question, latest complete tool return and pending notices are protected. Old complete tool groups are removed only if the real budget requires it. A mandatory-material overflow is an error, not a truncated goal or another model call.

Short object aliases are goal-local and exact. `positionFRU` means horizontal-body front, right, world-up in blocks; positive relative yaw is left, positive pitch is up. These are presentation-only coordinates. Physical event encoding is unchanged. Actions have discriminated, explicit parameters; an empty look is invalid. Text assumptions are labelled `未模拟的假设`.

The attention producer is **not** qualified by these changes. Only delivery of its complete notification into the workspace/Pi and cancellation of unexecuted chain tails is in scope. Context/display/notes have no writer API. The existing trusted actual-event path remains the only physical observation source.

## Bounded validation

From `D:\Kairos_V5_Predictive_Agent`:

```
node node_modules/typescript/bin/tsc -p tsconfig.json
node --test dist/test/analysis.test.js dist/test/cognitive-workspace.test.js dist/test/runtime-context.test.js dist/test/analysis-harness.test.js
node dist/src/analysis-harness.js
```

The last command freezes 12 independent questions (two per mode) and three continuity situations, then uses the real frozen Qwen/Pi with explicitly synthetic tool responses over a sealed public scene. Each case has a test-driver-only 12-request ceiling. A failed result is preserved, not retried or repaired by a planner. This demonstrates task-interface behavior, never physical capability.

Only all 15 raw cases passing the post-hoc scorer under the same source/prompt/schema identity permits:

```
node dist/src/main.js --short
```

This reuses the normal runtime/body/services, with a 20-request evaluator ceiling and a new disposable world; it does not initialize 128 experiences or open an old formal set. The viewer is read-only. The sole short run is stored under `evidence/analysis-harness-v1/short-loop-001`; a failed prerequisite prevents service startup.

## Current delivered result (2026-08-28)

The engineering subset passed 22/22. The completed real-Qwen qualification did **not** pass: 2/15 composite cases after a raw-output scoring audit. `qualification-003` is preserved, including the initially incorrect scores. Only the scorer and its regression tests changed after that inference run; no prompts, tool fixtures, modes or production inference were retuned afterward. `REVIEWED_SCORES.json` records both versions and the source-identity difference.

Do **not** rerun the model harness or start Minecraft on the basis of these results. The short-loop gate is closed. Three cases exhausted their 12-request ceiling, and other cases misreported current facts, failed to use the chosen modes, or did not process the delivered notice. An additional no-effect case has a test-fixture target-error limitation, not a demonstrated physical failure. See `evidence/analysis-harness-v1/REPORT.md`.

Independent read-only rescoring (after building; no model/server/world startup):

```powershell
$code = @'
import {readFile} from 'node:fs/promises';
import {CASES, scoreCase} from './dist/src/analysis-harness.js';
for (const spec of CASES) {
  const result = JSON.parse(await readFile(`evidence/analysis-harness-v1/qualification-003/${spec.id}/RESULT.json`, 'utf8'));
  console.log(JSON.stringify({id: spec.id, ...scoreCase(spec, result)}));
}
'@
$code | & D:\nodejs\node.exe --input-type=module
```
