-- Neutral subject for a hand-built observation.
-- Document rows keep their locator identity. This migration does not backfill
-- a subject key and does not invent document provenance.

ALTER TABLE "observed_resources" ADD COLUMN "observationSubjectKey" VARCHAR(64);

-- An OPEN observation (status OBSERVED) with no document locator must name
-- its neutral subject. A document observation satisfies the law through
-- sourceSha256. A row that has already left OBSERVED may remain null-subject:
-- decision writers change only decision fields and never rewrite the question.
-- Legacy rows are not given a fabricated key. NOT VALID skips the one-time
-- scan, so a historical OBSERVED null-subject row can survive the upgrade.
-- PostgreSQL still evaluates this CHECK on every later INSERT or UPDATE, and
-- an open null-subject row stays rejected.
ALTER TABLE "observed_resources"
  ADD CONSTRAINT "observed_resources_non_document_subject_required"
  CHECK (
    "status" <> 'OBSERVED'
    OR "sourceSha256" IS NOT NULL
    OR "observationSubjectKey" IS NOT NULL
  ) NOT VALID;

CREATE UNIQUE INDEX "observed_resources_neutral_subject_uidx"
  ON "observed_resources" ("workspaceId", "observationSubjectKey")
  WHERE "sourceSha256" IS NULL;
