-- BP-CORR-01B TEMPORAL CORRECTIVE — WHEN WE LEARNED IT vs WHEN IT BECAME TRUE.
--
-- ADDITIVE ONLY. One nullable column and one narrow CHECK. No backfill, no data
-- rewrite, no destructive DDL, and the already-applied
-- 20260826120000_bpcorr01_published_price_supersession migration is left exactly
-- as it was — migration history that has already run is a record of what
-- happened, not a draft.
--
-- THE DEFECT THIS CLOSES. BP-CORR-01B shipped withdrawal using the audit row's
-- `createdAt` as its effective point. That silently asserted something SIMPROK
-- is not entitled to assert: that a withdrawal became true at the instant we
-- were told about it. A source that retracts its July list "effective 1 August"
-- and is processed on 5 August would have kept the withdrawn price on offer for
-- four days; a retraction announced today and effective next Monday would have
-- removed the price today. Both directions were wrong, and both were invisible
-- because the two facts usually coincide.

ALTER TABLE "basic_price_publication_audits" ADD COLUMN "effectiveAt" TIMESTAMP(3);

-- NO BACKFILL, DELIBERATELY.
--
-- Every row that exists before this migration is a PUBLISH or a SUPERSEDED, and
-- both are instantaneous governance transitions: they become true exactly when
-- they are recorded, so there is no separate effective fact to state about them.
-- Writing `createdAt` into this column for those rows would manufacture a claim
-- nobody made, and would make a NULL — which honestly means "this action has no
-- separate effective time" — indistinguishable from a stated one.

-- MANDATORY FOR THE ONE ACTION WHOSE CURRENTNESS DEPENDS ON IT.
--
-- The currentness projection asks `effectiveAt <= asOf`. A WITHDRAWN row with a
-- NULL effective time would silently never match that predicate, so the price
-- would stay on offer forever and the withdrawal would be a governance record
-- that governs nothing — failing OPEN, which is the one direction this gate may
-- never fail. Made unrepresentable rather than merely unwritten.
--
-- SAFE AGAINST EXISTING DATA. WITHDRAWN is introduced by BP-CORR-01B itself and
-- no writer before it could produce that action, so there is no pre-existing row
-- this constraint can retroactively invalidate. Verified on the rehearsal
-- cluster before writing this migration: the only action present was PUBLISH.
--
-- PUBLISH and SUPERSEDED are explicitly untouched — the constraint names the one
-- action it governs rather than demanding a value from every row.
ALTER TABLE "basic_price_publication_audits"
  ADD CONSTRAINT "basic_price_publication_audits_withdrawn_requires_effective_at_check" CHECK (
    "action" <> 'WITHDRAWN' OR "effectiveAt" IS NOT NULL
  );

-- The currentness predicate filters on (basicPriceId, action, effectiveAt) as a
-- NOT EXISTS. `basicPriceId` is already indexed and is by far the most selective
-- of the three on this table, so the existing index already serves the lookup and
-- a second one would cost writes on an append-only audit table to buy nothing
-- measurable. No index is added here, and no claim is made about a query plan
-- that has not been measured.
