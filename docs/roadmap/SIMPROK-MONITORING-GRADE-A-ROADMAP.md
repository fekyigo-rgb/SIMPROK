# SIMPROK MONITORING — GRADE A ROADMAP

**Document ID:** SIMPROK-MONITORING-GRADE-A-ROADMAP  
**Version:** 1.0  
**Status:** OWNER PASS / LOCKED / CANONICAL ROADMAP  
**Lock Date:** 2026-08-07  
**Repository:** fekyigo-rgb/SIMPROK  
**Canonical Path:** `docs/roadmap/SIMPROK-MONITORING-GRADE-A-ROADMAP.md`  
**Change Rule:** LOCKED means LOCKED. Do not silently rewrite Product Law or this roadmap. Any future roadmap change requires a numbered, documented Owner Amendment. Repository reality may trigger STOP/review, never silent reinterpretation.

---

## 0. Owner Lock Declaration

Roadmap ini telah mendapat **Owner PASS** dan dikunci sebagai **roadmap kanonik eksekusi SIMPROK Monitoring Grade A**.

Roadmap ini:
- menjadi urutan kerja resmi Monitoring dari BUILD-00 menuju MON-15;
- tunduk pada Owner-locked SIMPROK Constitution/Foundation dan Locked Monitoring Product Law v1.1;
- tidak memberi executor kewenangan untuk mengubah prioritas, Product Law, authority, atau boundary secara independen;
- tidak boleh dibongkar, ditulis ulang, atau diganti karena preferensi implementasi;
- hanya dapat diubah melalui **Owner Amendment bernomor dan terdokumentasi**;
- wajib dibaca bersama reality repository: bila implementation reality bertentangan dengan roadmap/hukum yang lebih tinggi, executor **STOP dan melapor**, bukan menambal atau mengubah roadmap diam-diam.

---

## 1. North Star

SIMPROK Monitoring harus menjadi ruang yang membantu manusia melihat realitas proyek dengan jelas, cepat, dan dapat dipercaya.

Target Grade A:

- **super berkualitas dan bermutu** — benar secara domain, data, governance, security, UX, dan runtime;
- **super ringan dan enteng** — cepat dibuka, sedikit beban visual, sedikit dependency tambahan, efisien di laptop biasa;
- **super smart** — sistem menghitung deviasi, forecast, exception, dan insight tanpa mengambil alih keputusan manusia;
- **mudah dipahami** — pengguna memahami keadaan proyek dalam beberapa detik, lalu dapat membuka detail secara progresif;
- **meyakinkan** — setiap angka punya sumber, versi, cut-off, status, authority, dan jejak bukti;
- **adaptif** — mendukung proyek sederhana hingga kompleks tanpa memaksa satu workflow universal;
- **handal, kuat, kokoh** — tenant-safe, failure-safe, idempotent, auditable, reproducible;
- **membantu manusia menemukan kepastian** — mengurangi ketidakpastian, membedakan fakta, rencana, forecast, simulasi, dan recovery secara tegas.

Prinsip inti:

> **Monitoring reads, records, compares, forecasts, and explains project reality. Monitoring never silently changes the approved plan.**

---

## 2. Non-Negotiable Product Laws

Roadmap ini tunduk pada Product Law Monitoring v1.1 dan Konstitusi SIMPROK.

### 2.1 Lima lapisan kebenaran harus terpisah

1. **Baseline** — rencana resmi / pembanding yang approved/effective.
2. **Actual** — kenyataan lapangan yang attributable dan terverifikasi.
3. **Forecast** — proyeksi, bukan plan.
4. **Simulation** — skenario hipotetis, bukan authority.
5. **Recovery** — domain terpisah untuk corrective planning, review, approval, tracking, dan closure.

Tidak ada layer yang boleh overwrite Baseline.

### 2.2 Larangan mutlak

- Tidak ada automatic schedule shift.
- Tidak ada planned-weight redistribution untuk menyembunyikan deviasi.
- Tidak ada overwrite/delete terhadap approved/effective/superseded baseline.
- Tidak ada forecast yang diberi label planned.
- Tidak ada Simulation Draft yang diperlakukan sebagai instruksi kontraktual.
- Tidak ada Recovery approval otomatis.
- Tidak ada cross-project / cross-tenant leakage.
- Tidak ada fake data untuk menutup gap.
- `UNAVAILABLE`, `NOT_YET_RECORDED`, dan `0` harus berbeda.
- Monitoring bukan RAB kedua dan tidak menampilkan detail harga pada ruang utama Monitoring.

