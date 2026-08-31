import { PriceSourceOrigin } from '@prisma/client';
import {
  sourceFamilyOfOrigin,
  type SourceFamily,
} from './basic-price-source-family.util';
import {
  metadataCoherenceIssue,
  type MetadataCoherenceIssue,
} from './basic-price-metadata-coherence.law';

/**
 * WHAT A BATCH MAY LAWFULLY DO NEXT — stated ONCE, for both the writer and
 * the reader.
 *
 * WHY THIS FILE EXISTS. The Owner clicked `Ajukan Batch (6 siap)` and nothing
 * happened. The cause was not the endpoint: the button carried the native
 * `disabled` attribute, so the browser fired no click at all. It was disabled
 * because the FRONTEND held its OWN copy of the precondition —
 * `canSubmitBatch` in `utils/basicPriceImportDisplay.ts` — and that copy could
 * only answer YES or NO. It had no way to say WHY, because it was never given
 * the reasons: those live as `ConflictException` codes inside
 * `BasicPriceImportService.submitBatch` and
 * `BasicPricePrivateAssetService.keepBatchPrivate`.
 *
 * Two implementations answering one product question is the shadow-path defect
 * by definition, and the silent door was its symptom. So the question is
 * answered here, once, in the same order and with the same codes the services
 * throw — and the services and the read projection all consume THIS.
 *
 * IT DECIDES NOTHING NEW, WITH ONE NAMED EXCEPTION (see
 * MUTABLE_BATCH_STATUSES). Every reason code below is a code one of those two
 * services already threw. Nothing here writes anything.
 *
 * THE TWO ACTIONS ARE NOT THE SAME ACTION, and conflating them is what made
 * `Ajukan Batch` untrue:
 *
 *   PRIVATE_USE      keep MY OWN resolved rows as workspace-private Basic
 *                    Prices, usable by this workspace immediately. Incremental
 *                    and idempotent — it materializes whatever is ready now and
 *                    leaves the batch open so the rest can still be worked on.
 *                    Offered to every source family: keeping your own lawful
 *                    price is not a claim about anyone else's knowledge.
 *
 *   SIMPROK_PROPOSAL offer the batch to SIMPROK's evidence-based curation.
 *                    TERMINAL — it freezes the batch, so it legitimately
 *                    requires every row to have been decided first.
 */

/**
 * The batch facts these preconditions read. Nothing else is consulted.
 *
 * The three enum-shaped fields are typed as plain `string`, and that is
 * deliberate rather than lazy: these facts reach this file from BOTH a Prisma
 * row (where they are enums) and a `$queryRaw` lock (where they are strings).
 * `Enum | string` would collapse to `string` anyway, so `string` is simply the
 * honest declaration of what actually arrives. The VALUES are not taken on
 * trust: the status sets are explicit, and the source facts are only ever
 * tested for PRESENCE — origin and type are independent axes, so no stated
 * combination of them is refusable.
 */
export interface BatchLifecycleFacts {
  status: string;
  effectiveDate: Date | null;
  regionId: string | null;
  sourceOrigin: string | null;
  sourceType: string | null;
  readyForSubmissionRows: number;
  /**
   * TEMPORAL PROVENANCE — read so the review gate can ask the WRITER's coherence
   * question instead of a softer one of its own. All optional so every existing
   * caller keeps compiling; absent reads as "not stated", which is exactly what
   * the shared law already treats as legal-but-unclaimed.
   */
  sourcePeriodLabel?: string | null;
  sourcePeriodGranularity?: string | null;
  effectiveDateProvenance?: string | null;
  effectiveDateDerivationRule?: string | null;
  /**
   * HOW MANY OF THE READY ROWS ARE ALREADY STORED AS PRIVATE PRICES.
   *
   * OPTIONAL, AND THE ABSENCE MEANS "NOT ASKED" — never zero. Only the review
   * read path pays for this count; preview, patch and submit do not, and a
   * caller that never asked has no basis to claim that nothing is stored yet.
   * Every rule below therefore applies ONLY when this is a real number, which
   * is what keeps an unasked question from becoming a verdict.
   */
  alreadyPrivateRows?: number | null;
  /**
   * BP-REGION-TRUTH-07S — THE SOURCE'S OWN GEOGRAPHIC CLAIM ABOUT THIS BATCH'S
   * PRICE SCOPE, and whether a human has reconciled it with `regionId`.
   *
   * All optional, and absent reads as "not stated" — so every existing caller
   * keeps compiling and keeps its current verdict. A path that does not read
   * these facts cannot raise the question, which is correct: an unasked
   * question may not become a verdict.
   */
  sourceRegionScopeLabel?: string | null;
  sourceRegionScopeGeographicEvidence?: string | null;
  regionScopeConfirmedRegionId?: string | null;
}

