# RM-02B0 — Dedicated `simprok_rm02_audit` Role Contract

STATUS: `PROVISIONAL_PENDING_ARCHITECT_REVIEW_AND_OWNER_AUTHORIZATION`

`simprok_rm01b_audit` is **not modified, not reused, not extended** by this design. Everything below describes a **new**, separately-provisioned, separately-revocable role.

```
EXISTING_RM01B_AUDIT_ROLE_MUTATION=FORBIDDEN (and not performed)
NEW_DEDICATED_ROLE_REQUIRED=YES
PROPOSED_NEW_ROLE=simprok_rm02_audit
RM01B_AUDIT_ROLE_CHANGED=NO
```

## 1. Why a new role, not an extension

`simprok_rm01b_audit`'s contract (per the governing prompt's already-verified §5.13/§5.14 facts, corroborated structurally by its self-verifying provisioning script's `DIRECT_COLUMN_SELECT_GRANT_COUNT == 45` / `MUTATION_GRANT_COUNT == 0` / `DIRECT_FULL_TABLE_GRANT_COUNT == 0` postconditions) is an exact, closed, already-audited allowlist over 10 identity/governance tables. It has no privilege on any Basic Price domain table. Silently widening it would:

- retroactively change a contract that has already been reviewed and locked for RM01B's purposes;
- make the audit trail for "what can this role see" ambiguous across two unrelated investigations;
- couple RM02's future revocation/rotation lifecycle to RM01B's, when they have no reason to share one.

A new role is independently grantable, independently revocable, and independently auditable — strictly safer than widening an existing, already-closed grant.

## 2. Derivation of the exact column allowlist

