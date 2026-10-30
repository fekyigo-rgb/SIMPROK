-- BP-UNIT-DISPLAY-01: additive source vocabulary only.
-- No canonical UnitDefinition change, no unit conversion, and no existing alias mutation.
-- "Buah/Meter" and "Buah per Meter" denote the existing BH_PER_M identity.
-- Raw source cells remain verbatim in BasicPriceImportRow.rawUnitText.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "unit_definitions" WHERE "code" = 'BH_PER_M' AND "isActive" = true) THEN
    RAISE EXCEPTION 'BP-UNIT-DISPLAY-01 requires existing canonical BH_PER_M';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "unit_aliases" a
    JOIN "unit_definitions" u ON u."id" = a."unitDefinitionId"
    WHERE a."normalizedAlias" IN ('buah/meter', 'buah per meter')
      AND (u."code" <> 'BH_PER_M' OR a."context" IS NOT NULL OR NOT a."isActive")
  ) THEN
    RAISE EXCEPTION 'BP-UNIT-DISPLAY-01 conflicting governed unit alias; review required';
  END IF;
END $$;

INSERT INTO "unit_aliases"("id", "rawAlias", "normalizedAlias", "unitDefinitionId", "updatedAt")
SELECT v.id, v.raw, v.norm, u.id, CURRENT_TIMESTAMP
FROM (VALUES
('c7653c4d-3b0c-40f0-b010-29012b986701'::uuid, 'Buah/Meter', 'buah/meter', 'BH_PER_M'),
('c7653c4d-3b0c-40f0-b010-29012b986702'::uuid, 'Buah per Meter', 'buah per meter', 'BH_PER_M')
) v(id, raw, norm, code)
JOIN "unit_definitions" u ON u."code" = v.code
WHERE NOT EXISTS (
  SELECT 1 FROM "unit_aliases" a
  WHERE a."normalizedAlias" = v.norm AND a."context" IS NULL
);