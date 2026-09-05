# DESIGN-002 runtime measurement ingress

This tranche wires the runtime's measured action outcome into the explicit V4
timescale owner. It does not change the V3 default path and it does not create
another salience store.

## Boundary

After a real event has been committed, the runtime may submit only its event
ID, observation time, and goal residual before/after values. Attention may add
the typed `PredictionViolationMeasurementV1` produced by its physical
comparison. The memory owner resolves all R1/R2/R2A structure identities from
the committed event annotations and physical snapshots; callers cannot choose
a site, trace, support mass, or recovery rate.

The owner accepts the measured values at their observation time, then applies
the existing recovery law. If the measurement time is later than the event's
deposit time, the memory top-level active time advances with the three physical
layers and prediction caches are invalidated. A duplicate runtime measurement
for one event is rejected by the runtime before it reaches the worker.

This tranche covers the trusted measurement boundary; the follow-up now also
consumes V4 passive attention events and connects arousal-derived encoding
gain. Idle replay/homeostasis and the E1-E7 experimental gates remain deferred
DESIGN-002 work. No model, Minecraft, Formal, or long-term evidence run is part
of this change.

## Verification

The focused build and twelve-test set cover the worker bridge, V4 checkpoint
persistence, legacy V3 compatibility, same-time measured forwarding, physical
evidence identity preservation, and rejection of the measurement API on the
default V3 path. The test set passed 12/12 with no skips. Full regression is
intentionally deferred to the next evaluation round.
