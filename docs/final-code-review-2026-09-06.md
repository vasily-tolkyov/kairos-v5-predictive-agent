# Final code review: prototype/live boundary

## Scope

This review covers the production source tree, the R-series additions and the
Minecraft entry wiring. Historical evaluation modules and evidence remain
available for audit; they are not imported by the environment-neutral
prototype surface.

## Cleanup completed

- Audited the tree with temporary `noUnusedLocals` and `noUnusedParameters`
  checks and removed the unused production helpers, fields, parameters,
  imports and locals they exposed. The flags are not retained in
  `tsconfig.json` because the protected physical-medium file must remain
  byte-exact; its intentional unused local is part of that frozen identity.
  No physical rule, gate, timing law, evidence write, or error path was
  changed.
- Kept fail-closed assertions and the outer original-error propagation. These
  are contract enforcement, not fallback behavior; removing them would allow
  stale physical evidence, invalid snapshots or unsafe actions to continue.
- No automatic retry, silent catch, result fabrication, semantic action rule or
  Minecraft-specific rule was introduced.

## Boundary

- `src/prototype.ts` is the generic public surface for distributed memory,
  R1/R2/R2A readout, PredictionClone, goals and joint control.
- `src/adapters/minecraft/` is the only named live adapter surface for the
  Mineflayer body, server services, live runtime and viewers.
- `src/main.ts` imports live facilities through that adapter boundary.
- `test:prototype` runs every compiled test whose filename is not
  `minecraft-*.test.js`; `test:minecraft` runs only the compiled Minecraft
  files. The complete historical `npm test` command is unchanged.

The prototype boundary test imports `src/prototype.ts` and checks that its
exports contain no Mineflayer, server or viewer dependency.

## Verification

- `npm run build`: passed after the cleanup; the temporary unused-symbol audit
  also passed before its flags were removed from the build configuration.
- Boundary, R-series and runtime-entry tests: 9/9 passed.
- The separated prototype suite completed 487 passed, 2 skipped and one stale
  entry assertion; that assertion was updated to the current explicit fixture
  contract and the affected 9-test set then passed. No Minecraft process or
  real-world test was started by this review.

This cleanup does not claim a new Minecraft capability result. It makes the
generic prototype importable without the live adapter and leaves live testing
as an explicitly selected operation.
