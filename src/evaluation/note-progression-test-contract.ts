/** Experiment setup / post-hoc scoring only; never imported by the prototype. */
export function counterbalancedNoteStatesV1(base: number, repetition: number, layoutOrdinal: number): readonly number[] {
  if (!Number.isInteger(base) || base < 0 || base > 22
    || !Number.isInteger(repetition) || repetition < 0
    || !Number.isInteger(layoutOrdinal) || layoutOrdinal < 0)
    throw new Error('invalid-counterbalanced-note-capture');
  return (repetition + layoutOrdinal) % 2 === 0 ? [base, base + 1] : [base + 1, base];
}

/** Balanced isolated rehearsal; this order is never passed to the controller. */
export function balancedSingleTransitionStatesV1(
  states: readonly number[], repetition: number, layoutOrdinal: number,
): readonly number[] {
  if (states.length < 2 || new Set(states).size !== states.length
    || states.some(value => !Number.isInteger(value) || value < 0 || value > 23)
    || !Number.isInteger(repetition) || repetition < 0
    || !Number.isInteger(layoutOrdinal) || layoutOrdinal < 0)
    throw new Error('invalid-single-transition-rehearsal');
  const order = (repetition + layoutOrdinal) % 2 === 0 ? [...states] : [...states].reverse();
  const offset = (repetition + layoutOrdinal) % states.length;
  return [...order.slice(offset), ...order.slice(0, offset)];
}

/** The scorer knows the task; the controller receives only the final predicate. */
export function expectedNoteMilestonesV1(initial: number, target: number): readonly { before: string; after: string }[] {
  if (!Number.isInteger(initial) || !Number.isInteger(target) || initial < 0 || target > 24 || target < initial)
    throw new Error('invalid-note-progression-assessment');
  return Array.from({ length: target - initial }, (_, index) => ({
    before: String(initial + index), after: String(initial + index + 1),
  }));
}
