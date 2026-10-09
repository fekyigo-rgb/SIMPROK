-- One additive, append-only fact: a canonical BOQ intake request was
-- successfully applied to one Working Draft by one authorized account.
-- Historical RAB/BOQ rows are intentionally not backfilled.
CREATE TABLE "boq_business_use_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "boqStructureId" UUID NOT NULL,
    "sourceDocumentId" UUID NOT NULL,
    "intakeRequestId" UUID NOT NULL,
    "intakeJobId" UUID NOT NULL,
    "approvedByAccountId" UUID NOT NULL,
    "importFingerprint" VARCHAR(64) NOT NULL,
    "previousUseEventId" UUID,
    "appliedItemCount" INTEGER NOT NULL,
    "replacedItemCount" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_business_use_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "boq_business_use_events_counts_check" CHECK (
      "appliedItemCount" >= 0 AND "replacedItemCount" >= 0
    ),
    CONSTRAINT "boq_business_use_events_fingerprint_check" CHECK (
      "importFingerprint" ~ '^[0-9A-F]{64}$'
    )
);

CREATE UNIQUE INDEX "boq_business_use_events_previousUseEventId_key"
ON "boq_business_use_events"("previousUseEventId");

-- There is one root per Working Draft. The unique predecessor index above
-- prevents forks; together they preserve one honest append-only lineage.
CREATE UNIQUE INDEX "boq_business_use_events_one_root_per_structure_key"
ON "boq_business_use_events"("boqStructureId")
WHERE "previousUseEventId" IS NULL;

CREATE INDEX "boq_business_use_events_workspaceId_usedAt_idx"
ON "boq_business_use_events"("workspaceId", "usedAt");
CREATE INDEX "boq_business_use_events_organizationId_usedAt_idx"
ON "boq_business_use_events"("organizationId", "usedAt");
CREATE INDEX "boq_business_use_events_projectId_usedAt_idx"
ON "boq_business_use_events"("projectId", "usedAt");
CREATE INDEX "boq_business_use_events_boqStructureId_usedAt_idx"
ON "boq_business_use_events"("boqStructureId", "usedAt");
CREATE INDEX "boq_business_use_events_sourceDocumentId_idx"
ON "boq_business_use_events"("sourceDocumentId");
CREATE INDEX "boq_business_use_events_intakeRequestId_usedAt_idx"
ON "boq_business_use_events"("intakeRequestId", "usedAt");
CREATE INDEX "boq_business_use_events_intakeJobId_idx"
ON "boq_business_use_events"("intakeJobId");
CREATE INDEX "boq_business_use_events_approvedByAccountId_usedAt_idx"
ON "boq_business_use_events"("approvedByAccountId", "usedAt");
CREATE INDEX "boq_business_use_events_importFingerprint_idx"
ON "boq_business_use_events"("importFingerprint");

ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_boqStructureId_fkey"
FOREIGN KEY ("boqStructureId") REFERENCES "boq_structures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_intakeRequestId_fkey"
FOREIGN KEY ("intakeRequestId") REFERENCES "intake_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_intakeJobId_fkey"
FOREIGN KEY ("intakeJobId") REFERENCES "intake_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_approvedByAccountId_fkey"
FOREIGN KEY ("approvedByAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boq_business_use_events"
ADD CONSTRAINT "boq_business_use_events_previousUseEventId_fkey"
FOREIGN KEY ("previousUseEventId") REFERENCES "boq_business_use_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A direct writer cannot assemble a cross-tenant or cross-request event from
-- individually valid foreign keys. The whole canonical chain must agree.
CREATE FUNCTION assert_boq_business_use_event_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "projects" p
    JOIN "boq_structures" bs ON bs."id" = NEW."boqStructureId"
                             AND bs."projectId" = p."id"
    JOIN "intake_requests" ir ON ir."id" = NEW."intakeRequestId"
                              AND ir."workspaceId" = NEW."workspaceId"
                              AND ir."organizationId" = NEW."organizationId"
                              AND ir."projectId" = NEW."projectId"
                              AND ir."requestingAccountId" = NEW."approvedByAccountId"
                              AND ir."sourceDocumentId" = NEW."sourceDocumentId"
                              AND ir."intakeJobId" = NEW."intakeJobId"
                              AND ir."requestedKnowledgeType" = 'BOQ'
    JOIN "intake_jobs" ij ON ij."id" = NEW."intakeJobId"
                          AND ij."workspaceId" = NEW."workspaceId"
                          AND ij."organizationId" = NEW."organizationId"
                          AND ij."projectId" = NEW."projectId"
                          AND ij."sourceDocumentId" = NEW."sourceDocumentId"
                          AND ij."knowledgeType" = 'BOQ'
    JOIN "source_documents" sd ON sd."id" = NEW."sourceDocumentId"
                               AND sd."workspaceId" = NEW."workspaceId"
                               AND sd."organizationId" = NEW."organizationId"
    WHERE p."id" = NEW."projectId"
      AND p."workspaceId" = NEW."workspaceId"
      AND p."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'BOQ_BUSINESS_USE_SCOPE_MISMATCH';
  END IF;

  IF NEW."previousUseEventId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "boq_business_use_events" previous
    WHERE previous."id" = NEW."previousUseEventId"
      AND previous."workspaceId" = NEW."workspaceId"
      AND previous."organizationId" = NEW."organizationId"
      AND previous."projectId" = NEW."projectId"
      AND previous."boqStructureId" = NEW."boqStructureId"
  ) THEN
    RAISE EXCEPTION 'BOQ_BUSINESS_USE_PREDECESSOR_SCOPE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boq_business_use_events_scope_trigger
BEFORE INSERT ON "boq_business_use_events"
FOR EACH ROW EXECUTE FUNCTION assert_boq_business_use_event_scope();

-- PostgreSQL is the final append-only boundary. Corrections/replays are new
-- events; successful-use history is never rewritten or silently erased.
CREATE FUNCTION reject_boq_business_use_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BOQ_BUSINESS_USE_APPEND_ONLY: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boq_business_use_events_immutable_trigger
BEFORE UPDATE OR DELETE ON "boq_business_use_events"
FOR EACH ROW EXECUTE FUNCTION reject_boq_business_use_event_mutation();
