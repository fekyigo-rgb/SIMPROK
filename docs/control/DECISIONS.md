# SIMPROK — DECISIONS.md

Status: MUTABLE OPERATIONAL REGISTER, APPEND-ONLY.

Register ini mencatat keputusan Owner/Arsitek yang mempunyai bukti
repository/dokumen eksplisit. Register ini tidak mencipta keputusan baru,
tidak menomori ulang, dan tidak menyalin ulang seluruh isi sumber mengikat.
Keputusan lama tidak dihapus; keputusan baru yang menggantikan menulis
`SUPERSEDES`, keputusan lama menulis `SUPERSEDED_BY` (ROADMAP.md §17.10).

## Sumber mengikat (tidak disalin ulang di sini)

- `docs/control/ROADMAP.md` — FINAL v1.0, OWNER-LOCKED, urutan produk RM-00
  sampai RM-12.
- `docs/control/CARA-KERJA.md` — versi 2.1 FINAL, metode kerja Owner-Agent.

Bila entry di bawah tampak bertentangan dengan dua sumber di atas, dua
sumber di atas menang; laporkan gap, jangan mengoreksi sumber di sini.

## Register

### OD-04 — DECIMAL PRECISION POLICY
- STATUS: LOCKED.
- OWNER_LOCK_DATE: 2026-07-30.
- REGISTER_SYNC_DATE: 2026-08-01.
- OWNER_RE_RATIFICATION_REQUIRED: NO.
- CANONICAL_POLICY:

```text
CANONICAL_MONEY_SCALE=2
BOQ_QUANTITY_SCALE=6
INTERMEDIATE_ROUNDING=NONE
ROUNDING_MODE=ROUND_HALF_UP
ROUNDING_AUTHORITY=BACKEND_EXACT_DECIMAL
RAW_SOURCE_NUMERIC_EVIDENCE=RETAINED
```

- INTERPRETATION: setiap nilai kanonik yang dipersist dibulatkan pada
  canonical boundary; kalkulasi di antara boundary tidak dibulatkan ulang.
- ROADMAP_EFFECT: OD-04 bukan lagi blocker terbuka karena keputusan Owner
  telah dikunci. Implementasi tetap harus mengikuti policy di atas.
- CORRECTION_NOTE: status OPEN sebelumnya adalah stale operational-register
  entry, bukan pencabutan atau ketiadaan keputusan Owner.
