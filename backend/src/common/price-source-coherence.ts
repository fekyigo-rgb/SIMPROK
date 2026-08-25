import { PriceSourceOrigin, PriceSourceType } from '@prisma/client';

/**
 * THE TYPE AN ORIGIN *TYPICALLY* IMPLIES — a last-resort default for a source
 * that structurally CANNOT state its own type. Never a rule about what is true.
 *
 * ORIGIN AND TYPE ARE DIFFERENT AXES, AND OWNER LAW SAYS SO IN THOSE WORDS:
 * `docs/control/BASIC-PRICE-MASTER-DECISION.md` §10 —
 *
 *     SOURCE_TYPE ≠ SOURCE_ORIGIN ≠ INGESTION_CHANNEL ≠ SYNC_MODE
 *
 * `sourceOrigin` answers WHO the price came from in the world. `sourceType`
 * answers WHAT KIND OF STATEMENT the document is. A government agency can
 * publish a market survey; a supplier can circulate a regulated tariff. The two
 * do not determine one another, and `schema.prisma` states the same law for the
 * channel axis in the same breath: "Intake never derives one axis from the
 * other."
 *
 * WHY THIS TABLE STILL EXISTS. Its one honest job is the job it was born for:
 * `reality-intake`'s business-subscription worker derives a `PriceSubmission`
 * from a `CanonicalPricePoint`, and that model HAS NO `sourceType` COLUMN AT
 * ALL while `PriceSubmission.sourceType` is required. The worker must write
 * something into a field its source cannot speak to, so it writes the type the
 * origin typically implies. That is a default for silence — not a judgement
 * about a source that spoke.
 *
 * WHAT IT MUST NEVER DO AGAIN. RM-03D1 promoted it into an equality that could
 * REFUSE a stated pair, and a later change wired that refusal into intake, the
 * metadata PATCH, and both write boundaries — so a person who truthfully
 * described a government-published market survey was told their own document
 * was incoherent, and the import form stopped asking for the type at all.
 * A default for a silent source had become a law over a speaking one.
 *
 * The refusal is gone. `expectedSourceTypeFor` remains, for the worker and for
 * suggesting a starting value to a human who may overrule it.
 */
export const SOURCE_TYPE_BY_ORIGIN: Record<PriceSourceOrigin, PriceSourceType> =
  {
    GOVERNMENT: 'REGULATION',
    SUPPLIER: 'VENDOR_QUOTE',
    STORE: 'VENDOR_QUOTE',
    DISTRIBUTOR: 'VENDOR_QUOTE',
    FIELD_REPORT: 'MARKET_SURVEY',
    COMMUNITY_REPORT: 'MARKET_SURVEY',
  };

/** Every origin must map, or a caller would silently get `undefined`. */
export function assertSourceOriginMappingComplete(): void {
  const unmapped = Object.values(PriceSourceOrigin).filter(
    (origin) => !SOURCE_TYPE_BY_ORIGIN[origin],
  );
  if (unmapped.length > 0) {
    throw new Error(
      `Unmapped PriceSourceOrigin values: ${unmapped.join(', ')}`,
    );
  }
}

/**
 * The type this origin TYPICALLY implies.
 *
 * A SUGGESTION, and the only lawful readings of it are: fill a column a silent
 * source cannot fill, or offer a human a starting value they may overrule. It
 * is never a test of whether a stated pair is allowed — see the header.
 */
export function expectedSourceTypeFor(
  origin: PriceSourceOrigin,
): PriceSourceType {
  return SOURCE_TYPE_BY_ORIGIN[origin];
}
