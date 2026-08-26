-- MON-03 owner-ratified governance/time closure.
-- Additive only: no production data reset, no baseline rewrite, no timezone guessing.

ALTER TABLE "progress_audit_events"
  ADD COLUMN "reasonCode" TEXT,
  ADD COLUMN "reasonText" TEXT;

CREATE TABLE "project_time_zone_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "actorMembershipId" UUID NOT NULL,
  "previousTimeZone" VARCHAR(64),
  "nextTimeZone" VARCHAR(64),
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_time_zone_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_time_zone_events_workspaceId_occurredAt_idx"
  ON "project_time_zone_events"("workspaceId", "occurredAt");

CREATE INDEX "project_time_zone_events_projectId_occurredAt_idx"
  ON "project_time_zone_events"("projectId", "occurredAt");

CREATE INDEX "project_time_zone_events_actorAccountId_occurredAt_idx"
  ON "project_time_zone_events"("actorAccountId", "occurredAt");

ALTER TABLE "project_time_zone_events"
  ADD CONSTRAINT "project_time_zone_events_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_time_zone_events"
  ADD CONSTRAINT "project_time_zone_events_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_time_zone_events"
  ADD CONSTRAINT "project_time_zone_events_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_time_zone_events"
  ADD CONSTRAINT "project_time_zone_events_actorMembershipId_fkey"
  FOREIGN KEY ("actorMembershipId") REFERENCES "workspace_memberships"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
