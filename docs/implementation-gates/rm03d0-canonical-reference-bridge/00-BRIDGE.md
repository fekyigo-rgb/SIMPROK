# RM-03D0 — CANONICAL REFERENCE FOUNDATION BRIDGE

### Dalam Nama Tuhan Yesus Kristus.

```
RM03D0_BRIDGE_ENGINEERING     = PASS
CANONICAL_REFERENCE_APPLY     = NOT_STARTED
CANONICAL_PLAN_SHA256         = NOT_YET_GENERATED
CANONICAL_REGION              = NOT_LIVE
CANONICAL_RESOURCE_CATALOG    = NOT_LIVE
CANONICAL_REFERENCE_WRITE     = 0
MERGE                         = NO
```

Engineering only. This branch closes the two gaps RM-03D0 discovery proved —
nothing else — and it never connects to canonical `simprok_db`, not even for a
dry-run.

Base: `9a23ff45e6a1c498574f1dc611125ce9e9695d03`.

---

## 1. The exact delta

| File | Kind | Purpose |
|---|---|---|
| `backend/src/resource-catalog/resource-catalog-bootstrap-planner.ts` | **modified** | additive confirmation-authority generalization |
| `backend/src/canonical-reference/canonical-reference-target.ts` | new | canonical target guard |
| `backend/src/canonical-reference/region-provisioner.ts` | new | governed Region provisioner |
| `backend/src/canonical-reference/canonical-reference-target.spec.ts` | new | guard tests + old-law preservation |
| `backend/src/canonical-reference/region-provisioner.spec.ts` | new | Region tests |
| `backend/src/resource-catalog/confirmation-authority.spec.ts` | new | authority tests |
| `backend/scripts/rm03d0/canonical-reference-provisioning.ts` | new | canonical-safe CLI wiring |
| this document | new | bounded gate record |

`FRONTEND_CHANGE = 0`. No schema, no migration, no Cost Kernel, no Basic
Price/AHSP/RAB, no product CRUD, no new database role.

**The whole executable change to the reviewed planner is the confirmation gate**
— 72 insertions, 2 deletions, of which the non-comment lines are only the two
new constants, one optional interface field, and the gate itself. No planning,
identity, disposition, provenance, advisory-lock or transaction line is touched.

---

## 2. Why the planner had to change at all

RM-02C1b's core planner is target-agnostic in everything that matters — its
planning, identity, disposition and provenance law never mention an
environment. One thing was not: the apply gate demanded a token whose literal
text is `APPLY_RM02C1B_TO_SIMPROK_TEST`.

Reusing that planner against canonical would have meant passing a string that
says "apply to simprok_test" while writing to `simprok_db`. That is not a
technicality — provenance in SIMPROK is load-bearing truth, and the audit trail
would have recorded something untrue. So the coupling is removed rather than
worked around.

### The generalization

```ts
export const CONFIRMATION_TOKEN = 'APPLY_RM02C1B_TO_SIMPROK_TEST';          // unchanged
export const CANONICAL_REFERENCE_CONFIRMATION_TOKEN = 'APPLY_RM03D0_CANONICAL_REFERENCES';
export const KNOWN_CONFIRMATION_TOKENS = [CONFIRMATION_TOKEN, CANONICAL_REFERENCE_CONFIRMATION_TOKEN];

ApplyParams.expectedConfirmationToken?: string   // omitted => legacy authority
```

Three properties make this safe rather than merely convenient:

1. **The default is the strictest legacy behaviour.** Omitting the expectation
   reproduces the old gate exactly, including its refusal of every other
   string and its original `STOP_MISSING_CONFIRMATION_TOKEN` reason code.
2. **Membership is checked before equality.** Without the allow-list,
   `expectedConfirmationToken` would be a footgun: a caller could pass one
   arbitrary string as both the expectation and the token and the gate would
   collapse into `x === x`. An unrecognised expectation now fails closed
   *even when the two strings match* — `STOP_UNKNOWN_CONFIRMATION_AUTHORITY`.
