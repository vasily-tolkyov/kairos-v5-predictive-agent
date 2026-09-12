# Peaceful causal-task probe

Added after the peaceful held-out locomotion pair. Actor: peaceful-r3.
Initialize an empty-experience peaceful survival enclosure with seed 842193705,
wall depth 2, half width 3, start x 0.5, oak planks. Initialization uses no agent
actions. Save/archive the start before online exploration.

The only external goal is z < -4.2. No action names, stage order, recipe, route
or hidden engine identity enters policy. Static native bedrock floor/roof/walls
and a two-layer, two-high plank barrier make passage dependent on actual block
changes. The apparatus contains no rule callbacks or scripted successful actions.

Probe up to 512 decisions / 1200 seconds with learning enabled, then audit
original windows and saved block states. Record curiosity and hypothetical chains
separately from supported plans. Clearing the barrier by curiosity may demonstrate
physical task execution but does not establish learned causal planning. A later
transfer probe uses the learned model in a new enclosure geometry. The scene is
bounded and known to the evaluator, not evidence of unrestricted open-world skill.

This probe may run concurrently with natural-world online learning after the
sequential matched controls. Wall-clock throughput in overlapping runs is not a
matched performance comparison. Monitor host memory; preserve checkpoints if an
apparatus pause becomes necessary. No subagents or custom workflow runtimes.

## Same-world continuation after the first bounded run

The first run stopped at 512 decisions / 2070 learned windows, 1120.999 seconds,
with no deaths and goal pending. Its independent archived-world audit found five
removed planks, five items in the saved inventory and an opening through the
first layer at x=2, y=64..65. The second layer still blocks the terminal exit.
27 break attempts were exploratory; no supported plan was recorded.

Continue that exact stopped world and model for up to 512 more decisions / 1200
seconds. Keep the original goal and all counters. R4 adds only copied goal
definitions and baseline frame numbers to evidence; it changes no learning,
planning, motor or task-generation policy. Its immutable freeze SHA256 is
bb7b384d620878aae9eb70f64418c1bf7d43c6269984ddbead75a5055e92f9a8.
Do not stop immediately at task success, so subsequent self-generated intentions
can also be recorded. No reset, teleport, new objects or solution is introduced.
