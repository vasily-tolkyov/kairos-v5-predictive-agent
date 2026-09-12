# Peaceful actuator catch-up calibration

Registered before native execution. Compare the immutable R5 body and the new
R6 body on an empty peaceful bedrock platform. The evaluator selects six
four-tick forward presses per actor: three alternating unloaded/loaded pairs.
The loaded case blocks the Node event loop for 230 ms after the third physical
step, allowing the installed Mineflayer catch-up loop to deliver a synchronous
batch. A prepended SDK listener independently counts the pressed controls
before the body's own release callback. All observed action windows, control
samples, release receipts and server position replies are retained.

The original actor must reproduce an overlong press in at least one loaded
case. The candidate must issue exactly four pressed physical steps in all six
cases. World construction and resetting are evaluator apparatus. These twelve
selected actions are calibration, with zero autonomous trials and zero writes
to any learned model. Jump and held-item timing are also covered by the
synthetic batched-callback regression; they are not claimed as native checks.

This experiment tests the actuator boundary, not whether it explains all of
the earlier retention regression. Historical models and actors remain
unchanged. Legacy jump pulse syntax is outside the modern offered-action
catalogue and retains its historical behavior.
