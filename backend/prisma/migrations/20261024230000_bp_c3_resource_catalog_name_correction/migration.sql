-- BP-C3: isolated append-only audit for corrections to an ACTIVE catalog label.
-- Never changes ResourceCatalog identity, classification, specs, unit, price or original import text.
CREATE TABLE "resource_catalog_name_corrections" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "resourceCatalogId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "previousName" TEXT NOT NULL,
  "correctedName" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" TEXT NOT NULL,
  "priorUpdatedAt" TIMESTAMP(3) NOT NULL,
  "newUpdatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resource_catalog_name_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bp_c3_name_reason_guard" CHECK (length(btrim("reason")) >= 10),
  CONSTRAINT "bp_c3_name_evidence_guard" CHECK (length(btrim("evidence")) >= 20),
  CONSTRAINT "bp_c3_name_changed_guard" CHECK ("previousName" <> "correctedName")
);
CREATE UNIQUE INDEX "bp_c3_name_one_per_version"
  ON "resource_catalog_name_corrections" ("resourceCatalogId", "priorUpdatedAt");
CREATE INDEX "bp_c3_name_workspace_time_idx"
  ON "resource_catalog_name_corrections" ("workspaceId", "createdAt");
CREATE INDEX "bp_c3_name_catalog_time_idx"
  ON "resource_catalog_name_corrections" ("resourceCatalogId", "createdAt");
ALTER TABLE "resource_catalog_name_corrections"
  ADD CONSTRAINT "resource_catalog_name_corrections_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_catalog_name_corrections"
  ADD CONSTRAINT "resource_catalog_name_corrections_resourceCatalogId_fkey"
  FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_catalog_name_corrections"
  ADD CONSTRAINT "resource_catalog_name_corrections_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
