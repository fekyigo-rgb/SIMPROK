# RM-02C0A — Canonical Resource Discovery Rerun

**Status:** `READ-ONLY EVIDENCE — RM02C1 BOOTSTRAP REMAINS LOCKED`
**Mode:** Discovery only. No `ResourceCatalog` row was written. No endpoint was created. `simprok_test` and `simprok_db` were never connected to by this task.
**Adapter under discovery:** `backend/src/basic-price/basic-price-xlsx-intake.adapter.ts` (unmodified), `BASIC_PRICE_PARSER_CONTRACT_VERSION=RM02_BASIC_PRICE_01_V1`.

This document exists to close Phase A honestly: rerun discovery against the real, hash-verified source workbook using the official, already-merged adapter — not the historical "275" figure, and not merely re-asserting the Owner's browser-observed "271" as authority without independent reproduction. Both are treated as observations to reconcile against a fresh, deterministic run.

**Corrections applied to this version** (after an independent byte-level audit against the same hash-verified source; artifact hashes below reflect the corrected content, amended in place, not a second commit):
- §4: removed an over-absolute claim that L.01 is the *only* true 1:1 identifier in this source; replaced with a precisely bounded statement about what single-occurrence codes do and do not prove.
- §5: replaced an undifferentiated "227 blank" characterization with a proven split — 10 genuinely blank code cells vs. 217 external-reference-formula cells with no cached result at all (not a stored zero, corrected further below from the audit's own initial framing after this task's own direct byte-level re-verification).

---

## 1. Source verification

```
SOURCE_FILE_NAME=BASIC PRICE(1).xlsx
SOURCE_PATH=C:\SIMPROK\data\first-real-input\BASIC PRICE(1).xlsx
SOURCE_BYTE_SIZE=37635
SOURCE_SHA256=46B3F354A74A10BDB26316802D922B7D6C34AA109579FA55A3A9EA5D61504B61
EXPECTED_BYTE_SIZE=37635 -> MATCH
EXPECTED_SHA256=46B3F354A74A10BDB26316802D922B7D6C34AA109579FA55A3A9EA5D61504B61 -> MATCH
SOURCE_HASH_MATCH=YES
```

Search was bounded to `C:\SIMPROK\data\first-real-input\` and `C:\Users\asus\Downloads\` as instructed. The exact byte-size-and-hash match was found in the first location; no further search was required, so `C:\Users\asus\Downloads\` was not enumerated. No file named `BASIC PRICE.xlsx` was needed or used.

## 2. Workbook structure re-verification (before calling the adapter)

Loaded with ExcelJS for read-only structural inspection only, independent of the adapter:

```
WORKSHEET_COUNT=1
WORKSHEET_NAMES=["HARGA SATUAN UPAH DAN BAHAN"]
SELECTED_WORKSHEET_NAME=HARGA SATUAN UPAH DAN BAHAN
SELECTED_WORKSHEET_ROW_COUNT=336
SELECTED_WORKSHEET_COLUMN_COUNT=7
```

This matches the previously expected observation (one worksheet, that exact name) — but this was independently reproduced here, not assumed from the historical report. No STOP condition was triggered: worksheet count is exactly 1, the selected sheet was found, and there is no additional sheet that could change the interpretation of the source.

## 3. Discovery execution — primary output

The official, unmodified `BasicPriceXlsxIntakeAdapter#parse()` was run directly against the verified source buffer, with `selectedSheet = "HARGA SATUAN UPAH DAN BAHAN"`. Run twice (once during the initial discovery pass, once again while extending the runner to capture the full row inventory) — both runs produced identical output, confirming deterministic reproduction.

```
SOURCE_SHA256=46B3F354A74A10BDB26316802D922B7D6C34AA109579FA55A3A9EA5D61504B61
SOURCE_BYTE_SIZE=37635
PARSER_CONTRACT_VERSION=RM02_BASIC_PRICE_01_V1
SHEET_NAME=HARGA SATUAN UPAH DAN BAHAN
SHEET_ROW_COUNT=336
TOTAL_SOURCE_ROWS=278
PARSED_RESOURCE_ROWS=271
LABOR_ROWS=17
MATERIAL_ROWS=241
EQUIPMENT_ROWS=13
```

**Reconciliation checks (all passed — none triggered a STOP gate):**