/**
 * DOES THIS BATCH CARRY AN UNRECONCILED GEOGRAPHIC CLAIM FROM ITS SOURCE?
 *
 * THE SITUATION THIS EXISTS FOR. The Owner's Ambon workbook writes "KECAMATAN"
 * over three price columns and the reviewer picks one — "SIRIMAU". Separately,
 * and in a different box, they pick a canonical Region — "Kecamatan Teluk Ambon
 * Baguala". Both answers are honest, both are stored, and SIMPROK has no fact by
 * which they are the same place or different ones: `Region` is a flat code/name
 * table with no hierarchy, so there is nothing to prove compatibility WITH.
 *
 * SIMPROK MUST THEREFORE NEITHER ASSERT NOR DENY IT. Silently accepting the pair
 * would make a price save-ready under a Region the source never claimed for it.
 * Comparing the two spellings would be a guess wearing a proof's clothes. So the
 * pair is called UNPROVEN and asked about once, and the answer is stored as the
 * Region it was given about.
 *
 * ALL FOUR CONDITIONS ARE REQUIRED, and each removes a false alarm:
 *
 *   scope label      — a source that offered ONE place asked no scope question,
 *                      so there is no second answer to reconcile.
 *   geographic word  — "GROSIR | ECERAN" is the same SHAPE as a jurisdiction
 *                      matrix. Without a region word written BY THE SOURCE this
 *                      stays silent, which is what stops one ambiguity from
 *                      making SIMPROK noisy everywhere.
 *   a chosen Region  — nothing to reconcile against until one is picked, and its
 *                      absence is already reported as a missing required fact.
 *   no confirmation  — for THIS Region. A confirmation given about a different
 *                      Region confirms nothing about this one, so changing the
 *                      Region reopens the question rather than inheriting an
 *                      answer about somewhere else.
 */
export function regionScopeCompatibilityUnproven(
  facts: BatchLifecycleFacts,
): boolean {
  if (!facts.sourceRegionScopeLabel) return false;
  if (!facts.sourceRegionScopeGeographicEvidence) return false;
  if (!facts.regionId) return false;
  return facts.regionScopeConfirmedRegionId !== facts.regionId;
}

export type PrivateUseBlockReason =
  | 'BATCH_NOT_MUTABLE'
  | 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE'
  | 'REGION_REQUIRED_BEFORE_PRIVATE_USE'
  | 'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE'
  | 'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE'
  /**
   * THE SOURCE CALLED THIS SCOPE A PLACE, AND NOBODY HAS SAID IT IS THIS PLACE.
   * Not a fault, not a refusal of the work already done, and not a claim that
   * the two disagree — only that SIMPROK will not store a price under a Region
   * whose relation to the source's own geography is unproven. One confirmation
   * clears it. See `regionScopeCompatibilityUnproven`.
   */
  | 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE'
  | 'NO_ROWS_READY_FOR_PRIVATE_USE'
  /**
   * EVERY ROW THAT IS READY HAS ALREADY BEEN STORED. Not a fault and not a
   * refusal of anything the user still wants — the work is simply done, and
   * offering to do it again is what made the room offer to save thirteen rows
   * beside a status line saying those same thirteen prices already existed.
   */
  | 'ALL_READY_ROWS_ALREADY_PRIVATE';

/**
 * Mechanical preconditions of the proposal endpoint. Every one of these is a
 * code `submitBatch` throws, and `submitBatch` consumes this list — so what a
 * user is told and what the server would do are the same sentence.
 */
