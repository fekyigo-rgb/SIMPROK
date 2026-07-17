CREATE TYPE "UnitDimension" AS ENUM ('COUNT','MASS','LENGTH','AREA','VOLUME','TIME','PERSON_TIME','EQUIPMENT_TIME');
CREATE TYPE "UnitKind" AS ENUM ('CANONICAL','COMMERCIAL_PACKAGE','CONTEXTUAL');
CREATE TYPE "UnitConversionType" AS ENUM ('EXACT_GLOBAL','PACKAGE_CONTENT','RESOURCE_SPECIFIC','DENSITY_REQUIRED','CONTEXTUAL_TIME','NOT_CONVERTIBLE');
CREATE TYPE "UnitConversionRuleStatus" AS ENUM ('ACTIVE','RETIRED');

CREATE TABLE "unit_definitions" ("id" UUID NOT NULL,"code" TEXT NOT NULL,"displayName" TEXT NOT NULL,"symbol" TEXT NOT NULL,"dimension" "UnitDimension" NOT NULL,"kind" "UnitKind" NOT NULL,"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "unit_definitions_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "unit_definitions_code_key" ON "unit_definitions"("code");
CREATE TABLE "unit_aliases" ("id" UUID NOT NULL,"rawAlias" TEXT NOT NULL,"normalizedAlias" TEXT NOT NULL,"unitDefinitionId" UUID NOT NULL,"context" TEXT,"isActive" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "unit_aliases_pkey" PRIMARY KEY ("id"));
CREATE INDEX "unit_aliases_normalizedAlias_isActive_idx" ON "unit_aliases"("normalizedAlias","isActive");
CREATE INDEX "unit_aliases_unitDefinitionId_idx" ON "unit_aliases"("unitDefinitionId");
CREATE TABLE "unit_conversion_rules" ("id" UUID NOT NULL,"sourceUnitId" UUID NOT NULL,"targetUnitId" UUID NOT NULL,"conversionType" "UnitConversionType" NOT NULL,"quantityFactor" DECIMAL(24,12) NOT NULL,"resourceCatalogId" UUID,"evidenceReference" TEXT,"evidenceHash" TEXT,"evidencePayload" JSONB,"version" INTEGER NOT NULL,"status" "UnitConversionRuleStatus" NOT NULL DEFAULT 'ACTIVE',"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "unit_conversion_rules_pkey" PRIMARY KEY ("id"),CONSTRAINT "unit_rules_positive_factor" CHECK ("quantityFactor">0),CONSTRAINT "unit_rules_distinct_units" CHECK ("sourceUnitId"<>"targetUnitId"),CONSTRAINT "unit_rules_evidence_required" CHECK ("conversionType" NOT IN ('PACKAGE_CONTENT','RESOURCE_SPECIFIC') OR "evidenceReference" IS NOT NULL OR "evidenceHash" IS NOT NULL OR "evidencePayload" IS NOT NULL));
CREATE UNIQUE INDEX "unit_conversion_rule_version_key" ON "unit_conversion_rules"("sourceUnitId","targetUnitId","conversionType","resourceCatalogId","version");
CREATE INDEX "unit_conversion_rules_sourceUnitId_targetUnitId_status_idx" ON "unit_conversion_rules"("sourceUnitId","targetUnitId","status");
CREATE INDEX "unit_conversion_rules_resourceCatalogId_idx" ON "unit_conversion_rules"("resourceCatalogId");
ALTER TABLE "ahsp_versions" ADD COLUMN "outputUnit" TEXT,ADD COLUMN "outputUnitDefinitionId" UUID;
ALTER TABLE "ahsp_snapshots" ADD COLUMN "outputUnit" TEXT,ADD COLUMN "outputUnitDefinitionId" UUID;
ALTER TABLE "project_ahsp_resource_resolutions" ADD COLUMN "sourceUnitDefinitionId" UUID,ADD COLUMN "targetUnitDefinitionId" UUID,ADD COLUMN "unitConversionRuleId" UUID,ADD COLUMN "unitConversionRuleVersion" INTEGER,ADD COLUMN "quantityFactor" DECIMAL(24,12);
ALTER TABLE "unit_aliases" ADD CONSTRAINT "unit_aliases_unitDefinitionId_fkey" FOREIGN KEY ("unitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_conversion_rules" ADD CONSTRAINT "unit_conversion_rules_sourceUnitId_fkey" FOREIGN KEY ("sourceUnitId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_conversion_rules" ADD CONSTRAINT "unit_conversion_rules_targetUnitId_fkey" FOREIGN KEY ("targetUnitId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_conversion_rules" ADD CONSTRAINT "unit_conversion_rules_resourceCatalogId_fkey" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ahsp_versions" ADD CONSTRAINT "ahsp_versions_outputUnitDefinitionId_fkey" FOREIGN KEY ("outputUnitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ahsp_snapshots" ADD CONSTRAINT "ahsp_snapshots_outputUnitDefinitionId_fkey" FOREIGN KEY ("outputUnitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "pahr_sourceUnitDefinitionId_fkey" FOREIGN KEY ("sourceUnitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "pahr_targetUnitDefinitionId_fkey" FOREIGN KEY ("targetUnitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_ahsp_resource_resolutions" ADD CONSTRAINT "pahr_unitConversionRuleId_fkey" FOREIGN KEY ("unitConversionRuleId") REFERENCES "unit_conversion_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "project_ahsp_resource_resolutions_sourceUnitDefinitionId_idx" ON "project_ahsp_resource_resolutions"("sourceUnitDefinitionId");
CREATE INDEX "project_ahsp_resource_resolutions_targetUnitDefinitionId_idx" ON "project_ahsp_resource_resolutions"("targetUnitDefinitionId");
CREATE INDEX "project_ahsp_resource_resolutions_unitConversionRuleId_idx" ON "project_ahsp_resource_resolutions"("unitConversionRuleId");

DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT * FROM (VALUES
('10000000-0000-4000-8000-000000000001'::uuid,'PERSON_DAY','Person day','PERSON_DAY','PERSON_TIME'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000002'::uuid,'KG','Kilogram','kg','MASS'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000003'::uuid,'M1','Metre','m1','LENGTH'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000004'::uuid,'M2','Square metre','m2','AREA'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000005'::uuid,'M3','Cubic metre','m3','VOLUME'::"UnitDimension",'CANONICAL'::"UnitKind"),
('10000000-0000-4000-8000-000000000006'::uuid,'SAK','Sack','sak','COUNT'::"UnitDimension",'COMMERCIAL_PACKAGE'::"UnitKind"),
('10000000-0000-4000-8000-000000000007'::uuid,'ROLL','Roll','roll','COUNT'::"UnitDimension",'COMMERCIAL_PACKAGE'::"UnitKind"),
('10000000-0000-4000-8000-000000000008'::uuid,'TRUCK','Truck load','truck','COUNT'::"UnitDimension",'CONTEXTUAL'::"UnitKind")) v(id,code,name,symbol,dimension,kind) LOOP
IF EXISTS(SELECT 1 FROM "unit_definitions" u WHERE u."code"=r.code AND (u."displayName"<>r.name OR u."symbol"<>r.symbol OR u."dimension"<>r.dimension OR u."kind"<>r.kind)) THEN RAISE EXCEPTION 'Incompatible canonical unit definition: %',r.code; END IF;
INSERT INTO "unit_definitions"("id","code","displayName","symbol","dimension","kind","updatedAt") SELECT r.id,r.code,r.name,r.symbol,r.dimension,r.kind,CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM "unit_definitions" u WHERE u."code"=r.code); END LOOP; END $$;
INSERT INTO "unit_aliases"("id","rawAlias","normalizedAlias","unitDefinitionId","updatedAt") SELECT v.id,v.raw,v.norm,u.id,CURRENT_TIMESTAMP FROM (VALUES
('20000000-0000-4000-8000-000000000001'::uuid,'OH','oh','PERSON_DAY'),('20000000-0000-4000-8000-000000000002'::uuid,'Org/Hari','org/hari','PERSON_DAY'),('20000000-0000-4000-8000-000000000003'::uuid,'Orang/Hari','orang/hari','PERSON_DAY'),('20000000-0000-4000-8000-000000000004'::uuid,'PERSON_DAY','person_day','PERSON_DAY'),('20000000-0000-4000-8000-000000000005'::uuid,'KG','kg','KG'),('20000000-0000-4000-8000-000000000006'::uuid,'M1','m1','M1'),('20000000-0000-4000-8000-000000000007'::uuid,'M2','m2','M2'),('20000000-0000-4000-8000-000000000008'::uuid,'M3','m3','M3'),('20000000-0000-4000-8000-000000000009'::uuid,'SAK','sak','SAK'),('20000000-0000-4000-8000-000000000010'::uuid,'ROLL','roll','ROLL'),('20000000-0000-4000-8000-000000000011'::uuid,'TRUCK','truck','TRUCK')) v(id,raw,norm,code) JOIN "unit_definitions" u ON u."code"=v.code WHERE NOT EXISTS(SELECT 1 FROM "unit_aliases" a WHERE a."normalizedAlias"=v.norm AND a."unitDefinitionId"=u.id AND a."context" IS NULL);
