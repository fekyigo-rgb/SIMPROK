-- RI-01 STEP 3B — a spelling interpretation is an append-only review event
-- beside one ObservedResource. It never replaces source evidence and never
-- writes a resource identity decision by itself.

-- A composite key is required so the review's workspace cannot disagree with
-- its observation's workspace.
ALTER TABLE "observed_resources"
  ADD CONSTRAINT "observed_resources_id_workspace_key"
  UNIQUE ("id", "workspaceId");

CREATE TABLE "observed_resource_name_reviews" (
  "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId"            UUID NOT NULL,
  "observationId"          UUID NOT NULL,
  "version"                INTEGER NOT NULL,
  "reviewedName"           TEXT NOT NULL,
  "actorAccountId"         UUID NOT NULL,
  "reason"                 TEXT NOT NULL,
  "evidence"               TEXT NOT NULL,
  "sourceFactsFingerprint" VARCHAR(64) NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "observed_resource_name_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "observed_resource_name_reviews_version_positive_check"
    CHECK ("version" > 0),
  CONSTRAINT "observed_resource_name_reviews_reviewed_name_check"
    CHECK ("reviewedName" = btrim("reviewedName") AND "reviewedName" <> ''),
  CONSTRAINT "observed_resource_name_reviews_reason_check"
    CHECK (btrim("reason") <> ''),
  CONSTRAINT "observed_resource_name_reviews_evidence_check"
    CHECK (btrim("evidence") <> ''),
  CONSTRAINT "observed_resource_name_reviews_fingerprint_check"
    CHECK ("sourceFactsFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "observed_resource_name_reviews_observation_version_key"
  ON "observed_resource_name_reviews"("observationId", "version");

CREATE INDEX "observed_name_reviews_workspace_observation_version_idx"
  ON "observed_resource_name_reviews"("workspaceId", "observationId", "version");

CREATE INDEX "observed_name_reviews_actor_idx"
  ON "observed_resource_name_reviews"("actorAccountId");

-- The composite FK below already anchors workspaceId through the observation.
-- Do not add a redundant direct workspace FK: the schema intentionally owns
-- exactly one source-observation tenant-binding relation.
ALTER TABLE "observed_resource_name_reviews"
  ADD CONSTRAINT "observed_resource_name_reviews_observation_workspace_fkey"
  FOREIGN KEY ("observationId", "workspaceId")
  REFERENCES "observed_resources"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "observed_resource_name_reviews"
  ADD CONSTRAINT "observed_resource_name_reviews_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL is the final append-only boundary. A later interpretation is the
-- next version, never an UPDATE or DELETE of a previous human statement.
CREATE FUNCTION reject_observed_resource_name_review_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OBSERVED_RESOURCE_NAME_REVIEW_APPEND_ONLY: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observed_resource_name_reviews_immutable_trigger
BEFORE UPDATE OR DELETE ON "observed_resource_name_reviews"
FOR EACH ROW EXECUTE FUNCTION reject_observed_resource_name_review_mutation();

-- Source facts are evidence, not fields a spelling review may repair in place.
-- Identity decisions may still update status/resolution columns as before.
CREATE FUNCTION reject_observed_resource_source_fact_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."rawName" IS DISTINCT FROM NEW."rawName"
     OR OLD."rawCode" IS DISTINCT FROM NEW."rawCode"
     OR OLD."rawUnit" IS DISTINCT FROM NEW."rawUnit"
     OR OLD."resourceType" IS DISTINCT FROM NEW."resourceType"
     OR OLD."sourceSha256" IS DISTINCT FROM NEW."sourceSha256"
     OR OLD."sourceFileName" IS DISTINCT FROM NEW."sourceFileName"
     OR OLD."parserContractVersion" IS DISTINCT FROM NEW."parserContractVersion"
     OR OLD."sheetName" IS DISTINCT FROM NEW."sheetName"
     OR OLD."sourceRowNumber" IS DISTINCT FROM NEW."sourceRowNumber"
     OR OLD."sourceCodeCellAddress" IS DISTINCT FROM NEW."sourceCodeCellAddress"
     OR OLD."sourceNameCellAddress" IS DISTINCT FROM NEW."sourceNameCellAddress"
     OR OLD."sourceUnitCellAddress" IS DISTINCT FROM NEW."sourceUnitCellAddress"
  THEN
    RAISE EXCEPTION 'OBSERVED_RESOURCE_SOURCE_FACTS_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observed_resources_source_facts_immutable_trigger
BEFORE UPDATE ON "observed_resources"
FOR EACH ROW EXECUTE FUNCTION reject_observed_resource_source_fact_mutation();
