-- EQUIPMENT HOUR SOURCE VOCABULARY — additive contextual unit aliases.
--
-- Adds ONLY raw spellings, through the SAME mechanism and the same idempotency
-- law as 20260717010000_kamus_unit_kernel_01a and
-- 20260812090000_b1b12_golden_unit_coverage. No schema change, no new
-- UnitDefinition, no UnitConversionRule, no quantity factor: EQUIPMENT_HOUR
-- already exists, and every row below is a new way of WRITING it, not a new
-- thing to measure.
--
-- WHY THESE SPELLINGS, AND WHY ONLY IN EQUIPMENT CONTEXT
--
--   Indonesian rental schedules price a machine per operating hour and write
--   that hour several ways: "U/J" (unit/jam), "Jm", and plain "Jam". They all
--   name the same quantity — one hour of machine time — so the relation to
--   EQUIPMENT_HOUR is IDENTITY. Nothing here multiplies or divides a price.
--
--   Every row is context-scoped to EQUIPMENT on purpose. "U/J" and "Jm" are
--   equipment-schedule vocabulary; they say nothing about a labourer's hour and
--   must never resolve on a LABOR or MATERIAL row. Because the kernel treats a
--   context-scoped alias as ineligible without trusted context, these rows
--   cannot leak: a LABOR row asking for "U/J" finds no context-free candidate
--   and fails closed, which is the correct answer, not a gap.
--
--   The absence of these spellings from the B1-B12 Golden evidence pack is not
--   evidence they are invalid — that pack simply did not contain them. History
--   stays as it was recorded; vocabulary grows forward, here.
--
-- WHY ONLY TWO ROWS
--
--   Normalisation is NFKC + trim + lowercase + whitespace-collapse, so "U/J"
--   and "u/j" are one normalised key ("u/j"), and "Jm" and "jm" are one key
--   ("jm"). A second row per capitalisation would be a duplicate that makes the
--   spelling ambiguous — precisely what the resolver refuses to guess through.
--   "Jam"/"jam" needs no row at all: 20260812090000 already catalogues "jam"
--   under both LABOR and EQUIPMENT.

INSERT INTO "unit_aliases"("id","rawAlias","normalizedAlias","unitDefinitionId","context","updatedAt") SELECT v.id,v.raw,v.norm,u.id,v.ctx,CURRENT_TIMESTAMP FROM (VALUES
('21000000-0000-4000-8000-000000000003'::uuid,'U/J','u/j','EQUIPMENT_HOUR','EQUIPMENT'),
('21000000-0000-4000-8000-000000000004'::uuid,'Jm','jm','EQUIPMENT_HOUR','EQUIPMENT')) v(id,raw,norm,code,ctx) JOIN "unit_definitions" u ON u."code"=v.code WHERE NOT EXISTS(SELECT 1 FROM "unit_aliases" a WHERE a."normalizedAlias"=v.norm AND a."unitDefinitionId"=u.id AND a."context"=v.ctx);

-- A normalised spelling that already means something else in the SAME context
-- would make every future resolution of it ambiguous. Refuse loudly here rather
-- than let the ambiguity reach a reviewer.
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM "unit_aliases" a JOIN "unit_definitions" u ON u."id"=a."unitDefinitionId" WHERE a."normalizedAlias" IN ('u/j','jm') AND a."context"='EQUIPMENT' AND u."code"<>'EQUIPMENT_HOUR') THEN
  RAISE EXCEPTION 'Conflicting EQUIPMENT alias for u/j or jm already points at a different canonical unit';
END IF;
END $$;