3. **No environment inference.** The planner still never reads `process.env` to
   decide authority. The caller names its authority explicitly, or gets the
   legacy one.

### PLAN_SHA256 is provably unaffected

`computePlanHash` and `canonicalPlanJson` take only a `BootstrapPlan`.
`applyBootstrapPlan` builds that plan by enumerating five fields into
`buildPlan` explicitly — there is no `...params` spread and `params` is never
serialized. A new field on `ApplyParams` therefore cannot enter the hash. Every
previously computed plan hash remains valid.

---

## 3. Old law preserved

```
LEGACY_RM02C1B_PRESERVED  = YES
ACCEPTANCE_GUARD_WEAKENED = NO
CORE_PLANNER_REUSED       = YES
```

- `scripts/rm02c1b/resource-catalog-bootstrap.ts` is **untouched**. It still
  loads `.env.test`, still runs `verifyAcceptanceDatabase`, still refuses
  anything but `simprok_test`, and still passes no expectation — so it still
  gets the legacy authority.
- `scripts/database-role-guards.ts` is **untouched**. `simprok_db` remains
  `FORBIDDEN_PRODUCTION_DATABASE` for acceptance and E2E.
- `test/acceptance/resource-catalog-bootstrap.e2e-spec.ts` is **untouched** and
  still asserts `'WRONG_TOKEN'` → `STOP_MISSING_CONFIRMATION_TOKEN`.
- The new canonical guard shares no code path with the old guards and cannot
  grant anything to them.

The independence is asserted against the *other guard's own constants*, not a
copy of them, so weakening either side breaks the build:

```
FORBIDDEN_PRODUCTION_DATABASE === CANONICAL_REFERENCE_DATABASE
assertAcceptanceEnvironment(canonical DSN) → throws
assertE2EEnvironment(canonical DSN, with destructive capability) → throws
assertCanonicalReferenceTarget(simprok_test | simprok_e2e) → STOP_NON_CANONICAL_DATABASE_REFUSED
```

---

## 4. Canonical reference guard

Proves four coordinates, each with its own reason code, and re-proves them
against the **server** rather than trusting the DSN:

```
database  = simprok_db      (simprok_test / simprok_e2e get a named refusal)
host      = 127.0.0.1
port      = 55432           (5432 — the forbidden legacy cluster — is refused)
workspace = a9978fab-d1fc-4bb3-9beb-5d8b89d973e3
```

Two details worth stating:

- **An absent port is refused, not defaulted.** Defaulting to 5432 would let a
  DSN aimed at the forbidden legacy cluster pass as "unspecified".
- **The live probe exists because a DSN can be right while the connection is
  not** — a tunnel, pooler or proxy. `current_database()` /
  `inet_server_addr()` / `inet_server_port()` are read back and run through the
  same predicate. The probe SQL is asserted to be `SELECT`-only.

No credential ever reaches an error message, a return value or a log; a test
pins that a DSN containing a password produces a refusal that contains neither
the password, the user, nor the scheme.

---

## 5. Region provisioner

Region is **reference data, not CRUD**. This module can bring one designated
Region into existence and recognise that it already exists. It cannot rename,
deactivate, delete or guess. No general `POST /regions` and no UI was added.

```
absent exact          → CREATE_REGION
exact existing        → REUSE_EXACT_REGION      (writes nothing, not even updatedAt)
same code, other name → STOP_REGION_CODE_CONFLICT
same name, other code → STOP_REGION_NAME_CONFLICT
exact but inactive    → STOP_REGION_INACTIVE_CONFLICT
whitespace-padded     → STOP_REGION_DESIGNATION_NOT_NORMALISED
```

Trimming is refused rather than applied: silently normalising would alter a
fact the Owner designated.