```
LABOR(17) + MATERIAL(241) + EQUIPMENT(13) = 271 = PARSED_RESOURCE_ROWS -> TRUE
TOTAL_SOURCE_ROWS(278) = PARSED_RESOURCE_ROWS(271) + EXCLUDED_NO_NAME_ROWS(7) -> TRUE
Physical row tally: blank(49) + marker(3) + header(3) + preSection(3) + contentAfterSection(278) = 336 = SELECTED_WORKSHEET_ROW_COUNT -> TRUE
```

The independent physical-row tally (a read-only diagnostic re-scan, not an alternative parser — see §9) exactly accounts for every one of the 336 physical rows in the sheet, and the adapter's own `totalSourceRows` counter exactly equals the independent tally's `contentRowsAfterSection` count. This is strong internal evidence the adapter's row classification is behaving consistently and deterministically against this specific source file.

## 4. Quality discovery — summary

Full detail (every row number) is in `02-RM02C0-ANOMALY-REGISTER.json`. Summary:

| Metric | Count |
|---|---|
| Missing code count | 227 |
| Missing unit count | 2 |
| Missing numeric-price count | 3 |
| Price error count | 3 |
| Duplicate exact identity (rows) | 4 (2 groups) |
| Duplicate code / same identity | 0 |
| Duplicate code / different identity | 11 (1 group: code `L.02`, 11 different named trades) |
| Duplicate normalized name (rows) | 6 (3 groups) |
| Same name / different code | 0 |
| Distinct raw-unit variants | 20 |
| Distinct code values | 34 |

**Notable finding — `L.02` is not a unique key.** All 11 rows carrying code `L.02` have genuinely different names (`Tukang`, `Tukang Batu`, `Tukang Besi`, `Tukang Kayu`, `Tukang Cat`, `Tukang vibrator`, `Tukang las konstruksi`, `Tukang las Biasa`, `Tukang ereksi`, and 2 more — see the anomaly register for the exact row list). `L.02` functions as a generic "skilled tradesman" bucket code in this source, not a per-resource identifier. L.01 is one independently confirmed, unambiguous identity for the acceptance case. L.02 is proven reused across 11 different resource names and is not unique. The other 33 distinct codes occur once in this workbook, but single occurrence does not prove global or canonical uniqueness. This is directly relevant to RM-02C1 bootstrap design: code cannot be assumed to be a reliable canonical key across the board.

**Duplicate exact-identity rows** (both blank-code, MATERIAL section): rows 136/137 ("Pintu gulung besi", unit M²) and rows 157/161 ("Sealant", unit Tube) are byte-identical across code+name+unit. A third name-duplicate pair (rows 200/201, "porslen") shares only the *normalized* name, not the full raw identity — it is **not** counted among the exact-identity duplicates, and is flagged separately in the anomaly register (`duplicateNameGroupDetail`) so it is not silently merged into a stronger claim than the evidence supports.

## 5. Code-zero classification (corrected after independent byte-level audit)

An initial pass of this report treated all 227 adapter-null-code rows as one undifferentiated "blank" bucket. An independent audit of the same hash-verified workbook, and this task's own follow-up byte-level re-inspection of every one of those 227 code cells, proved that is imprecise: 227 splits into two structurally different categories, and neither is a stored `0`.

```
ADAPTER_NULL_CODE_COUNT=227
TRUE_SOURCE_CODE_CELL_BLANK_COUNT=10
TRUE_SOURCE_CODE_CELL_BLANK_ROWS=[39,52,54,59,61,83,128,192,193,194]
SOURCE_CODE_CELL_EXTERNAL_REFERENCE_FORMULA_NO_CACHED_RESULT_COUNT=217
CODE_LITERAL_ZERO_AFTER_ADAPTER_COUNT=0
SOURCE_CODE_CELL_DIRECT_NUMERIC_ZERO_COUNT=0
SOURCE_CODE_CELL_DIRECT_TEXT_ZERO_COUNT=0
USABLE_CANONICAL_CODE_FROM_ZERO_COUNT=0
```

**Category 1 — true blank (10 rows):** the code cell is genuinely empty (`ExcelJS.ValueType.Null`/no value at all). Rows: 39, 52, 54, 59, 61, 83, 128, 192, 193, 194.

