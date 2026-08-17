/**
 * MINIMAL EXCEPTION UX — per-resource trust status.
 *
 * WHAT THIS IS
 *
 * A presentation adapter. It turns facts the SERVER already decided — the
 * persisted `status` and `reasonCodes` of one ProjectAhspResourceResolution —
 * into the short, calm sentence a human needs in the RAB.
 *
 * WHAT THIS IS EMPHATICALLY NOT
 *
 * It is NOT a second Resource Identity authority. It resolves nothing, ranks
 * nothing, and decides nothing. It never looks at a resource NAME, a candidate
 * COUNT, a spelling, a colour, a previous selection or any browser state — the
 * only inputs it will accept are the two server-authoritative fields above.
 * Every branch below is a translation of a verdict the backend already reached;
 * if the server says nothing recognisable, this says "belum dapat dipastikan"
 * rather than inventing a verdict of its own.
 *
 * THE FOUR STATES, AND WHY THEY ARE EXACTLY FOUR
 *
 *   MACHINE_PROVEN        SIMPROK proved it. Say so quietly, ask nothing.
 *   HUMAN_SETTLED         An authorized recorded human decision applies.
 *                         Deliberately NOT called machine-proven: a governed
 *                         decision is a different authority, and merging the two
 *                         would tell the reader SIMPROK proved something it did
 *                         not.
 *   NEEDS_HUMAN_DECISION  The machine narrowed the question to several
 *                         legitimate possibilities it cannot truthfully
 *                         separate. This is the ONLY state that may ever offer
 *                         a decision interaction.
 *   NOT_PROVABLE          Something is genuinely not yet provable. Say why, in
 *                         one ordinary sentence, and offer no fake choice.
 *
 * IDENTITY, UNIT AND PRICE REMAIN DISTINCT. This module describes whether a
 * resource's RESOLUTION is settled and whether a human is needed. It never
 * collapses identity, unit and price into one generic "trusted" tick — which is
 * why an unproved unit surfaces as its own honest reason instead of silently
 * downgrading a proven identity.
 */

/**
 * Server verdicts, as persisted on the resolution row
 * (backend ProjectAhspResolutionStatus).
 */
export const RESOURCE_RESOLUTION_STATUS = {
  RESOLVED: 'RESOLVED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  UNRESOLVED: 'UNRESOLVED',
} as const;

export const RESOURCE_TRUST_STATE = {
  MACHINE_PROVEN: 'MACHINE_PROVEN',
  HUMAN_SETTLED: 'HUMAN_SETTLED',
  NEEDS_HUMAN_DECISION: 'NEEDS_HUMAN_DECISION',
  NOT_PROVABLE: 'NOT_PROVABLE',
} as const;

export type ResourceTrustState =
  (typeof RESOURCE_TRUST_STATE)[keyof typeof RESOURCE_TRUST_STATE];

/**
 * The reason code the backend emits when a governed human decision was reused.
 * Mirrors ResourceIdentityAuthority/ResourceIdentityReasonCode in
 * backend/src/resource-catalog/resource-identity-resolution.kernel.ts.
 */
const VERIFIED_MAPPING_REUSED = 'VERIFIED_MAPPING_REUSED';

/**
 * THE HUMAN-DECIDABLE LAW, RESTATED FROM SERVER FACTS ONLY.
 *
 * The backend kernel's `isHumanDecidable()` admits exactly one shape: a
 * NEEDS_REVIEW verdict that reports MULTIPLE_CANDIDATES_NEEDS_REVIEW and is not
 * disqualified by SPECIFICATION_UNPROVED. Both of those reason codes are
 * persisted on the resolution row, so this predicate is composed purely of
 * facts the server already published — never of a candidate count, and never of
 * anything this module worked out for itself.
 *
 * A human decides BETWEEN legitimate alternatives. They never overrule a guard,
 * which is why an unproved specification can never become a chooser.
 */
const MULTIPLE_CANDIDATES_NEEDS_REVIEW = 'MULTIPLE_CANDIDATES_NEEDS_REVIEW';
const SPECIFICATION_UNPROVED = 'SPECIFICATION_UNPROVED';

