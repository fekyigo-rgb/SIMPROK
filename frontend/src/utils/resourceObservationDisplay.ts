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

/**
 * Collision-proof separator for the grouping key, the same character and the
 * same reason as the import page's own decision key: a real space would let two
 * different field combinations flatten to one string, and the null character
 * never appears in source text.
 */
const QUESTION_FIELD_SEPARATOR = '\u0000';

/** One question, and every observation that asked it. */
export interface ObservationGroup {
  /** The question itself, shaped exactly as a lone observation would be. */
  view: ObservationView;
  /**
   * Every observation posing this identical question, in first-seen order. The
   * curator answers once; the answer is recorded against each of these, so each
   * keeps its own decision row, its own actor and its own provenance.
   */
  ids: string[];
  /** How many times it was asked. 1 means a lone observation. */
  occurrences: number;
}

/**
 * AUTOMATION BEFORE HUMAN INTERVENTION — the law this page already applies to
 * identical AHSP items, applied to the resources beneath them.
 *
 * One official document quotes "Alat Bantu (Ls)" once per analysis, so a real
 * import can put the SAME question on screen sixty-six times. Answering it
 * sixty-six times is not sixty-six judgments; it is one judgment and sixty-five
 * repetitions, and repetition is machine work. The rows are folded into one
 * question with an honest count.
 *
 * WHAT MAY BE FOLDED IS DELIBERATELY NARROW. Two observations join a group only
 * when EVERY input the decision depends on is identical: the raw name exactly as
 * written, the source code, the unit as written, the resource class, the unit the
 * Unit authority proved, and the exact candidate set the identity authority
 * nominated. Anything less would merge two questions that are not the same
 * question — and a differing candidate set means SIMPROK found different
 * evidence, which is precisely when a human must look twice.
 *
 * The raw name is compared as written rather than case-folded: the reader is
 * shown one spelling, and it must be the spelling the source actually used.
 *
 * NOTHING IS DECIDED HERE. No candidate is selected, no group is answered on the
 * reader's behalf, and a lone observation is still its own group of one.
 */
export const groupIdenticalObservations = (
  observations: readonly CuratableObservationWire[] | null | undefined,
): ObservationGroup[] => {
  const groups: ObservationGroup[] = [];
  const byQuestion = new Map<string, ObservationGroup>();

  for (const observation of observations ?? []) {
    if (!observation?.id) continue;
    const view = describeCuratableObservation(observation);
    // The null character never appears in source text, so no combination of
    // fields can collide with a different combination.
    const question = [
      (observation.rawName ?? '').trim(),
      (observation.rawCode ?? '').trim(),
      (observation.rawUnit ?? '').trim(),
      (observation.resourceType ?? '').trim(),
      observation.suggestedUnitDefinitionId ?? '',
      view.candidateChoices.map((c) => c.resourceCatalogId).join(QUESTION_FIELD_SEPARATOR),
    ].join(QUESTION_FIELD_SEPARATOR);

    const existing = byQuestion.get(question);
    if (existing) {
      existing.ids.push(observation.id);
      existing.occurrences += 1;
      continue;
    }
    const group: ObservationGroup = { view, ids: [observation.id], occurrences: 1 };
    byQuestion.set(question, group);
    groups.push(group);
  }

  return groups;
};

/**
 * How the count is said out loud, or null for a question asked once — where a
 * count would be noise rather than information.
 */
export const observationOccurrenceLine = (group: ObservationGroup): string | null =>
  group.occurrences > 1
    ? 'Ditemukan ' + group.occurrences + ' kali dalam dokumen. Satu keputusan berlaku untuk semuanya.'
    : null;

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