export type ProposalBlockReason =
  | 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION'
  | 'BATCH_NOT_READY_FOR_REVIEW'
  | 'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION'
  | 'REGION_REQUIRED_BEFORE_SUBMISSION'
  | 'SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION'
  | 'SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION'
  /** Same unproven pair as the private path, refused in the proposal's own
   * vocabulary — an unreconciled geography must not be offered to SIMPROK's
   * curation any more than it may be stored privately. */
  | 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION'
  | 'NO_ROWS_READY_FOR_SUBMISSION';

/**
 * Why the normal product DOOR does not offer curation, which is a different
 * question from whether the endpoint would accept the call. Kept as its own
 * type so neither can be mistaken for the other.
 */
export type ProposalNotOfferedReason = 'ALREADY_PROPOSED' | ProposalBlockReason;

/**
 * The batch statuses during which rows may still be worked on and kept.
 *
 * INCLUDES `NEEDS_REVIEW`, AND THAT IS THE ONE GATE THIS TASK WIDENED.
 *
 * A batch only reaches `READY_FOR_REVIEW` when EVERY row has been decided
 * (`BasicPriceRowResolutionService.recomputeBatchStatus`). Requiring it for
 * PRIVATE use meant the Owner's six finished rows out of eighty-six could not
 * be kept until the other eighty were also finished — the "86 giant tasks"
 * outcome the product law forbids, and the reason the review room had no
 * usable action at all.
 *
 * Nothing about a finished row depends on its neighbours. The private writer
 * selects `READY_FOR_SUBMISSION` rows only, and re-checks each row's own
 * resource identity and canonical price before writing it. The batch-wide gate
 * was guarding the TERMINAL action's invariant ("this batch is done"), which
 * private use never claimed. `SIMPROK_PROPOSAL` keeps that gate below,
 * unchanged.
 */
const MUTABLE_BATCH_STATUSES = new Set<string>([
  'NEEDS_REVIEW',
  'READY_FOR_REVIEW',
]);

/** Statuses that mean this batch has already been handed to curation. */
const PROPOSED_BATCH_STATUSES = new Set<string>([
  'APPROVED_FOR_SUBMISSION',
  'PARTIALLY_SUBMITTED',
  'SUBMITTED',
]);

/**
 * THE REQUIRED METADATA FACTS — the ONE list, in the ONE order.
 *
 * WHY THIS IS HERE AND NOT IN THE BROWSER. The import page let a user walk into
 * the review room with metadata that had never been saved, and then discover at
 * the very end that the batch could not be kept. The page could not have
 * prevented it honestly: requiredness is source law, and the browser had no
 * copy of that law — only a guess about which inputs looked filled in.
 *
 * The obvious repair was to teach the browser the rule. That is the shadow-path
 * defect this file already exists to prevent, so the rule is stated here
 * instead, next to the two actions that already enforce it, and derived from
 * exactly the same facts `privateUseBlockReason` reads. The browser is told
 * WHICH facts are required and WHICH are still missing; it never decides either.
 *
 * NOTE WHAT IS ABSENT. `sourceOrganizationName` (the publisher) and
 * `sourceVendorName` are NOT here, and must never be added on the grounds that
 * the form shows a box for them. A source that names no publisher has no
 * publisher, and forcing a user to type one to unlock a door is how a product
 * manufactures false provenance. Optional facts stay optional.
 */
export const REQUIRED_METADATA_FACTS = [
  'EFFECTIVE_DATE',
  'REGION',
  'SOURCE_ORIGIN',
  'SOURCE_TYPE',
] as const;

export type RequiredMetadataFact = (typeof REQUIRED_METADATA_FACTS)[number];

/**
 * Which required facts this batch has NOT stated, in the declared order.
 *
 * Presence only — the same test `classificationBlock` applies to the source
 * pair, for the same reason: uncertainty blocks, and disagreement-with-a-table
 * does not.
 */
export function missingRequiredMetadataFacts(
  facts: BatchLifecycleFacts,
): RequiredMetadataFact[] {
  const missing: RequiredMetadataFact[] = [];
  if (!facts.effectiveDate) missing.push('EFFECTIVE_DATE');
  if (!facts.regionId) missing.push('REGION');
  if (!facts.sourceOrigin) missing.push('SOURCE_ORIGIN');
  if (!facts.sourceType) missing.push('SOURCE_TYPE');
  return missing;
}

