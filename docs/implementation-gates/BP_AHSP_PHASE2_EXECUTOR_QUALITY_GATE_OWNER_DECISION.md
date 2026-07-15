# BP-AHSP Phase 2 — Executor Quality Gate Owner Decision

**Status:** OWNER DECISION — LOCKED FOR COMMIT B ONLY  
**Owner:** Feky de Fretes  
**Date:** 15 July 2026  
**Applies to:** GitHub Issue #25 / BP-AHSP Phase 2 Commit B only

---

## 1. Owner Principle

Executor governance is a quality fence, not a permanent tool monopoly.

The purpose of executor restrictions is to protect SIMPROK quality, trustworthiness, scope discipline, evidence integrity, and auditability. A named tool is not inherently trusted or distrusted. The controlling standard is whether the executor can work within the locked scope and produce verifiable evidence that passes PM/Gatekeeper review.

Therefore:

```text
QUALITY, EVIDENCE, AND GATE COMPLIANCE
ARE AUTHORITATIVE OVER EXECUTOR BRAND OR TOOL NAME.
```

This decision does not weaken any product, security, database, testing, or scope law.

---

## 2. Bounded Executor Authorization for Commit B

Claude Code is explicitly authorized to implement **Commit B only** for BP-AHSP Phase 2:

```text
Kernel Option C — Freshness-Aware Deterministic Resolution
```

This authorization supersedes prior `CODEX ONLY` executor clauses **only for Commit B of Issue #25**.

The authorization is justified by observed behavior:

- Claude Code proved the exact baseline before editing;
- detected the executor-law conflict;
- stopped fail-closed;
- made no unauthorized changes;
- deferred to Owner/PM rather than bypassing governance.

These actions demonstrate the discipline required for this bounded implementation slice.

---

## 3. Exact Scope

Claude Code may modify exactly these two files:

```text
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.ts
backend/src/ahsp/price-resolution/ahsp-resource-price-resolution.kernel.spec.ts
```

No other file is authorized.

Commit C, Commit D, schema, migration, service, controller, module, E2E infrastructure, frontend, Cost Kernel, RAB arithmetic, Execution Factor, and PR creation remain prohibited.

---

## 4. Quality Gate

Authorization to write code is not authorization to declare PASS.

Commit B must still prove:

- exact trusted baseline;
- exactly two changed files;
- preservation of all existing Phase 1 tests and outputs;
- five real Option C regression tests;
- no fake, skipped, or placeholder tests;
- focused kernel test PASS;
- full backend unit PASS;
- backend build PASS;
- clean worktree;
- local and remote branch equality;
- PM/Gatekeeper source review before any next stage.

Claude Code must stop immediately after Commit B and must not begin Commit C.

---

## 5. Independent Review

Claude Code may implement Commit B, but it does not self-certify production readiness.

The result must return to:

```text
Owner
→ PM / Gatekeeper
→ Architect / independent reviewer as needed
```

Only PM/Gatekeeper may issue `COMMIT_B_PM_GATE_PASS`.

---

## 6. Non-Generalization Law

This is not a blanket authorization for Claude Code, Codex, Antigravity, or any other tool to implement any SIMPROK task.

Executor selection is decided per bounded task based on:

- technical capability;
- repository discipline;
- adherence to locked laws;
- evidence quality;
- reliability demonstrated in the current slice;
- Owner and PM authorization.

Commit C and Commit D require a new explicit executor decision after Commit B review.

---

## 7. Final Controlling Statement

> Claude Code is authorized to implement BP-AHSP Phase 2 Commit B only, under the exact two-file scope and all existing quality gates. Prior `CODEX ONLY` clauses are superseded only for this bounded Commit B slice. Quality, evidence, and PM Gate remain authoritative.
