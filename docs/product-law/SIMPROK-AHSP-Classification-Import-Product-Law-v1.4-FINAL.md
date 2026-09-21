STATUS: LOCKED BY OWNER
VERSION: v1.4 FINAL
DATE: 19 September 2026
SUPERSEDES: v1.3 and earlier drafts

---

# SIMPROK — AHSP Classification & Import Product Law
## LOCKED v1.4 FINAL — 19 September 2026
### Canonical Handoff for Owner, PM/Gatekeeper, Architect, Auditor, Codex/Executor

**Owner:** Feky de Fretes  
**Status:** LOCKED PRODUCT LAW / CANONICAL SOURCE OF TRUTH  
**Supersedes:** v1.3 FINAL; adds multi-classification + interpretation/idempotency law  
**Canonical hierarchy:** `Jenis Pengadaan → Kategori → Subkategori → Jenis Pekerjaan → Uraian AHSP`

---

# 0. ABSOLUTE WORK LAW

Every AI/agent/executor working on this area MUST follow:

**FIND → PROVE → REUSE → CONNECT → EXPOSE → ACTIVATE → VERIFY**

Rules:
- Do not rebuild capability that already exists.
- Do not leave healthy capability dormant.
- If capability is broken: repair the minimum root cause.
- If capability exists but is disconnected: connect it.
- If capability exists but is hidden: expose/activate it.
- Build new capability only when repository evidence proves it is truly absent.
- Do not create a second taxonomy, second resource truth, second unit truth, second archive truth, second approval flow, or parallel workflow for the same domain fact.

---

# 1. CANONICAL AHSP CLASSIFICATION HIERARCHY

SIMPROK canonical hierarchy is:

**Jenis Pengadaan → Kategori → Subkategori → Jenis Pekerjaan → Uraian AHSP**

Supporting AHSP fields:
- **Satuan Output AHSP** — required for readiness.
- **Kode AHSP** — optional.
- **Dasar / Acuan AHSP** — normative/reference document.
- **Penerbit / Instansi Sumber** — institution/organization that issued the reference.
- **Sumber Data** — how the record entered/lives in SIMPROK; distinct from Dasar/Acuan and Penerbit.

**Important:** the hierarchy above defines the canonical shape of a classification path.  
An AHSP is **not limited to exactly one path**. One AHSP may have multiple lawful classification assignments/paths.

Example:

- Jenis Pengadaan: Pekerjaan Konstruksi
- Kategori: Bina Marga
- Subkategori: Drainase
- Jenis Pekerjaan: Gorong-gorong dan Drainase Beton Pracetak
- Uraian AHSP: Galian pada Saluran Air atau Lereng untuk Pemeliharaan
- Satuan: M3
- Kode AHSP: optional
- Dasar / Acuan AHSP: SE DJBK No. 47/SE/Dk/2026
- Penerbit / Instansi Sumber: instansi penerbit yang sah
- Sumber Data: Import / AHSP Saya / Organisasi / sumber internal SIMPROK lain

---

# 2. SIMPROK IS GLOBAL, NOT A PUPR APPLICATION

SIMPROK is an independent/global platform.

PUPR, Bina Marga, Cipta Karya, SDA, e-Katalog, and other government structures are **source/reference realities**, not the internal identity of SIMPROK.

Therefore:
- SIMPROK may adopt useful hierarchy and meaning.
- SIMPROK must not copy PUPR nomenclature blindly as its internal taxonomy.
- Canonical SIMPROK terminology must remain neutral and reusable across construction, consultancy, goods procurement, services, and future verticals.
- Original source terminology must still be preserved as provenance/knowledge.

---

# 3. MEANING BEFORE NOMENCLATURE

SIMPROK must NOT require source files to use SIMPROK terminology.

Importer / Document Understanding interprets source terminology by:

**meaning + hierarchy + context**

not by:
- fixed cell coordinates,
- exact label only,
- filename,
- one rigid government template.

