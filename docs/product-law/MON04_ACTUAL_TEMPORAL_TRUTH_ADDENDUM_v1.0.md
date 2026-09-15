# MON-04 Actual Temporal Truth Addendum v1.0

**Status:** OWNER-RATIFIED
**Owner:** Feky de Fretes
**Decision Date:** 2026-09-15
**Owner Decision:** `CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE`

## Relation to Existing Product Law

This Addendum records the later Owner-ratified law for MON-04 Actual temporal
truth. It preserves the historical record that temporal cutoff and
correction-period restatement semantics were previously deferred.

The following existing Product Laws remain canonical for every decision they
already establish:

- `docs/product-law/MONITORING_SUPERVISION_CONTROL_RECOVERY_LAW_20260824.md`
- `docs/product-law/MON04_CURRENT_NUMERIC_LAW_ADDENDUM_v1.0.md`

This Addendum supersedes only the previously deferred decision concerning
CURRENT-official-truth temporal cutoff and correction-period restatement.

## Law

1. Actual temporal Monitoring uses CURRENT governed official truth.

2. The required order is:

   ```text
   FULL CURRENT CONTEXT
   → LINEAGE
   → CURRENT LEAVES
   → LIFECYCLE ELIGIBILITY
   → NUMERIC DOMAIN
   → SEMANTIC AUTHORITY
   → COMPLETENESS
   → PROJECT BUSINESS workDate CUTOFF
   ```

3. Temporal cutoff MUST NOT be applied before lineage resolution.

4. Superseded predecessors never become temporal fallback.

5. A later correction may restate earlier Monitoring periods.

6. If a correction changes `workDate`, the current leaf's lawful `workDate`
   becomes the temporal placement.

7. Once a fact becomes current official truth, late verification or semantic
   proof may restate it back onto its lawful `workDate`.

8. Missing, ineligible, unproven, invalid, and incomplete truth MUST NOT be
   converted to zero.

9. A lawful current fact occurring after a cutoff may produce `COMPLETE(0)`
   through that cutoff without reviving its predecessor.

10. `AS_KNOWN_AT_TIME` remains DEFERRED. This Addendum does not define
    historical system-knowledge reconstruction.

11. Existing Law 1, Law 2, Law 3, H2-A1, Active Baseline, Execution Plan,
    audit history, and correction lineage remain unchanged.

12. No schema change is established by this law.

13. This Addendum supersedes ONLY the previously deferred decision concerning
    CURRENT-official-truth temporal cutoff and correction-period restatement.

14. Weekly/monthly UI, Schedule Realisasi, Kurva S series, comparator,
    Forecast, Recovery, and MON-05 remain separate implementation steps.

## Boundary

This law defines neither an `AS_KNOWN_AT_TIME` historical snapshot nor a
second Actual engine. It does not authorize fabricated schedule facts,
unknown-to-zero conversion, predecessor fallback, schema expansion, or
mutation of audit history.

Soli Deo Gloria. Haleluya. Amin.
