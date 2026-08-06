# RM-03B — PRIVATE ASSETS → ONE LIVE RAB ROW — 00 CONTRACT

### Dalam Nama Tuhan Yesus Kristus.

| Attribute | Value |
|---|---|
| Gate ID | `RM03B-PRIVATE-ASSETS` |
| Branch | `feat/rm03b-private-assets-one-live-row` |
| BASE_SHA | `99eff0019f84fe737234bd5fe8586475fd9794ce` (post-merge main) |
| PR65_MERGE_SHA | `99eff0019f84fe737234bd5fe8586475fd9794ce` |
| SCHEMA_CHANGE | **NO** |
| MIGRATION_CHANGE | **NO** |
| DEPENDENCY_CHANGE | **NO** |
| PRODUCTION_DATA_WRITE | **NO** |

---

## 1. Owner law this gate implements

| Law | Meaning | This gate |
|---|---|---|
| `BASIC_PRICE_SIMPROK_CATALOG` | general prices curated by SIMPROK's internal back-office | untouched |
| `USER_PRIVATE_BASIC_PRICE` | a user's own price, usable by their workspace immediately, no verifier/publisher/second human | **BLOCKED — see `03-SCHEMA-DECISION-PACKET.md`** |
| `USER_PRIVATE_AHSP` | a user's own AHSP, workspace-scoped, usable without national publication | **DELIVERED** |
| `PUBLICATION / REVIEW / VERIFICATION` | national catalog only, internal back-office | untouched, and never shown to general users |
| `GENERAL_USER_REVIEW_PUBLISH_UI=FORBIDDEN` | — | honoured; no back-office control added |
| `SECOND_HUMAN_ACTOR_FOR_PRIVATE_USE=NOT_REQUIRED` | — | honoured; the private AHSP path needs no second human |
| `PUBLIC_CATALOG_POLICY_REGRESSION=FORBIDDEN` | — | proven by test; catalog predicate byte-identical |

**A private asset is never called "published" anywhere in this gate** — not in
the database, not in the API, not in the UI wording.

---

## 2. The split, and why

The audit (`01-CURRENT-REALITY-MATRIX.md`) found the two asset types are **not
symmetric in the schema**, so they cannot be delivered together:

| | AHSP | Basic Price |
|---|---|---|
| Ownership discriminator | `ownershipType` (`SIMPROK_ASSET` / `APPROVED_COMMUNITY_ASSET` / `USER_ASSET`), schema.prisma:665 | **none** |
| Tenant column | `workspaceId`, documented "NULL for Official Repository", :657 | `workspaceId` (tenancy only) |
| Purpose-built index | `@@index([workspaceId, ownershipType])`, :705 | — |
| Can express "private, usable now"? | **YES** | **NO** |

Therefore:

- **RM-03B2 — private AHSP use: DELIVERED HERE.** No schema change.
- **RM-03B1 — private Basic Price: `STOP_SCHEMA_DECISION_REQUIRED`.** No
  writer, no migration, no inferred semantics. Decision packet supplied.

Consequence, stated plainly: in this gate a workspace-private AHSP is priced
from **PUBLISHED catalog Basic Prices**. That is a real and useful capability —
users far more often have their own *analysis method* than their own *prices* —
but it is not yet the full private-asset story, and this document does not
pretend otherwise.

---

## 3. What is implemented

### 3.1 Additive private-AHSP eligibility

`backend/src/project-ahsp/ahsp-eligibility.policy.ts` — one predicate builder,
consumed by **both** `listEligibleVersions` and the `selectForBoqItem`
server-side revalidation.

```
eligible = shared completeness
         AND (catalog branch OR private branch)

catalog branch  status = PUBLISHED
                ahsp.deletedAt = null
                ahsp.workspaceId ∈ { me, null }      ← unchanged
                version.workspaceId ∈ { me, null }   ← unchanged

private branch  status NOT IN (SUPERSEDED, ARCHIVED)   ← never requires PUBLISHED
                version.workspaceId = me               ← strict, never null
                ahsp.workspaceId    = me               ← strict, never null
                ahsp.ownershipType  = USER_ASSET
                ahsp.deletedAt = null AND ahsp.archivedAt = null
```

**Both call sites are built from the same function on purpose.** If the picker
could offer a version the binding would refuse — or worse, the reverse — that
gap is the privilege escalation. Sharing one builder makes drift impossible.

#### Why the private branch uses strict equality