Source labels may include:
- Bidang
- Kategori
- Divisi / Devisi
- Subkategori
- Kelompok
- Seksi
- Subseksi
- Jenis Pekerjaan

Canonical interpretation rules:
- source **`Bidang`** → canonical **`Kategori`** when hierarchy/context proves that level.
- source **`Divisi / Devisi`** → canonical **`Subkategori`**.
- source **`Seksi`** → canonical **`Jenis Pekerjaan`**.
- source **`Subseksi`** → preserve and interpret according to hierarchy/context; never map blindly.
- source labels already using `Kategori`, `Subkategori`, or `Jenis Pekerjaan` may map directly when context confirms the same semantic level.

---

# 4. PRESERVE ORIGINAL SOURCE TAXONOMY

Canonical normalization must NEVER erase or replace source nomenclature.

Example 1:

Source:
- sourceLabel = `Divisi`
- sourceCode = `2`
- sourceValue = `Divisi 2 Drainase`

Canonical:
- `Subkategori = Drainase`

Both remain known.

Example 2:

Source:
- `Seksi 2.3 Gorong-gorong Pracetak`

Canonical:
- `Jenis Pekerjaan = Gorong-gorong Pracetak`

But `Seksi`, `2.3`, and original wording remain stored as:
- source taxonomy,
- alias,
- code,
- provenance/context.

Canonical naming is an interpretation layer, NOT a destructive rewrite.

---

# 5. IMPORT MUST BE BACKWARD-COMPATIBLE AND LAYOUT-TOLERANT

## 5.1 Current/known format must remain supported

The current Import AHSP format that already recognizes:
- Kode AHSP
- Uraian AHSP
- Satuan Output

must remain supported.

Do NOT replace it with a new mandatory rigid template.

## 5.2 Richer/evolving formats must also be accepted

SIMPROK should also accept metadata appearing as:
- extra header rows,
- additional rows,
- additional columns,
- label:value pairs,
- section headers,
- mixed but understandable structures.

Example source metadata:

- BIDANG : Bina Marga
- DIVISI : Divisi 2 Drainase
- SEKSI : Gorong-gorong dan Drainase Beton Pracetak
- DASAR / ACUAN : SE DJBK No. 47/SE/Dk/2026
- PENERBIT : [instansi penerbit]

SIMPROK may interpret canonically:

- Kategori = Bina Marga
- Subkategori = Drainase
- Jenis Pekerjaan = Gorong-gorong dan Drainase Beton Pracetak
- Dasar/Acuan = SE DJBK No. 47/SE/Dk/2026
- Penerbit/Instansi Sumber = [instansi penerbit]

while preserving the original labels/values/codes.

---

# 6. ASSISTED IMPORT — HUMAN COMPLETION WHEN METADATA IS MISSING

For the current near-term product path, Import AHSP remains human-assisted for classification.

Before/around import, SIMPROK must provide the following context fields:

1. **Jenis Pengadaan** — single-valued for now
2. **Kategori**
3. **Subkategori**
4. **Jenis Pekerjaan**
5. **Dasar / Acuan AHSP**
6. **Penerbit / Instansi Sumber**

For classification, **Kategori + Subkategori + Jenis Pekerjaan may be assigned in more than one path** to the same AHSP. The UI should support multi-select/add-more classification paths rather than forcing one flat classification.

Rules:
- If the Excel/source already contains these data and SIMPROK understands them, prefill automatically.
- The user should NOT re-enter information SIMPROK already understood.
- If some metadata is absent, user may complete only the missing fields.
- These fields must reuse the SAME shared classification truth used by Buat RAB / Ruang Interaksi and Manual AHSP.
- Do not create an Import-only taxonomy.

Important distinction:
- **Dasar / Acuan AHSP** = normative/reference document.
- **Penerbit / Instansi Sumber** = institution/organization issuing that reference.
- **Sumber Data** = SIMPROK record provenance such as Import, AHSP Saya, Organisasi.
These three concepts must not be collapsed into one field.

