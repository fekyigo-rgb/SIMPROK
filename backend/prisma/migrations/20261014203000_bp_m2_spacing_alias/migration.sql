-- BP-UNIT-M2-ALIAS-01: REUSE the existing Unit Kernel and M2 identity.
-- Read-only evidence: five Basic Price rows spell canonical M2 as "M 2".
-- Spacing of square-metre symbol; no conversion, new unit, or new resource.
-- NEVER infer M5, V2, Staf, Dos, Zak, Gallon or other unknown units.
-- Idempotent; fail closed on missing canonical proof or conflicting alias.
DO $$
DECLARE canonical_m2 uuid;
BEGIN
  SELECT u.id INTO STRICT canonical_m2
  FROM "unit_definitions" u
  WHERE u."code" = 'M2'
    AND u."isActive" = true
    AND u."dimension" = 'AREA'::"UnitDimension";

  IF NOT EXISTS (
    SELECT 1 FROM "unit_aliases" a
    WHERE a."normalizedAlias" = 'm2'
      AND a.context IS NULL AND a."isActive" = true
      AND a."unitDefinitionId" = canonical_m2
  ) THEN
    RAISE EXCEPTION 'M2 canonical spelling is not independently proved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "unit_aliases" a
    WHERE a."normalizedAlias" = 'm 2'
      AND (a."unitDefinitionId" <> canonical_m2
           OR a.context IS NOT NULL OR a."isActive" = false)
  ) THEN
    RAISE EXCEPTION 'M 2 alias already has incompatible provenance';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "unit_aliases" a
    WHERE a."normalizedAlias" = 'm 2'
      AND a.context IS NULL AND a."isActive" = true
      AND a."unitDefinitionId" = canonical_m2
  ) THEN
    INSERT INTO "unit_aliases" (
      "id", "rawAlias", "normalizedAlias", "unitDefinitionId",
      context, "isActive", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), 'M 2', 'm 2', canonical_m2,
      NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  END IF;
END $$;
