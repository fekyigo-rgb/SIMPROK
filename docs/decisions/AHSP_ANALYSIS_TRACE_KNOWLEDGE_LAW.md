# SIMPROK — AHSP Analysis Trace & Knowledge Decision
Date: 2026-09-08
Status: OWNER DECISION — LOCK

## Final Verdict

1. Jejak Analisa is NOT a mandatory user-facing feature. The AHSP Detail page remains simple and lightweight. Do not add a permanent technical diagram/flowchart merely for completeness.

2. SIMPROK SHOULD understand the formation/evidence of AHSP internally: components, coefficients, supporting evidence, explicitly evidenced assumptions/context, what is already covered by the AHSP, and what remains unknown or requires human decision.

3. Do not make runtime heavy by re-reading source documents on every use. Use: source documents/text → Agent/document intelligence → compact structured knowledge + evidence reference → Knowledge Repository → fast runtime consumption.

4. Input does NOT have to be PDF. Evidence may come from PDF, Excel, text/copy-paste, or other supported documents. Never invent missing evidence.

5. Agent AI is appropriate for the expensive learning/extraction step. Persist compact, evidence-backed knowledge; runtime SIMPROK should consume that knowledge rather than invoke an LLM for every page view or calculation.

6. No invented explanation of coefficients. If a source states Pekerja = 0.25 OH but does not explain why, SIMPROK may store the coefficient as an evidenced fact, but must not invent a productivity formula or assumption.

7. Long-term purpose: Execution Intelligence and anti-double-counting. AHSP knowledge should help distinguish what is already included in an AHSP, what is changed by execution conditions, what may legitimately become an Execution Factor, and what must not be added again.

## UI Decision

AHSP Detail should prioritize Informasi AHSP, Komponen Pembentuk AHSP, simple metadata, one clear Edit/Update entry point, Usulkan ke SIMPROK when applicable, and Riwayat when useful.

Do NOT add Terkait Penggunaan, Diskusi, or a permanent technical Jejak Analisa panel. A future Jejak Analisa / Dasar Analisa entry may be considered only when real evidence-backed content exists and it benefits the user.

## Architecture Law

SUPER SMART INSIDE, SIMPLE OUTSIDE.

Prefer: EXPENSIVE ONCE → COMPACT KNOWLEDGE → FAST MANY-TIMES USE.

Fail-closed applies to truth and canonical decisions, not to understanding/evidence discovery. Unknown facts remain explicitly unknown.

## Anti-Duplicate Law

Reuse existing SourceEnvelope / ReaderRegistry, AHSP document understanding, Unit Kernel, Resource Identity Intelligence, canonical AHSP writers, Knowledge Repository / Knowledge Bus principles, and existing Agent/AI capabilities where appropriate.

Do NOT create a second importer, second Resource Identity engine, second knowledge engine, or duplicate AHSP writer for this purpose.

## Owner Lock

This decision is the baseline for future AHSP intelligence work. Do not reopen or redesign it unless concrete contrary evidence appears.