### OD-IMPORT-01 — BOQ XLSX bounded intake ke Working Draft kosong
- STATUS: IMPLEMENTED (scope PR #35), belum ada catatan ratifikasi formal
  terpisah di repository selain PR itu sendiri — NEEDS_REVIEW untuk asal
  keputusan/ratifikasi resminya.
- SOURCE: PR #35 body ("Implements OD-IMPORT-01 as a bounded BOQ XLSX
  journey into an existing empty Working Draft"), merge commit
  `095002bdebb77a8439015551ec853be5b91d50dc`.
- NOTE: ID ini hanya ditemukan pada teks PR #35 di GitHub, tidak pada
  berkas repository manapun yang digit-grep. Dicatat apa adanya, tidak
  dihilangkan, ditandai `NEEDS_REVIEW` untuk sumber keputusan aslinya.

### UTANG-AUTOBASELINE-13 remediation decision
- STATUS: IMPLEMENTED_AND_MERGED
- SOURCE: PR #37 body ("UTANG-AUTOBASELINE-13 is addressed in this
  revision: setup prepares or reuses DRAFT state only"), commit
  `e6165a587dc6a514dd596f939073b2a6ccb4d28b` (parent of merge
  `478ce4f76960e4e557d7f32a15b20df3c7639905`).
- Lihat `docs/control/DEBT.md` untuk status debt terkait.

## Prinsip Owner — belum diratifikasi (dicatat, bukan hukum aktif)

### ID=UNASSIGNED — AHSP Universal Intake & Curation Law
- RECORD_AS: OWNER_PRINCIPLE_PENDING_RATIFICATION
- STATUS: BELUM_DIRATIFIKASI
- ENUM_STATUS: ILUSTRATIF_TIDAK_MENGIKAT — enum di dalam prinsip ini
  (mis. status kurasi AHSP) tidak boleh diperlakukan sebagai schema/domain
  terkunci oleh executor mana pun.
- SOURCE: EXPLICIT_OWNER_DIRECTIVE, 2026-07-21, dilampirkan pada prompt
  eksekusi RM-00/PR #36 (bukan dari GitHub/commit).
- RATIFY_AT: desain RM-02/RM-03, di bawah review Gemini + Arsitek.
- RINGKASAN (bukan salinan hukum penuh — lihat sumber Owner untuk teks
  lengkap): AHSP dari tiap bidang boleh punya bentuk input berbeda dan
  wajib dinormalisasi ke satu model AHSP kanonikal; data tak terpetakan
  tidak boleh ditebak diam-diam; user dapat membuat/mengimpor AHSP privat
  untuk dipakai sendiri di akun/workspace berwenang tanpa menunggu kurasi
  nasional; status kurasi mengendalikan publikasi nasional, bukan hak
  pakai privat; `APPROVED_COMMUNITY_ASSET` tidak otomatis menjadi
  `SIMPROK_ASSET`.
- EFFECT_ON_CURRENT_SLICE: DOCUMENT_ONLY. Tidak ada perubahan
  ROADMAP.md/CARA-KERJA.md, kode AHSP, schema, atau write `simprok_db`
  pada slice RM-00 ini.

### ID=UNASSIGNED — Basic Price Parallel Curation Pattern
- RECORD_AS: OWNER_PRINCIPLE_PENDING_RATIFICATION
- STATUS: BELUM_DIRATIFIKASI
- ENUM_STATUS: ILUSTRATIF_TIDAK_MENGIKAT
- SOURCE: EXPLICIT_OWNER_DIRECTIVE, 2026-07-21, dilampirkan pada prompt
  eksekusi RM-00/PR #36 (bukan dari GitHub/commit).
- RATIFY_AT: desain RM-02, di bawah review Gemini + Arsitek.
- RINGKASAN: pola kesamaan dengan poin 5–7 AHSP Universal Intake berlaku
  untuk Basic Price (user dapat membuat/mengimpor Basic Price privat dan
  memakainya sendiri; pengusulan kurasi nasional opsional; penolakan
  kurasi tidak menghapus hak pakai privat). Ini kesamaan pola, BUKAN
  penyamaan enum/status/tabel/workflow AHSP dengan Basic Price. Ketentuan
  Basic Price kanonikal yang sudah ada (Resource + Location + Date +
  Source, verification status, snapshot/lineage, tenant isolation)
  mengungguli analogi ini bila berbeda.
- EFFECT_ON_CURRENT_SLICE: DOCUMENT_ONLY. Tidak ada perubahan kode Basic
  Price, schema, atau write `simprok_db` pada slice RM-00 ini.

## Soli Deo Gloria. Haleluya. Amin.

### AD-PROCESS-01-R1 — RED gate sequence correction
- STATUS: FINAL, Revision 1.
- ROOT_CAUSE: PM_RED_GATE_SEQUENCE_FAILURE.
- EXECUTOR_SCOPE_DEVIATION_IN_AUDIT_ACCOUNT_EVENT: NO.
- OWNER_AUTHORIZATION: YES.
- ARCHITECT_REVIEW_BEFORE_EXECUTION: NO.
- CONSTITUTION_REVIEW_BEFORE_EXECUTION: NO.
- R0: no RED execution before the complete RED review chain passes.
- R1: the executor runs the exact frozen scope without improvisation.
- R2: production access follows the full RED gate, not Architect-only review.
- R3: every audit uses a Frozen Evidence Contract.
- R4: debt may be triaged in bulk, but evidence and closure remain per debt.
- R5: evidence already obtained is reused.
- R6: only security, data integrity, tenant isolation, or irreversible risk
  may block the active slice.
- R7: one Closure Packet, one final report, one decision.
- Questions outside the Evidence Contract do not expand the slice. Critical
  findings are reported and fail closed; non-critical findings enter a
  non-blocking backlog. All known blockers are reported together.
- ROADMAP.md and CARA-KERJA.md are unchanged. Gate failure is not shifted to
  the executor; Codex executed the mandate it was given.

### AD-RM01B-01 — One phased Closure Packet
- STATUS: FINAL.
- DECISION: RM01B uses one Closure Packet with PHASE-0 through PHASE-4 kept
  separate. No phase auto-advances. Every later phase needs its own exact gate
  and authorization.

### AD-RM02D2A-01 — Verification and publication are separate human actions
- STATUS: LOCKED.
- SOURCE: `RM02D2A-1-BACKEND-RUNTIME-LIFECYCLE-CLOSURE-V2` governing prompt
  §2, implemented verbatim in `docs/implementation-gates/rm02d2a1/OWNER-LOCK.md`
  (full text of the lock, not copied here).
- DECISION (summary only — OWNER-LOCK.md is binding): ACCEPT of a Basic
  Price review creates exactly one `BasicPrice` at `UNPUBLISHED+VERIFIED`,
  never `PUBLISHED`. Publication (`status` AND `verificationStatus` both to
  `PUBLISHED`, atomically) is a separate action, gated by
  `BASIC_PRICE_PUBLISH`, and is refused (`409 VERIFIER_CANNOT_PUBLISH`)
  when the publisher is the same human who verified it. Auto-publish is
  forbidden; no bypass/self-approval/admin-fallback path exists.
- ACCEPTED RISK: a single-human workspace cannot publish a Basic Price
  through this normal path. Owner has accepted this risk explicitly (see
  OWNER-LOCK.md §2.1). A governed exception path is deferred to a separate,
  future Owner decision — not sketched or implied by this entry.
- IMPLEMENTED_BY: branch `feat/rm02d2a1-backend-runtime-lifecycle`, base
  `ccb6983419b8b134d6cfc4b1dba87518af3db59a`. Not yet merged
  (`MERGE_AUTHORITY=OWNER_ONLY`, `RM02_EXIT_GATE=OPEN` — see STATE.md).

### AD-RM02D2A2-01 — ONE SIMPROK BASIC PRICE PRODUCT MODEL
- STATUS: FINAL. OWNER_AUTHORIZED=YES.
- SOURCE: `RM02D2A2-REMEDIATION-03-FINAL` governing prompt (Owner, 2026-07-31),
  correcting a prior misreading of the product model by PM/reviewer.
- ROOT_CAUSE OF PRIOR MISREADING: Basic Price was implemented as a
  capability-space with a role/permission-dependent landing page, an
  Explorer gated behind `BASIC_PRICE_VIEW` alone, Review/Publication links
  surfaced inside the public Explorer, and user import gated in part by the
  internal `BASIC_PRICE_REVIEW_VIEW` curation code.
- DECISION:
  1. SIMPROK is one product. There is no Basic Price edition, variant, or
     role-based product experience (`ONE_SIMPROK_PRODUCT=YES`,
     `PRODUCT_EDITION_VARIANT=NO`).
  2. Every account with an ACTIVE `WorkspaceMembership` on the active
     workspace — any role, custom role, or no role — gets the same Basic
     Price baseline: view the public catalog, search/filter it, and use
     Impor/Masukkan Harga to manage and submit their own import batch.
     Canonical baseline capabilities:
     `BASIC_PRICE_VIEW, BASIC_PRICE_IMPORT, BASIC_PRICE_RESOLVE,
     BASIC_PRICE_SUBMIT`, granted structurally by
     `WorkspacePermissionResolverService` (backend/src/auth/
     workspace-permission-resolver.service.ts), never by role-by-role or
     email-literal grants. `INVITED`/`SUSPENDED`/missing/no-active-workspace
     accounts remain fail-closed (null/deny).
  3. Internal curation capabilities — `BASIC_PRICE_REVIEW_VIEW`,
     `BASIC_PRICE_VERIFY`, `BASIC_PRICE_PUBLISH` — are never part of this
     baseline and are never surfaced in the general product (no capability
     landing, no "Antrean Review"/"Antrean Publikasi"/"Manajemen Basic
     Price" link from a product page). Their backend routes and guards
     stay live and fail-closed via direct protected routes, pending a
     separate canonical back-office shell slice.
  4. `/basic-price` renders `BasicPriceExplorerPage` directly for any
     account reaching it — no capability-aware chooser, no role-dependent
     variant. The Sidebar shows Basic Price universally, exactly like every
     other nav item.
  5. User-owned import boundary: a user's own import-batch lifecycle
     (view/update batch, resolve/reject/candidate-lookup a row, submit
     batch) is scoped to the uploading account
     (`basic-price-import-ownership.util.ts`) — a same-workspace teammate
     holding the same capability cannot read or mutate another account's
     batch. This is separate from, and does not touch, internal
     `PriceSubmission` curation, which begins only after a user submits.
  6. Three Basic Price source families are locked
     (`SOURCE_FAMILY_MAP=OWNER_LOCKED`): GOVERNMENT -> Harga Pemerintah;
     SUPPLIER/STORE/DISTRIBUTOR -> Harga Toko/Supplier; FIELD_REPORT/
     COMMUNITY_REPORT -> Harga Lapangan. No new enum/schema field — a pure
     grouping over the existing `PriceSourceOrigin` values
     (`basic-price-source-family.util.ts`), and the Explorer's new
     Kategori (`ResourceCatalog.type`) and Keluarga Sumber filters are
     built the same way. Exact `sourceOrigin` filtering remains available
     for backward compatibility.
  7. SOURCE ≠ REPORTER: source answers "whose price is this"; reporter
     answers "who entered/reported it." A user manually entering a
     government HSPK is still `SOURCE_FAMILY=GOVERNMENT` with that user as
     reporter — manual input never implies Harga Lapangan by itself.
  8. Intake direction for this slice only: government manual import is the
     supported existing path; government website/application connectors,
     supplier direct/automatic connectors, and any Field Evidence redesign
     are explicitly out of scope (`*_CONNECTOR=FUTURE_NOT_IN_SCOPE`,
     `FIELD_EVIDENCE_REDESIGN=NOT_IN_SCOPE`).
  9. Private-use + optional-curation principle: this decision RATIFIES the
     "Basic Price Parallel Curation Pattern" principle recorded above
     (private/workspace Basic Price may be used without waiting for
     national curation; curation rejection never revokes private-use
     rights) as Owner Law. `PRIVATE_BASIC_PRICE_PRINCIPLE=RATIFIED`. Its
     *implementation* (Harga Saya, Simpan untuk saya, Usulkan ke SIMPROK,
     human submission status, AHSP/RAB consumption snapshot) is explicitly
     NOT part of this decision's implementation
     (`PRIVATE_BASIC_PRICE_IMPLEMENTATION=NO`) — it is the next roadmap
     slice (§20 of the governing prompt; PRIVATE_BASIC_PRICE_NEXT_ROADMAP_
     SLICE=YES). The AHSP Universal Intake & Curation Law principle above
     remains separately `BELUM_DIRATIFIKASI` — unaffected by this entry.
- AMENDMENT A1 — SECURITY BOUNDARY CONSEQUENCE AND PRECEDENT: every ACTIVE
  membership, including a membership with no role, thereby gains
  `BASIC_PRICE_VIEW/_IMPORT/_RESOLVE/_SUBMIT` — it can view the catalog,
  upload a batch, resolve/read rows in its own batch, and submit its own
  batch into the curation queue. The containing security boundaries are:
  membership must be ACTIVE; workspace isolation; `uploadedByAccountId`
  ownership; internal curation (`REVIEW_VIEW`/`VERIFY`/`PUBLISH`) staying
  outside the baseline. `BASIC_PRICE_RESOLVE` on the baseline means
  resolving the caller's OWN import-row mapping, never verifying or
  curating another user's submission.
  `MEMBERSHIP_DERIVED_CAPABILITY_PRECEDENT=YES`, scoped strictly to these
  four codes — it may not be used to add any other permission to the
  membership baseline without a new, separate Owner decision.
- AMENDMENT A2 — LEGACY TEST CHANGE REGISTER: tests that previously locked
  the incorrect model were updated, never weakened. Full per-test register
  (file/test/old/new/reason) is in
  `docs/implementation-gates/rm02d2a2/CONTRACT-INVENTORY.md`. No negative
  test, cross-workspace isolation assertion, or internal REVIEW/VERIFY/
  PUBLISH denial was removed; `TEST_WEAKENING_COUNT=0`.
- IMPLEMENTED_BY: branch `feat/rm02d2a2-basic-price-review-publication-ui`,
  commits `90732dc21e03042d279d670fdf74ffb0b0d4f002` (Checkpoint 1 —
  authority/ownership foundation) and
  `a95c42fe165ee7b6a366d2398b1c193df0e91a0a` (Checkpoint 2 — product
  experience), base `fb7f89aaa6d2de9418c4839e0d957402db02fc2b`. Not yet
  merged — `MERGE_READY=NO`, `PRODUCTION_ACTIVATION=NO`, Draft PR #56.
- SCHEMA_CHANGE=NO. MIGRATION_CHANGE=NO. PERMISSION_SEED_CHANGE=NO.

## Soli Deo Gloria. Haleluya. Amin.
