/**
 * RAB-AUTO-04 — same canonical BOQ SOURCE fact, not a lexical AHSP matcher.
 *
 * A person's proven AHSP decision can be inherited only when both BOQ rows
 * refer to exactly one WBS node AND source row code, full work description and
 * output unit agree. Non-identical specifications are not silently narrowed.
 * This never turns two AHSP names into one identity.
 */
export interface BoqSourceFact {
  wbsNodeId: string | null;
  wbsCode: string;
  name: string;
  unit: string;
}
const sourceText = (v: string): string =>
  v.normalize('NFC').replace(/\s+/g, ' ').trim();
export function sameProvenBoqSourceFact(
  a: BoqSourceFact,
  b: BoqSourceFact,
): boolean {
  return Boolean(
    a.wbsNodeId &&
    b.wbsNodeId &&
    a.wbsNodeId === b.wbsNodeId &&
    a.wbsCode.trim() &&
    b.wbsCode.trim() &&
    a.wbsCode === b.wbsCode &&
    sourceText(a.name).length > 0 &&
    sourceText(a.name) === sourceText(b.name) &&
    a.unit.trim().length > 0 &&
    a.unit === b.unit,
  );
}