### 2.3 Human authority

SIMPROK menghitung, membandingkan, mendeteksi, menjelaskan, dan merekomendasikan. Manusia tetap memutuskan tindakan formal, perubahan baseline, approval Recovery, dan official publication.

---

## 3. Definition of Grade A

Sebuah slice hanya boleh disebut **Grade A** bila seluruh kategori berikut terbukti.

| Kategori | Grade A berarti |
|---|---|
| Correctness | output domain benar terhadap Product Law dan source data |
| Runtime | build, test, integration/E2E, dan browser proof lulus sesuai scope |
| Security | tenant/project isolation, permission, zero unauthorized mutation |
| Integrity | baseline protected, audit traceable, no silent overwrite |
| Performance | ringan pada representative dataset; tidak ada bottleneck besar yang dibiarkan tanpa bukti |
| UX | cepat dipahami, progressive disclosure, accessible, responsive |
| Smartness | insight berbasis data/sumber; tidak mengarang certainty |
| Reliability | idempotency, concurrency, retry/failure behavior terbukti |
| Maintainability | minimum delta, reuse existing healthy assets, readable/testable code |
| Traceability | Product Law → design/contract → code → test → browser/UAT evidence |
| Reproducibility | hasil dapat diulang dari commit dan environment yang ditentukan |

**No Completion Without Evidence.**

---

## 4. Working Method — Wajib untuk setiap Slice

Setiap slice menjalankan urutan berikut:

1. **Reality Audit — read only**  
   Audit repo, schema, routes, services, components, tests, existing healthy assets, duplication, and gaps.
2. **Minimum Delta Contract**  
   Tetapkan apa yang benar-benar perlu berubah dan apa yang tidak boleh disentuh.
3. **Architecture / Contract Gate**  
   Hanya artefak yang relevan untuk slice yang harus ditutup; jangan membuat dokumen besar yang tidak perlu.
4. **Implementation**  
   Reuse first. No rebuild of healthy capabilities.
5. **Verification**  
   Build + focused tests + regression sesuai risiko.
6. **Runtime / Browser Proof**  
   Buktikan perilaku nyata, bukan hanya compile.
7. **Negative Proof**  
   Buktikan hal yang dilarang benar-benar gagal/ditolak.
8. **SCM Closeout**  
   Clean diff, focused commit, traceable PR/evidence.
9. **Owner Review**  
   Owner menilai hasil produk, bukan hanya laporan teknis.

STOP jika reality repository bertentangan dengan asumsi desain.

---

## 5. Roadmap Stages

Roadmap mengikuti vertical slices, bukan proyek besar sekaligus.

### BUILD-00 — BASELINE HEALTH VERIFICATION

**Status saat ini:** accepted PASS-WITH-LIMITATION pada mesin tanpa E2E database.

Tujuan:
- memastikan repository sehat sebelum pembangunan Monitoring;
- backend build PASS;
- frontend build PASS;
- available unit tests PASS;
- working tree clean;
- no source mutation bila tidak diperlukan.

Catatan:
- E2E yang membutuhkan dedicated PostgreSQL environment tetap menjadi limitation sampai environment siap.
- Jangan ulang BUILD-00 tanpa bukti perubahan baseline repository atau kebutuhan gate baru.

**Exit:** repository baseline terbukti sehat untuk memulai Monitoring.

---

### MON-01 — REALITY MAP & IMPLEMENTATION GATE

**Tujuan:** tahu persis apa yang sudah ada sebelum coding Monitoring.

Audit read-only minimum:
- existing Project / WBS / RAB / progress models;
- project lifecycle dan assignments;
- existing field progress write/read path;
- schedule/planned data yang benar-benar tersedia;
- source of planned weight;
- frontend Monitoring routes/components/placeholders;
- permissions/guards yang sudah ada;
- existing audit mechanism;
- e2e harness dan `.env.e2e` requirements;
- dataset fixture/seed yang dapat dipakai.

Classify setiap asset:
- `HEALTHY_REUSE`
- `PRESENT_NEEDS_INTEGRATION`
- `GAP_PROVEN`
- `CONFLICT_WITH_PRODUCT_LAW`
- `DEFER`

Artefak wajib yang ditutup **hanya sejauh first slice membutuhkan**:
- Authority/Permission Matrix minimum;
- Data Model + state invariant minimum;
- API contract minimum;
- Audit contract minimum;
- Prototype/UAT criteria minimum.

**Hard gate:** tidak ada production mutation path sebelum gap dan contract dibuktikan.