Same discipline as RM-02C1b — pure plan → canonical JSON → SHA-256 → apply
gated on that exact hash, inside one transaction under an advisory lock, with
the plan rebuilt and re-hashed *inside* the transaction so a stale review
cannot apply.

> **The real `REGION_CODE` / `REGION_NAME` are NOT in this branch.** RM-03D0
> discovery proved the Owner's Basic Price workbook contains no region: the
> only "lokasi" strings are `"Terima lokasi"` delivery terms, which name no
> place. The test fixtures use the deliberately non-geographic
> `TEST-REGION` / `Test Region Name` and are labelled as fixtures. Designating
> the real values is the Owner's, before any apply.

---

## 6. ResourceCatalog canonical wrapper

`scripts/rm03d0/canonical-reference-provisioning.ts` reuses the existing
planner verbatim — `loadCanonicalInventory`, `buildPlan`, `canonicalPlanJson`,
`computePlanHash`, `applyBootstrapPlan`. **No second planner exists.**

- Dry-run computes a **fresh** plan from current `simprok_db` state + canonical
  workspace `a9978fab…` + pinned inventory `CE2B3AEB…` + source evidence
  `46B3F354…`, and writes nothing.
- The Workspace-A plan hash committed at
  `rm02c1b-reviewed-bootstrap/01-RM02C1B-CANONICAL-PLAN.json` is **never**
  reused. Despite its file name it is an acceptance-workspace plan; a plan is a
  statement about one database at one moment.
- Apply requires the exact expected hash **and** the canonical token, both from
  the environment, never from argv.
- Order is Region, then ResourceCatalog.

Law lives in `src/` and CLI wiring in `scripts/` deliberately: jest's `rootDir`
is `src`, so law placed in `scripts/` would sit outside the standard CI gate.

---

## 7. Verification

| Gate | Result |
|---|---|
| Backend build | PASS |
| Backend unit (`npm test`) | **979 / 979**, 74 suites — baseline 911/71, so **+68 tests, 0 regressions** |
| New focused suites | 58 canonical-reference + 47 planner/authority |
| Legacy RM-02C1b planner spec | PASS, unmodified |
| Typecheck of new files | clean |
| Frontend delta | **0 files** |

Test matrix coverage: legacy preservation · acceptance/E2E cannot target
canonical · canonical guard accepts exact target and rejects wrong
db/host/port/workspace/missing authority · canonical token accepted only by the
canonical path · test token cannot authorize canonical · canonical token cannot
silently authorize acceptance · invented authority refused even when both
strings match · Region dry-run zero-write, create, reuse, conflict, idempotent,
stale-hash refused, readback mismatch refused · plan-hash determinism and
sensitivity · secret never in an error message · probe SQL is read-only.

---

## 8. Execution separation

```
CANONICAL_REGION_WRITE            = 0
CANONICAL_RESOURCE_CATALOG_WRITE  = 0
CANONICAL_PROVENANCE_WRITE        = 0
BASIC_PRICE_WRITE = 0   AHSP_WRITE = 0   BOQ_WRITE = 0   RAB_WRITE = 0
SCHEMA_WRITE = 0   MIGRATION = 0   RUNTIME_RESTART = 0
```

Unmerged feature code never connected to canonical `simprok_db` — not for
apply, not for dry-run. Every test above runs against injected structural
clients and plain objects; no test in this branch opens a database connection.

---

## 9. What must happen next, in order

1. Owner merge decision on this bridge.
2. **Owner designates `REGION_CODE` and `REGION_NAME`** — the one input this
   branch deliberately does not contain.
3. A separate Owner-controlled read-only canonical dry-run produces the fresh
   combined `REGION_PLAN_SHA256` + `RESOURCE_CATALOG_PLAN_SHA256`.
4. Owner RED apply, as `simprok_app`.
5. Region + ResourceCatalog live → return directly to `ONE_LIVE_RAB_ROW`.

Soli Deo Gloria. Haleluya. Amin.
