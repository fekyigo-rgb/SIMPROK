-- Additive only. One scoped human unit decision per durable import occurrence.
-- Does not alter unit_definitions, unit_aliases, conversion rules, or existing columns.

CREATE TABLE "ahsp_import_unit_decisions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "importJobId" UUID NOT NULL,
    "importLineId" UUID NOT NULL,
    "occurrenceKey" VARCHAR(64) NOT NULL,
    "unitDefinitionId" UUID NOT NULL,
    "rawUnit" TEXT NOT NULL,
    "decidedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ahsp_import_unit_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ahsp_import_unit_decisions_importLineId_occurrenceKey_key" ON "ahsp_import_unit_decisions"("importLineId", "occurrenceKey");

CREATE INDEX "ahsp_import_unit_decisions_workspaceId_importJobId_idx" ON "ahsp_import_unit_decisions"("workspaceId", "importJobId");

ALTER TABLE "ahsp_import_unit_decisions" ADD CONSTRAINT "ahsp_import_unit_decisions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_import_unit_decisions" ADD CONSTRAINT "ahsp_import_unit_decisions_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ahsp_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_import_unit_decisions" ADD CONSTRAINT "ahsp_import_unit_decisions_importLineId_fkey" FOREIGN KEY ("importLineId") REFERENCES "ahsp_import_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ahsp_import_unit_decisions" ADD CONSTRAINT "ahsp_import_unit_decisions_unitDefinitionId_fkey" FOREIGN KEY ("unitDefinitionId") REFERENCES "unit_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