/**
 * May a person open the row-review room for this batch yet?
 *
 * `metadataComplete` is a statement about PERSISTED truth, because these facts
 * are read from the stored batch. That is the entire point: a form that looks
 * complete on screen has proved nothing, and the browser must not be able to
 * mistake its own draft for a saved fact. The gate answers only about what the
 * database actually holds.
 *
 * `requiredFacts` is published alongside so the page can tell a user which of
 * its OWN inputs still need a value before saving is worth attempting, without
 * owning the rule that says which those are.
 */
export interface BatchReviewGate {
  requiredFacts: readonly RequiredMetadataFact[];
  missingRequiredFacts: RequiredMetadataFact[];
  metadataComplete: boolean;
  /**
   * Would the WRITER accept this batch's metadata? Answered by the same shared
   * law `keepBatchPrivate` refuses with — never by a second, softer opinion.
   */
  metadataCoherent: boolean;
  reviewAllowed: boolean;
  reasonCode:
    | 'BATCH_NOT_MUTABLE'
    | 'REQUIRED_METADATA_INCOMPLETE'
    | MetadataCoherenceIssue['code']
    | null;
}

/**
 * MAY A PERSON OPEN THE ROW-REVIEW ROOM YET?
 *
 * THE INVARIANT THIS FUNCTION EXISTS TO HOLD:
 *
 *     reviewAllowed === true
 *   ⟹ the SAME persisted metadata will not later be refused by
 *     `keepBatchPrivate` on metadata/provenance grounds.
 *
 * It used to be false. This gate checked that four facts were PRESENT; the
 * writer additionally checked that the temporal provenance claim was COHERENT
 * — that a date claiming to be derived from a period is one that derivation
 * actually produces. So a batch could be told "you may review", have thirteen
 * rows resolved by hand, and only then be refused at `Simpan & Gunakan` for
 * metadata it had been holding the entire time. The work survived; the trust
 * did not.
 *
 * The repair is not "check harder here". It is that both callers now read
 * `metadataCoherenceIssue` from `basic-price-metadata-coherence.law.ts`, so
 * there is one answer with two presentations: the writer throws it, this
 * reports it. Nothing was relaxed on the writer's side to make them agree.
 *
 * `metadataComplete` remains a separate, softer statement — "the four facts are
 * stated" — because a person filling a form needs to know which BOX is empty
 * before they need to know that a derivation does not explain a date.
 */
export function evaluateBatchReviewGate(
  facts: BatchLifecycleFacts,
): BatchReviewGate {
  const missingRequiredFacts = missingRequiredMetadataFacts(facts);
  const metadataComplete = missingRequiredFacts.length === 0;

  // The writer's own verdict, asked in the writer's own order. Only asked once
  // the four facts are present, because an absent fact is already reported
  // above in words a person can act on.
  const coherenceIssue = metadataComplete
    ? metadataCoherenceIssue({
        sourceOrigin: facts.sourceOrigin,
        sourceType: facts.sourceType,
        effectiveDate: facts.effectiveDate,
        sourcePeriodLabel: facts.sourcePeriodLabel ?? null,
        sourcePeriodGranularity: facts.sourcePeriodGranularity ?? null,
        effectiveDateProvenance: facts.effectiveDateProvenance ?? null,
        effectiveDateDerivationRule: facts.effectiveDateDerivationRule ?? null,
      })
    : null;

  // A batch that can no longer be worked on is not "incomplete"; it is closed.
  // Reporting the two separately keeps the room from telling a user to fill in
  // a field that would change nothing.
  const mutable = MUTABLE_BATCH_STATUSES.has(facts.status);
  const reasonCode = !mutable
    ? ('BATCH_NOT_MUTABLE' as const)
    : !metadataComplete
      ? ('REQUIRED_METADATA_INCOMPLETE' as const)
      : (coherenceIssue?.code ?? null);

  return {
    requiredFacts: REQUIRED_METADATA_FACTS,
    missingRequiredFacts,
    metadataComplete,
    metadataCoherent: coherenceIssue === null,
    reviewAllowed: reasonCode === null,
    reasonCode,
  };
}