**Exit:** satu peta reality + satu minimal-delta plan yang dapat dieksekusi.

---

### MON-02 — READ-ONLY TRUTH SURFACE

**Tujuan:** Monitoring pertama harus berguna bahkan sebelum semua write capability hadir.

Scope:
- authorized project selection;
- project Monitoring shell;
- Effective Baseline identity/version/cut-off terlihat;
- hierarchical WBS/activity list;
- planned start/finish/duration/volume/weight yang memang tersedia;
- Actual yang sudah ada dibaca terpisah;
- contextual drawer untuk selected node;
- explicit data states: `UNAVAILABLE`, `NOT_YET_RECORDED`, `0`;
- no price detail in main Monitoring room.

UX law:
- Summary | S-Curve | Schedule | Network | Attention sebagai lensa; tidak semua harus hidup di slice ini;
- main surface tetap ringan;
- detail dibuka lewat contextual drawer;
- status tidak disampaikan dengan warna saja;
- no permanent button overload per row.

Negative proof:
- Monitoring read path tidak dapat mengubah Baseline;
- user di luar project scope tidak dapat melihat data.

**Exit:** user bisa membuka satu proyek dan memahami plan-vs-reality tanpa kebingungan dan tanpa mutation risk.

---

### MON-03 — ACTUAL PROGRESS + EVIDENCE + AUDIT

**Tujuan:** satu real field fact masuk secara aman dan traceable.

Scope:
- submit one Actual Progress record;
- project/workspace authorization;
- attributable actor, server time, cut-off, source/capture method;
- evidence metadata reference;
- verification state sesuai existing governance;
- correction through new linked correction/superseding record, not silent overwrite;
- append-only audit semantics;
- summary and partial view update from same governed facts.

Mandatory negative tests:
- unauthorized write = zero domain mutation;
- cross-project write denied;
- invalid progress input = zero partial mutation;
- correction does not delete history.

**Exit:** satu actual field fact dapat direkam, diverifikasi, ditelusuri, dikoreksi secara non-destruktif, dan terlihat di UI.

---

### MON-04 — DEVIATION ENGINE + S-CURVE BASIC

**Tujuan:** SIMPROK mulai menjadi alat kejelasan, bukan sekadar display.

Scope:
- planned vs actual volume deviation;
- period and cumulative progress/weight deviation;
- planned curve immutable;
- actual curve until cut-off;
- no missed planned weight roll-forward;
- data-quality warnings;
- global and selected-WBS partial curve where meaningful.

Product invariant:
- keterlambatan tidak pernah mengubah planned series.

Performance target:
- calculate once, reuse normalized results;
- avoid recomputing full project tree on every row render;
- pagination/virtualization/aggregation only when representative dataset proves need.

**Exit:** deviasi terlihat jelas dan planned history tidak pernah dimanipulasi agar tampak lebih baik.

---

### MON-05 — FORECAST SNAPSHOT v1

**Tujuan:** memberi terang ke depan tanpa mencampur proyeksi dengan ketetapan.

Scope:
- versioned Forecast Run/Snapshot;
- source Baseline version;
- source Actual snapshot/cut-off;
- method version;
- explicit assumptions;
- data-quality/reliability indicator;
- generated-at / generated-by;
- forecast finish by selected scope where source data supports it;
- `UNAVAILABLE` bila source critical tidak cukup.

Before coding:
- Forecast Method artefact harus disetujui untuk method v1.

Negative proof:
- forecast recalculation mutates forecast only;
- forecast cannot write planned fields;
- system never fabricates finish date when data is insufficient.

**Exit:** forecast reproducible dan visibly distinct from Baseline.

---

### MON-06 — EXCEPTION & ATTENTION ENGINE

**Tujuan:** Monitoring menemukan kondisi yang perlu perhatian tanpa mengambil keputusan manusia.

Initial exception examples:
- planned start passed, Actual Start absent;
- planned finish passed, work incomplete;
- planned duration elapsed, work incomplete;
- period volume/weight missed;
- forecast threatens milestone/finish;
- dependency threat where source logic exists.

Every exception must carry:
- source Baseline/version;
- Actual cut-off/snapshot;
- affected scope;
- remaining work;
- deviation;
- evidence/constraints when available;
- source version for dedupe;
- severity/status based on approved rules.

Attention UI:
- text + icon + color;
- show reason, evidence, and next legitimate door;
- never produce panic labels unsupported by data.

**Exit:** user can see what needs attention and why.

---

