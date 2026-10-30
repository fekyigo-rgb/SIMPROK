-- F03A: preserve price-selection intent on EXISTING canonical Project.
-- This is NOT an automatic price-winner policy. No money, AHSP, or RAB mutation.
-- All historical projects remain NULL -> no preference -> old ambiguity gate.
ALTER TABLE "projects"
  ADD COLUMN "priceSelectionPreferenceMode" VARCHAR(24),
  ADD COLUMN "priceSelectionPreferencePolicyVersion" VARCHAR(64);

ALTER TABLE "projects" ADD CONSTRAINT "project_price_preference_intent_law_check"
CHECK (
  ("priceSelectionPreferenceMode" IS NULL AND "priceSelectionPreferencePolicyVersion" IS NULL)
  OR (
    "priceSelectionPreferenceMode" IN ('LOWEST', 'MIDDLE', 'HIGHEST')
    AND "priceSelectionPreferencePolicyVersion" = 'F03A_PROJECT_PRICE_INTENT_V1'
  )
);
