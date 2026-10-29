-- BP-HISTORY: hide an unfinished personal upload from active history only.
-- Source document, rows, identity audit and any confirmed prices remain intact.
ALTER TABLE "basic_price_import_batches"
  ADD COLUMN "historyDismissedAt" TIMESTAMP(3),
  ADD COLUMN "historyDismissedByAccountId" UUID;
CREATE INDEX "bp_import_history_visible_idx" ON "basic_price_import_batches"
  ("workspaceId", "uploadedByAccountId", "createdAt" DESC)
  WHERE "historyDismissedAt" IS NULL;
