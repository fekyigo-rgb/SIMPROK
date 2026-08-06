# RM-03 / ONE_LIVE_RAB_ROW — 00 CONTRACT

### Dalam Nama Tuhan Yesus Kristus.

| Attribute | Value |
|---|---|
| Gate ID | `RM03-ONE-LIVE-RAB-ROW` |
| Branch | `feat/rm03-one-live-rab-row` |
| BASE_SHA | `3eaa6e4a53d45461192970628b9cf2a3c269d681` |
| Status | LEVEL-A ENGINEERING PROOF — awaiting Owner PR review |
| Owner authority | MERGE, PRODUCTION ACTIVATION, PRODUCTION REALITY DATA |
| SCHEMA_CHANGE | **NO** |
| MIGRATION_CHANGE | **NO** |
| DEPENDENCY_CHANGE | **NO** |

---

## 1. The single objective

Close the last link of one Golden Thread:

```
REAL BASIC PRICE
→ REAL AHSP
→ BINDING AHSP SELECTION
→ PROJECT AHSP OCCURRENCE
→ RESOURCE RESOLUTION + SNAPSHOT
→ SERVER COST KERNEL
→ ONE PERSISTED RAB ROW
→ HARD RELOAD
→ READ-ONLY RECOMPUTATION PROOF      ← the link this gate closes
```