/**
 * ONE truthful business reason per refusal, in ordinary language.
 *
 * Ordered by specificity, not alphabetically: the first code present wins, so a
 * precise cause ("spesifikasi bertentangan") is preferred over a vaguer one
 * that may accompany it. Every key is a real code emitted by the backend
 * identity kernel or the AHSP price kernel; nothing here is speculative.
 */
const NOT_PROVABLE_REASON: ReadonlyArray<readonly [string, string]> = [
  ['RESOURCE_NOT_FOUND', 'Sumber daya ini belum dikenali di katalog.'],
  ['SPECIFICATION_CONFLICT', 'Spesifikasi sumber dan katalog saling bertentangan.'],
  [
    'SPECIFICATION_UNPROVED',
    'Katalog menyebut spesifikasi yang tidak dinyatakan oleh sumber.',
  ],
  ['RESOURCE_TYPE_MISMATCH', 'Jenis sumber daya tidak cocok dengan katalog.'],
  ['REVIEWED_MAPPING_CONFLICT', 'Catatan tinjauan sebelumnya saling bertentangan.'],
  // ---- unit truth, independent of identity ----
  ['UNIT_CONTEXT_SOURCE_UNIT_UNSTATED', 'Sumber tidak menyatakan satuan.'],
  ['UNIT_CONTEXT_SOURCE_UNIT_UNPROVED', 'Satuan yang dinyatakan sumber belum terbukti.'],
  ['UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED', 'Satuan pada katalog belum terbukti.'],
  [
    'UNIT_CONTEXT_NO_MATCHING_REPRESENTATION',
    'Tidak ada entri katalog dengan satuan yang sama dengan sumber.',
  ],
  [
    'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS',
    'Satuan tidak membedakan entri katalog yang sama kuat.',
  ],
  ['UNIT_NOT_SUPPORTED', 'Satuan belum dapat dibuktikan oleh Kamus Unit.'],
  ['UNIT_CONVERSION_UNPROVED', 'Konversi satuan yang dibutuhkan belum terbukti.'],
  ['BASIC_PRICE_UNIT_NOT_SUPPORTED', 'Satuan harga dasar belum terbukti.'],
  // ---- price truth, independent of identity and unit ----
  ['NO_BASIC_PRICE_CANDIDATE', 'Belum ada harga dasar yang sah untuk sumber daya ini.'],
  ['ONLY_EXPIRED_BASIC_PRICE_CANDIDATES', 'Harga dasar yang tersedia sudah kedaluwarsa.'],
  ['MULTIPLE_BASIC_PRICE_CANDIDATES', 'Ada lebih dari satu harga dasar yang sama sah.'],
];

/** Said when the server refused for a reason this adapter does not recognise. */
const UNRECOGNISED_REASON = 'Bukti yang diperlukan belum tersedia.';

export const RESOURCE_TRUST_LABEL: Record<ResourceTrustState, string> = {
  MACHINE_PROVEN: 'Terbukti otomatis',
  HUMAN_SETTLED: 'Sudah ditetapkan',
  NEEDS_HUMAN_DECISION: 'Perlu keputusan Anda',
  NOT_PROVABLE: 'Belum dapat dipastikan',
};

export interface ResourceTrustInput {
  readonly status: string;
  readonly reasonCodes: readonly string[];
}

export interface ResourceTrustView {
  readonly state: ResourceTrustState;
  /** Short, calm, user-facing label. Never a code. */
  readonly label: string;
  /**
   * ONE truthful business reason. Present only where the reader needs to know
   * why SIMPROK is withholding a verdict — never decoration on a healthy row.
   */
  readonly reason: string | null;
  /** True only for rows a human must actually look at. Drives exception-first. */
  readonly needsAttention: boolean;
  /**
   * THE ONLY GATE A DECISION INTERACTION MAY READ.
   *
   * True exclusively for NEEDS_HUMAN_DECISION. A refusal that a human cannot
   * lawfully answer — a missing resource, a conflicting specification, an
   * unproved unit — must never be dressed up as "silakan pilih".
   */
  readonly decisionAvailable: boolean;
}