/**
 * Are BOTH source facts STATED? Returns the first missing one.
 *
 * PRESENCE ONLY. It used to also test the pair for "coherence" against
 * SOURCE_TYPE_BY_ORIGIN and refuse anything that disagreed, which made a
 * government-published market survey unrepresentable. Origin and type are
 * independent axes (Owner law, BASIC-PRICE-MASTER-DECISION §10), so no
 * combination of two STATED facts is refusable here.
 *
 * What still fails closed is the UNSTATED fact — which is the fail-closed law
 * working exactly as intended: uncertainty blocks, disagreement-with-a-table
 * does not.
 *
 * Generic over the two "missing" codes so each caller gets back only its own
 * vocabulary: the private path must never answer with a SUBMISSION code.
 */
function classificationBlock<O extends string, T extends string>(
  facts: BatchLifecycleFacts,
  originMissing: O,
  typeMissing: T,
): O | T | null {
  if (!facts.sourceOrigin) return originMissing;
  if (!facts.sourceType) return typeMissing;
  return null;
}

/**
 * May this batch's ready rows be kept as workspace-private Basic Prices right
 * now? `null` means yes.
 *
 * Order matches `BasicPricePrivateAssetService.keepBatchPrivate` exactly, so
 * the sentence a user reads before acting is the same one the server would
 * answer with if they acted anyway.
 */
export function privateUseBlockReason(
  facts: BatchLifecycleFacts,
): PrivateUseBlockReason | null {
  if (!MUTABLE_BATCH_STATUSES.has(facts.status)) {
    return 'BATCH_NOT_MUTABLE';
  }
  if (!facts.effectiveDate) {
    return 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE';
  }
  if (!facts.regionId) {
    return 'REGION_REQUIRED_BEFORE_PRIVATE_USE';
  }
  // IMMEDIATELY AFTER THE REGION, because it is a question ABOUT the region and
  // a person reading the two in sequence is being told one story: which place,
  // then whether the source agrees it is that place. Asking it before a Region
  // exists would be asking someone to reconcile an answer they have not given.
  if (regionScopeCompatibilityUnproven(facts)) {
    return 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_PRIVATE_USE';
  }
  const classification = classificationBlock(
    facts,
    'SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE',
    'SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE',
  );
  if (classification) return classification;
  if (facts.readyForSubmissionRows <= 0) {
    return 'NO_ROWS_READY_FOR_PRIVATE_USE';
  }
  /**
   * THE WORK IS DONE, SO THE ACTION IS NOT OFFERED.
   *
   * LAST, AND ONLY WHEN MEASURED. It sits after every other precondition
   * because "nothing is finished yet" and "everything finished is already
   * stored" are opposite facts that must never borrow each other's sentence,
   * and it is skipped entirely when `alreadyPrivateRows` was not asked for —
   * an unmeasured question may not become a verdict.
   *
   * THIS IS NOT A SAFETY BOUNDARY AND MUST NEVER BECOME ONE. `keepBatchPrivate`
   * stays idempotent: a stale tab that presses anyway is still answered with
   * `alreadyPrivateCount` and creates no duplicate. What changes here is only
   * whether a person is INVITED to press — clarity, not enforcement.
   */
  if (
    typeof facts.alreadyPrivateRows === 'number' &&
    facts.readyForSubmissionRows - facts.alreadyPrivateRows <= 0
  ) {
    return 'ALL_READY_ROWS_ALREADY_PRIVATE';
  }
  return null;
}

/**
 * HOW MANY ROWS ONE PRESS WOULD ACTUALLY STORE — the count a button may show.
 *
 * A count that includes rows already stored is not a count of work; it is the
 * same number the screen showed before the work happened, which is how
 * `Simpan & Gunakan (13 siap)` came to sit beside thirteen finished prices.
 *
 * NULL MEANS NOT MEASURED, and the browser must treat it as such rather than
 * as zero. Only the review read path pays for the private-price count, so every
 * other projection answers null here — an honest absence instead of a number
 * that would be wrong by exactly the amount already saved.
 */
export function actionablePrivateUseRows(
  facts: BatchLifecycleFacts,
): number | null {
  if (typeof facts.alreadyPrivateRows !== 'number') return null;
  return Math.max(0, facts.readyForSubmissionRows - facts.alreadyPrivateRows);
}

