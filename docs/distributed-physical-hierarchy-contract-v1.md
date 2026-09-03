# Distributed physical hierarchy contract V1

This contract separates a genuinely distributed physical hierarchy from a
metadata reasoner whose answers are merely enabled by an active trace.

## Governing invariant

Changing the physical field or its learned connections must change the
capability. Changing audit identifiers or deleting the searchable event index
must not change the capability.

R1, R2 and R2A exchange time-varying population activity. They do not exchange
whole-event hashes, result labels, pattern labels, or preselected rules.

## Excitation dynamics

Fast activation is a finite, nonnegative excitation resource. A trusted real
afferent pulse may inject it; recovery and fast dissipation may remove it.
Thermal noise may only redistribute excitation through local six-neighbour
exchanges. It must never create independent activation at every newly reached
lattice site.

For a local pair `(i,j)`, a thermal microproposal jointly changes
`a_i' = a_i - delta` and `a_j' = a_j + delta`. Proposals outside
`0..maximumActivation` are rejected. The proposal is symmetric, the complete
two-site conservative energy difference includes both sites, their mutual
coupling and their unchanged neighbours, and acceptance remains exactly
`min(1, exp(-deltaE / temperature))`.

Learned directed bonds remain outside the scalar potential. They carry a
bounded non-equilibrium flux that removes exactly the amount delivered from
the source population. Thus a learned well can retain excitation that reaches
it, but its depth cannot manufacture excitation in the absence of an input or
a physical path.

This constraint was added before V1 qualification after the independent-site
proposal was falsified: one local query spread its frontier across all `32^3`
sites and spontaneously activated an unconnected remote learned basin. Top-K,
frontier clipping, raised readout thresholds and metadata gates are not valid
substitutes for finite excitation.

## R1 to R2

R1 activity reaches R2 through a persistent sparse projection `P12`:

```text
R2 input[j,t] = sum_i P12[i,j] * phi(R1 activation[i,t])
```

Each individual R1 site acquires a stable sparse fibre projection by local
competition in the R2 lattice. The projection never computes an R2 coordinate
from an R1 coordinate. Actual R1 pulses are projected in their original order.
Local removal of one R1 population may only remove its corresponding R2 input;
it must not replace the whole R2 representation with an unrelated token.

## R2 to R2A

`P2A` follows the same rule for every R2 site. R2A receives the actual R2
prefix and branch propagation, transient pre-branch public-condition
populations, the action efference copy, and the observed result branch.

Patterns and factors are named only after physical readout discovers them.
Membership, applicability and evidence grade must be determined by attractor,
corridor and ablation measurements. Set difference, Jaccard similarity,
whole-sequence hashes and caller-supplied success labels cannot select a
pattern or certify a factor.

## Physical qualifications

A stable attractor needs active depth/support, perturbation return, sufficient
dwell, low escape, repeat support in independent real events, and physical
separation from competitors. Event and context counts are evidence-volume
gates, not substitutes for those measurements.

A stable corridor needs forward propagation, reverse-order rejection, shared
prefix propagation, terminal-branch separation, and degradation when its key
connections are cut.

An intervention record may contain only real baseline/intervention event
references and the actually manipulated public factor. Branch success and
factor-ablation loss are computed from the physical substrate. They are never
accepted from the caller.

## Prediction clone

Every prediction independently injects three physical inputs in time order:

1. current public perception populations;
2. the current real event prefix;
3. the candidate action efference-copy population.

Missing input returns `unknown`. A result exists only when the stochastic field
actually reaches a qualified readout attractor. Metadata may decode a reached
population into a public change, but may not choose the result first.

## Required reverse ablations

- Delete or rename audit IDs: physical behaviour is unchanged.
- Delete the searchable raw-event index after learning: recall and prediction
  remain, while provenance detail becomes unavailable.
- Change an audit success label: behaviour and grade are unchanged.
- Clear a potential well or directed corridor while retaining metadata: the
  corresponding ability disappears.
- Cut one factor-to-branch channel: only that conditional selection disappears.
- Reverse pulse order with identical sites: directed propagation separates it;
  deleting directed connections removes that separation.
- Change only transient R3 condition input: physical branch probability changes.

Until these bidirectional tests pass, the implementation may only claim that a
distributed substrate exists. It may not claim that the rule resides in the
substrate.
