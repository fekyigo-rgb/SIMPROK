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
- STATUS: OPEN (belum Owner-Locked)
- SOURCE: `docs/control/ROADMAP.md` §16 ("OD-04 DECIMAL PRECISION, Closure
  = RM-02, Entry blocker RM-04") dan §6 RM-02 ("OD-04 PRECISION POLICY
  wajib Owner-Locked sebelum RM-02 selesai").
- CLOSURE_CONDITION: dikunci Owner sebelum RM-02 (Import Basic Price)
  dinyatakan selesai; menjadi entry blocker untuk RM-04.

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

## Soli Deo Gloria. Haleluya. Amin.