/**
 * SOURCE-POLICY ROUTING — which families the PRODUCT DOOR sends to community
 * curation.
 *
 * Owner law (#97 §3): a genuinely official government list, and a supplier's
 * own commercial quote, must not be pushed through field-survey business
 * curation MERELY because they are Basic Prices. `PriceSubmissionReview` is
 * exactly that curation — an SLA-tracked human verdict on a reported market
 * observation — so the normal door routes only FIELD_PRICE to it.
 *
 * WHAT THIS IS NOT. It is not a claim that government or supplier prices are
 * lesser, and it deletes nothing: both families reach a fully usable governed
 * Basic Price through PRIVATE_USE, which is the primary action for every
 * family. Publication of a catalog price remains its own separately governed
 * ladder (`BASIC_PRICE_PUBLISH`), untouched by this file.
 *
 * DERIVED FROM THE ONE FAMILY AUTHORITY, never from a second opinion about
 * what an origin means.
 */
export function familyOffersCommunityCuration(family: SourceFamily): boolean {
  return family === 'FIELD_PRICE';
}

/**
 * Preconditions of proposing this batch to curation. `null` means the endpoint
 * accepts the call — and `submitBatch` consumes THIS, so a reason returned here
 * is a reason the write boundary actually enforces.
 *
 * THE SOURCE-FAMILY ROUTE IS ENFORCED HERE, NOT MERELY DISPLAYED. It briefly
 * lived only in the read projection: the review room hid the action for
 * government and supplier batches while `POST :batchId/submit` still accepted
 * them. That is a UI-only domain law — a rule that holds exactly as long as the
 * user goes through the screen — and a rule the API contradicts is not a rule.
 *
 * It is checked FIRST because it is the most fundamental refusal: a family this
 * door does not serve should be told so plainly, not asked to complete metadata
 * for a journey that ends in a refusal anyway.
 *
 * The already-proposed statuses are NOT handled here: that path is an idempotent
 * RETURN in the service, not a refusal, and folding it in would turn a success
 * into an error code.
 */
export function proposalBlockReason(
  facts: BatchLifecycleFacts,
): ProposalBlockReason | null {
  if (facts.sourceOrigin) {
    const family = sourceFamilyOfOrigin(
      facts.sourceOrigin as PriceSourceOrigin,
    );
    if (family && !familyOffersCommunityCuration(family)) {
      return 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION';
    }
  }
  if (facts.status !== 'READY_FOR_REVIEW') {
    return 'BATCH_NOT_READY_FOR_REVIEW';
  }
  if (!facts.effectiveDate) {
    return 'EFFECTIVE_DATE_REQUIRED_BEFORE_SUBMISSION';
  }
  if (!facts.regionId) {
    return 'REGION_REQUIRED_BEFORE_SUBMISSION';
  }
  if (regionScopeCompatibilityUnproven(facts)) {
    return 'REGION_SCOPE_COMPATIBILITY_UNCONFIRMED_BEFORE_SUBMISSION';
  }
  const classification = classificationBlock(
    facts,
    'SOURCE_ORIGIN_REQUIRED_BEFORE_SUBMISSION',
    'SOURCE_TYPE_REQUIRED_BEFORE_SUBMISSION',
  );
  if (classification) return classification;
  if (facts.readyForSubmissionRows <= 0) {
    return 'NO_ROWS_READY_FOR_SUBMISSION';
  }
  return null;
}

/**
 * What the review room may offer, and why not when it may not.
 *
 * Every reason here is one the WRITE boundary enforces too — including the
 * source-family route, which briefly lived only on this side. A rule the API
 * contradicts is not a rule, and a room that hides an action the endpoint would
 * still perform is describing a policy that does not exist.
 */
