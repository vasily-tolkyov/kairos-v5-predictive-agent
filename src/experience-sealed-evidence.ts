import type { RealEvent } from './contracts.js';
import { validateEvent } from './events.js';
import { sealRealObservation } from './experience-live-state.js';
import { sha } from './util.js';
import { freezeEvidenceData } from './immutable-evidence.js';

const SEALED_EVENTS = new WeakMap<RealEvent, string>();

/** Cache only an original event that has passed validation and whose entire
 * reachable data has been frozen. Event IDs and caller-frozen outer shells
 * alone never qualify. Mutable or cloned events retain full digest checking. */
export function sealRealEvent(event: RealEvent): string {
  const previous = SEALED_EVENTS.get(event); if (previous) return previous;
  validateEvent(event);
  for (const frame of event.frames) sealRealObservation(frame);
  freezeEvidenceData(event);
  const digest = sha(event); SEALED_EVENTS.set(event, digest); return digest;
}

export function actualEventDigest(event: RealEvent): string {
  return SEALED_EVENTS.get(event) ?? sha(event);
}