const firstKnownReason = (reasonCodes: readonly string[]): string => {
  for (const [code, sentence] of NOT_PROVABLE_REASON) {
    if (reasonCodes.includes(code)) return sentence;
  }
  return UNRECOGNISED_REASON;
};

const view = (
  state: ResourceTrustState,
  reason: string | null,
): ResourceTrustView => ({
  state,
  label: RESOURCE_TRUST_LABEL[state],
  reason,
  needsAttention:
    state === RESOURCE_TRUST_STATE.NEEDS_HUMAN_DECISION ||
    state === RESOURCE_TRUST_STATE.NOT_PROVABLE,
  decisionAvailable: state === RESOURCE_TRUST_STATE.NEEDS_HUMAN_DECISION,
});

/**
 * Classify ONE resource from the server's own verdict.
 *
 * Fails closed: an unknown or missing status is "belum dapat dipastikan", never
 * an optimistic pass. A temporary inability to describe a row must never read
 * as a proof.
 */
export const toResourceTrust = (input: ResourceTrustInput): ResourceTrustView => {
  const codes = Array.isArray(input?.reasonCodes) ? input.reasonCodes : [];

  if (input?.status === RESOURCE_RESOLUTION_STATUS.RESOLVED) {
    // A recorded human decision carried this row. Say that plainly rather than
    // letting it pass as something SIMPROK worked out by itself.
    return codes.includes(VERIFIED_MAPPING_REUSED)
      ? view(RESOURCE_TRUST_STATE.HUMAN_SETTLED, null)
      : view(RESOURCE_TRUST_STATE.MACHINE_PROVEN, null);
  }

  if (
    input?.status === RESOURCE_RESOLUTION_STATUS.NEEDS_REVIEW &&
    codes.includes(MULTIPLE_CANDIDATES_NEEDS_REVIEW) &&
    !codes.includes(SPECIFICATION_UNPROVED)
  ) {
    return view(RESOURCE_TRUST_STATE.NEEDS_HUMAN_DECISION, null);
  }

  return view(RESOURCE_TRUST_STATE.NOT_PROVABLE, firstKnownReason(codes));
};

export interface ResourceTrustSummary {
  readonly total: number;
  /** Machine proven plus governed-human settled: nothing to do. */
  readonly settled: number;
  readonly needsDecision: number;
  readonly notProvable: number;
  /** needsDecision + notProvable — the exception count the user must find. */
  readonly attention: number;
  readonly allClear: boolean;
  /**
   * ONE calm sentence for the top of the list. The normal path stays quiet:
   * when everything is settled it says so in a few words and asks for nothing.
   */
  readonly headline: string;
}

/**
 * EXCEPTION-FIRST SUMMARY.
 *
 * The point of this function is that a 50-resource analysis with 5 problems
 * should read as "5 need attention", not as fifty cards to inspect. It counts
 * only what the classifier already decided; it re-derives no state of its own.
 */
export const summariseResourceTrust = (
  views: readonly ResourceTrustView[],
): ResourceTrustSummary => {
  const total = views.length;
  const needsDecision = views.filter(
    (v) => v.state === RESOURCE_TRUST_STATE.NEEDS_HUMAN_DECISION,
  ).length;
  const notProvable = views.filter(
    (v) => v.state === RESOURCE_TRUST_STATE.NOT_PROVABLE,
  ).length;
  const attention = needsDecision + notProvable;
  const settled = total - attention;

  let headline: string;
  if (total === 0) {
    headline = 'Belum ada komponen untuk ditelusuri.';
  } else if (attention === 0) {
    headline = `Seluruh ${total} komponen sudah beres. Tidak ada yang perlu Anda lakukan.`;
  } else {
    const parts: string[] = [];
    if (needsDecision > 0) parts.push(`${needsDecision} perlu keputusan Anda`);
    if (notProvable > 0) parts.push(`${notProvable} belum dapat dipastikan`);
    headline = `SIMPROK sudah menyelesaikan ${settled} dari ${total} komponen. ${parts.join(', ')}.`;
  }

  return { total, settled, needsDecision, notProvable, attention, allClear: attention === 0, headline };
};
