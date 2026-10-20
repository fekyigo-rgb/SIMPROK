-- PR205 Owner-approved additive specification decisions, append-only.
CREATE TABLE "basic_price_import_row_specification_decisions" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "rowId" UUID NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "previousDecisionId" UUID,
  "previousVersion" INTEGER NOT NULL,
  "resultingVersion" INTEGER NOT NULL,
  "decisionKind" TEXT NOT NULL,
  "sourceSha256" VARCHAR(64) NOT NULL,
  "sourceSpecifications" JSONB,
  "confirmedSpecifications" JSONB NOT NULL,
  "reason" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "basic_price_import_row_specification_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bp_row_spec_kind_check" CHECK ("decisionKind" IN ('CONFIRM_SOURCE','SUPPLEMENT','CORRECT')),
  CONSTRAINT "bp_row_spec_version_check" CHECK ("previousVersion" >= 0 AND "resultingVersion" = "previousVersion" + 1),
  CONSTRAINT "bp_row_spec_digest_check" CHECK ("sourceSha256" ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT "bp_row_spec_nonempty_check" CHECK (jsonb_typeof("confirmedSpecifications") = 'object' AND "confirmedSpecifications" <> '{}'::jsonb)
);
CREATE UNIQUE INDEX "bp_row_spec_row_version_key" ON "basic_price_import_row_specification_decisions" ("rowId","resultingVersion");
CREATE INDEX "bp_row_spec_history_idx" ON "basic_price_import_row_specification_decisions" ("workspaceId","rowId","resultingVersion" DESC);
CREATE INDEX "bp_row_spec_actor_idx" ON "basic_price_import_row_specification_decisions" ("actorAccountId");
ALTER TABLE "basic_price_import_row_specification_decisions" ADD CONSTRAINT "bp_row_spec_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_specification_decisions" ADD CONSTRAINT "bp_row_spec_row_fk" FOREIGN KEY ("rowId") REFERENCES "basic_price_import_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_specification_decisions" ADD CONSTRAINT "bp_row_spec_actor_fk" FOREIGN KEY ("actorAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "basic_price_import_row_specification_decisions" ADD CONSTRAINT "basic_price_import_row_specification_decisions_previousDecisionId_fkey" FOREIGN KEY ("previousDecisionId") REFERENCES "basic_price_import_row_specification_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION bp_row_spec_decision_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PR205_SPECIFICATION_DECISIONS_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bp_row_spec_decision_no_mutation BEFORE UPDATE OR DELETE
ON "basic_price_import_row_specification_decisions" FOR EACH ROW
EXECUTE FUNCTION bp_row_spec_decision_immutable();
