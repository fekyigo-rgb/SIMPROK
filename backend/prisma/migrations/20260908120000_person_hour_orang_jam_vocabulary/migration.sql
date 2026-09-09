-- PERSON_HOUR ORANG-JAM VOCABULARY — additive context-free unit aliases.
--
-- Adds ONLY raw spellings, through the SAME mechanism and the same idempotency
-- law as 20260717010000_kamus_unit_kernel_01a, 20260812090000_b1b12_golden_unit_coverage,
-- and 20260813090000_equipment_hour_source_vocabulary. No schema change, no new
-- UnitDefinition, no UnitConversionRule, no quantityFactor: PERSON_HOUR already
-- exists (kamus/b1b12), and every row below is a new way of WRITING it, not a
-- new thing to measure.
--
-- WHY THESE SPELLINGS, AND WHY CONTEXT-FREE
--
--   Indonesian AHSP prints a labourer's hour as "orang-jam" and abbreviates it
--   OJ / Org/Jam / Orang/Jam — the exact mirror of the person-DAY vocabulary
--   this kernel already catalogues context-free (OH / Org/Hari / Orang/Hari ->
--   PERSON_DAY in 20260717010000). Because every one of these spellings carries
--   the token "orang" (a person), it names a PERSON hour and nothing else, so it
--   is CONTEXT-FREE: it can never mean an equipment hour. This is the load-bearing
--   difference from bare "jam", which 20260812090000 deliberately left
--   context-scoped (PERSON_HOUR under LABOR, EQUIPMENT_HOUR under EQUIPMENT)
--   precisely because "jam" alone does not say whose hour it is. These rows do
--   not touch "jam"; they never collide with it (distinct normalised keys).
--
--   The relation to PERSON_HOUR is IDENTITY. Nothing here multiplies or divides
--   a price, and NO conversion rule is created: OH (PERSON_DAY) and OJ
--   (PERSON_HOUR) remain two distinct canonical units in the same PERSON_TIME
--   dimension, and any attempt to carry one to the other still fails closed with
--   CONVERSION_RULE_NOT_FOUND — a day is not eight hours here unless a governed
--   unitConversionRule proves it, which this migration does not assert.
--
-- WHY ONLY THREE ROWS
--
--   Normalisation is NFKC + trim + lowercase + whitespace-collapse, so OJ/oj,
--   Org/Jam/org/jam and Orang/Jam/orang/jam are three distinct normalised keys
--   (oj, org/jam, orang/jam); a second row per capitalisation would be a
--   duplicate that makes the spelling ambiguous — precisely what the resolver
--   refuses to guess through. The further-abbreviated "Org/Jm" (org/jm) is
--   deliberately NOT added: it has no precedent in the sanctioned person-DAY set
--   (there is no "org/hr"), so an unproven source that writes it fails closed as
--   UNKNOWN_UNIT_ALIAS, which is the correct answer, not a gap.

-- Context-free aliases: one canonical meaning (a person's hour), whatever the
-- resource is. Idempotent on (normalizedAlias, unitDefinitionId, context IS NULL).
INSERT INTO "unit_aliases"("id","rawAlias","normalizedAlias","unitDefinitionId","updatedAt") SELECT v.id,v.raw,v.norm,u.id,CURRENT_TIMESTAMP FROM (VALUES
('20000000-0000-4000-8000-000000000026'::uuid,'OJ','oj','PERSON_HOUR'),
('20000000-0000-4000-8000-000000000027'::uuid,'Org/Jam','org/jam','PERSON_HOUR'),
('20000000-0000-4000-8000-000000000028'::uuid,'Orang/Jam','orang/jam','PERSON_HOUR')) v(id,raw,norm,code) JOIN "unit_definitions" u ON u."code"=v.code WHERE NOT EXISTS(SELECT 1 FROM "unit_aliases" a WHERE a."normalizedAlias"=v.norm AND a."unitDefinitionId"=u.id AND a."context" IS NULL);

-- A normalised spelling that already means something else CONTEXT-FREE would make
-- every future resolution of it ambiguous. Refuse loudly here rather than let the
-- ambiguity reach a reviewer. (A context-scoped meaning is fine — eligibility law
-- never borrows it — so only context-free conflicts are checked.)
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM "unit_aliases" a JOIN "unit_definitions" u ON u."id"=a."unitDefinitionId" WHERE a."normalizedAlias" IN ('oj','org/jam','orang/jam') AND a."context" IS NULL AND u."code"<>'PERSON_HOUR') THEN
  RAISE EXCEPTION 'Conflicting context-free alias for oj/org/jam/orang/jam already points at a different canonical unit';
END IF;
END $$;