export interface BatchLifecycleActions {
  privateUse: {
    offered: boolean;
    reasonCode: PrivateUseBlockReason | null;
    /**
     * Rows one press would actually store. Null when the private-price count
     * was not asked for on this path — see actionablePrivateUseRows.
     */
    actionableRows: number | null;
  };
  simprokProposal: {
    offered: boolean;
    reasonCode: ProposalNotOfferedReason | null;
    sourceFamily: SourceFamily | null;
  };
  /**
   * Whether the ROW-REVIEW ROOM may be entered at all — the door before the two
   * actions above, answered from the same facts by the same file so a user
   * cannot reach a room whose only exits are refusals.
   */
  reviewGate: BatchReviewGate;
  /**
   * BP-REGION-TRUTH-07S — THE TWO REGION ANSWERS, SIDE BY SIDE, AND WHETHER
   * ANYONE HAS SAID THEY ARE THE SAME PLACE.
   *
   * Projected as facts, with the verdict computed HERE, for the reason this
   * whole file exists: the browser must never hold its own copy of a product
   * rule. It renders what the source said, what the canonical Region says, and
   * the one sentence in between — it does not decide which pairs are a problem.
   *
   * `compatibilityUnproven` is false for every non-geographic source, so the
   * ordinary import shows nothing at all here.
   */
  regionScope: {
    /** The source's own wording for the scope this batch was read under. */
    sourceLabel: string | null;
    /** The source's own word proving that scope is a place, when it wrote one. */
    geographicEvidence: string | null;
    /** Which Region a human already reconciled that scope against, if any. */
    confirmedRegionId: string | null;
    compatibilityUnproven: boolean;
  };
}

/**
 * WHAT THE ROUTING DECISION IS, EXACTLY — stated here rather than left to be
 * inferred from a boolean.
 *
 * `SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION` means this family does not
 * reach community curation AT ALL — not merely that the product door declines
 * to offer it. `proposalBlockReason` above tests the family FIRST, and
 * `BasicPriceImportService.submitBatch` consumes that same function and throws
 * its verdict as a `ConflictException`. So `POST :batchId/submit` refuses a
 * government or supplier batch at the write boundary, with this exact code,
 * whatever the browser does.
 *
 * THIS PARAGRAPH USED TO SAY THE OPPOSITE — that the endpoint still accepted
 * such a proposal and that refusing it was "a product decision this file
 * deliberately does not take." That was true only before the family test moved
 * into `proposalBlockReason`; the decision was in fact taken, and the comment
 * was left behind describing a policy the code no longer had. A rule the API
 * contradicts is not a rule — and neither is a comment the API contradicts.
 *
 * The reason is unchanged and still Owner law (#97 §3): field-survey curation
 * must not be FORCED onto an official or commercial source. The forcing was that
 * curation used to be the ONLY door out of the review room; the fix is that
 * private use is now the primary door for every family, and it deletes nothing —
 * both families still reach a fully usable governed Basic Price that way.
 *
 * What this comment does NOT decide, and must not be read as deciding: whether
 * government and supplier sources should have some OTHER lawful route to catalog
 * truth. Today they have none. That is an open Owner product decision.
 */
export function evaluateBatchLifecycleActions(
  facts: BatchLifecycleFacts,
): BatchLifecycleActions {
  const privateReason = privateUseBlockReason(facts);
  const sourceFamily = facts.sourceOrigin
    ? sourceFamilyOfOrigin(facts.sourceOrigin as PriceSourceOrigin)
    : null;

  const proposalReason: ProposalNotOfferedReason | null =
    PROPOSED_BATCH_STATUSES.has(facts.status)
      ? 'ALREADY_PROPOSED'
      : sourceFamily && !familyOffersCommunityCuration(sourceFamily)
        ? 'SOURCE_FAMILY_NOT_ROUTED_TO_COMMUNITY_CURATION'
        : proposalBlockReason(facts);

  return {
    privateUse: {
      offered: privateReason === null,
      reasonCode: privateReason,
      actionableRows: actionablePrivateUseRows(facts),
    },
    simprokProposal: {
      offered: proposalReason === null,
      reasonCode: proposalReason,
      sourceFamily,
    },
    reviewGate: evaluateBatchReviewGate(facts),
    regionScope: {
      sourceLabel: facts.sourceRegionScopeLabel ?? null,
      geographicEvidence: facts.sourceRegionScopeGeographicEvidence ?? null,
      confirmedRegionId: facts.regionScopeConfirmedRegionId ?? null,
      compatibilityUnproven: regionScopeCompatibilityUnproven(facts),
    },
  };
}
