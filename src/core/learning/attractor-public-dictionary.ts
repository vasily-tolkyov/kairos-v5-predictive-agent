import type { PublicChange, PublicValue } from '../../contracts.js';
import { assert, canonical, sha } from '../../util.js';
import type { DistributedAttractorReadoutV1 } from '../physics/distributed-physical-contracts.js';

/**
 * A naming index for a physical terminal readout.  It is deliberately kept
 * outside R1/R2/R2A: the physical substrate decides which basin was reached;
 * this index only reports what a trusted observation said that basin meant.
 */
export interface PublicReadoutSignatureV1 {
  readonly version: 'PublicReadoutSignatureV1';
  readonly signature: string;
  readonly mediumVersion: string;
  readonly coreSiteIds: readonly number[];
  readonly assemblyId: string | null;
  readonly terminalActivationProfile: readonly { readonly siteId: number; readonly meanActivation: number }[];
}

export type AttractorDictionaryStatusV1 =
  | 'observed' | 'provisionally-mapped' | 'stable' | 'ambiguous' | 'retired';

export interface AttractorDictionaryEntryV1 {
  readonly version: 'AttractorDictionaryEntryV1';
  readonly entryId: string;
  readonly physicalSignature: PublicReadoutSignatureV1;
  readonly publicEvent: readonly PublicChange[];
  readonly sourceEventIds: readonly string[];
  readonly contextIds: readonly string[];
  readonly supportCount: number;
  readonly contradictionCount: number;
  readonly status: AttractorDictionaryStatusV1;
  readonly evidenceLevel: DistributedAttractorReadoutV1['evidenceLevel'];
}

export interface AttractorPublicEventDictionaryV1 {
  readonly version: 'AttractorPublicEventDictionaryV1';
  readonly mediumVersion: string;
  readonly entries: readonly AttractorDictionaryEntryV1[];
  readonly snapshotSha256: string;
}

export interface TrustedAttractorPublicObservationV1 {
  readonly source: 'trusted-real-event';
  readonly sourceEventId: string;
  readonly contextId: string;
  readonly mediumVersion: string;
  readonly readout: DistributedAttractorReadoutV1;
  readonly publicEvent: readonly PublicChange[];
}

export interface AttractorDictionaryResolutionV1 {
  readonly version: 'AttractorDictionaryResolutionV1';
  readonly status: 'resolved' | 'unknown' | 'ambiguous';
  readonly signature: PublicReadoutSignatureV1;
  readonly publicEvent: readonly PublicChange[];
  readonly entryIds: readonly string[];
  readonly unknown: readonly string[];
}

function rounded(value: number): number {
  assert(Number.isFinite(value), 'attractor-dictionary-non-finite-readout');
  return Number(value.toFixed(9));
}

function normalizeChanges(changes: readonly PublicChange[]): readonly PublicChange[] {
  return changes.map(change => ({ ...change })).sort((left, right) =>
    `${left.subject}\u001f${left.property}\u001f${canonical(left.before)}\u001f${canonical(left.after)}`
      .localeCompare(`${right.subject}\u001f${right.property}\u001f${canonical(right.before)}\u001f${canonical(right.after)}`, 'en'));
}

function eventKey(changes: readonly PublicChange[]): string {
  return canonical(normalizeChanges(changes).map(change => ({
    subject: change.subject, property: change.property,
    before: change.before as PublicValue, after: change.after as PublicValue,
  })));
}

export function publicReadoutSignatureV1(mediumVersion: string,
  readout: DistributedAttractorReadoutV1): PublicReadoutSignatureV1 {
  assert(mediumVersion.length > 0, 'attractor-dictionary-medium-version-empty');
  assert(readout.version === 'DistributedAttractorReadoutV1',
    'attractor-dictionary-readout-version-invalid');
  assert(readout.coreSiteIds.length > 0 && readout.coreSiteIds.every(Number.isSafeInteger),
    'attractor-dictionary-readout-has-no-core');
  const coreSiteIds = [...new Set(readout.coreSiteIds)].sort((a, b) => a - b);
  const terminalActivationProfile = (readout.terminalActivations ?? [])
    .map(value => ({ siteId: value.siteId, meanActivation: rounded(value.meanActivation) }))
    .sort((a, b) => a.siteId - b.siteId);
  const assemblyId = readout.coactivationAssemblyId ?? null;
  const identity = { version: 'PublicReadoutSignatureV1' as const, mediumVersion, coreSiteIds,
    assemblyId, terminalActivationProfile };
  return { ...identity, signature: sha(identity) };
}

function entryStatus(support: number, contradictions: number, contexts: number): AttractorDictionaryStatusV1 {
  if (contradictions > 0) return 'ambiguous';
  if (support >= 8 && contexts >= 4) return 'stable';
  return support >= 2 ? 'provisionally-mapped' : 'observed';
}

function copyEntry(entry: AttractorDictionaryEntryV1): AttractorDictionaryEntryV1 {
  return structuredClone(entry);
}

export class AttractorPublicEventDictionaryStoreV1 {
  readonly #mediumVersion: string;
  readonly #entries = new Map<string, AttractorDictionaryEntryV1>();
  readonly #sources = new Set<string>();

