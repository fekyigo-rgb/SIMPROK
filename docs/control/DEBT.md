# SIMPROK — DEBT.md

Status: MUTABLE OPERATIONAL REGISTER.

Hukum kejujuran register: dilarang mengarang status, DAN dilarang
menghilangkan entry. Utang yang hanya bersumber verdict/percakapan tetap
dicatat dengan sumbernya dan ditandai `NEEDS_REVIEW` — tidak dibuang demi
register yang terlihat bersih. Debt yang ditutup tidak dihapus; diberi
`CLOSED_BY`, exact SHA, PR, tanggal, dan bukti (ROADMAP.md §16).

## OPEN

### UTANG-PLATFORM-03
- STATUS: OPEN
- CLOSURE_CONDITION: RM-12 (ROADMAP.md §16, §15)
- SOURCE: PR #35 body ("Records UTANG-PLATFORM-03: vertical-local
  temporary intake pending Platform Reality Intake / ADR-002"), merge
  `095002bdebb77a8439015551ec853be5b91d50dc`.

### UTANG-FAKE-ZERO-04
- STATUS: OPEN
- CLOSURE_CONDITION: sebelum baseline/approval final (ROADMAP.md §16)
- SOURCE: PR #35 body — "quantity=0 and unit='' are contained legacy
  storage sentinels for FOLDER/NOTE only, never business facts or
  arithmetic inputs"; PR #35 "Deferred" section states explicitly "the
  schema closure of UTANG-FAKE-ZERO-04 remain out of scope." Merge
  `095002bdebb77a8439015551ec853be5b91d50dc`.

### UTANG-ACCESS-05
- STATUS: OPEN
- CLOSURE_CONDITION: security slice sebelum produksi penuh (ROADMAP.md §16)
- SOURCE: PR #35 body, B-4 section — "UTANG-ACCESS-05 records
  project-existence concealment as a separate future security slice."
  Merge `095002bdebb77a8439015551ec853be5b91d50dc`.

### UTANG-LIFECYCLE-06
- STATUS: OPEN — DILARANG ditandai CLOSED pada slice ini.
- Status implementasi: implemented locally.
- CLOSURE_CONDITION: PR #35 merged (SUDAH, `095002b...`) DAN bukti browser
  negatif PASS (BELUM).
- SOURCE: ROADMAP.md §16; dikonfirmasi oleh PR #35 body:
  `OWNER_BROWSER_PROOF_NEGATIVE: NOT_STARTED`,
  `OWNER_BROWSER_PROOF_COMPLETE: NO`.

### UTANG-PERMISSION-08
- STATUS: STILL_OPEN — production `simprok_db` belum tersentuh; DILARANG
  ditandai CLOSED sampai gate produksi terpisah (RM-01b) benar-benar PASS.
- CLOSURE_CONDITION: RM-01 (ROADMAP.md §16); secara spesifik, `RAB_VIEW`
  dan `RAB_DRAFT_EDIT` benar-benar ter-seed dan digrant di `simprok_db`.
- SOURCE: ROADMAP.md §16. Dikuatkan oleh audit read-only RM-01A (sesi yang
  sama, sebelum slice ini, transaksi `READ ONLY` pada `simprok_db`):
  permission `RAB_VIEW` dan `RAB_DRAFT_EDIT` — dideklarasikan
  `SEEDED_CURRENT` di `backend/src/common/constants/permissions.ts` dan
  dipakai `@Permissions()` pada endpoint BOQ import/draft — berstatus
  ABSENT dari tabel `permissions` di `simprok_db` pada saat audit.
  Tiga permission `AHSP_APPROVE`, `BASIC_PRICE_VIEW`, `BASIC_PRICE_MANAGE`
  sengaja belum diaktifkan pada RM-01 dan tetap bagian utang ini bila
  masih absen.
- RM-01a-CODE (slice ini): menyiapkan jalur aktivasi additive/idempotent
  yang sempit (`backend/src/auth/rm01-permission-activation-planner.ts`,
  PLAN/APPLY, hanya `RAB_VIEW`+`RAB_DRAFT_EDIT`, hanya satu workspace +
  role `DIRECTOR` eksplisit, tidak pernah wildcard). Diuji PLAN dan APPLY
  hanya terhadap `simprok_test` (lihat PR body slice ini untuk hasil).
  Jalur ini TIDAK dijalankan terhadap `simprok_db` pada slice ini —
  `SIMPROK_DB_CONNECTION_COUNT=0`. Keputusan menjalankan APPLY terhadap
  `simprok_db` tetap keputusan Owner/PM terpisah di gate RM-01b.

### UTANG-TSC-10
- STATUS: OPEN — NEEDS_REVIEW (bukti tambahan tidak ditemukan pada slice
  ini di luar ROADMAP.md)
- CLOSURE_CONDITION: maintenance gate sebelum Grade A release (ROADMAP.md §16)
- SOURCE: ROADMAP.md §16. Tidak ada commit/dokumen tambahan bernama utang
  ini yang ditemukan pada pencarian repository sesi ini; satu commit
  `abe350c fix(frontend): clean unused TypeScript symbols` ditemukan tetapi
  tidak terbukti terkait langsung dengan ID ini. Ditandai NEEDS_REVIEW,
  bukan diasumsikan closed.

