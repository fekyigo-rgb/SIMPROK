import { normalizeWorkHeadingForEvidence } from './ahsp-preference';

/**
 * RAB-AUTO-05: proof of an EXPLICIT, approved source reference, not a
 * name-based AHSP matcher. Both identity channels must be independently
 * present: the dedicated BOQ "Kode AHSP" cell and its complete work label.
 * NFC/space/case normalization only; digits, dimensions and punctuation
 * remain significant and are never approximated.
 */
export type BoqFirstSourceReference = Readonly<{
  sourceAhspCode: string | null;
  name: string;
}>;
export type AhspFirstReferenceCandidate = Readonly<{
  code: string | null;
  workType: string;
  methodName: string;
}>;

const exactLabel = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');

export function explicitAhspSourceProof(
  boq: BoqFirstSourceReference,
  ahsp: AhspFirstReferenceCandidate,
): boolean {
  if (
    !boq.sourceAhspCode ||
    !boq.sourceAhspCode.trim() ||
    !boq.name.trim() ||
    !ahsp.code?.trim()
  )
    return false;
  const exactCode =
    boq.sourceAhspCode.trim().toUpperCase() === ahsp.code.trim().toUpperCase();
  const description = exactLabel(boq.name);
  return (
    exactCode &&
    ((ahsp.workType.trim() !== '' &&
      description === exactLabel(ahsp.workType)) ||
      (ahsp.methodName.trim() !== '' &&
        description === exactLabel(ahsp.methodName)))
  );
}


/**
 * Owner-authorized bounded first association for an otherwise uncoded BOQ.
 * This is NOT lexical matching: it admits only identical complete work/method
 * facts after the existing harmless Pek./Pekerjaan heading normalization.
 * The caller must also prove the entire eligible universe, a single candidate,
 * preferred canonical classification, Unit Kernel identity and a current
 * approved BOQ source. The canonical transaction writer repeats these gates.
 */
const fullWorkFact = (raw: string): string =>
  normalizeWorkHeadingForEvidence(raw)
    .replace(/^Pekerjaan\s+/iu, '')
    .toLocaleLowerCase('id-ID');

export function exactUncodedWorkFact(
  boq: { sourceAhspCode: string | null; name: string },
  ahsp: { methodName: string },
): boolean {
  if (boq.sourceAhspCode || !boq.name.trim() || !ahsp.methodName.trim()) {
    return false;
  }
  return Boolean(fullWorkFact(boq.name)) &&
    fullWorkFact(boq.name) === fullWorkFact(ahsp.methodName);
}

/**
 * Project classification MUST be the chosen Kategori/Subkategori, never a
 * cross-category fallback. Unit compatibility has already come from the
 * official Unit Kernel path, and the writer rechecks monetary identity.
 */
export function exactUncodedFirstCandidateProven(
  boq: { sourceAhspCode: string | null; name: string },
  candidate: {
    ahsp: {
      methodName: string;
      methodType?: string;
      locationType?: string;
      keterangan?: string | null;
    };
    uncodedClassificationScopeProven?: boolean;
    outputUnit: string | null;
    _count?: { resources: number };
    preference?: {
      recommended: boolean;
      band: string;
      classificationPath?: string | null;
    } | null;
  },
): boolean {
  return exactUncodedWorkFact(boq, candidate.ahsp) &&
    Boolean(candidate.outputUnit) &&
    (candidate._count?.resources ?? 0) > 0 &&
    candidate.preference?.recommended === true &&
    candidate.uncodedClassificationScopeProven === true &&
    // No separately proven engineering method or site condition on uncoded
    // BOQ: do not silently infer specialized METHOD or LOCATION facts.
    candidate.ahsp.methodType === 'MANUAL' &&
    candidate.ahsp.locationType === 'GENERAL' &&
    // A technical note outside the BOQ title is an unproved source fact,
    // not authority for a silent first binding.
    !candidate.ahsp.keterangan?.trim() &&
    candidate.preference.classificationPath != null &&
    (candidate.preference.band === 'PREFERRED_SUBKATEGORI' ||
      candidate.preference.band === 'PREFERRED_KATEGORI');
}

/** Discovery only: never identity authority on its own. */
export function exactUncodedSearchAnchor(name: string): string {
  return normalizeWorkHeadingForEvidence(name)
    .replace(/^Pekerjaan\s+/iu, '')
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .slice(0, 120)
    .trim();
}
