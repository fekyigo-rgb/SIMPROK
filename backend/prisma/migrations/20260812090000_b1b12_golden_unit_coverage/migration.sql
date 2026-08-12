-- B1B12_UNIT_KERNEL_COVERAGE_01 — additive canonical unit reference data.
--
-- Adds ONLY the canonical units the Golden Bina Marga / Drainase B1-B12 section
-- actually needs, through the SAME mechanism and the same idempotency law as
-- 20260717010000_kamus_unit_kernel_01a. No schema change: every dimension and
-- kind used below already exists in the enums that migration created.
--
-- WHY EACH IDENTITY IS ITS OWN ROW
--
--   PERSON_HOUR / EQUIPMENT_HOUR  the source prints "jam" for both a worker and
--     a machine, but PERSON_TIME and EQUIPMENT_TIME are already two distinct
--     dimensions in this schema, and PERSON_DAY already lives in PERSON_TIME.
--     One hour of a labourer and one hour of an excavator are not the same
--     quantity and are never priced from the same basic price. They are
--     therefore two canonical units sharing one raw spelling, separated by
--     UnitAlias.context — the column this table has always had for exactly this.
--
--   LITER   a volume the source writes "Ltr". Canonical, VOLUME. No LITER<->M3
--     conversion rule is created: the Golden path prices litres against litres,
--     and a conversion nobody needs is a claim nobody verified.
--
--   LS      Lump Sum. This is a BOUNDED CONTEXTUAL REPRESENTATION inside the
--     existing Unit model, not a claim that COUNT is the mathematically
--     complete dimension of a lump sum — a lump sum has no physical dimension
--     at all. CONTEXTUAL is the honest marker for that (the same shape TRUCK
--     already uses), and the COUNT slot is carried only because the enum offers
--     no dimensionless value. What the model DOES guarantee is the part that
--     matters: LS keeps its own canonical identity, is never interchangeable
--     with UNIT, and has no conversion rule, so any attempt fails closed with
--     CONVERSION_RULE_NOT_FOUND. A dedicated dimension is deliberately NOT
--     introduced here.
--
--   UNIT    the canonical discrete "each" for a supplied item (e.g. a rubber
--     ring). "unit" and "Unit" differ only by case, which normalisation already
--     folds, so they are one row and not two identities.
--
--   LBR     lembar/sheet. A sheet is the commercial form a sheet material is
--     supplied in, exactly like ROLL and SAK, so it is COMMERCIAL_PACKAGE. It
--     keeps its own identity and is deliberately NOT aliased onto UNIT.
--
--   BH_PER_M  "bh/m" is buah-per-metre — formally a count PER LENGTH. The
--     UnitDimension enum has no denominator, so this row is a BOUNDED
--     CONTEXTUAL REPRESENTATION and NOT a dimensionally complete one: COUNT
--     records the numerator, CONTEXTUAL records that the value is only
--     meaningful against its length context. No dimensional-analysis framework
--     is introduced. The load-bearing guarantee is the safety law:
--     BH_PER_M is not M1, and BH_PER_M -> M1 has no conversion rule, so
--     resolving it as ordinary metre fails closed rather than silently.
--
-- Aliases carry raw spelling variants only. Normalisation (NFKC + trim +
-- lowercase + whitespace collapse) folds case, so one row per DISTINCT
-- normalised form — two rows sharing a normalised form would make the unit
-- ambiguous, which is precisely what the resolver refuses to guess through.
-- The straight (U+0027) and curly (U+2019) apostrophes do NOT normalise to each
-- other, so "M'" and "M’" are genuinely two rows.

DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT * FROM (VALUES
('10000000-0000-4000-8000-000000000009'::uuid,'PERSON_HOUR','Person hour','jam-orang','PERSON_TIME'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000010'::uuid,'EQUIPMENT_HOUR','Equipment hour','jam-alat','EQUIPMENT_TIME'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000011'::uuid,'LITER','Litre','liter','VOLUME'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000012'::uuid,'LS','Lump sum','ls','COUNT'::"UnitDimension",'CONTEXTUAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000013'::uuid,'UNIT','Unit (each)','unit','COUNT'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000014'::uuid,'LBR','Lembar (sheet)','lbr','COUNT'::"UnitDimension",'COMMERCIAL_PACKAGE'::"UnitKind"),
('10000000-0000-4000-8000-000000000015'::uuid,'BH_PER_M','Buah per metre','bh/m','COUNT'::"UnitDimension",'CONTEXTUAL'::"UnitKind")) v(id,code,name,symbol,dimension,kind) LOOP
IF EXISTS(SELECT 1 FROM "unit_definitions" u WHERE u."code"=r.code AND (u."displayName"<>r.name OR u."symbol"<>r.symbol OR u."dimension"<>r.dimension OR u."kind"<>r.kind)) THEN RAISE EXCEPTION 'Incompatible canonical unit definition: %',r.code; END IF;
INSERT INTO "unit_definitions"("id","code","displayName","symbol","dimension","kind","updatedAt") SELECT r.id,r.code,r.name,r.symbol,r.dimension,r.kind,CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM "unit_definitions" u WHERE u."code"=r.code); END LOOP; END $$;

-- Context-free aliases: one canonical meaning, whatever the resource is.
INSERT INTO "unit_aliases"("id","rawAlias","normalizedAlias","unitDefinitionId","updatedAt") SELECT v.id,v.raw,v.norm,u.id,CURRENT_TIMESTAMP FROM (VALUES
('20000000-0000-4000-8000-000000000012'::uuid,'PERSON_HOUR','person_hour','PERSON_HOUR'),
('20000000-0000-4000-8000-000000000013'::uuid,'EQUIPMENT_HOUR','equipment_hour','EQUIPMENT_HOUR'),
('20000000-0000-4000-8000-000000000014'::uuid,'m','m','M1'),
('20000000-0000-4000-8000-000000000015'::uuid,'M''','m''','M1'),
('20000000-0000-4000-8000-000000000016'::uuid,'M’','m’','M1'),
('20000000-0000-4000-8000-000000000017'::uuid,'LITER','liter','LITER'),
('20000000-0000-4000-8000-000000000018'::uuid,'Ltr','ltr','LITER'),
('20000000-0000-4000-8000-000000000019'::uuid,'LS','ls','LS'),
('20000000-0000-4000-8000-000000000020'::uuid,'UNIT','unit','UNIT'),
('20000000-0000-4000-8000-000000000021'::uuid,'LBR','lbr','LBR'),
('20000000-0000-4000-8000-000000000022'::uuid,'BH_PER_M','bh_per_m','BH_PER_M'),
('20000000-0000-4000-8000-000000000023'::uuid,'bh/m','bh/m','BH_PER_M'),
('20000000-0000-4000-8000-000000000024'::uuid,'bh/M''','bh/m''','BH_PER_M'),
('20000000-0000-4000-8000-000000000025'::uuid,'bh/M’','bh/m’','BH_PER_M')) v(id,raw,norm,code) JOIN "unit_definitions" u ON u."code"=v.code WHERE NOT EXISTS(SELECT 1 FROM "unit_aliases" a WHERE a."normalizedAlias"=v.norm AND a."unitDefinitionId"=u.id AND a."context" IS NULL);

-- Context-scoped aliases: the SAME raw word, two canonical meanings. Without a
-- trusted context the resolver sees two candidates and returns
-- AMBIGUOUS_UNIT_ALIAS, which is the intended answer, not a defect.
INSERT INTO "unit_aliases"("id","rawAlias","normalizedAlias","unitDefinitionId","context","updatedAt") SELECT v.id,v.raw,v.norm,u.id,v.ctx,CURRENT_TIMESTAMP FROM (VALUES
('21000000-0000-4000-8000-000000000001'::uuid,'jam','jam','PERSON_HOUR','LABOR'),
('21000000-0000-4000-8000-000000000002'::uuid,'jam','jam','EQUIPMENT_HOUR','EQUIPMENT')) v(id,raw,norm,code,ctx) JOIN "unit_definitions" u ON u."code"=v.code WHERE NOT EXISTS(SELECT 1 FROM "unit_aliases" a WHERE a."normalizedAlias"=v.norm AND a."unitDefinitionId"=u.id AND a."context"=v.ctx);