**Category 2 — external-reference formula with no cached result (217 rows):** the code cell contains a formula referencing an external, unavailable workbook, e.g. `[1]ANALISA!D124`. Direct inspection of the cell's raw stored value (`cell.value`) shows it contains **only** `{ "formula": "[1]ANALISA!D124" }` — there is no `result` key present in the stored data at all, for any of these 217 cells. This is not a stored zero; it is the complete absence of a cached value, because the referenced external workbook was not available when this file was last saved.

A precision note the independent audit's own framing got slightly wrong, corrected here after direct verification: ExcelJS exposes a **separate, derived convenience property**, `cell.result` (distinct from `cell.value.result`), which independently defaults to `0` when no real cached result exists — and its `cell.text` renders as an empty string in the same situation. That `0` is a property of the ExcelJS library's own fallback getter, **not data stored in the source XLSX file**. The official adapter's `cellDisplayText()` and `classifyPriceCell()` both read `cell.value.result` directly — never the derived `.result`/`.text` getters — so the adapter was never at risk of treating this as a literal zero; it correctly produced `null`.

**Governance conclusion (unchanged by the precision correction):** none of these 217 rows may be treated as a physically blank source cell, and none may become canonical code `"0"` — there is no `0` anywhere in the stored data to canonicalize from. Both the true-blank and the external-reference-no-result rows remain `NO_USABLE_RESOURCE_CODE` pending human governance. `USABLE_CANONICAL_CODE_FROM_ZERO_COUNT=0` because there is no code value here at all, fabricated or otherwise.

Separately, and unaffected by the above: there remain **zero** rows anywhere in this source where the code cell's own raw stored value is a *direct* (non-formula) numeric or text `0` — `CODE_LITERAL_ZERO_AFTER_ADAPTER_COUNT`, `SOURCE_CODE_CELL_DIRECT_NUMERIC_ZERO_COUNT`, and `SOURCE_CODE_CELL_DIRECT_TEXT_ZERO_COUNT` are all confirmed `0`.

## 6. L.01 character-exact reconciliation

```
L01_CODE_EXACT_MATCH=YES
L01_NAME_EXACT_MATCH=YES
L01_UNIT_CHARACTER_EXACT_MATCH=YES
L01_UNIT_NORMALIZED_MATCH=YES
L01_SOURCE_ROW=9
L01_SOURCE_CODE_CELL=D9
L01_SOURCE_NAME_CELL=C9
L01_SOURCE_UNIT_CELL=E9
```

Raw evidence, byte-for-byte:

- `rawResourceCodeText` = `"L.01"` — exact match against fixture acceptance `L.01`.
- `rawResourceNameText` = `"Pekerja"` — exact match against fixture acceptance `Pekerja`.
- `rawUnitText` = `"Org/Hari"` — exact match against fixture acceptance `Org/Hari`, confirmed both character-exact (raw string equality) **and** normalized-match.
- Unit Unicode code points: `U+004F U+0072 U+0067 U+002F U+0048 U+0061 U+0072 U+0069` (`O r g / H a r i`) — no non-ASCII, no zero-width, no lookalike characters. There is nothing hiding in the raw bytes that a normalized-only comparison could have masked.

