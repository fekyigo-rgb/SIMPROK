-- SCOPE-03B1: additive, nullable, immutable price evidence on existing
-- append-only reviewed row mapping. No new price authority or table.
ALTER TABLE "basic_price_import_row_resource_mappings"
  ADD COLUMN "conversionSourcePriceValue" DECIMAL(18,2),
  ADD COLUMN "conversionAdaptedPriceValue" DECIMAL(18,2),
  ADD COLUMN "conversionQuantityFactor" DECIMAL(24,12),
  ADD COLUMN "conversionRuleId" UUID,
  ADD COLUMN "conversionRuleVersion" INTEGER,
  ADD COLUMN "conversionPolicyVersion" TEXT;

ALTER TABLE "basic_price_import_row_resource_mappings"
  ADD CONSTRAINT "bp_mapping_conversion_atomic_evidence_check"
  CHECK (
    (
      "conversionSourcePriceValue" IS NULL AND
      "conversionAdaptedPriceValue" IS NULL AND
      "conversionQuantityFactor" IS NULL AND
      "conversionRuleId" IS NULL AND
      "conversionRuleVersion" IS NULL AND
      "conversionPolicyVersion" IS NULL
    )
    OR
    (
      "conversionSourcePriceValue" IS NOT NULL AND
      "conversionAdaptedPriceValue" IS NOT NULL AND
      "conversionQuantityFactor" IS NOT NULL AND
      "conversionQuantityFactor" > 0 AND
      "conversionRuleId" IS NOT NULL AND
      "conversionRuleVersion" IS NOT NULL AND
      "conversionRuleVersion" > 0 AND
      "conversionPolicyVersion" IS NOT NULL AND
      length(btrim("conversionPolicyVersion")) > 0 AND
      "conversionSourcePriceValue" >= 0 AND
      "conversionAdaptedPriceValue" >= 0
    )
  );

ALTER TABLE "basic_price_import_row_resource_mappings"
  ADD CONSTRAINT "bp_mapping_conversion_rule_fk"
  FOREIGN KEY ("conversionRuleId") REFERENCES "unit_conversion_rules"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bp_mapping_conversion_rule_idx"
  ON "basic_price_import_row_resource_mappings"("conversionRuleId");

-- No writer may revise frozen conversion arithmetic after review.
-- Any legitimate correction creates a new decision with compensation.
CREATE OR REPLACE FUNCTION "bp_mapping_conversion_evidence_immutable"()
RETURNS trigger AS $$
BEGIN
  IF ROW(
    NEW."conversionSourcePriceValue", NEW."conversionAdaptedPriceValue",
    NEW."conversionQuantityFactor", NEW."conversionRuleId",
    NEW."conversionRuleVersion", NEW."conversionPolicyVersion"
  ) IS DISTINCT FROM ROW(
    OLD."conversionSourcePriceValue", OLD."conversionAdaptedPriceValue",
    OLD."conversionQuantityFactor", OLD."conversionRuleId",
    OLD."conversionRuleVersion", OLD."conversionPolicyVersion"
  ) THEN
    RAISE EXCEPTION 'BASIC_PRICE_CONVERSION_EVIDENCE_IMMUTABLE'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bp_mapping_conversion_evidence_immutable_trigger"
BEFORE UPDATE ON "basic_price_import_row_resource_mappings"
FOR EACH ROW EXECUTE FUNCTION "bp_mapping_conversion_evidence_immutable"();