These metadata fields should not be made universally mandatory for every global AHSP source unless a future explicit product law says so.

---

# 7. SOURCE IDENTITY vs CLASSIFICATION INTERPRETATION

The uploaded file/source evidence and the classification interpretation are **different layers**.

## 7.1 Source identity
The same file bytes/source evidence remain the same source/import identity.

Classification metadata must **not** be used to create a second source identity merely because the user changes or corrects a classification.

## 7.2 Classification is interpretation/context metadata
Classification may be corrected without creating a new source identity.

Required behavior:
- corrections must never be silently ignored;
- corrections must be stored/auditable;
- current classification truth may change while source evidence remains unchanged;
- source bytes/provenance remain immutable evidence.

## 7.3 Source evidence wins over conflicting declaration
If the source document explicitly states a classification and the user declares a conflicting classification:
- do not silently overwrite the source;
- preserve both source evidence and human declaration;
- surface the conflict;
- source evidence has higher authority as evidence of what the document itself says.

This mirrors the existing product principle: **Reality Before Decision**.

# 8. SOFT CASCADE, NOT HARD LOCK

Classification selection is a **soft cascade**.

Example:
- User chooses Kategori = Cipta Karya.
- SIMPROK prioritizes relevant Subkategori.
- User may still search outside those suggestions.
- If the needed classification does not exist, user may add it.

Likewise:
- choosing a Subkategori prioritizes related Jenis Pekerjaan;
- it does not hard-lock the user to a limited list.

SIMPROK helps navigate reality; it does not force global reality into a rigid closed tree.

---

# 9. CUSTOM CLASSIFICATION

If a needed Kategori/Subkategori/Jenis Pekerjaan does not yet exist:
- user may add it;
- default scope is workspace/local;
- it may be used immediately in that lawful scope;
- it must NOT auto-promote to global/shared taxonomy;
- do not invent a global approval/promotion engine unless a future governed requirement proves one is needed.

---

# 10. MULTI-CLASSIFICATION PATH LAW

One AHSP may legitimately be reusable across more than one classification context.

Therefore, canonical behavior is:

**one AHSP → many classification paths**

Example:
- Kategori A → Subkategori A1 → Jenis Pekerjaan X
- Kategori B → Subkategori B2 → Jenis Pekerjaan Y

## 10.1 Preserve path relationships
Do NOT model this as three unrelated flat arrays such as:
- Kategori = [A, B]
- Subkategori = [A1, B2]
- Jenis Pekerjaan = [X, Y]

because that loses the hierarchy relationship.

The canonical unit is a **classification assignment/path**.

## 10.2 Source-derived + user-added assignments may coexist
A source document may state one classification path, while the user legitimately adds another path because the same AHSP is reusable elsewhere.

Both must remain:
- distinguishable by provenance,
- auditable,
- non-destructive.

Do not silently replace source-derived classification with a user-added one.

## 10.3 Search/filter behavior
An AHSP must be returned when **any** of its assigned classification paths matches the active filters/search.

## 10.4 Near-term data-model caution
Existing scalar fields such as:
- `fieldCategory`
- `subCategory`
- `classification`

are not sufficient as the long-term canonical representation if multiple paths must be persisted.

This is a **product-law/data-model gap**, not permission to patch schema immediately.

Before any schema change:
**FIND → PROVE → REUSE** existing structures first.  
Any schema change requires explicit governed design and Owner authorization.

# 11. ONE SHARED CLASSIFICATION TRUTH

The same canonical classification source MUST be reused by:

- Buat RAB / Ruang Interaksi
- Manual AHSP
- Import AHSP
- AHSP list/search/filter

Do not duplicate lists per menu.

Target:

**One shared classification truth → many consumers**

---

# 12. SEARCH LAW

Search must understand BOTH canonical terms and source terms.