### UTANG-AUTHZ-11
- STATUS: CODE_READY_AWAITING_EXACT_SHA_REVIEW — bukan CLOSED. Status
  CLOSED tidak boleh ditetapkan hanya berdasarkan laporan executor;
  menunggu ARCHITECT_EXACT_SHA_REVIEW, GEMINI_CONSTITUTION_EXACT_SHA_REVIEW,
  INDEPENDENT_SECURITY_AUDIT (Codex), dan OWNER_BROWSER_PROOF pada exact
  PR_HEAD_SHA slice ini (lihat panel Merah §10.8).
- CLOSURE_CONDITION: RM-01 (ROADMAP.md §16), plus seluruh panel Merah PASS.
- SOURCE (temuan awal): ROADMAP.md §16. Dikuatkan oleh audit read-only
  RM-01A (sesi yang sama, sebelum slice RM-01a-CODE ini):
  `frontend/src/App.tsx` route `project/new` masih memakai `RoleRoute
  allowedRoles={['DIRECTOR','OWNER']}` (role literal), sementara backend
  memakai permission code (`PROJECT_CREATE`, `RAB_VIEW`, `RAB_DRAFT_EDIT`)
  di `project.controller.ts`. Frontend authority != backend authority
  pada jalur yang sama.
- RM-01a-CODE (slice ini) — kode readiness, bukan closure:
  - Backend: resolver kanonikal baru
    `WorkspacePermissionResolverService` (dipakai bersama oleh
    `PermissionsGuard` dan `GET /auth/capabilities`); `POST
    /projects/:projectId/initiate` diubah dari `PROJECT_CREATE` menjadi
    `RAB_DRAFT_EDIT` (endpoint menulis isi Working Draft); `GET
    /projects/:projectId/boq` dan `GET .../boq/draft` diubah dari
    `PROJECT_VIEW` menjadi `RAB_VIEW` — menyamakan matriks otoritas
    dengan §5C.
  - Frontend: `AuthContext` menambah `permissionState`
    (IDLE/LOADING/READY/ERROR) dan `hasPermission(code)` fail-closed;
    `PermissionRoute` baru menggantikan `RoleRoute` HANYA pada
    `/project/new`, `/project/:id/rab`, dan `/project/:id/rab/workspace`
    (permission `PROJECT_CREATE`, `RAB_VIEW`, `RAB_DRAFT_EDIT`); `RoleRoute`
    literal TIDAK dihapus dari rute lain (index Observatory, `/showcase`)
    — di luar scope RM-01.
  - `ObservatoryPage.tsx`'s `canCreateRab` diubah dari role-literal check
    menjadi `hasPermission('PROJECT_CREATE')`.
- CATATAN JUJUR: perbaikan ini menutup KESENJANGAN KODE, bukan
  KESENJANGAN status. Tidak ada klaim CLOSED sampai panel Merah PASS.

### UTANG-E2E-CLEANUP-11
- STATUS: OPEN — NEEDS_REVIEW (remediasi kuat ditemukan, belum ada
  deklarasi closure eksplisit)
- CLOSURE_CONDITION: test-infra stabilization; wajib sebelum Safe E2E
  kembali dipakai sebagai bukti absolut (ROADMAP.md §16)
- SOURCE: ROADMAP.md §16. PR #16 "fix(test-infra): close e2e residual
  leaks" MERGED 2026-07-13T09:10:35Z, merge commit
  `4961fea9ccd2a0131c561f42b21cd58178ef65f7` (commits `fbfd302`
  "enforce clean deterministic e2e lifecycle", `bee3ae5` "close e2e
  residual leaks"). Safe E2E kemudian dipakai sebagai bukti pada PR #35
  (21 suites/205 tests PASS) dan PR #37 (22 suites/237 tests PASS,
  "Residual fingerprint: 63 tables, PASS"), menunjukkan test-infra
  berfungsi dan dipercaya sebagai bukti — namun tidak ada dokumen yang
  secara eksplisit menyatakan `UTANG-E2E-CLEANUP-11 CLOSED`. Dicatat
  OPEN dengan bukti kuat, bukan ditutup sepihak oleh executor ini.

### UTANG-PROOF-12
- STATUS: OPEN
- CLOSURE_CONDITION: bukti browser negatif ACC-X (belum dilakukan)
- SOURCE: instruksi eksplisit prompt RM-00/PR #36; konsisten dengan
  ROADMAP.md §19 butir 6 ("Owner menguji ACC-X negative lifecycle") yang
  belum tercatat selesai di PR manapun yang diperiksa sesi ini.

### UTANG-READONLY-ACCT
- STATUS: OPEN — NEEDS_REVIEW
- CLOSURE_CONDITION: belum ditetapkan; menunggu keputusan Owner/Arsitek
  soal akun read-only sejati untuk audit `simprok_db`.