### MON-07 — MONITORING → RECOVERY IDEMPOTENT HANDOFF

**Tujuan:** dari fakta dan exception ke ruang tindakan resmi, tanpa duplikasi.

Scope:
- `Open or View Recovery` door;
- stable source identity/idempotency key;
- repeated equivalent request returns/reuses same Recovery Case;
- materially changed source condition gets controlled new source version/identity;
- handoff + relation + audit/outbox/event are transactionally safe according to actual architecture;
- Recovery remains separate menu/domain.

Mandatory proof:
- double-click/retry/browser retry/network retry does not create duplicate case;
- unauthorized handoff = zero mutation;
- Monitoring cannot approve Recovery.

**Exit:** exception can become one governed Recovery Case safely.

---

### MON-08 — SIMULATION DRAFT v1

**Tujuan:** membantu manusia menyiapkan alternatif tanpa menciptakan authority palsu.

Scope:
- versioned Simulation Draft;
- source Recovery Case;
- source Baseline + Actual + Forecast as applicable;
- assumptions;
- proposed resource/method/sequence/shift/logistics changes;
- safety/SMKK prerequisites visible;
- predicted impact;
- mandatory disclaimer in UI and export preview.

Mandatory disclaimer:

> SIMULATION — NOT APPROVED  
> This scenario does not change the official Baseline.  
> This scenario is not a contractual instruction.  
> This scenario does not approve time or cost.

**Exit:** alternatives can be compared without changing official plan.

---

### MON-09 — RECOVERY REVIEW / APPROVAL / TRACKING

**Tujuan:** manusia memilih corrective strategy melalui authority yang benar.

Scope:
- under-review/revision/reject/approve lifecycle;
- mandatory approvers resolved from project profile/Authority Matrix;
- actor authority snapshot;
- separation of duties for high-impact decisions;
- approved Recovery Target visible separately from Baseline and Forecast;
- implementation tracking without rewriting baseline.

Hard law:
- Approved Recovery Plan **does not automatically revise Baseline**.

**Exit:** Recovery decision traceable, governed, human-authorized.

---

### MON-10 — FORMAL CHANGE & BASELINE REVISION

**Tujuan:** jika rencana resmi memang harus berubah, perubahan terjadi secara formal dan non-destructive.

Before implementation:
- project-specific authority/legal/contract mapping sufficient for target profile.

Scope:
- authorized formal change document link;
- new Baseline Version from prior version;
- previous Baseline becomes `SUPERSEDED`, never deleted;
- effective dates/version lineage;
- historical reports continue resolving the governing baseline for their period;
- persistence-level immutability test.

Mandatory proof:
- direct update/delete of APPROVED/EFFECTIVE/SUPERSEDED protected planned fields is rejected;
- new version only via authorized path.

**Exit:** revised baseline is legally/governance-separated from Monitoring analysis and Recovery approval.

---

### MON-11 — REPORTS v1 + TEMPLATE VERSIONING

**Tujuan:** laporan memakai fakta yang sama, bukan entry angka kedua yang bisa bertentangan.

Scope:
- daily report facts;
- weekly aggregation from governed daily facts;
- monthly aggregation from governed facts;
- report template code/version/applicability;
- period/cut-off/source provenance;
- project-profile-aware review/signature workflow;
- no universal hardcoded government form.

Start with one representative real template; prove pattern before generalizing.

**Exit:** daily → weekly → monthly chain dapat direproduksi tanpa duplicate source of truth.

---

### MON-12 — SMKK CORE INTEGRATION

**Tujuan:** safety menjadi governed supporting domain, bukan dekorasi.

Scope minimum:
- inspection/observation/finding;
- risk/unsafe condition where applicable;
- corrective action;
- responsible person/due date;
- evidence;
- verification/closure;
- affected Monitoring activities linked without mixing write models;
- Recovery/Simulation surfaces unresolved safety prerequisites.

**Exit:** safety-related uncertainty is visible and traceable in Monitoring/Recovery decisions.

---

### MON-13 — EXPORT / PRINT / VERIFICATION

**Tujuan:** dokumen Monitoring dapat dipercaya dan tidak tertukar antara draft dan official.

Document states:
- DRAFT
- FOR_REVIEW
- OFFICIAL
- SUPERSEDED
- VOID

Scope:
- frozen source snapshot;
- document ID/version;
- baseline version;
- actual cut-off;
- generated-at/generated-by;
- approval workflow for OFFICIAL;
- final persisted file hash (minimum SHA-256 equivalent policy);
- verification manifest;
- QR/verification route;
- superseded/void remains verifiable;
- Simulation Draft watermark on all pages.