Searchable concepts include:
- Kode AHSP
- Uraian AHSP
- Jenis Pengadaan
- Kategori
- Subkategori
- Jenis Pekerjaan
- source nomenclature
- source codes
- aliases
- Dasar/Acuan when relevant
- Penerbit/Instansi Sumber when relevant

A user should be able to type:
- `Divisi 2`
- `Seksi 2.3`
- `jalan`
- `jembatan`
- `drainase`
- `gorong-gorong`
- `2.3`

and reach the relevant canonical classification/AHSP.

---

# 13. AHSP FILTER TARGET

Primary filter target:

**Search + Jenis Pengadaan + Kategori + Subkategori + Jenis Pekerjaan + Sumber**

For AHSP with multiple classification paths, filter matching is:
**match if any assigned path satisfies the selected filter context**.

Rules:
- `Dasar AHSP` should NOT remain a primary dedicated filter.
- Dasar/Acuan remains visible in AHSP Detail.
- Dasar/Acuan may remain discoverable through global search.
- Jenis Pengadaan must reuse the same source/options already used by Buat RAB / Ruang Interaksi.
- Do not create a separate Jenis Pengadaan list only for AHSP.

---

# 14. AHSP DETAIL TARGET LANGUAGE

Target information language:

- Jenis Pengadaan
- Kategori
- Subkategori
- Jenis Pekerjaan
- Uraian AHSP
- Satuan
- Kode AHSP
- Dasar / Acuan AHSP
- Penerbit / Instansi Sumber
- Sumber Data

Avoid duplicate meanings such as:
- `Jenis Pekerjaan`
- `Jenis Pekerjaan (klasifikasi)`

Before renaming any backend field, audit its actual meaning. Do not rename blindly.

---

# 15. IMPORT AHSP PRODUCT LAW

Import AHSP is a **gate to receive and understand AHSP**, not a resource-selection gauntlet.

## Layer A — Work Identity

SIMPROK prioritizes understanding:
- Jenis Pengadaan
- one or more classification paths containing:
  - Kategori
  - Subkategori
  - Jenis Pekerjaan
- Uraian AHSP
- Satuan Output
- Kode AHSP (optional)
- Dasar / Acuan AHSP
- Penerbit / Instansi Sumber

## Layer B — Formula Truth

SIMPROK preserves the formula source:
- Tenaga
- Bahan
- Alat
- raw resource name
- raw resource code, if present
- raw resource unit
- coefficient
- source provenance/context

These source facts are accepted first.

## Layer C — Resource Enrichment

- known/proven canonical resource → reuse automatically
- unknown resource → retained as raw/private information
- ambiguity → marked, not discarded
- resource canonicalization is enrichment and should not be the gate that rejects the AHSP formula/source truth itself

## Layer D — Pricing / RAB Use

When AHSP is used for calculation:
- the proper AHSP formula is selected;
- component resources resolve to canonical identity;
- Basic Price provides price truth in the relevant context;
- the resulting unit price contributes to RAB.

---

# 16. BOQ → AHSP MATCHING PRINCIPLE

When RAB/BOQ needs an AHSP, matching must not rely on Uraian alone.

Relevant signals may include:
- Kategori / family
- Subkategori
- Jenis Pekerjaan
- Uraian AHSP
- Satuan Output
- specification/context when available
- Kode AHSP as an optional supporting signal
- source/version when relevant

Kode AHSP is supporting evidence, not a universal identity key.

---

# 17. ONE RESOURCE TRUTH — BASIC PRICE ↔ AHSP ↔ MANUAL INPUT

Basic Price and AHSP MUST use one canonical resource intelligence/source of truth.

Law:
- resource proven in Basic Price must NOT be rematched from zero in AHSP;
- resource proven in AHSP must NOT be rematched from zero in Basic Price;
- Manual AHSP, Import AHSP, and Basic Price are different intake channels but must converge on the same canonical Resource Truth;
- do not create duplicate resolver/catalog/source-of-truth.

