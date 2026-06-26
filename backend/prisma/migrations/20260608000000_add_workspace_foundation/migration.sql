-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_code_key" ON "Workspace"("code");

-- CreateIndex
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill one active Workspace for every existing Organization.
INSERT INTO "Workspace" (
    "id",
    "organizationId",
    "code",
    "name",
    "description",
    "isActive",
    "createdAt",
    "updatedAt"
)
SELECT
    LOWER(
        SUBSTRING(MD5("Organization"."id" || ':workspace') FROM 1 FOR 8) || '-' ||
        SUBSTRING(MD5("Organization"."id" || ':workspace') FROM 9 FOR 4) || '-' ||
        SUBSTRING(MD5("Organization"."id" || ':workspace') FROM 13 FOR 4) || '-' ||
        SUBSTRING(MD5("Organization"."id" || ':workspace') FROM 17 FOR 4) || '-' ||
        SUBSTRING(MD5("Organization"."id" || ':workspace') FROM 21 FOR 12)
    ),
    "Organization"."id",
    "Organization"."code",
    "Organization"."name",
    "Organization"."description",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Organization"
WHERE NOT EXISTS (
    SELECT 1
    FROM "Workspace"
    WHERE "Workspace"."organizationId" = "Organization"."id"
);

-- Enforce V1 active Workspace governance: max one active Workspace per Organization.
CREATE UNIQUE INDEX "Workspace_one_active_per_organization"
ON "Workspace"("organizationId")
WHERE "isActive" = true;

-- Validate backfill result: no Organization may have zero active Workspace.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Organization"
        WHERE NOT EXISTS (
            SELECT 1
            FROM "Workspace"
            WHERE "Workspace"."organizationId" = "Organization"."id"
              AND "Workspace"."isActive" = true
        )
    ) THEN
        RAISE EXCEPTION 'Workspace backfill failed: organization without active workspace exists';
    END IF;
END $$;
