-- RAB-TRUTH-01H — freeze the AHSP ownership that formed each calculation.
--
-- THE BUG THIS CLOSES, proven against a live rehearsal: a persisted
-- SERVER_COST_KERNEL calculation stayed byte-for-byte identical — same
-- unitPrice, lineTotal, occurrence, calculatedAt, calculationAsOfDate — while
-- the source AHSP was transferred USER_ASSET -> SIMPROK_ASSET. Because the read
-- path asked the LIVE `ahsps.ownershipType`, the row's price origin silently
-- moved from "Data Pengguna" to "Auto SIMPROK" with nothing recalculated.
-- A price origin describes how a price WAS FORMED, not who owns the source
-- today.
--
-- WHY ONLY THIS COLUMN. Two facts decide the origin of a calculated price:
--   * AHSP ownership          MUTABLE  (ahsp.service transfer writes it)
--   * BasicPrice.assetScope   IMMUTABLE (no production writer updates it;
--                             publication writes only status/verificationStatus
--                             and positively filters SIMPROK_CATALOG, and the
--                             provenance-correction writer omits it on purpose)
-- Only the mutable one is frozen. Copying assetScope as well would duplicate a
-- stable truth and create a second copy to keep in step.

-- Typed with the domain's OWN enum, not free text. The database then refuses
-- an ownership that does not exist, and the frozen value compares directly
-- against `ahsps.ownershipType` — a TEXT column could not, which is how the
-- first consistency query failed with `operator does not exist: text =
-- "OwnershipType"`.
ALTER TABLE "project_ahsp_occurrences"
  ADD COLUMN "ahspOwnershipAtCalculation" "OwnershipType";

-- BACKFILL — ONLY WHERE HISTORY IS PROVABLE, NEVER FROM TODAY'S OWNERSHIP.
--
-- `ahsps.ownershipTransferredAt` is written by exactly one code path: the
-- ownership-transfer command. NULL there is therefore not "unknown" — it is
-- positive evidence that this AHSP has never been transferred, so the ownership
-- it carries now is the same ownership it carried when the occurrence was
-- created. Those rows can be filled truthfully.
--
-- An AHSP that HAS been transferred is deliberately left NULL: its ownership at
-- the occurrence's creation time cannot be proven from this table alone, and
-- guessing it from the current value is exactly the drift this migration
-- exists to stop. NULL means unknown, and unknown is allowed to stay unknown.
UPDATE "project_ahsp_occurrences" o
SET "ahspOwnershipAtCalculation" = a."ownershipType"
FROM "ahsp_versions" v
JOIN "ahsps" a ON a."id" = v."ahspId"
WHERE v."id" = o."ahspVersionId"
  AND a."ownershipTransferredAt" IS NULL;
