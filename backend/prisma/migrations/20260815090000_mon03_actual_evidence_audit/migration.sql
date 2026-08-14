CREATE TYPE "ProgressActualStatus" AS ENUM (
  'RECORDED',
  'SUBMITTED',
  'VERIFIED',
  'ACCEPTED',
  'RETURNED_FOR_CORRECTION'
);

ALTER TABLE "progress_reports"
  ADD COLUMN "commandId" TEXT;

CREATE UNIQUE INDEX "progress_reports_commandId_key"
  ON "progress_reports"("commandId");

ALTER TABLE "progress_entries"
  ALTER COLUMN "actualCost" DROP NOT NULL,
  ALTER COLUMN "earnedValue" DROP NOT NULL,
  ADD COLUMN "status" "ProgressActualStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN "captureMethod" TEXT NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "evidenceReferences" JSONB,
  ADD COLUMN "recordedByAccountId" UUID,
  ADD COLUMN "recordedByMembershipId" UUID,
  ADD COLUMN "supersedesEntryId" UUID,
  ADD COLUMN "correctionReason" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "progress_entries_supersedesEntryId_key"
  ON "progress_entries"("supersedesEntryId");
CREATE INDEX "progress_entries_boqItemId_createdAt_idx"
  ON "progress_entries"("boqItemId", "createdAt");
CREATE INDEX "progress_entries_recordedByAccountId_idx"
  ON "progress_entries"("recordedByAccountId");
CREATE INDEX "progress_entries_recordedByMembershipId_idx"
  ON "progress_entries"("recordedByMembershipId");

ALTER TABLE "progress_entries"
  ADD CONSTRAINT "progress_entries_recordedByAccountId_fkey"
    FOREIGN KEY ("recordedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_entries_recordedByMembershipId_fkey"
    FOREIGN KEY ("recordedByMembershipId") REFERENCES "workspace_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_entries_supersedesEntryId_fkey"
    FOREIGN KEY ("supersedesEntryId") REFERENCES "progress_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "progress_audit_events" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "progressEntryId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "actorPositionId" UUID,
  "action" TEXT NOT NULL,
  "authorityCode" TEXT,
  "reason" TEXT,
  "evidenceReferences" JSONB,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "progress_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "progress_audit_events_projectId_occurredAt_idx"
  ON "progress_audit_events"("projectId", "occurredAt");
CREATE INDEX "progress_audit_events_progressEntryId_occurredAt_idx"
  ON "progress_audit_events"("progressEntryId", "occurredAt");
CREATE INDEX "progress_audit_events_actorAccountId_occurredAt_idx"
  ON "progress_audit_events"("actorAccountId", "occurredAt");

ALTER TABLE "progress_audit_events"
  ADD CONSTRAINT "progress_audit_events_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_audit_events_progressEntryId_fkey"
    FOREIGN KEY ("progressEntryId") REFERENCES "progress_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_audit_events_actorAccountId_fkey"
    FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_audit_events_actorMembershipId_fkey"
    FOREIGN KEY ("actorMembershipId") REFERENCES "workspace_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_audit_events_actorPositionId_fkey"
    FOREIGN KEY ("actorPositionId") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
