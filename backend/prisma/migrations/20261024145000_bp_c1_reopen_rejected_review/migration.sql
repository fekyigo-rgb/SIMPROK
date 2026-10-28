-- BP-C1: immutable audit when a rejected row is re-opened before admission.
CREATE TABLE "basic_price_import_row_rejected_review_reopens" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "rowId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "priorRowVersion" INTEGER NOT NULL,
  "newRowVersion" INTEGER NOT NULL,
  "previousReason" TEXT NOT NULL,
  "reopenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "basic_price_import_row_rejected_review_reopens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bp_c1_reopen_reason_nonblank" CHECK (length(trim("reason")) >= 10),
  CONSTRAINT "bp_c1_reopen_version_step" CHECK ("newRowVersion" = "priorRowVersion" + 1)
);
CREATE UNIQUE INDEX "bp_c1_reopen_one_per_version"
  ON "basic_price_import_row_rejected_review_reopens" ("rowId", "priorRowVersion");
CREATE INDEX "bp_c1_reopen_workspace_time_idx"
  ON "basic_price_import_row_rejected_review_reopens" ("workspaceId", "reopenedAt");
ALTER TABLE "basic_price_import_row_rejected_review_reopens"
  ADD CONSTRAINT "bp_c1_reopen_workspace_fk" FOREIGN KEY ("workspaceId")
  REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_rejected_review_reopens"
  ADD CONSTRAINT "bp_c1_reopen_row_fk" FOREIGN KEY ("rowId")
  REFERENCES "basic_price_import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_rejected_review_reopens"
  ADD CONSTRAINT "bp_c1_reopen_actor_fk" FOREIGN KEY ("actorAccountId")
  REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