- SOURCE: verdict Arsitek RM-01A — audit `simprok_db` dijalankan sebagai
  superuser `postgres`; akun read-only sejati belum ada. Dikuatkan
  langsung oleh audit read-only RM-01A pada sesi yang sama (sebelum slice
  ini): query `SELECT current_database(), current_user` dalam transaksi
  `READ ONLY` mengembalikan `current_user=postgres`. Catatan: PR #37 body
  mencatat hal terpisah namun terkait — CI workflow `simprok_test`
  memakai service PostgreSQL disposable dengan user bernama `postgres`
  juga; kedua fakta ini tidak digabung sebagai satu klaim tunggal di sini.

### OD-04 DECIMAL PRECISION
- STATUS: OPEN
- CLOSURE_CONDITION: RM-02; entry blocker RM-04 (ROADMAP.md §16, §6)
- SOURCE: ROADMAP.md §16, §6. Lihat juga `docs/control/DECISIONS.md`.

### IMPORT RETRY / IDEMPOTENCY GAP (retry-after-lost-response, PR #35)
- STATUS: KNOWN_GAP (bukan bug tersembunyi — diterima sadar untuk
  IMPORT-FIRST-01)
- CLOSURE_CONDITION: RM-12 — replay idempoten penuh menunggu persistence
  fingerprint/history (ROADMAP.md §16, "IMPORT RETRY / IDEMPOTENCY GAP,
  Closure = RM-12")
- SOURCE: PR #35 body, "Known gap" — "If the backend successfully commits
  but the response is lost due to a network interruption, an approve
  retry against the now-populated Working Draft receives 409
  WORKING_DRAFT_NOT_EMPTY. This is fail-safe and accepted for
  IMPORT-FIRST-01." Merge `095002bdebb77a8439015551ec853be5b91d50dc`.
  ID sesi ini tidak diciptakan baru; disamakan dengan entry ROADMAP.md
  "IMPORT RETRY / IDEMPOTENCY GAP" karena menjelaskan gap teknis yang
  sama.

## CLOSED (tidak dihapus dari histori)

### UTANG-AUTOBASELINE-13
- STATUS: CLOSED_BY_PR_37
- CLOSED_BY: PR #37, commit `e6165a587dc6a514dd596f939073b2a6ccb4d28b`
  (parent langsung dari merge commit `478ce4f76960e4e557d7f32a15b20df3c7639905`)
- TANGGAL: 2026-07-21T07:09:21Z (mergedAt PR #37)
- BUKTI: diff `e6165a5` menghapus seluruh write auto-approval di
  `initiateSetup()` — pembuatan `RabDocument` status `APPROVED`,
  `ProjectBaseline` status `ACTIVE`, `ProgressReport`, dan perubahan
  `Project.status` ke `ACTIVE` — seluruhnya dihapus. Kode saat ini
  (`478ce4f`, diverifikasi ulang via `git show HEAD:backend/src/project/project.service.ts`)
  mengunci baris Project (`FOR UPDATE`), mencari BoqStructure `status:
  'DRAFT'` tanpa bergantung nama, menolak dengan `MULTIPLE_DRAFT_BOQ_STRUCTURES`
  bila lebih dari satu, dan menggunakan kembali draft tunggal yang ada
  alih-alih selalu membuat structure baru. PR #37 body mengonfirmasi
  eksplisit: "UTANG-AUTOBASELINE-13 is addressed in this revision: setup
  prepares or reuses DRAFT state only."
- CATATAN SILANG: temuan audit RM-01A (sesi yang sama, sebelum slice ini)
  yang membaca kode pada `main` SEBELUM PR #37 merge (saat `main` masih
  di `095002b...`) melaporkan risiko tabrakan second-structure pada
  `initiateSetup()`. Temuan itu benar untuk SHA saat itu; PR #37
  (`478ce4f...`, setelah RM-01A) memperbaikinya. Dicatat di sini agar
  tidak ada kesan kontradiksi antar audit — keduanya benar untuk exact
  SHA masing-masing.
- REMAINS_CLOSED_BY_PR_37 (RM-01a-CODE non-regression proof): slice ini
  mengubah `project.service.ts` untuk null-integrity (`saveDraftBoq`),
  tetapi hunk `initiateSetup()` dibiarkan identik dengan baseline —
  dibuktikan lewat `git diff` yang menunjukkan nol perubahan pada method
  tersebut. Test `initiateSetup` (idempotency, collision guard) tetap PASS
  tanpa modifikasi ekspektasi lifecycle.

### UTANG-ORDER-09
- STATUS: CLOSED
- CLOSURE_EVIDENCE: pre-Multer lifecycle guard (ROADMAP.md §16)
- SOURCE: ROADMAP.md §16 — "Status = CLOSED, Closure evidence =
  pre-Multer lifecycle guard, Dipindahkan ke Closed Debt Register, Tidak
  boleh dihapus dari histori." Dicatat di sini sesuai sumber; tidak ada
  SHA/PR tambahan ditemukan pada pencarian sesi ini di luar ROADMAP.md
  itu sendiri — NEEDS_REVIEW untuk exact SHA penutupnya bila dibutuhkan
  audit lebih dalam.

## Soli Deo Gloria. Haleluya. Amin.
