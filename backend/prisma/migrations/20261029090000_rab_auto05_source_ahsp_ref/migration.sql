-- RAB-AUTO-05: the optional, explicitly named AHSP code from a BOQ source
-- is NOT the WBS number and is NOT an automatically inferred match.
-- Historic rows remain NULL. No existing association or money is rewritten.
ALTER TABLE "boq_items" ADD COLUMN "sourceAhspCode" VARCHAR(128);