Every link up to and including *ONE PERSISTED RAB ROW* already existed at
`BASE_SHA` (Gate 2A, PR #61; E1A contextual occurrence, PR #62). The audit
recorded in `01-TRACE-MATRIX.md` found the chain intact up to persistence and
**broken at the final link**.

### The defect in one sentence

`RabKernelPersistenceService` clears `BoqItem.workingOccurrenceId` on a
successful persist (correctly — after persisting, nothing is staged for
calculation any more), but `CostKernelService` resolves a line's occurrence
**exclusively** through that working pointer. A persisted line therefore
answers `FAIL_CLOSED / OCCURRENCE_NOT_FOUND` on every read after the write,
and the RAB workspace — which renders prices from that read — showed `—` for a
price it had just successfully saved.

The surviving link is `BoqItem.calculationOccurrenceId`, which the Gate-2A
truth constraint guarantees is `NOT NULL` for every `SERVER_COST_KERNEL` row.

---

## 2. Two levels of PASS — never to be mixed

### LEVEL-A — ENGINEERING PROOF (this PR)

Achievable without writing any reality data into production.

| Claim | Value |
|---|---|
| `RM03_ENGINEERING_READY` | YES |
| `E2E_GOLDEN_THREAD_PROOF` | delegated to CI Official Safe E2E (see `02-VERIFICATION.md`) |
| `PRODUCTION_REALITY_DATA_WRITTEN` | **NO** |
| `GOLDEN_THREAD_LIVE_CLOSED` | **NO** |

Level-A is **not** evidence that a real Basic Price is live in production.

### LEVEL-B — LIVE PRODUCTION PROOF (not this PR)

Requires, and does not yet have:

- a real AHSP source artefact with byte provenance and Owner acknowledgement;
- a real Basic Price source artefact with the same;
- a genuine second human actor (verify and publish may not be the same person);
- the complete human Basic Price lifecycle performed in a browser;
- Owner's own browser journey on project `Percobaan 1`;
- read-only recomputation against persisted production truth.

| Claim | Value |
|---|---|
| `ONE_LIVE_RAB_ROW` | **NOT PASSED** |
| `BASIC_PRICE_TO_RAB_GOLDEN_THREAD_PROOF` | **NOT PASSED** |
| `GOLDEN_THREAD_CLOSED` | **NO** |
| `GATE2B_READY` | **NO** |

**Level-B may never be claimed on the strength of an E2E fixture.**

---

## 3. What this gate implements

One read-only endpoint and the UI that consumes it. Nothing else.

```
GET /projects/:projectId/boq/items/:boqItemId/persisted-calculation
    guard: JwtAuthGuard + ProjectAccessGuard + PermissionsGuard
    permission: RAB_VIEW   (same as GET :projectId/boq/draft)
```

It follows `calculationOccurrenceId`, re-runs the **existing, unmodified**
pure Cost Kernel over the **frozen** `ProjectAhspResourceResolution` rows, and
reports whether the recomputed money equals the stored money.

| Property | Decision |
|---|---|
| Writes | none — ever. Proven by a spec whose Prisma double exposes no write method. |
| Re-resolution | none. Basic Prices are **not** re-read; the frozen resolutions are the input. |
| Rounding | the existing `toMoneyDecimal2` (OD-04, scale 2, ROUND_HALF_UP). No new policy. |
| Money arithmetic | `Prisma.Decimal` only. No `Number()`, `parseFloat`, unary `+`. |
| Disagreement | reported as `MISMATCH`. Never repaired, never hidden, never auto-corrected. |

### Why re-reading prices would be wrong

Re-reading Basic Prices at proof time would answer a different question —
"what would this line cost today?" — and would make an untouched, correct line
look changed every time the market moved. The proof asks only: *is the money
stored on this line still exactly what its own frozen provenance produces?*

### Result states

| Status | Meaning |
|---|---|
| `VERIFIED` | recomputed == stored on every money field |
| `MISMATCH` | provenance intact, kernel ran, result differs — an integrity alarm for a human |
| `FAIL_CLOSED` | cannot be re-proved; `reason` says why |

`FAIL_CLOSED` reasons: `BOQ_ITEM_NOT_FOUND`, `NOT_CALCULATED`,
`MANUAL_PRICE_NOT_REPROVABLE`, `CALCULATION_OCCURRENCE_MISSING`,
`STORED_MONEY_MISSING`, `RECOMPUTATION_FAIL_CLOSED` (carries the kernel reason).

An unpriced row and a manually-priced row are **legitimate states**, not
errors, and the UI says so in those words.

---

## 4. Frontend scope

| Change | Reason |
|---|---|
| Row renders persisted `unitPrice`/`lineTotal` when the transient recalculation cannot serve a persisted line | a saved price must survive a hard reload |
| Row badge states the persisted `priceOrigin`, with the as-of date on hover | provenance the user can see |
| Drawer gains a per-resource breakdown: coefficient, Basic Price source, adapted price, exact resource cost, plus occurrence/policy/region/as-of provenance | "where did this number come from?" |
| `manualUnitPrice` derived from `priceOrigin === 'MANUAL_CLIENT'` instead of "a unitPrice exists" | **defect fix on the canonical path**, see below |

### The `manualUnitPrice` defect

`mapBoqToRows` inferred "this row is manually priced" from the mere presence
of a `unitPrice`. A `SERVER_COST_KERNEL` row has one, so every persisted row
was flagged manual; `handleSaveDraft` then emitted a `unitPrice` key for it,
and the backend correctly rejected the save with
`SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN`. A line could not be edited again
after it was calculated. Fixed by asking the server's own `priceOrigin`.

No client-side money arithmetic was added. The pre-existing manual-row and
recap arithmetic (`UTANG-UI-MONEY-01`) is untouched and out of scope.

---

## 5. Non-goals — explicitly not done

Full RAB redesign · Monitoring · Recovery · War Room · procurement · contracts ·
broad TKDN · active Execution Factor · schedule · maps · universal document
ingestion · dependency or Prisma upgrade · broad architectural refactor ·
AHSP version publication workflow · Basic Price permission seeding ·
unit-conversion widening beyond the existing `PERSON_DAY` identity rule.

The last three are **real gaps found by the audit** and are recorded as
Level-B blockers in `01-TRACE-MATRIX.md`. They are governance and product-law
decisions belonging to Owner/PM, not to an executor, and are deliberately left
untouched.

---

## 6. Acceptance criteria for Level-A

1. `SCHEMA_CHANGE = MIGRATION_CHANGE = DEPENDENCY_CHANGE = NO`.
2. Backend build green; frontend build green.
3. Backend unit suite green with a net increase and no regression.
4. Frontend suite green with a net increase and no regression.
5. A persisted line re-proves to `VERIFIED` with exact stored/recomputed equality.
6. The per-resource breakdown carries coefficient, Basic Price id, adapted
   price and exact resource cost, and those costs sum to the stored unit price.
7. The re-proof path is provably read-only.
8. `RAB_VIEW` is required; an actor without it is rejected.
9. Official Safe E2E green in CI against `simprok_e2e`, with
   `RESIDUAL_RESULT: PASS`.
10. No production database write. No Owner bootstrap re-run. No credential rotation.

---

## 7. Laws honoured

- **P7C LAW-0.5 / 0.6** — every displayed value traces to canonical data or a
  deterministic kernel result over it; nothing is shown as fact without origin.
- **P7C LAW-2.5** — a manual price stays labelled manual and is never given
  kernel provenance; the re-proof refuses it by name.
- **P7C LAW-6.2** — money is born only in the deterministic Cost Kernel.
- **TEST-GT.1** — one Golden Thread is reproducible from source to total.
- **Hukum Pintu** — the breakdown panel appears only for a row that genuinely
  has one; otherwise it states honestly why it cannot.
- **Doktrin Cermin** — no browser verification is claimed in this document.
  Owner's eyes remain the final verdict.

Soli Deo Gloria. Haleluya. Amin.
