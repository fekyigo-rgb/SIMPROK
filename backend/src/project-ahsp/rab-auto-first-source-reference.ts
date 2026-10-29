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
