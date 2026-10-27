-- BP-C2 — exact provenance idempotency, no second price writer or history.
--
-- The old unique expression incorrectly treated different suppliers with the
-- same monetary quote, business date and reporting account as one fact. Their
-- SOURCE IDENTITIES are not in this key: they are in the append-only
-- BasicPriceProvenanceCorrection birth audit.
--
-- The EXISTING Detail transaction already serializes the actual predecessor
-- with SELECT ... FOR UPDATE. Its tightened writer now confirms that an exact
-- repeat has the same predecessor, same-source decision and recorded source
-- identity, and refuses a second SAME-SOURCE child. Therefore a DB uniqueness
-- constraint based ONLY on money is both false and unnecessary. Replace it
-- with the exact same nonunique lookup index, retaining query efficiency.
--
-- NO changes to old rows, values, audit events, source documents, foreign
-- keys, catalog, resource identity, validity time or permanent runtime.

DROP INDEX "basic_prices_private_new_observation_idempotency_key";

CREATE INDEX "basic_prices_private_new_observation_lookup_idx"
ON "basic_prices" (
  "workspaceId",
  "resourceId",
  COALESCE("regionId", '00000000-0000-0000-0000-000000000000'::uuid),
  "effectiveDate",
  "value",
  COALESCE("kdnPercent", ('-1'::numeric)),
  "reportedByAccountId"
)
WHERE "recordsNewObservation" = TRUE
  AND "assetScope" = 'WORKSPACE_PRIVATE';
