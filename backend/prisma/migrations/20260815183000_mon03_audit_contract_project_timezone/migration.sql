CREATE TYPE "ProgressAuditOutcome" AS ENUM (
  'SUCCESS',
  'DENIED',
  'FAILED'
);

ALTER TABLE "projects"
  ADD COLUMN "timeZone" VARCHAR(64);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_timeZone_not_blank_check"
  CHECK ("timeZone" IS NULL OR length(btrim("timeZone")) > 0);

ALTER TABLE "progress_audit_events"
  ADD COLUMN "schemaVersion" INTEGER,
  ADD COLUMN "eventType" TEXT,
  ADD COLUMN "outcome" "ProgressAuditOutcome" NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "workspaceId" UUID,
  ADD COLUMN "actorType" TEXT,
  ADD COLUMN "sourceModule" TEXT,
  ADD COLUMN "targetEntityType" TEXT,
  ADD COLUMN "targetEntityId" UUID,
  ADD COLUMN "correlationId" UUID,
  ADD COLUMN "requestId" UUID,
  ADD COLUMN "businessCommandId" TEXT,
  ADD COLUMN "recordedAt" TIMESTAMP(3);

ALTER TABLE "progress_audit_events"
  ALTER COLUMN "progressEntryId" DROP NOT NULL;

UPDATE "progress_audit_events" audit
   SET "workspaceId" = project."workspaceId",
       "eventType" = COALESCE(audit."eventType", 'ACTUAL_PROGRESS'),
       "actorType" = COALESCE(audit."actorType", 'HUMAN'),
       "sourceModule" = COALESCE(audit."sourceModule", 'FIELD_PROGRESS'),
       "targetEntityType" = COALESCE(audit."targetEntityType", 'PROGRESS_ENTRY'),
       "targetEntityId" = COALESCE(audit."targetEntityId", audit."progressEntryId")
  FROM "projects" project
 WHERE audit."projectId" = project."id";

ALTER TABLE "progress_audit_events"
  ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "progress_audit_events"
  ADD CONSTRAINT "progress_audit_events_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "progress_audit_events_success_target_check"
    CHECK ("outcome" <> 'SUCCESS' OR "progressEntryId" IS NOT NULL);

CREATE INDEX "progress_audit_events_workspaceId_occurredAt_idx"
  ON "progress_audit_events"("workspaceId", "occurredAt");

CREATE INDEX "progress_audit_events_outcome_occurredAt_idx"
  ON "progress_audit_events"("outcome", "occurredAt");

CREATE INDEX "progress_audit_events_businessCommandId_idx"
  ON "progress_audit_events"("businessCommandId");