Negative proof:
- PDF generation alone cannot make a document OFFICIAL;
- modified bytes must fail hash verification;
- unauthorized actor cannot issue official export.

**Exit:** recipient can verify what the document is, from which snapshot, by whom, when, and whether bytes/status are still valid.

---

### MON-14 — PERFORMANCE, ACCESSIBILITY, SECURITY HARDENING

**Tujuan:** Grade A tidak hanya benar, tetapi ringan, nyaman, dan kuat.

Performance:
- representative large WBS dataset;
- long Actual history;
- many evidence references;
- S-Curve and hierarchy response budget;
- avoid large synchronous recomputation in render path;
- code splitting/lazy load only where measured benefit exists;
- do not add infrastructure without measured need.

Accessibility:
- keyboard navigation;
- focus visible;
- icon/text alongside color;
- contrast target WCAG AA for ordinary text;
- responsive desktop/tablet/mobile;
- print/PDF readability.

Security:
- IDOR/project isolation;
- permission/authority bypass;
- evidence access control;
- audit tamper protection;
- secrets absent from logs;
- malicious/oversized evidence handling according to upload contract;
- concurrency and retry safety.

**Exit:** performance/security/accessibility budgets pass on agreed representative environment.

---

### MON-15 — PILOT UAT & GRADE A CLOSEOUT

**Tujuan:** membuktikan Monitoring benar-benar membantu manusia.

Representative UAT actors:
- Project Manager / project authority;
- owner representative / PPK where applicable;
- contractor field/site user;
- supervising/verifier user;
- planner/project-controls user;
- SMKK/safety user;
- document controller;
- auditor/read-only user;
- administrator without automatic project approval authority.

UAT must prove users can distinguish:
- Baseline;
- Actual;
- Forecast;
- Simulation;
- Recovery Target;
- Revised Baseline.

Critical demonstrations:
- late Actual leaves Planned unchanged;
- missed planned weight is not moved forward;
- `UNAVAILABLE` is not zero;
- forecast is understood as projection;
- repeated Recovery handoff returns one case;
- rejected Recovery causes zero unauthorized/official mutation;
- approved Recovery remains separate from Baseline;
- formal baseline revision creates a new version;
- official export verifies hash and status;
- cross-project access fails;
- audit reconstructs who did what, when, under which authority and source versions.

**Grade A Closeout:** no unresolved Critical defect; no unresolved baseline-mutation defect; no authorization bypass; no duplicate-handoff defect; no official-export integrity defect; documented disposition of High defects; clean repository; reproducible gates; Owner acceptance.

---

## 6. Cross-Cutting Grade A Quality Gates

Every implementation PR affecting Monitoring should run the applicable subset of:

### Gate A — SCM
- correct branch/base;
- clean start;
- focused diff;
- no generated garbage/secrets;
- no unrelated refactor.

### Gate B — Build
- backend build PASS;
- frontend build PASS.

### Gate C — Tests
- focused unit tests;
- affected integration tests;
- E2E for the slice when environment exists;
- negative/zero-mutation tests;
- regression tests for touched foundation.

### Gate D — Runtime
- browser proof for user-visible behavior;
- API/runtime proof for write/state transitions;
- persistence proof for immutability/idempotency where applicable.

### Gate E — Security
- tenant/project scope;
- permission/authority;
- denied write = zero mutation;
- secrets/log hygiene.

### Gate F — UX
- clear labels;
- progressive disclosure;
- loading/empty/error/forbidden/conflict states;
- mobile/tablet/desktop as slice requires;
- no color-only meaning.

### Gate G — Performance
- measure before optimize;
- representative dataset;
- budget defined per critical interaction;
- no new heavy service/dependency without evidence.

### Gate H — Auditability
- provenance/source/version/cut-off;
- actor/authority snapshot where decision exists;
- correlation/traceability;
- no silent history deletion.

---

## 7. Metrics for “Super Ringan, Super Smart, Super Membantu”

Exact numeric budgets must be set using repository/runtime measurement, not guessed in this roadmap. The following metrics are mandatory categories.

### 7.1 Lightweight / Performance
- Monitoring initial route JS payload;
- time-to-first-usable Monitoring surface;
- hierarchy response latency;
- contextual drawer latency;
- S-Curve calculation/render latency;
- memory behavior on representative WBS;
- export generation duration;
- database query count/shape for main view.