This is the strongest possible discovery-phase result: **character-exact match, not merely normalized match**, across code, name, and unit simultaneously, on a single, unambiguous row (only one LABOR row carries code `L.01`, and only one row's name matches `/pekerja/i` — no collision, no candidate ambiguity).

Per the discovery mandate, character-exact/name/unit reconciliation alone is necessary but not sufficient to authorize canonicalize-in-place: type and workspace intent must also be reconciled. Type is structurally confirmed (`sourceSection = LABOR`, consistent with a labor resource). **Workspace intent (global canonical vs. workspace-scoped, and any RM-02C1 identity-key policy) is a PM/Architect decision this discovery task does not make and does not presume.**

## 7. Reconciliation

1. **Is the old count of 275 correct?** No — it is **REJECTED**. It could not be reproduced by the official, unmodified adapter under any of the natural totals this discovery computed: not `PARSED_RESOURCE_ROWS` (271), not `TOTAL_SOURCE_ROWS` (278, the pre-name-filter content-row count), not the physical worksheet row count (336), and not any single-section subtotal.
2. **What does the official parser produce?** **271**, reproduced deterministically across two independent runs of the unmodified adapter against the hash-verified source.
3. **Section breakdown:** LABOR 17, MATERIAL 241, EQUIPMENT 13 — sums exactly to 271.
4. **Why do 275 and 271 differ?** The official adapter's own instrumentation fully explains its *own* internal numbers (271 parsed = 278 content rows − 7 rows excluded for having no resolvable resource name — see §3), and that chain reconciles perfectly. It does **not**, however, explain the historical 275 figure, because 275 does not equal any of this run's cleanly-derived subtotals (not 271, not 278, and 278 − 275 = 3, an unexplained remainder). The closest of this run's own numbers to 275 is 278 (off by exactly 3) — offered here only as an **unconfirmed observation**, not a proven causal chain, since this task has no access to the original computation or methodology that produced "275." **No speculation beyond this is asserted as fact.** 275 should not be used as an authority going forward; it is superseded by the deterministic 271 reproduced here.
5. **Is L.01/Pekerja/Org-Hari present and matching?** Yes — see §6. Single, unambiguous, character-exact match.
6. **Is L.01 safe for a canonicalize-in-place recommendation in the next phase?** The discovery-phase evidence is as strong as it can be (character-exact code/name/unit, structurally confirmed type, zero ambiguity/collision). It is **evidence-ready**, contingent on workspace-intent and any RM-02C1 identity-key policy being explicitly decided by PM/Architect — this task does not make that decision and `RM02C1_BOOTSTRAP` remains locked regardless of this finding.

## 8. Owner browser observation reconciliation

`OWNER_BROWSER_271_RECONCILED=YES`. The Owner's own browser session (RM-02B acceptance walkthrough) reported 271 parsed rows. This discovery rerun, executed independently and directly against the hash-verified source using the official adapter, reproduces exactly **271** with a fully-accounted internal breakdown. The two observations agree exactly; the Owner's browser figure was corroborating evidence, not the authority being trusted blindly — it is now independently confirmed.

## 9. Methodology notes (transparency)

- The workbook structure inspection (§2) and the physical-row tally used to compute blank/marker/header/pre-section/excluded-no-name counts are **read-only diagnostics**, not an alternative parser. They replicate the adapter's own (non-exported) row-classification rules verbatim, for counting purposes only, and were cross-checked against the adapter's own `totalSourceRows` output — the two independently-computed numbers matched exactly (§3), which is itself evidence the replication is faithful.
- Every anomaly count and row list in `02-RM02C0-ANOMALY-REGISTER.json` was computed directly from the real `BasicPriceImportKnowledgeRow[]` array the official adapter returned — no anomaly was invented, and no row was excluded from consideration.
- Exact definitions for every duplicate/identity metric are recorded in `02-RM02C0-ANOMALY-REGISTER.json`'s `methodologyNotes` field, since the mission specified metric names but not exact formulas — those definitions are this discovery's own, explicit, and documented rather than left implicit.
- No price value beyond the already-publicly-committed L.01 figure (see `docs/implementation-gates/RM02B0_PRODUCTION_FACT_RECONCILIATION.md`) is restated in the row-level inventory artifact, per instruction — identity there is section + raw code + raw name + raw unit + source cell addresses only.
- The §5 code-zero correction was not accepted on the strength of the audit's claim alone. This task independently re-inspected all 227 adapter-null-code cells' raw `cell.value` and `cell.type` directly against the hash-verified source before writing anything: the 10/217 row-count split matched the audit exactly (including every individual row number), but the audit's specific mechanism description ("cached numeric result is 0") did not match direct inspection of the stored data, which shows no `result` key present at all for those 217 cells. The more precise finding is recorded above; the audit's governance conclusion (no usable code, never canonicalize to `"0"`) is unaffected and is, if anything, more strongly supported by the corrected mechanism.

## 10. What this discovery does NOT do

- Does not write any `ResourceCatalog` row.
- Does not create any endpoint.
- Does not touch `simprok_test` or `simprok_db` in any way.
- Does not decide or recommend a specific canonicalization strategy beyond the narrow L.01 evidence-readiness statement in §6/§7.
- Does not begin RM-02C1 bootstrap. `RM02C1_BOOTSTRAP=LOCKED` is unchanged by this task.

Soli Deo Gloria.
