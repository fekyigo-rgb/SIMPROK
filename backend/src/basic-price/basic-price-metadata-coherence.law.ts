/**
 * IS THIS BATCH'S METADATA TRUTHFUL ENOUGH TO WRITE A PRICE FROM? — decided
 * ONCE, for both the room that ASKS and the writer that REFUSES.
 *
 * WHY THIS FILE EXISTS. The review room and the private writer were answering
 * the same question with two different amounts of law. The room checked that
 * four facts were PRESENT; the writer additionally checked that the temporal
 * provenance claim was COHERENT — that a date claiming to be derived from a
 * period is a date that derivation actually produces. So a batch could be told
 * "you may review", have thirteen rows resolved by a person, and only then be
 * refused at `Simpan & Gunakan` for metadata it had been holding all along.
 *
 * That is not a bug in either check. Both were right. The defect was that there
 * were two of them, and the softer one guarded the door.
 *
 * So the deciding is here, as PURE FUNCTIONS THAT RETURN A REASON, and the two
 * callers differ only in what they do with it:
 *
 *   the writer   throws a named ConflictException — unchanged codes, unchanged
 *                detail payloads, nothing weakened
 *   the room     reports the same code as a reason a door is shut
 *
 * A rule the API contradicts is not a rule, and a room that opens onto a
 * refusal is describing a product that does not exist.
 *
 * NOTHING HERE IS NEW LAW. Every code below is one the writer already threw.
 * This file moved them; it did not invent, relax or reorder them.
 */

