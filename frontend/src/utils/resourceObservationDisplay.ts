/**
 * Human-facing view-model for the shared observed-resource curation surface.
 *
 * SIMPROK preserves a resource it saw but could not prove, shows the candidates
 * it found, and asks a person to decide — existing resource or genuinely new.
 * This module only chooses the words and shapes the options; it never decides
 * identity, never auto-selects a candidate, and never lets an internal code,
 * reason string, or UUID reach the reader.
 */

/** One candidate the identity authority nominated: a name plus its catalogue id. */
export interface ObservationCandidateWire {
  resourceCatalogId: string;
  name: string;
}

/** An open observation, enriched by GET /resource-observations for curation. */
export interface CuratableObservationWire {
  id: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  resourceType?: string | null;
  origin?: string | null;
  status?: string | null;
  candidates?: readonly ObservationCandidateWire[] | null;
  suggestedUnitDefinitionId?: string | null;
}

export interface ObservationCandidateChoice {
  resourceCatalogId: string;
  name: string;
}

export interface ObservationView {
  id: string;
  /** rawName, with the unit as written appended — what the reader recognises. */
  title: string;
  /** Candidate NAMES only, in order, de-duplicated. Never ids. */
  candidateChoices: ObservationCandidateChoice[];
  /** One human sentence naming the candidates, or null when there are none. */
  candidateLine: string | null;
  /** True when the Unit Kernel proved a unit, so "genuinely new" can be offered. */
  canProposeNew: boolean;
  newUnitDefinitionId: string | null;
  /** What the curator should do, in plain language. */
  guidance: string;
}

const trimmedName = (name: string): string => name.trim();

/**
 * Shape one observation for the curator. Candidates keep their catalogue id (so
 * "this is an existing resource" carries the id the mint safety needs) but the
 * reader is only ever shown the name.
 */
export const describeCuratableObservation = (
  observation: CuratableObservationWire,
): ObservationView => {
  const seen = new Set<string>();
  const candidateChoices: ObservationCandidateChoice[] = [];
  for (const candidate of observation.candidates ?? []) {
    const name = trimmedName(candidate?.name ?? '');
    if (name === '' || !candidate?.resourceCatalogId) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    candidateChoices.push({ resourceCatalogId: candidate.resourceCatalogId, name });
  }

  const names = candidateChoices.map((c) => c.name);
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const candidateLine =
    names.length > 0
      ? 'SIMPROK menemukan kemungkinan padanan: ' +
        shown.join(', ') +
        (rest > 0 ? ', dan ' + rest + ' lainnya' : '') +
        '.'
      : null;

  const guidance =
    names.length > 0
      ? 'Pilih padanan yang paling sesuai, atau usulkan sebagai sumber daya baru.'
      : 'SIMPROK belum menemukan padanan yang dapat dipastikan. Anda dapat mengusulkan sumber daya ini sebagai sumber daya baru untuk ditinjau.';

  const unit = (observation.rawUnit ?? '').trim();
  const title =
    unit !== '' ? observation.rawName + ' (' + unit + ')' : observation.rawName;

  return {
    id: observation.id,
    title,
    candidateChoices,
    candidateLine,
    canProposeNew: Boolean(observation.suggestedUnitDefinitionId),
    newUnitDefinitionId: observation.suggestedUnitDefinitionId ?? null,
    guidance,
  };
};

/** Wire shape of a preview work item's resource (from GET /ahsp/document/preview). */
export interface PreviewResourceWire {
  rawName?: string | null;
  group?: string | null;
  resolvedResourceCatalogId?: string | null;
  identityCandidates?: readonly string[] | null;
}

/**
 * The candidate NAMES to show under an unresolved work item in the import
 * preview — the names SIMPROK found for resources it could not yet prove. A
 * resolved resource contributes none. Names only; de-duplicated; never a code.
 */
export const previewCandidateNames = (
  resources: readonly PreviewResourceWire[] | null | undefined,
): string[] => {
  const names: string[] = [];
  for (const resource of resources ?? []) {
    if (resource?.resolvedResourceCatalogId) continue;
    for (const candidate of resource?.identityCandidates ?? []) {
      const name = String(candidate).trim();
      if (name !== '' && !names.includes(name)) names.push(name);
    }
  }
  return names;
};

/**
 * A defensive guard used by tests: reader-facing copy must never leak a UUID or
 * a SCREAMING_SNAKE reason code.
 */
export const looksLikeInternalIdentifier = (text: string): boolean =>
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(text) || /[A-Z]{4,}_[A-Z]/.test(text);
