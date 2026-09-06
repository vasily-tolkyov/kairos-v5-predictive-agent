import { assert, sha } from './util.js';
import { DistributedHierarchicalPhysicalMemoryV1,
  type KairosV5DistributedPhysicalMemoryV3 } from './distributed-hierarchical-memory.js';
import { AttractorPublicEventDictionaryStoreV1,
  type AttractorPublicEventDictionaryV1 } from './core/learning/attractor-public-dictionary.js';
import { InterventionAgendaStoreV1,
  type InterventionAgendaStateV1 } from './core/learning/intervention-agenda.js';

/** Namespace for the R-series upgrade.  It is intentionally not a memory
 * version: an old V3 checkpoint cannot be mistaken for this wrapper. */
export const KAIROS_V5_R_SERIES_NAMESPACE_V1 = 'V5-RSERIES-V1' as const;
export const KAIROS_V5_R_SERIES_RUNTIME_VERSION_V1 =
  'KairosV5RSeriesRuntimeV1' as const;

function emptyDictionary(): AttractorPublicEventDictionaryV1 {
  return new AttractorPublicEventDictionaryStoreV1('KairosV5-R1-terminal').snapshot();
}
function emptyAgenda(): InterventionAgendaStateV1 {
  return new InterventionAgendaStoreV1().snapshot();
}

export interface KairosV5RSeriesCheckpointV1 {
  readonly version: typeof KAIROS_V5_R_SERIES_RUNTIME_VERSION_V1;
  readonly namespace: typeof KAIROS_V5_R_SERIES_NAMESPACE_V1;
  readonly memory: KairosV5DistributedPhysicalMemoryV3;
  readonly memorySha256: string;
  /** Hashes keep naming and intervention state versioned without duplicating
   * either store in a second persistence format. */
  readonly attractorDictionarySha256: string;
  readonly interventionAgendaSha256: string;
}

/**
 * Small version boundary around the existing physical-memory owner.  It does
 * not create another substrate or copy old coordinates; it only gives the
 * R-series dictionary/agenda a fail-closed checkpoint identity and a single
 * trusted entry point for their real-event APIs.
 */
export class KairosV5RSeriesRuntimeV1 {
  readonly #memory: DistributedHierarchicalPhysicalMemoryV1;
  readonly #namespace = KAIROS_V5_R_SERIES_NAMESPACE_V1;

  constructor(memory = new DistributedHierarchicalPhysicalMemoryV1()) {
    this.#memory = memory;
  }

  get namespace(): typeof KAIROS_V5_R_SERIES_NAMESPACE_V1 { return this.#namespace; }
  get memory(): DistributedHierarchicalPhysicalMemoryV1 { return this.#memory; }

  snapshot(): KairosV5RSeriesCheckpointV1 {
    const memory = this.#memory.snapshot();
    const dictionary = memory.attractorDictionary ?? emptyDictionary();
    const agenda = memory.interventionAgenda ?? emptyAgenda();
    return { version: KAIROS_V5_R_SERIES_RUNTIME_VERSION_V1, namespace: this.#namespace,
      memory, memorySha256: sha(memory),
      attractorDictionarySha256: sha(dictionary),
      interventionAgendaSha256: sha(agenda) };
  }

  static restore(checkpoint: KairosV5RSeriesCheckpointV1): KairosV5RSeriesRuntimeV1 {
    assert(checkpoint.version === KAIROS_V5_R_SERIES_RUNTIME_VERSION_V1
      && checkpoint.namespace === KAIROS_V5_R_SERIES_NAMESPACE_V1,
      'r-series-checkpoint-namespace-invalid');
    assert(sha(checkpoint.memory) === checkpoint.memorySha256,
      'r-series-checkpoint-memory-hash-mismatch');
    const dictionary = checkpoint.memory.attractorDictionary ?? emptyDictionary();
    const agenda = checkpoint.memory.interventionAgenda ?? emptyAgenda();
    assert(sha(dictionary) === checkpoint.attractorDictionarySha256,
      'r-series-checkpoint-dictionary-hash-mismatch');
    assert(sha(agenda) === checkpoint.interventionAgendaSha256,
      'r-series-checkpoint-agenda-hash-mismatch');
    return new KairosV5RSeriesRuntimeV1(DistributedHierarchicalPhysicalMemoryV1.restore(checkpoint.memory));
  }
}

