-- MON-03 final targeted governance closure.
-- Forward-only: preserve historical unknowns and correct only proven vocabulary drift.

CREATE TYPE "ProgressCorrectionReasonCode" AS ENUM (
  'DATA_ENTRY_ERROR',
  'MEASUREMENT_UPDATE',
  'FIELD_FACT_CORRECTION',
  'ADMINISTRATIVE_CORRECTION',
  'OTHER'
);

ALTER TABLE "progress_entries"
  ADD COLUMN "correctionReasonCode" "ProgressCorrectionReasonCode";

-- Existing corrections without a controlled code remain historically UNKNOWN.
-- Enforce reason-code presence only when a correction lineage is newly created
-- or its lineage/code is deliberately changed. Ordinary lifecycle updates of a
-- grandfathered historical correction must remain possible without inventing a
-- category that was never recorded.
CREATE FUNCTION enforce_new_progress_correction_reason_code() RETURNS trigger AS $$
BEGIN
  IF NEW."supersedesEntryId" IS NOT NULL
     AND NEW."correctionReasonCode" IS NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD."supersedesEntryId" IS DISTINCT FROM NEW."supersedesEntryId"
       OR OLD."correctionReasonCode" IS DISTINCT FROM NEW."correctionReasonCode"
     )
  THEN
    RAISE EXCEPTION 'PROGRESS_CORRECTION_REASON_CODE_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER progress_entries_new_correction_reason_code_trigger
BEFORE INSERT OR UPDATE OF "supersedesEntryId", "correctionReasonCode"
ON "progress_entries"
FOR EACH ROW
EXECUTE FUNCTION enforce_new_progress_correction_reason_code();

ALTER TABLE "progress_audit_events"
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "entityVersionBefore" INTEGER,
  ADD COLUMN "entityVersionAfter" INTEGER;

-- HUMAN was a stale implementation synonym. These rows are known authenticated
-- human-account events, so USER is a vocabulary correction rather than a backfill
-- of an unknown fact.
UPDATE "progress_audit_events"
   SET "actorType" = 'USER'
 WHERE "actorType" = 'HUMAN';

-- A denial/failure code explains why the command did not execute. It is not a
-- business correction reason.
UPDATE "progress_audit_events"
   SET "errorCode" = "reasonCode",
       "reasonCode" = NULL
 WHERE "outcome" IN ('DENIED', 'FAILED')
   AND "reasonCode" IS NOT NULL;

ALTER TABLE "progress_audit_events"
  DROP CONSTRAINT "progress_audit_events_success_target_check",
  ADD CONSTRAINT "progress_audit_events_success_target_check"
    CHECK ("outcome" <> 'SUCCESS' OR "targetEntityId" IS NOT NULL),
  ADD CONSTRAINT "progress_audit_events_actor_type_check"
    CHECK ("actorType" IS NULL OR "actorType" = 'USER'),
  ADD CONSTRAINT "progress_audit_events_denial_error_code_check"
    CHECK ("outcome" = 'SUCCESS' OR "errorCode" IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "progress_audit_events_denial_reason_separation_check"
    CHECK ("outcome" = 'SUCCESS' OR "reasonCode" IS NULL) NOT VALID;

ALTER TABLE "project_time_zone_events"
  ADD COLUMN "commandId" TEXT,
  ADD COLUMN "commandFingerprint" TEXT;

CREATE UNIQUE INDEX "project_time_zone_events_commandId_key"
  ON "project_time_zone_events"("commandId");

CREATE FUNCTION reject_project_time_zone_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PROJECT_TIME_ZONE_HISTORY_APPEND_ONLY: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_time_zone_events_immutable_trigger
BEFORE UPDATE OR DELETE ON "project_time_zone_events"
FOR EACH ROW EXECUTE FUNCTION reject_project_time_zone_event_mutation();
