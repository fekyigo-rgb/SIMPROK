/**
 * WHICH TEMPORAL QUESTION IS TRUE FOR *THIS* SOURCE.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Basic Price has one required calendar day
 * per price — `effectiveDate` — and the import form asked for it with one
 * label, `Tanggal Berlaku`, for every source that has ever existed. That label
 * is a claim, and for most of the Owner's data it is a false one. A market
 * survey does not "become effective" on a day; it was OBSERVED on one. A
 * vendor quotation was QUOTED on one. Only a regulation or an official list
 * genuinely says "this price begins on the first of January", and that is the
 * one case the old label described.
 *
 * WHAT THIS FILE DOES NOT DO, DELIBERATELY.
 *
 *   - It does not rename, re-map, widen or reinterpret a single persisted
 *     column. `effectiveDate` still means the calendar day the price applies
 *     from, `reviewDate` is still soft advice, `validUntil` is still the only
 *     hard end, and `createdAt` is still the moment SIMPROK received the file.
 *     The database was never confused; the QUESTION was.
 *   - It does not change what is required. Requiredness lives in
 *     `basic-price-batch-actions.policy.ts` and nowhere else, and a
 *     `BasicPrice` genuinely cannot exist without a day to apply from, so
 *     `EFFECTIVE_DATE` stays required for every source. Asking a truer question
 *     is not the same as asking fewer.
 *   - It does not translate anything. It answers with a CODE, exactly as every
 *     other Basic Price verdict does, and the browser owns the sentence. A
 *     server that shipped Indonesian prose would put product copy behind a
 *     deploy and out of the reach of the tests that pin it.
 *
 * SOURCE TYPE DECIDES, NOT SOURCE ORIGIN, and that distinction is the whole
 * point. `sourceOrigin` says WHO produced the price; `sourceType` says WHAT
 * KIND OF DOCUMENT it is, and only the document kind carries a temporal
 * meaning. A government body that runs a price survey has origin GOVERNMENT and
 * type MARKET_SURVEY, and its date is an observation, not a decree — deriving
 * the question from origin would ask that survey when it "starts being valid",
 * which is precisely the falsehood being removed.
 */
export const EFFECTIVE_DATE_QUESTIONS = [
  /**
   * A SNAPSHOT OF THE REAL WORLD. A field survey, a market survey, a quotation:
   * the price was TRUE on a day, and that day is what a person can actually
   * state. Nobody decreed anything.
   */
  'OBSERVED_PRICE_DATE',
  /**
   * A DOCUMENT THAT NAMES ITS OWN START. A regulation or an official price
   * list says when it begins — which may be in the past, today, or months
   * ahead, and SIMPROK stores whichever the source actually said. This is a
   * fact to be COPIED, never one the reviewer is asked to invent.
   */
  'SOURCE_STATED_START',
  /**
   * NOT ENOUGH IS KNOWN YET TO ASK A SHARPER QUESTION — the source type is
   * still unstated, or it is SIMPROK's own estimate, which is neither an
   * observation of a market nor a decree by an authority. The neutral wording
   * is the honest one here; guessing a sharper label would be inventing the
   * very meaning this file exists to stop inventing.
   */
  'PRICE_DATE_UNSPECIFIED',
] as const;

export type EffectiveDateQuestion = (typeof EFFECTIVE_DATE_QUESTIONS)[number];

/**
 * SOFT RE-VERIFICATION IS ADVICE, AND ADVICE ONLY MAKES SENSE FOR DATA THAT
 * AGES IN SILENCE.
 *
 * A workbook a person uploaded is a snapshot: nothing will ever update it, so
 * "check this again around here" is genuinely useful. A live system-to-system
 * feed is the opposite case — its freshness is a fact about actual
 * synchronisation, and asking a human to PREDICT when a machine-updated price
 * will go stale manufactures precision nobody has.
 *
 * INGESTION CHANNEL DECIDES, NOT SOURCE FAMILY. A supplier's price list
 * emailed as a spreadsheet and uploaded by hand is a snapshot, however
 * "supplier" the source is; the same supplier's live bridge is not. Reading
 * this from the source family would collapse three independent facts —
 * who produced it, how it arrived, and how it ages — into one, which is the
 * error this codebase names explicitly: source family is not ingestion channel
 * is not a temporal fact.
 *
 * NEITHER VALUE MAKES `reviewDate` REQUIRED. It is optional for every source
 * and every channel; this only decides which sentence is true beside the field.
 */
export const REVERIFICATION_APPLICABILITIES = [
  /** A snapshot that ages in silence. A person may state a re-check date. */
  'RECOMMENDED',
  /** A live feed. Freshness follows actual synchronisation, not a prediction. */
  'FOLLOWS_SOURCE_UPDATES',
] as const;

export type ReverificationApplicability =
  (typeof REVERIFICATION_APPLICABILITIES)[number];

/**
 * Channels whose prices arrive by machine and keep arriving. Listed by name
 * rather than by exclusion, so a channel added to the enum later reads as
 * "not proven to be live" and keeps the optional field on offer, instead of
 * silently inheriting a suppression nobody decided.
 */
const LIVE_INGESTION_CHANNELS: ReadonlySet<string> = new Set([
  'SUPPLIER_BRIDGE',
  'EXTERNAL_API',
  'GOVERNMENT_FEED',
]);

/**
 * The temporal question this batch's stated source type actually answers.
 *
 * A null type is not a failure — it is the ordinary state of a browser upload
 * before anyone has classified it, and it gets the neutral question rather
 * than a guessed one.
 */
export function effectiveDateQuestionFor(
  sourceType: string | null | undefined,
): EffectiveDateQuestion {
  switch (sourceType) {
    case 'REGULATION':
      return 'SOURCE_STATED_START';
    case 'MARKET_SURVEY':
    case 'VENDOR_QUOTE':
      return 'OBSERVED_PRICE_DATE';
    default:
      // SYSTEM_ESTIMATE, an unstated type, and any value this build has never
      // heard of. Fails to the neutral wording, never to a sharper claim.
      return 'PRICE_DATE_UNSPECIFIED';
  }
}

/**
 * Whether a human-stated re-verification date is the right thing to offer.
 *
 * An absent channel answers `RECOMMENDED`, and that direction is chosen on
 * purpose: the failure mode of offering an optional field to a live feed is a
 * field a person can leave blank, while the failure mode of hiding it from a
 * snapshot is a price that quietly ages with nothing to say about it.
 */
export function reverificationApplicabilityFor(
  ingestionChannel: string | null | undefined,
): ReverificationApplicability {
  return ingestionChannel && LIVE_INGESTION_CHANNELS.has(ingestionChannel)
    ? 'FOLLOWS_SOURCE_UPDATES'
    : 'RECOMMENDED';
}

/** What the room needs in order to ask this batch the right questions. */
export interface BatchTemporalQuestions {
  effectiveDateQuestion: EffectiveDateQuestion;
  reverification: ReverificationApplicability;
}

export function batchTemporalQuestions(batch: {
  sourceType: string | null | undefined;
  ingestionChannel?: string | null;
}): BatchTemporalQuestions {
  return {
    effectiveDateQuestion: effectiveDateQuestionFor(batch.sourceType),
    reverification: reverificationApplicabilityFor(batch.ingestionChannel),
  };
}
