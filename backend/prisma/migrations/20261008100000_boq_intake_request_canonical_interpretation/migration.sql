-- Additive typed-interpretation identity for current-contract jobs.
-- All fields are nullable so historical PRICE_POINT jobs remain untouched.
ALTER TABLE "intake_jobs"
ADD COLUMN "interpretationKey" TEXT,
ADD COLUMN "projectId" UUID,
ADD COLUMN "knowledgeType" TEXT,
ADD COLUMN "interpretationMode" TEXT,
ADD COLUMN "selectedSheet" TEXT,
ADD COLUMN "readerContractVersion" TEXT,
ADD COLUMN "semanticContractVersion" TEXT;

-- Every lawful processing request is evidence of its own actor and trusted
-- scope.  It may bind once to the canonical interpretation work-unit.
CREATE TABLE "intake_requests" (
    "id" UUID NOT NULL,
    "sourceDocumentId" UUID NOT NULL,
    "intakeJobId" UUID,
    "requestingAccountId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requestedKnowledgeType" TEXT NOT NULL,
    "presentedFileName" TEXT NOT NULL,
    "presentedMimeType" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intake_jobs_interpretationKey_key"
ON "intake_jobs"("interpretationKey");

CREATE INDEX "intake_jobs_projectId_idx" ON "intake_jobs"("projectId");
CREATE INDEX "intake_jobs_knowledgeType_idx" ON "intake_jobs"("knowledgeType");

CREATE UNIQUE INDEX "intake_requests_correlationId_key"
ON "intake_requests"("correlationId");
CREATE INDEX "intake_requests_sourceDocumentId_idx"
ON "intake_requests"("sourceDocumentId");
CREATE INDEX "intake_requests_intakeJobId_idx"
ON "intake_requests"("intakeJobId");
CREATE INDEX "intake_requests_requestingAccountId_createdAt_idx"
ON "intake_requests"("requestingAccountId", "createdAt");
CREATE INDEX "intake_requests_workspaceId_projectId_createdAt_idx"
ON "intake_requests"("workspaceId", "projectId", "createdAt");

ALTER TABLE "intake_jobs"
ADD CONSTRAINT "intake_jobs_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "source_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_intakeJobId_fkey"
FOREIGN KEY ("intakeJobId") REFERENCES "intake_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_requestingAccountId_fkey"
FOREIGN KEY ("requestingAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "intake_requests"
ADD CONSTRAINT "intake_requests_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