`ownershipType` defaults to `USER_ASSET` and is **hardcoded to `USER_ASSET` by
`AhspService.create` for every row it writes — including the `workspaceId: null`
Official Repository branch** (`ahsp.service.ts:83`). So `ownershipType` alone is
**not** a private/catalog discriminator. Had the private branch reused the
catalog branch's `OR: [{workspaceId}, {workspaceId: null}]` clause, every
null-workspace row would have become eligible for **every tenant at once**.

`ownershipType` is also **user-mutable**: the transfer route can rewrite it,
gated only by a `reviewStatus` that is self-grantable in the same workspace.
The private branch is therefore keyed on **ownership of the row** (strict
`workspaceId` equality on both the AHSP and its version), with `ownershipType`
as a supporting condition only — never as the sole authority.

#### Why `archivedAt` is added on the private branch only

The pre-existing predicate checked `deletedAt` but never `archivedAt`. The
private branch asserts both. Tightening the **catalog** branch to match is
deliberately NOT done here — that would be a silent change to public behaviour,
which §7 forbids. It is recorded as a finding instead.

### 3.2 Tenant-trust prerequisites (security, not scope creep)

Private eligibility is keyed on `workspaceId`. That column was not trustworthy:

| Defect | Location | Fix |
|---|---|---|
| `workspaceId: body.workspaceId ?? workspaceId` — the **client value won** over the guard-verified one, so a member of workspace B could plant an AHSP into workspace A | `ahsp.controller.ts` create | trusted context only |
| same inversion for versions | `ahsp.controller.ts` version create | trusted context only |
| `findUnique({ where: { id: ahspId } })` with **no tenant check** — any workspace could append a version to any AHSP id, including a null-workspace catalog one | `ahsp-version.service.ts` | foreign parent → `not found` |

These were pre-existing. They become **exploitable pricing paths** the moment
private AHSPs are bindable, so they are closed here as a precondition. There is
no global `ValidationPipe` (`main.ts`) and the DTOs are plain interfaces, so a
forged body field is stripped nowhere else — it has to be ignored at the
controller.

A foreign parent is reported as **not found**, not forbidden, so the endpoint
never confirms the existence of ids the caller may not see.

### 3.3 Minimal honest UI

`frontend/src/utils/ahspOriginDisplay.ts` + the existing RAB picker:
each option is prefixed `[AHSP Saya]` or `[Katalog SIMPROK]`, and selecting a
private one shows *"Analisa milik workspace Anda sendiri — bukan kurasi
SIMPROK."*

An **absent** origin degrades to the catalog label, never to the private one:
claiming "this is yours" without evidence is the dishonest direction.

No AHSP-authoring UI is built (none exists today; creation is API-only). No
back-office control is added. That is the §11 minimum honest surface.

---

## 4. Non-goals

Private Basic Price writer · Basic Price schema change or migration · national
proposal workflow · back-office review/verify/publish UI for general users ·
unit-engine widening beyond `PERSON_DAY`/factor-1/IDENTITY · AHSP authoring UI ·
AHSP version publication lifecycle · any change to public/catalog eligibility ·
production data.

---

## 5. Acceptance criteria

1. `SCHEMA_CHANGE = MIGRATION_CHANGE = DEPENDENCY_CHANGE = NO`.
2. Catalog predicate unchanged; public path proven non-regressed by test.
3. A workspace's own never-published AHSP is listable and bindable by its owner.
4. A null-workspace `USER_ASSET` is **not** reachable through the private branch.
5. Another workspace's private AHSP is neither listed nor bindable.
6. Archived / superseded private assets are not eligible.
7. A forged `workspaceId` in a create body is ignored.
8. A version cannot be appended to another workspace's AHSP.
9. Binding a private AHSP resolves its resources against **published** Basic
   Prices and produces a normal occurrence.
10. PR #65's persisted read-only re-proof still passes unchanged.
11. Backend, frontend, and Official Safe E2E all green, with net test increase.

---

## 6. Laws honoured

- **P7C LAW-2.1/2.7** — SIMPROK does not invent prices; a private AHSP is still
  priced only from canonical Basic Prices, and nothing is fabricated.
- **P7C LAW-0.4** — no fake provenance; the origin label is derived from
  persisted columns, never asserted.
- **Owner Lock** — verification/publication remain separate human back-office
  actions for the catalog, and are neither required nor simulated for private use.
- **Hukum Pintu** — the private note appears only for a genuinely private asset.
- **Doktrin Cermin** — no browser verification is claimed in this gate.

Soli Deo Gloria. Haleluya. Amin.
