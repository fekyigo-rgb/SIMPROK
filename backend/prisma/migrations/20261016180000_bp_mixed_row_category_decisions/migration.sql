-- Additive append-only audit of human row category decisions.
CREATE TABLE "basic_price_import_row_category_decisions" (
"id" UUID NOT NULL,
"workspaceId" UUID NOT NULL,
"rowId" UUID NOT NULL,
"actorAccountId" UUID NOT NULL,
"previousSection" "BasicPriceImportRowSection",
"chosenSection" "BasicPriceImportRowSection" NOT NULL,
"previousVersion" INTEGER NOT NULL,
"resultingVersion" INTEGER NOT NULL,
"reason" TEXT,
"decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "bp_row_category_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bp_row_category_decisions_rowId_idx" ON "basic_price_import_row_category_decisions"("rowId");
CREATE INDEX "bp_row_category_decisions_workspaceId_idx" ON "basic_price_import_row_category_decisions"("workspaceId");
CREATE INDEX "bp_row_category_decisions_actorAccountId_idx" ON "basic_price_import_row_category_decisions"("actorAccountId");
CREATE UNIQUE INDEX "bp_row_category_decisions_rowId_resultingVersion_key" ON "basic_price_import_row_category_decisions"("rowId", "resultingVersion");
ALTER TABLE "basic_price_import_row_category_decisions" ADD CONSTRAINT "bp_row_category_decisions_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_category_decisions" ADD CONSTRAINT "bp_row_category_decisions_row_fk" FOREIGN KEY ("rowId") REFERENCES "basic_price_import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_category_decisions" ADD CONSTRAINT "bp_row_category_decisions_actor_fk" FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