/** The exact facts both the gate and the writer read. Nothing else is consulted. */
export interface BatchProvenanceFacts {
  sourceOrigin: string | null;
  sourceType: string | null;
  /**
   * The date the provenance claim must actually explain. Optional only so
   * callers that genuinely have no date yet can still check the structural
   * half; when it IS supplied, a DERIVED claim is verified against it.
   */
  effectiveDate?: Date | null;
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

export const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim().length === 0;

/**
 * RM-03D1 — THE derivation authority. What a derivation rule actually MEANS.
 *
 * Returns the date the stated derivation produces, or NULL when this authority
 * cannot prove one. NULL means UNVERIFIABLE and every caller must fail closed:
 * an unprovable derivation is not a derivation.
 *
 * Deliberately tiny. Only the locked law is implemented — YEAR + PERIOD_START —
 * because that is the only derivation the evidence and the Owner decision
 * establish. MONTH/QUARTER/END_OF_PERIOD and friends are NOT invented here;
 * when a real source demands one, it arrives with its own decision.
 */
export const YEAR_IN_LABEL = /\b(19|20)\d{2}\b/g;

export function derivedEffectiveDateFor(
  sourcePeriodLabel: string | null,
  sourcePeriodGranularity: string | null,
  effectiveDateDerivationRule: string | null,
): Date | null {
  if (
    sourcePeriodGranularity !== 'YEAR' ||
    effectiveDateDerivationRule !== 'PERIOD_START' ||
    !sourcePeriodLabel
  ) {
    return null;
  }
  // The label is verbatim source text ("TA 2024", "Tahun Anggaran 2024"), so the
  // year is read out of it rather than assumed. Exactly one distinct year must
  // be present: none means there is nothing to derive from, and several means
  // the period is ambiguous — both are unprovable, not "probably fine".
  const years = new Set(sourcePeriodLabel.match(YEAR_IN_LABEL) ?? []);
  if (years.size !== 1) return null;
  const year = Number([...years][0]);
  return new Date(Date.UTC(year, 0, 1));
}

/** Same UTC calendar day? Compared by date, never by instant. */
export function isSameUtcDay(left: Date, right: Date): boolean {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

/**
 * Every way a batch's metadata can be un-writable, as a named code plus the
 * detail the writer already reported with it.
 */
export type MetadataCoherenceIssue =
  | { code: 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE' }
  | { code: 'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE' }
  | { code: 'DERIVATION_RULE_REQUIRES_PROVENANCE' }
  | { code: 'SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE' }
  | { code: 'SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE' }
  | { code: 'DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE' }
  | {
      code: 'DERIVATION_RULE_NOT_PROVABLE';
      sourcePeriodLabel: string | null;
      sourcePeriodGranularity: string | null;
      effectiveDateDerivationRule: string | null;
    }
  | {
      code: 'DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE';
      effectiveDate: string;
      derivedEffectiveDate: string;
      sourcePeriodLabel: string | null;
      sourcePeriodGranularity: string | null;
      effectiveDateDerivationRule: string | null;
    }
  | { code: 'DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED' };

/**
 * RM-03D1 — a private price may never carry an UNSTATED source classification.
 *
 * NO PAIR TEST. An earlier version compared the pair against SOURCE_TYPE_BY_ORIGIN
 * and refused anything that disagreed, which made a real-world combination — a
 * market survey PUBLISHED BY a government agency — unrepresentable. Origin and
 * type are independent axes under Owner law (BASIC-PRICE-MASTER-DECISION §10).
 * What is guarded here is the genuinely UNCERTAIN fact: a source SIMPROK was
 * never told about.
 */
export function sourceClassificationIssue(
  sourceOrigin: string | null,
  sourceType: string | null,
): MetadataCoherenceIssue | null {
  if (!sourceOrigin)
    return { code: 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE' };
  if (!sourceType) return { code: 'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE' };
  return null;
}

/**
 * RM-03D1 — a DERIVED date must be re-derivable, and a stated date must not
 * pretend to have been derived.
 *
 * The database enforces the same shape, and deliberately so: this gives a
 * caller a named reason instead of a constraint violation, while the constraint
 * makes the incoherent row unrepresentable even to a writer that forgets to
 * ask. Whitespace is rejected because `'   '` is not a period label, and a
 * NOT NULL column would happily accept it.
 */
export function temporalProvenanceIssue(
  batch: BatchProvenanceFacts,
): MetadataCoherenceIssue | null {
  const provenance = batch.effectiveDateProvenance;
  if (!provenance) {
    // Unknown provenance stays legal — it reads as "we do not claim", which is
    // honest for anything imported before this distinction existed.
    if (!isBlank(batch.effectiveDateDerivationRule)) {
      return { code: 'DERIVATION_RULE_REQUIRES_PROVENANCE' };
    }
    return null;
  }
  if (provenance === 'DERIVED_FROM_SOURCE_PERIOD') {
    if (isBlank(batch.sourcePeriodLabel)) {
      return { code: 'SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE' };
    }
    if (!batch.sourcePeriodGranularity) {
      return { code: 'SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE' };
    }
    if (isBlank(batch.effectiveDateDerivationRule)) {
      return { code: 'DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE' };
    }
    // STRUCTURE IS NOT TRUTH. The claim must actually produce the date it
    // describes, or it is a well-formed falsehood.
    if (batch.effectiveDate) {
      const derived = derivedEffectiveDateFor(
        batch.sourcePeriodLabel,
        batch.sourcePeriodGranularity,
        batch.effectiveDateDerivationRule,
      );
      if (!derived) {
        return {
          code: 'DERIVATION_RULE_NOT_PROVABLE',
          sourcePeriodLabel: batch.sourcePeriodLabel,
          sourcePeriodGranularity: batch.sourcePeriodGranularity,
          effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
        };
      }
      if (!isSameUtcDay(derived, batch.effectiveDate)) {
        return {
          code: 'DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE',
          effectiveDate: batch.effectiveDate.toISOString().slice(0, 10),
          derivedEffectiveDate: derived.toISOString().slice(0, 10),
          sourcePeriodLabel: batch.sourcePeriodLabel,
          sourcePeriodGranularity: batch.sourcePeriodGranularity,
          effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
        };
      }
    }
    return null;
  }
  // SOURCE_STATED: the source printed the date, so there is no rule to carry.
  // A period LABEL may still be present — a document can truthfully state both
  // "TA 2024" and an exact date — so only the rule is forbidden.
  if (!isBlank(batch.effectiveDateDerivationRule)) {
    return { code: 'DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED' };
  }
  return null;
}

/**
 * THE WHOLE metadata question, in the writer's own order.
 *
 * `null` means the writer would not refuse this batch on metadata grounds. It
 * says nothing about rows, permissions or tenancy — those are different
 * questions with different answers, and folding them in here would let a
 * metadata gate speak for laws it does not own.
 */
export function metadataCoherenceIssue(
  batch: BatchProvenanceFacts,
): MetadataCoherenceIssue | null {
  return (
    sourceClassificationIssue(batch.sourceOrigin, batch.sourceType) ??
    temporalProvenanceIssue(batch)
  );
}
