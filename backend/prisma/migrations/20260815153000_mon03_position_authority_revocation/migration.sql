-- Authority grants remain historically attributable when revoked.
ALTER TABLE "position_authorities"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "position_authorities_isActive_idx"
  ON "position_authorities"("isActive");

ALTER TABLE "position_authorities"
  ADD CONSTRAINT "position_authorities_revocation_consistency_check"
  CHECK (
    ("isActive" = TRUE AND "revokedAt" IS NULL)
    OR ("isActive" = FALSE AND "revokedAt" IS NOT NULL)
  );