Every column below was derived by working backwards from the **specific output fields required by `06-RM02B0-PRODUCTION-PREFLIGHT-READONLY.psql` §24.1–§24.6** (which mirrors the governing prompt's required preflight outputs exactly). No table or column is granted "just in case." Per instruction, several tables named as *candidates* in the governing prompt's own list are deliberately **excluded** because no required output actually needs them:

| Candidate table | Included? | Reason |
|---|---|---|
| `basic_prices` | YES | direct subject of §24.1 |
| `price_submissions` | YES | direct subject of §24.2 |
| `price_submission_revisions` | YES | direct subject of §24.2 |
| `price_submission_reviews` | YES | direct subject of §24.3 |
| `price_submission_review_decisions` | YES | direct subject of §24.3 (action-type counts only) |
| `price_submission_audits` | **NO** | every §24.3 output (`VERIFIED_SUBMISSION_WITHOUT_ACCEPT_DECISION_COUNT`, etc.) is derivable from `price_submissions` + `price_submission_reviews` + `price_submission_review_decisions` alone; the audit log additionally carries free-text `reason`, which is exactly the kind of note-like content the governing prompt says must not be exposed ("Jangan mengekspos row-level business-sensitive values" / "Do not expose human names, emails, or notes") |
| `boq_items` | YES | direct subject of §24.4 |
| `resource_catalog` | **NO** | no §24 output requires any `resource_catalog` column — the preflight only needs the *foreign key id* already present on `price_submissions.resourceId`, never the resource's own name/code/spec |
| `workspaces` | **NO** | no §24 output requires a `workspaces` column — only the raw `workspaceId` UUID already on the price tables is needed, for grouping/distinctness, never the workspace's name or any other attribute |
| `organizations` | **NO** | same reasoning as `workspaces` |

## 3. Canonical column matrix

| TABLE_NAME | COLUMN_NAME | PREFLIGHT_QUERY_SECTION | WHY_REQUIRED | SENSITIVE_DATA_RISK | GRANT_REQUIRED |
|---|---|---|---|---|---|
| basic_prices | id | 24.1 | row counting | none (surrogate key) | YES |
| basic_prices | status | 24.1 | status/verification crosstab | none (enum-like string) | YES |
| basic_prices | "verificationStatus" | 24.1 | status/verification crosstab | none | YES |
| basic_prices | "regionId" | 24.1, 24.5 | null/distinct region audit | low (UUID only, no name) | YES |
| basic_prices | "effectiveDate" | 24.1 | null-date count | low (date only, no context) | YES |
| basic_prices | value | 24.1 | min/max — **aggregate only**, never row-level | **medium if exposed row-level; mitigated: preflight SQL only ever selects MIN()/MAX() aggregates, never a bare `value` per row** | YES |
| basic_prices | "workspaceId" | 24.1 | tenant-scoping counts | low (UUID only) | YES |
| basic_prices | "organizationId" | 24.1 | tenant-scoping counts | low (UUID only) | YES |
| basic_prices | "sourceSubmissionId" | 24.1, 24.2 | duplicate-link / orphan detection join key | low (UUID only) | YES |
| basic_prices | "createdAt" | 24.1 | legacy-row classification | low | YES |
| basic_prices | "resourceId" | 24.6 | duplicate-identity collision scan (aggregate only) | low (UUID only) | YES |
| price_submissions | id | 24.2 | row counting / join key | none | YES |
| price_submissions | status | 24.2 | status distribution | none | YES |
| price_submissions | "workspaceId" | 24.2 | null-tenant counts | low | YES |
| price_submissions | "organizationId" | 24.2 | null-tenant counts | low | YES |
| price_submissions | "resourceId" | 24.2 | null-resource defensive proof | low (UUID only) | YES |
| price_submissions | "currentRevisionId" | 24.2 | missing-current-revision detection | low (UUID only) | YES |
| price_submissions | "regionId" | 24.5 | region readiness audit | low (UUID only) | YES |
| price_submission_revisions | id | 24.2 | join key | none | YES |
| price_submission_revisions | "submissionId" | 24.2 | orphan detection join key | low (UUID only) | YES |
| price_submission_revisions | "effectiveDate" | 24.2 | null-date count | low | YES |
| price_submission_revisions | value | 24.2 | min/max — aggregate only | medium if row-level; mitigated same as above | YES |
| price_submission_reviews | id | 24.3 | row counting | none | YES |
| price_submission_reviews | "priceSubmissionId" | 24.3 | orphan detection join key | low (UUID only) | YES |
| price_submission_reviews | "slaState" | 24.3 | open/resolved counts | none | YES |
| price_submission_reviews | "resolvedAt" | 24.3 | resolved counts | low (timestamp only) | YES |
| price_submission_review_decisions | id | 24.3 | row counting | none | YES |
| price_submission_review_decisions | "reviewId" | 24.3 | join key | low (UUID only) | YES |
| price_submission_review_decisions | action | 24.3 | accept/reject/correction/reassign counts | none (enum-like string) | YES |
| boq_items | id | 24.4 | row counting | none | YES |
| boq_items | quantity | 24.4 | min/max/scale analysis — aggregate only | medium if row-level; mitigated same as above | YES |

```
RM02_AUDIT_ROLE_REQUIRED_TABLE_COUNT=6
RM02_AUDIT_ROLE_REQUIRED_COLUMN_COUNT=31
RM02_AUDIT_ROLE_COLUMN_ALLOWLIST=
  basic_prices(id, status, "verificationStatus", "regionId", "effectiveDate", value, "workspaceId", "organizationId", "sourceSubmissionId", "createdAt", "resourceId")
  price_submissions(id, status, "workspaceId", "organizationId", "resourceId", "currentRevisionId", "regionId")
  price_submission_revisions(id, "submissionId", "effectiveDate", value)
  price_submission_reviews(id, "priceSubmissionId", "slaState", "resolvedAt")
  price_submission_review_decisions(id, "reviewId", action)
  boq_items(id, quantity)
```

Note on `value`/`quantity` columns: they are included because §24 requires MIN/MAX aggregates. The preflight SQL (`06-RM02B0-PRODUCTION-PREFLIGHT-READONLY.psql`) is written to **never** `SELECT value` or `SELECT quantity` as a bare per-row projection — only inside `MIN()`/`MAX()`/scale-analysis aggregate expressions, and the governing prompt's own instruction ("Do not expose row-level business-sensitive values") is honored by that query discipline, not by withholding the column grant (withholding it would make the required MIN/MAX outputs impossible to produce at all).

## 4. Role attribute and setting contract

```
RM02_AUDIT_ROLE_ATTRIBUTE_CONTRACT=
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS
  CONNECTION LIMIT 1

RM02_AUDIT_ROLE_SETTING_CONTRACT=
  default_transaction_read_only = on
  statement_timeout = '15s'
  lock_timeout = '3s'
  idle_in_transaction_session_timeout = '30s'

RM02_AUDIT_ROLE_MUTATION_PRIVILEGE_COUNT=0
RM02_AUDIT_ROLE_MEMBERSHIP_COUNT=0
RM01B_AUDIT_ROLE_CHANGED=NO
```

Database/schema-level privileges: `CONNECT` on exactly `simprok_db`, `USAGE` on schema `public`. No `CREATE`, no sequence privilege, no function `EXECUTE` (no §24 output requires calling any function beyond built-in introspection functions, which do not require `EXECUTE` grants to the built-ins themselves), no `ALTER DEFAULT PRIVILEGES`, no future-object wildcard grant, no role membership of any kind.

## 5. Relationship to the provisioning and preflight artifacts

- `04-RM02B0-RM02-AUDIT-ROLE-PROVISION-PROPOSAL.psql` implements exactly this contract as DCL — proposed only, not executed.
- `06-RM02B0-PRODUCTION-PREFLIGHT-READONLY.psql` is written to require **exactly** this column set (no more) and proves it via the three-layer visibility gate (§23 of the governing prompt) before running any substantive `SELECT`.

```
ROLE_PROVISIONING_PROPOSAL_CREATED=YES (see 04, 05)
ROLE_PROVISIONING_EXECUTED=NO
ROLE_PROVISIONING_REQUIRES_ARCHITECT_REVIEW=YES
ROLE_PROVISIONING_REQUIRES_OWNER_AUTHORIZATION=YES
ROLE_PROVISIONING_CLASSIFICATION=RED
```
