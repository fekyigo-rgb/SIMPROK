# RM-02C1c — Owner Disposition Contract (Missing-Unit Human Disposition)

**Status:** IMPLEMENTED, NOT MERGED. Draft PR only.

```
BASE_SHA=eeb99e59863f4b37dd691dcec5406203e429cafe
BRANCH=feat/rm02c1c-missing-unit-human-disposition
WORKTREE=C:\Users\asus\SIMPROK-WT-RM02C1C
ROADMAP_ITEM=RM-02C1c
```

## 1. Decision authority and scope

```
DECISION_SCOPE=SIMPROK_TEST_ACCEPTANCE_ONLY
PRODUCTION_CANONICAL_UNIT_DECISION=NO
GLOBAL_RESOURCE_STANDARD_DECISION=NO
PRODUCTION_ACTIVATION=NO
```

**ACCEPTANCE-ONLY HUMAN DISPOSITION — NOT A GLOBAL OR PRODUCTION UNIT
STANDARD.** This document records exactly two Owner-approved unit
decisions, scoped to Workspace-A in `simprok_test`, for exactly the two
source rows RM-02C1b left blocked:

```
ROW_39_RESOURCE=Kawat BRC
ROW_39_CANONICAL_BASE_UNIT=Buah

ROW_104_RESOURCE=Kerikil
ROW_104_CANONICAL_BASE_UNIT=M3
```

These decisions do **not** mean:

- every "Kawat BRC" anywhere must use "Buah";
- every "Kerikil" anywhere must use "M3";
- "Buah", "Unit", and "Lembar" are equivalent;
- "M3" and "Kg" are convertible;
- these units are production-wide canonical standards.

A future official source may explicitly state a different unit for either
name (e.g. Kerikil/Kg, Kawat BRC/Unit). Each such variant is a separately
reviewed source identity — this contract does not pre-authorize merging,
converting, or reconciling any future variant with the two resources
created here.

```
AUTO_UNIT_CONVERSION=FORBIDDEN
AUTO_ALIAS_CREATION=FORBIDDEN
AUTO_CODE_GENERATION=FORBIDDEN
AUTO_RESOURCE_MERGE=FORBIDDEN
```

## 2. Source truth versus human decision

The original workbook source unit cells for rows 39 and 104 are empty —
independently re-verified against the committed RM-02C0 inventory before
any code was written (see §4).

Because of this:

- `ResourceCatalog.baseUnit` records the Owner-approved disposition
  ("Buah" / "M3");
- `ResourceSourceIdentity.rawUnit` remains `NULL` for both rows — writing
  the human decision into `rawUnit` would falsify provenance (it would
  claim the source cell contained something it never contained);
- every other `ResourceSourceIdentity` field (sourceSha256, sourceFileName,
  parserContractVersion, sheetName, sourceRowNumber, sourceSection, cell
  addresses, rawCode, rawName) is taken directly from the committed
  inventory, unchanged.

No schema field was added to record this decision. The decision itself is
recorded here and in the deterministic plan's `decisionRecord` field
(`01-RM02C1C-DETERMINISTIC-PLAN.json`), not in any new database column.

## 3. Why a separate module, not an extension of RM-02C1b

`src/resource-catalog/resource-catalog-missing-unit-disposition.ts` is a
new, narrow module — it does not modify, weaken, or reinterpret
`resource-catalog-bootstrap-planner.ts` (RM-02C1b's locked 271-row
planner). It reuses that module's already-proven inventory verification
(`loadCanonicalInventory` and its `EXPECTED_*` pins) via a plain import,
because both slices must agree on the exact same canonical source
evidence — but it defines its own plan shape, its own three-value
disposition enum (`CREATE_REVIEWED_RESOURCE` / `IDEMPOTENT_ALREADY_APPLIED`
/ `CONFLICT_STOP`), and its own transaction/advisory-lock scope.

This is a two-row, hand-reviewed acceptance, not a generic "missing unit"
resolution framework. Adding a third row to `OWNER_DISPOSITIONS` requires a
new Owner decision, not a code change to a general algorithm.

## 4. Independent re-verification of the evidence (before writing code)

```
ROW_39:  sourceRowNumber=39,  sourceSection=MATERIAL, rawResourceNameText="Kawat BRC", rawUnitText=null  -> CONFIRMED
ROW_104: sourceRowNumber=104, sourceSection=MATERIAL, rawResourceNameText="Kerikil",   rawUnitText=null  -> CONFIRMED
```

`verifyOwnerDispositionAgainstEvidence()` re-runs exactly this check at
both plan-build time and inside the apply transaction — if the committed
inventory ever drifted from what this contract was authorized against, it
throws `CanonicalEvidenceMismatchError` (`STOP_CANONICAL_EVIDENCE_MISMATCH`)
rather than silently reinterpreting the row.

## 5. Disposition model (three values only)

```
CREATE_REVIEWED_RESOURCE     — nothing exists yet; create both records.
IDEMPOTENT_ALREADY_APPLIED   — exact provenance + linked catalog already
                                match this row's Owner-approved disposition
                                exactly; zero writes.
CONFLICT_STOP                — existing provenance mismatches the source
                                (STOP_EXISTING_PROVENANCE_CONFLICT), or an
                                unproven candidate already occupies the
                                exact name/type/approved-unit slot
                                (STOP_EXISTING_UNPROVEN_RESOURCE_COLLISION).
                                Apply refuses entirely if either row hits
                                this — zero writes for both rows, not just
                                the conflicting one.
```

A pre-existing resource with the **same name but a different unit** (e.g.
an existing "Kerikil"/"Kg") is neither of the above — the unproven-
candidate lookup filters by the *approved* unit specifically, so a
different-unit resource simply never matches that query and never blocks.
It is left completely untouched; this contract's own resource is still
created independently. This is a structural property of the lookup, not a
special case that needed its own code branch — proven directly (§Proof
Report, item 24).

## 6. Bounded scope confirmation

```
RM02C1B_267_RESOURCES_MODIFIED=NO
RM02C1B_269_PROVENANCE_ROWS_MODIFIED=NO
PRISMA_SCHEMA_CHANGED=NO
MIGRATION_CREATED=NO
ENDPOINT_CREATED=NO
FRONTEND_TOUCHED=NO
UNIT_DEFINITION_CREATED=NO
UNIT_ALIAS_CREATED=NO
BASIC_PRICE_CREATED=NO
```

Soli Deo Gloria.
