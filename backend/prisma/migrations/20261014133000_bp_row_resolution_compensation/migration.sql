-- BP-ROW8-COMPENSATION-01: strictly additive, append-only evidence.
-- Does not change or backfill any prior mapping, catalog, source, or price.
CREATE TABLE "basic_price_import_row_resolution_compensations" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "rowId" UUID NOT NULL,
  "mappingId" UUID NOT NULL,
  "resourceCatalogId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "priorRowVersion" INTEGER NOT NULL,
  "newRowVersion" INTEGER NOT NULL,
  "previousCatalogName" TEXT NOT NULL,
  "compensatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bp_row_compensations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bp_row_compensations_reason_check" CHECK (length(btrim("reason")) >= 10),
  CONSTRAINT "bp_row_compensations_versions_check" CHECK (
     "priorRowVersion" >= 0 AND "newRowVersion" = "priorRowVersion" + 1
  )
);
CREATE UNIQUE INDEX "bp_row_compensations_mappingId_key" ON "basic_price_import_row_resolution_compensations"("mappingId");
CREATE INDEX "bp_row_compensations_workspace_time_idx" ON "basic_price_import_row_resolution_compensations"("workspaceId", "compensatedAt");
CREATE INDEX "bp_row_compensations_row_idx" ON "basic_price_import_row_resolution_compensations"("rowId");
CREATE INDEX "bp_row_compensations_catalog_idx" ON "basic_price_import_row_resolution_compensations"("resourceCatalogId");
ALTER TABLE "basic_price_import_row_resolution_compensations"
  ADD CONSTRAINT "bp_row_compensations_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "bp_row_compensations_row_fk" FOREIGN KEY ("rowId") REFERENCES "basic_price_import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "bp_row_compensations_mapping_fk" FOREIGN KEY ("mappingId") REFERENCES "basic_price_import_row_resource_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "bp_row_compensations_catalog_fk" FOREIGN KEY ("resourceCatalogId") REFERENCES "resource_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "bp_row_compensations_actor_fk" FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An audit of a reversal must NEVER itself be silently reversed or removed.
CREATE FUNCTION "bp_row_compensations_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BP_ROW_COMPENSATION_APPEND_ONLY';
END
$$;
CREATE TRIGGER "bp_row_compensations_append_only"
BEFORE UPDATE OR DELETE ON "basic_price_import_row_resolution_compensations"
FOR EACH ROW EXECUTE FUNCTION "bp_row_compensations_reject_mutation"();