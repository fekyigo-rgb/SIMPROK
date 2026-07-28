-- CreateIndex
CREATE INDEX "basic_price_import_row_resource_mappings_reviewerAccountId_idx" ON "basic_price_import_row_resource_mappings"("reviewerAccountId");

-- CreateIndex
CREATE INDEX "basic_price_source_equivalences_verifiedByAccountId_idx" ON "basic_price_source_equivalences"("verifiedByAccountId");

-- AddForeignKey
ALTER TABLE "basic_price_import_row_resource_mappings" ADD CONSTRAINT "fk_row_mapping_reviewer" FOREIGN KEY ("reviewerAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basic_price_source_equivalences" ADD CONSTRAINT "fk_equivalence_verified_by" FOREIGN KEY ("verifiedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RM-02D1-REMEDIATION-V3.2.1 (F1): sourceSha256 values stored on
-- BasicPriceSourceEquivalence must be exactly 64 uppercase hex characters,
-- the same canonical storage convention already enforced on
-- resource_source_identities.sourceSha256
-- (see 20260727025308_rm02c1a_resource_identity_schema_foundation). A
-- read-only preflight confirmed zero existing rows violate this before
-- this constraint was added.
-- CheckConstraint
ALTER TABLE "basic_price_source_equivalences"
ADD CONSTRAINT "basic_price_source_equivalences_batch_sha256_format_check"
CHECK ("batchSourceSha256" ~ '^[0-9A-F]{64}$');

-- CheckConstraint
ALTER TABLE "basic_price_source_equivalences"
ADD CONSTRAINT "basic_price_source_equivalences_canonical_sha256_format_check"
CHECK ("canonicalSourceSha256" ~ '^[0-9A-F]{64}$');