  constructor(mediumVersion: string, snapshot?: AttractorPublicEventDictionaryV1) {
    assert(mediumVersion.length > 0, 'attractor-dictionary-medium-version-empty');
    this.#mediumVersion = mediumVersion;
    if (snapshot !== undefined) {
      assert(snapshot.version === 'AttractorPublicEventDictionaryV1'
        && snapshot.mediumVersion === mediumVersion
        && snapshot.snapshotSha256 === sha({ version: snapshot.version,
          mediumVersion: snapshot.mediumVersion, entries: snapshot.entries }),
        'attractor-dictionary-snapshot-invalid');
      for (const entry of snapshot.entries) {
        assert(entry.version === 'AttractorDictionaryEntryV1'
          && entry.physicalSignature.signature === sha({
            version: entry.physicalSignature.version,
            mediumVersion: entry.physicalSignature.mediumVersion,
            coreSiteIds: entry.physicalSignature.coreSiteIds,
            assemblyId: entry.physicalSignature.assemblyId,
            terminalActivationProfile: entry.physicalSignature.terminalActivationProfile,
          }), 'attractor-dictionary-signature-invalid');
        assert(!this.#entries.has(entry.entryId), 'attractor-dictionary-duplicate-entry');
        this.#entries.set(entry.entryId, copyEntry(entry));
        for (const source of entry.sourceEventIds) this.#sources.add(source);
      }
    }
  }

  observe(value: TrustedAttractorPublicObservationV1): AttractorDictionaryEntryV1 {
    assert(value.source === 'trusted-real-event' && value.sourceEventId.length > 0
      && value.contextId.length > 0, 'attractor-dictionary-source-not-trusted');
    assert(value.mediumVersion === this.#mediumVersion, 'attractor-dictionary-medium-mismatch');
    assert(value.readout.evidenceLevel !== 'none' && !value.readout.ambiguous,
      'attractor-dictionary-readout-not-usable');
    if (this.#sources.has(value.sourceEventId)) {
      const existing = [...this.#entries.values()].find(entry => entry.sourceEventIds.includes(value.sourceEventId));
      assert(existing, 'attractor-dictionary-source-index-corrupt');
      return copyEntry(existing);
    }
    const signature = publicReadoutSignatureV1(value.mediumVersion, value.readout);
    const normalizedEvent = normalizeChanges(value.publicEvent);
    const identity = sha({ version: 'AttractorDictionaryEntryV1', signature: signature.signature,
      publicEvent: normalizedEvent.map(change => ({ subject: change.subject, property: change.property,
        before: change.before, after: change.after })) });
    const matching = [...this.#entries.values()].filter(entry => entry.physicalSignature.signature === signature.signature);
    const conflicting = matching.filter(entry => eventKey(entry.publicEvent) !== eventKey(normalizedEvent));
    const current = matching.find(entry => eventKey(entry.publicEvent) === eventKey(normalizedEvent));
    const support = (current?.supportCount ?? 0) + 1;
    const contradictionCount = (current?.contradictionCount ?? 0) + conflicting.length;
    const sourceEventIds = [...new Set([...(current?.sourceEventIds ?? []), value.sourceEventId])]
      .sort((a, b) => a.localeCompare(b, 'en'));
    const contextIds = [...new Set([...(current?.contextIds ?? []), value.contextId])]
      .sort((a, b) => a.localeCompare(b, 'en'));
    const entry: AttractorDictionaryEntryV1 = {
      version: 'AttractorDictionaryEntryV1', entryId: current?.entryId ?? identity,
      physicalSignature: signature, publicEvent: normalizedEvent,
      sourceEventIds, contextIds, supportCount: support, contradictionCount,
      status: conflicting.length > 0 ? 'ambiguous' : entryStatus(support, contradictionCount, contextIds.length),
      evidenceLevel: value.readout.evidenceLevel,
    };
    if (current) this.#entries.set(current.entryId, entry);
    else this.#entries.set(entry.entryId, entry);
    this.#sources.add(value.sourceEventId);
    if (conflicting.length > 0) {
      for (const other of conflicting) this.#entries.set(other.entryId,
        { ...other, contradictionCount: other.contradictionCount + 1, status: 'ambiguous' });
    }
    return copyEntry(entry);
  }

  resolve(mediumVersion: string, readout: DistributedAttractorReadoutV1): AttractorDictionaryResolutionV1 {
    const signature = publicReadoutSignatureV1(mediumVersion, readout);
    const entries = [...this.#entries.values()].filter(entry =>
      entry.physicalSignature.signature === signature.signature && entry.status !== 'retired');
    if (entries.length === 0) return { version: 'AttractorDictionaryResolutionV1', status: 'unknown',
      signature, publicEvent: [], entryIds: [], unknown: ['physical-attractor-signature-not-observed'] };
    if (entries.some(entry => entry.status === 'ambiguous') || new Set(entries.map(entry => eventKey(entry.publicEvent))).size > 1)
      return { version: 'AttractorDictionaryResolutionV1', status: 'ambiguous', signature, publicEvent: [],
        entryIds: entries.map(entry => entry.entryId).sort(), unknown: ['physical-attractor-has-conflicting-public-observations'] };
    const entry = entries[0]!;
    return { version: 'AttractorDictionaryResolutionV1', status: 'resolved', signature,
      publicEvent: structuredClone(entry.publicEvent), entryIds: [entry.entryId], unknown: [] };
  }

  snapshot(): AttractorPublicEventDictionaryV1 {
    const entries = [...this.#entries.values()].sort((a, b) => a.entryId.localeCompare(b.entryId, 'en'))
      .map(copyEntry);
    const body = { version: 'AttractorPublicEventDictionaryV1' as const,
      mediumVersion: this.#mediumVersion, entries };
    return { ...body, snapshotSha256: sha(body) };
  }
}