### 7.2 Smartness
- percentage of displayed insights with explicit source/cut-off;
- forecast reproducibility rate;
- false or unsupported exception rate;
- number of user actions required to understand root cause;
- percentage of missing-data cases shown honestly instead of guessed.

### 7.3 Human Clarity
- UAT users correctly distinguish Baseline vs Actual vs Forecast vs Recovery;
- time required to identify top project exception;
- user can explain “why this is red/attention” from evidence shown;
- no critical task depends on hidden technical knowledge.

### 7.4 Reliability
- duplicate Recovery Case rate under retries = 0;
- unauthorized mutation rate = 0;
- protected Baseline update success rate = 0;
- unreconciled partial transaction rate = 0;
- traceable official export rate = 100% for official documents.

---

## 8. Risk Register

| Risk | Impact | Mandatory mitigation |
|---|---|---|
| Build from memory instead of repo | duplicate/rebuild | reality audit first |
| Baseline mutable through alternate path | destroys credibility | persistence protection + negative test |
| Missing weight shown as zero | false S-Curve | explicit availability state |
| Forecast treated as promise | wrong decision | visual/semantic separation + method/source |
| Recovery handoff duplicates | fragmented governance | stable idempotency + unique persistence |
| Too many buttons/charts | heavy/confusing UI | progressive disclosure |
| Overengineering for future scale | heavy laptop footprint | measured need before infra |
| Universal government workflow | wrong authority | project profile + authority matrix |
| Reports retype numeric facts | conflicting truth | governed shared facts + template views |
| AI invents certainty | unsafe recommendation | source/confidence/missing-data behavior |
| Broad refactor during Monitoring | regression | minimum delta + scoped PR |
| Security checked only in UI | bypass | DB/query-level scope and negative tests |

---

## 9. Dependency Graph

```text
BUILD-00 Baseline Health
        ↓
MON-01 Reality Map + Minimum Contracts
        ↓
MON-02 Read-Only Truth Surface
        ↓
MON-03 Actual + Evidence + Audit
        ↓
MON-04 Deviation + Basic S-Curve
        ↓
MON-05 Forecast v1
        ↓
MON-06 Exception / Attention
        ↓
MON-07 Idempotent Recovery Handoff
        ↓
MON-08 Simulation Draft
        ↓
MON-09 Recovery Governance
        ↓
MON-10 Formal Change / Revised Baseline
        ↓
MON-11 Reports     MON-12 SMKK
        \           /
         \         /
          MON-13 Export / Verification
                  ↓
          MON-14 Hardening
                  ↓
          MON-15 Pilot UAT / Grade A Closeout
```

Parallel work is allowed only when files/contracts are non-conflicting and the shared foundation is already stable.

---

## 10. Executor Law

Every executor must begin by reading this file and the locked Monitoring Product Law before modifying Monitoring.

Executor must not decide roadmap priority independently.

For each task, executor reports:

1. repo/branch/HEAD reality;
2. existing assets reused;
3. proven gap;
4. exact files changed;
5. commands and results;
6. browser/runtime proof where applicable;
7. negative proof;
8. final git status/diff;
9. STOP/deviation if any.

A correct STOP is a valid successful outcome.

---

## 11. Source Hierarchy

When documents disagree, use this hierarchy:

1. Owner-locked SIMPROK Constitution / Foundation laws.
2. Locked Monitoring Product Law v1.1.
3. Approved Monitoring architecture/contracts/ADRs for the affected slice.
4. This roadmap.
5. Current task prompt.
6. Executor implementation choice.

Repository reality can reveal a gap or conflict, but an executor must STOP rather than silently rewrite higher-level law.

---

## 12. Current Position

**Completed:** BUILD-00 baseline health verification, PASS-WITH-LIMITATION due E2E environment not available on that machine.  
**Next authorized planning target:** MON-01 Reality Map & Implementation Gate.  
**Next coding target:** not assumed until MON-01 proves repository reality and minimum slice contracts.

---

## 13. Source Documents Used

This roadmap consolidates and operationalizes the existing Monitoring direction from:

- `SIMPROK Monitoring Product Law v1.1 — Final Research and Lock Package.docx`
- `SIMPROK Monitoring — Halaman 2 and Supporting Pages Product Law.docx`
- `Product Law Terkunci, Arsitektur Visual, dan Rencana Implementasi SIMPROK Monitoring Halaman Dua.docx`
- SIMPROK Phase-2 Platform Constitution / Implementation Constitution

It does not replace those laws.

---

**Soli Deo Gloria.**