“One nerve / one intelligence” means:
- same canonical resource identity,
- same catalog authority,
- same evidence authority,
- same identity rules.

It does NOT require a single in-memory object instance.

## Open runtime proof
It is NOT YET proven that Manual AHSP canonicalizes immediately at entry/save time.
Do not claim that as already verified.
The product law is locked: Manual input must eventually converge on the same Resource Truth and must not create a separate intelligence path.

---

# 18. PRIVATE RESOURCE LAW

Unknown/private resources:
- may remain workspace/private;
- are not rejected merely because they are unknown;
- do not require global approval just to remain private;
- must not auto-publish globally.

Do not invent promotion/approval infrastructure unless future product evidence and governance require it.

---

# 19. Q1 — NO AMENDMENT NOW

Current law remains:

If an AHSP source lacks output unit:
- keep it PENDING;
- do not invent the unit;
- do not force READY;
- do not amend the incomplete-import law now.

The product may revisit this later based on real usage evidence.

---

# 20. EXISTING CAPABILITY PRESERVATION — FREEZE

Do not rebuild/reopen already healthy capability unless a new regression proves direct damage.

Preserve:
- F1 decision safety / historical-decision replay protection / source-fact binding
- F2 document-scoped summary/cache
- F3 provenance spoof protection
- F3 real MATERIAL→EQUIPMENT replacement path
- C1 archive / readForDocument / durability
- C2 workContext / browser presentation
- isolation / NOSUPERUSER guard
- reupload idempotency
- Resource Identity Kernel
- Unit Kernel
- observed/private resource persistence
- one-truth canonical resource reuse
- green build/test gates

---

# 21. LATEST VERIFIED CANDIDATE CHECKPOINT
## Handoff context — not a new product law

Last verified isolated candidate state:

- Worktree: `SIMPROK-WT-AHSP-GRADEA`
- Branch: `fix/ahsp-resource-decision-safety`
- HEAD/base/origin-main: `cfd44460`
- Worktree entries: 38
- Staged: 0
- Candidate NOT merged/promoted to Permanent

Verified status:
- Q2 existing AHSP output-unit authority via `AHSP_MANAGE` = PASS
- Q3 Basic Price ↔ AHSP one-resource-truth proof = PASS
- Q4 unique genuine human-question grouping = PASS
- Q1 = no amendment; current missing-output-unit law stays in force

Important:
Permanent may still show older behavior.
Do NOT look at old Permanent behavior and rebuild capability that is already fixed in the candidate.

---

# 22. NEAR-TERM IMPLEMENTATION STRATEGY

For speed, safety, and minimum regression:

**Human-assisted classification first.**

Near-term flow:

Import AHSP
→ user/SIMPROK completes:
- Jenis Pengadaan
- Kategori
- Subkategori
- Jenis Pekerjaan
- Dasar/Acuan AHSP
- Penerbit/Instansi Sumber
→ existing importer processes the file

Progressive intelligence later:
- if SIMPROK can read metadata automatically, prefill it;
- user only confirms/corrects when necessary;
- do not require taxonomy AI perfection before Import AHSP becomes useful.

For AHSP classification:
- source-provided path(s) are prefilled when understood;
- user may add additional lawful paths;
- Kategori/Subkategori/Jenis Pekerjaan must not be constrained to one-only values;
- Jenis Pengadaan remains single-valued for now unless Owner later revises this law.

This strategy does NOT block future automatic taxonomy understanding.

---

# 23. CANONICAL PRINCIPLE

**SIMPROK receives reality in the source’s language, understands its meaning, preserves the original nomenclature/provenance, normalizes it into a canonical internal language, and reuses shared intelligence across the whole product.**

**One SIMPROK.  
One Classification Truth.  
One Resource Truth.  
No parallel truth.**

Soli Deo Gloria.
