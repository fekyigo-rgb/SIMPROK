# SIMPROK MONITORING — OWNER AMENDMENT 002
## INTEGRITY INTELLIGENCE — INPUT TRUST, PROVENANCE, EVIDENCE & TRUTH ELIGIBILITY

**Document ID:** SIMPROK-MONITORING-OWNER-AMENDMENT-002  
**Status:** OWNER PASS / LOCKED / CANONICAL UPON MAIN MERGE  
**Owner:** Feky de Fretes  
**PM / Gatekeeper:** ChatGPT  
**Date:** 2026-08-22  
**Repository:** fekyigo-rgb/SIMPROK  
**Canonical Path:** `docs/roadmap/SIMPROK-MONITORING-OWNER-AMENDMENT-002-INTEGRITY-INTELLIGENCE.md`  
**Applies to:** Monitoring, Actual Progress, evidence intake, visual evidence, future camera/drone/satellite/sensor channels, machine interpretation, downstream analytics, and every SIMPROK feature that consumes external or human-originated facts.  
**Does NOT reopen:** H2-A0, H2-A1, Halaman 1, Owner Amendment 001, Baseline law, RAB law, authority/RBAC foundation, or any previously locked healthy foundation.

---

## 0. OWNER LOCK DECLARATION

SIMPROK **bukan kotak penerima data pasif**.

SIMPROK wajib memiliki **Integrity Intelligence**: kemampuan untuk menerima masukan tanpa menelan masukan mentah sebagai kebenaran otomatis.

Hukum ini mengunci prinsip:

> **INPUT ≠ TRUTH.**

Setiap input dapat menjadi:

- fakta yang sah;
- klaim yang belum terbukti;
- evidence yang relevan;
- evidence yang lemah/tidak lengkap;
- data duplikat;
- data salah konteks;
- data kontradiktif;
- data yang tidak dapat diverifikasi;
- data terindikasi tidak valid/manipulatif;
- data yang harus diisolasi atau ditolak oleh kebijakan.

Tidak boleh ada AI, executor, service, UI, atau ingestion channel yang mengubah hukum ini secara diam-diam.

Perubahan terhadap Amendment ini hanya boleh melalui Owner Amendment bernomor berikutnya atau perintah Owner eksplisit.

---

## 1. NORTH STAR — INTEGRITY BEFORE INTELLIGENCE

SIMPROK harus menjadi sistem yang:

1. menerima informasi;
2. mengenali asal dan konteksnya;
3. memeriksa kewenangan dan scope;
4. memeriksa struktur, format, domain, dan konsistensi;
5. memeriksa provenance dan hubungan evidence;
6. membandingkan dengan fakta lain yang relevan bila tersedia;
7. mendeteksi duplikasi, konflik, anomali, atau ketidakmasukakalan;
8. memberi trust/eligibility state yang jujur;
9. hanya memakai data sesuai tingkat kepercayaannya;
10. mempertahankan jejak asli dan keputusan manusia/mesin yang terjadi setelahnya.

Ringkas:

> **RECEIVE → IDENTIFY → VALIDATE → CROSS-CHECK → CLASSIFY TRUST → GOVERN → USE.**

---

## 2. INPUT, EVIDENCE, INTERPRETATION, TRUTH — WAJIB TERPISAH

SIMPROK wajib membedakan sekurang-kurangnya empat konsep:

### 2.1 Input
Apa pun yang masuk ke SIMPROK dari manusia, file, API, sensor, kamera, drone, satelit, perangkat lain, atau machine process.

### 2.2 Evidence
Bukti/referensi yang mendukung suatu klaim atau fakta dan memiliki konteks/provenance yang dapat ditelusuri.

### 2.3 Interpretation
Hasil pembacaan/analisis oleh manusia atau mesin terhadap input/evidence.

### 2.4 Governed Truth
Fakta yang sudah memenuhi hukum domain, scope, authority, provenance, lifecycle, dan trust eligibility yang diperlukan untuk dipakai oleh capability tertentu.

**Input tidak otomatis menjadi Governed Truth.**

**Interpretation tidak otomatis menjadi Governed Truth.**

**Machine confidence tidak sama dengan human/legal/contractual approval.**

---

## 3. ASLI / PALSU — HUKUM KEJUJURAN

SIMPROK harus mampu mendeteksi indikasi bahwa data/evidence mungkin:

- asli dan konsisten;
- tidak terbukti;
- tidak relevan;
- rusak/berkualitas buruk;
- salah konteks;
- duplikat;
- bertentangan dengan fakta lain;
- termanipulasi;
- atau tidak memenuhi kebijakan.

Tetapi SIMPROK **dilarang menyatakan “PALSU” sebagai kepastian** bila bukti belum cukup.

State yang benar harus mencerminkan tingkat pembuktian, misalnya secara konseptual:

- `VERIFIED` / terverifikasi;
- `TRUSTED` / dapat dipercaya;
- `NEEDS_REVIEW` / perlu review;
- `CONFLICT` / konflik;
- `UNVERIFIED` / belum terverifikasi;
- `SOURCE_UNPROVEN` / sumber belum terbukti;
- `SUSPECTED_INVALID` / terindikasi tidak valid;
- `REJECTED_BY_POLICY` / ditolak kebijakan;
- `UNAVAILABLE` / tidak tersedia.

Exact enum/API tetap mengikuti current architecture dan tidak boleh dibuat paralel tanpa kebutuhan terbukti.

---

## 4. “SAMPAH” — DEFINISI PRODUK

Data “sampah” bukan sekadar file jelek.

Data dapat menjadi tidak layak dipakai bila, antara lain:

- tidak memiliki provenance yang memadai;
- tidak diketahui siapa/apa sumbernya;
- berasal dari actor yang tidak berwenang;
- salah workspace/project/item;
- duplikat/replay yang tidak sah;
- satuan/format/domain tidak masuk akal;
- tanggal/waktu tidak konsisten;
- nilai bertentangan dengan constraint domain;
- evidence tidak relevan dengan klaim;
- metadata penting hilang;
- content rusak/tidak terbaca;
- bertentangan dengan governed facts lain;
- atau gagal policy/integrity check.

SIMPROK tidak boleh memasukkan data seperti ini diam-diam ke perhitungan resmi.

---

## 5. RAW EVIDENCE TIDAK BOLEH DIHAPUS DIAM-DIAM

Ketika data/evidence dicurigai atau gagal trust check:

**jangan otomatis menghapus raw evidence hanya karena AI menganggapnya buruk/palsu.**

Untuk kebutuhan audit, forensic trace, dispute, dan koreksi:

- raw input/evidence harus dipertahankan sesuai retention/security law;
- trust state boleh berubah;
- eligibility untuk dipakai dalam calculation/decision boleh dibatasi;
- alasan penolakan/isolasi harus dapat ditelusuri;
- correction harus non-destructive bila hukum domain menuntut sejarah.

Hapus permanen hanya melalui hukum retention/security/privacy yang sah, bukan karena inferensi mesin semata.

---

## 6. AUTHORITY + INTEGRITY — DUA GERBANG BERBEDA

Actor yang berwenang **belum tentu** membuat data otomatis benar.

Data yang tampak benar **belum tentu** boleh masuk bila actor tidak berwenang.

Karena itu SIMPROK wajib memisahkan:

1. **Authority Gate** — siapa boleh melakukan apa;
2. **Integrity Gate** — apakah data cukup valid, konsisten, attributable, dan eligible untuk digunakan.

Keduanya harus lolos sesuai capability yang dituju.

---

## 7. ACTUAL PROGRESS LAW

Untuk Monitoring Actual:

`SUBMITTED` berarti fakta/klaim telah masuk melalui jalur governed.

`SUBMITTED` **bukan berarti SIMPROK percaya 100%**.

Lifecycle seperti `SUBMITTED → VERIFIED → ACCEPTED` harus tetap mengikuti current governance/authority yang sehat.

SIMPROK tidak boleh menciptakan trust engine paralel bila lifecycle existing sudah menangani fungsi tersebut.

Monitoring membaca effective Actual menurut hukum canonical, bukan menurut data terakhir yang sekadar masuk.

---

## 8. PROVENANCE WAJIB MENEMPEL

Setiap input/evidence yang akan memengaruhi truth penting harus, sejauh capability memungkinkan, dapat ditelusuri ke konteks seperti:

- source/channel;
- actor/device/system identity;
- workspace/project;
- WBS/BOQ/item/scope;
- timestamp / work date / received time;
- location/zone bila relevan;
- capture method;
- evidence reference;
- source version/hash bila relevan;
- transformation/interpretation method;
- verification/review history;
- authority/lifecycle state.

SIMPROK tidak boleh menyajikan angka presisi tinggi tanpa provenance yang sebanding bila provenance memang dibutuhkan untuk mempercayai angka tersebut.

---

## 9. FUTURE VISUAL INTELLIGENCE LAW

Di masa depan, input dapat berasal dari:

- phone photo/video;
- fixed camera/CCTV;
- drone;
- aerial imagery;
- satellite imagery;
- mapping/photogrammetry;
- sensor/device;
- machine interpretation/computer vision.

Arsitektur konseptual wajib mengikuti:

> **RAW VISUAL/SENSOR EVIDENCE  
> → PROVENANCE + QUALITY CHECK  
> → MACHINE/HUMAN INTERPRETATION  
> → CONFIDENCE + REASON  
> → CROSS-CHECK WITH PROJECT TRUTH  
> → TRUST/REVIEW STATE  
> → GOVERNED ACTUAL ONLY WHEN ELIGIBLE**

Kamera/drone/satelit **tidak boleh menjadi jalur kebenaran kedua**.

Mereka adalah source/evidence channels yang masuk ke integrity/governance backbone yang sama.

---

## 10. MACHINE INTERPRETATION — ADVISORY BEFORE AUTHORITY

Machine/AI boleh:

- mendeteksi objek/perubahan;
- mengelompokkan evidence;
- membaca metadata;
- membandingkan before/during/after;
- mendeteksi anomali;
- memperkirakan quantity/progress bila method sah;
- memberi confidence;
- memberi reason codes;
- merekomendasikan review/verification.

Machine/AI tidak boleh:

- mengarang certainty;
- mengubah estimate menjadi official Actual tanpa governance;
- mengubah Baseline;
- menandai evidence sebagai verified tanpa basis;
- menghapus evidence karena model menilainya buruk;
- mengambil keputusan formal yang harus dilakukan manusia berwenang.

Prinsip:

> **SIMPROK mengamati, mendeteksi, membandingkan, menjelaskan, dan merekomendasikan; manusia menetapkan keputusan formal.**

---

## 11. CONFIDENCE HARUS EXPLAINABLE

Bila SIMPROK memberi confidence/trust score atau status, ia harus dapat menjelaskan alasan yang relevan.

Confidence tanpa reason/provenance tidak boleh dipakai untuk menciptakan kepastian palsu.

Contoh reason dimensions yang mungkin relevan:

- source identity known/unknown;
- metadata completeness;
- spatial/time consistency;
- cross-source agreement;
- duplication/replay signal;
- image quality;
- model/method version;
- human verification state;
- domain constraint match/mismatch.

Exact implementation ditunda sampai slice yang memang membutuhkannya.

---

## 12. CROSS-CHECK — CERDAS TAPI TIDAK KAKU

SIMPROK harus mampu membandingkan data baru terhadap konteks yang tersedia, tetapi tidak boleh menolak fakta sah hanya karena berbeda dari data lama.

Perbedaan dapat berarti:

- perubahan nyata;
- correction;
- data dari periode berbeda;
- satuan berbeda tetapi convertible;
- nama berbeda tetapi identity sama;
- evidence konflik;
- atau kesalahan input.

Karena itu cross-check harus:

- context-aware;
- unit-aware;
- identity-aware;
- time-aware;
- provenance-aware;
- fail-closed pada ketidakpastian penting;
- dan menyediakan review door bila perlu.

Tidak boleh membuat exact-string equality sebagai satu-satunya ukuran kebenaran.

---

## 13. NO SILENT NORMALIZATION OF TRUTH

Normalization untuk membantu matching/presentation boleh dilakukan sesuai hukum yang sehat.

Tetapi normalization tidak boleh:

- menghapus provenance;
- mengaburkan nilai asli;
- mengubah source fact diam-diam;
- mengubah unit tanpa conversion proof;
- mengubah unknown menjadi known;
- mengubah conflict menjadi resolved tanpa authority/bukti.

Raw value dan normalized/resolved value harus dapat dibedakan bila diperlukan untuk audit.

---

## 14. TRUST ELIGIBILITY — SIAPA BOLEH MEMAKAI DATA

Tidak semua data yang tersimpan harus eligible untuk semua calculation.

SIMPROK boleh menyimpan sebuah input untuk audit tetapi mengecualikannya dari:

- official Actual;
- progress calculation;
- forecast;
- recommendation;
- publication;
- contractual report;
- downstream intelligence;

sampai trust/governance state memenuhi syarat.

Eligibility harus eksplisit atau dapat diturunkan secara deterministic dari hukum yang disetujui.

---

## 15. MONITORING UX LAW

UI harus membedakan secara jelas antara:

- fakta yang sudah governed;
- klaim baru;
- evidence;
- evidence belum diverifikasi;
- estimate/machine interpretation;
- conflict;
- unavailable;
- needs review.

Jangan menggunakan satu warna/status generik untuk semua ketidakpastian.

Jangan menampilkan machine estimate seolah-olah official progress.

Progressive disclosure tetap berlaku: simple outside, rich inside.

---

## 16. AUDITABILITY

Untuk keputusan trust yang material, sistem harus mampu menjawab:

- data apa yang diterima;
- dari siapa/apa;
- kapan;
- untuk scope apa;
- pemeriksaan apa yang dilakukan;
- apa hasil pemeriksaannya;
- siapa/apa yang mengubah trust state;
- versi method/policy apa yang dipakai;
- apa alasan menerima/menolak/mengisolasi;
- apakah data tersebut digunakan oleh calculation tertentu.

No invisible trust mutation.

---

## 17. SECURITY / PRIVACY / EVIDENCE BOUNDARY

Integrity Intelligence tidak memberi izin untuk mengumpulkan evidence tanpa batas.

Semua future visual/sensor capability tetap tunduk pada:

- project/workspace authorization;
- privacy law;
- consent/notice bila diperlukan;
- data minimization;
- retention law;
- access control;
- secure storage;
- location/sensitive data governance.

“Lebih banyak data” bukan otomatis “lebih baik”.

---

## 18. IMPLEMENTATION LAW — REUSE FIRST

Sebelum membuat engine baru:

1. audit current domain;
2. gunakan authority/lifecycle/provenance/audit assets existing bila sehat;
3. tambahkan minimum seam yang terbukti hilang;
4. jangan membuat parallel trust system;
5. jangan membuat parallel Actual store;
6. jangan membuat parallel Evidence truth.

PASS → LOCK.

FAIL → repair minimum seam → retest.

Tidak boleh redesign area sehat berdasarkan kekhawatiran hipotetis.

---

## 19. STOP CONDITIONS

Executor/AI wajib STOP dan lapor bila sebuah task mengharuskan:

- menganggap input mentah sebagai verified truth;
- menghapus provenance untuk memudahkan UX;
- membypass authority/integrity gate;
- membuat fake evidence/fake certainty;
- memasukkan data unresolved ke official calculation tanpa hukum;
- menyatakan “palsu” tanpa bukti cukup;
- menghapus raw evidence hanya karena machine suspicion;
- membuat second Actual/trust/evidence authority;
- atau mengubah locked foundation untuk convenience.

STOP harus sempit dan berbasis bukti, bukan alasan untuk menghentikan seluruh pekerjaan yang masih aman.

---

## 20. REQUIRED AGENT BEHAVIOR

Semua Agent IA yang bekerja pada SIMPROK wajib membaca hukum ini sebagai constraint produk.

Untuk setiap intake/data/evidence task, Agent harus bertanya:

1. Apa sumbernya?
2. Siapa/apa actor/device/system-nya?
3. Apakah actor/channel berwenang?
4. Apa scope/project/item-nya?
5. Apa provenance-nya?
6. Apakah format/domain/unit masuk akal?
7. Apakah ada duplicate/conflict/anomaly?
8. Apa trust/lifecycle state yang sah?
9. Apakah data eligible untuk calculation/decision yang diminta?
10. Apakah UI menjelaskan uncertainty secara jujur?
11. Apakah raw evidence dan audit trail tetap dapat ditelusuri?

Tidak boleh melewati checklist konseptual ini hanya untuk membuat demo terlihat berhasil.

---

## 21. NON-GOALS SAAT INI

Amendment ini **mengunci hukum**, bukan memerintahkan implementasi besar sekarang.

Tidak otomatis membuka pekerjaan:

- AI vision;
- drone control;
- satellite provider integration;
- photogrammetry;
- sensor IoT;
- authenticity forensic engine;
- deepfake detector;
- global trust scoring platform.

Capability tersebut hanya boleh dibangun ketika roadmap/slice yang sah membutuhkannya.

---

## 22. ACCEPTANCE LAW

Sebuah future capability yang menerima data/evidence hanya boleh disebut Grade A bila terbukti:

- tenant/project safe;
- attributable;
- provenance-aware;
- duplicate/idempotency safe bila relevan;
- domain/unit/context validated;
- uncertainty explicit;
- raw vs interpreted vs governed truth separated;
- rejected/needs-review data tidak bocor menjadi official truth;
- machine inference tidak mengambil human authority;
- audit trail dapat direproduksi;
- no silent mutation of Baseline/official history.

---

## 23. FINAL LOCKED FORMULA

> **INPUT ≠ TRUTH.**
>
> **INPUT → IDENTIFY → VALIDATE → CROSS-CHECK → CLASSIFY TRUST → GOVERN → USE.**
>
> **RAW EVIDENCE ≠ VERIFIED EVIDENCE.**
>
> **MACHINE INTERPRETATION ≠ OFFICIAL FACT.**
>
> **SUSPECTED INVALID ≠ PROVEN FALSE.**
>
> **STORE FOR AUDIT ≠ ELIGIBLE FOR CALCULATION.**
>
> **SIMPROK menerima informasi, tetapi tidak menelan informasi mentah sebagai kebenaran.**
>
> **SIMPROK menjaga provenance, menguji konsistensi, membedakan fakta dari klaim, mendeteksi anomali, mengisolasi ketidakpastian, dan menjelaskan alasan kepercayaannya.**
>
> **Jika kepastian atau authority belum cukup, manusia yang berwenang menetapkan.**

---

## 24. RELATIONSHIP TO EXISTING LOCKS

Amendment ini memperkuat dan tidak mengganti:

- SIMPROK Constitution/Foundation;
- Monitoring Product Law;
- SIMPROK Monitoring Grade-A Roadmap;
- Owner Amendment 001 — Halaman 2;
- H2-A0 Current Truth Shell;
- H2-A1 Canonical Baseline Weight Truth;
- existing authority, audit, progress lifecycle, evidence-reference, identity, unit, and provenance foundations yang telah PASS/LOCK.

Jika terdapat konflik nyata antara implementation lama dengan hukum ini:

**jangan reinterpretasi diam-diam.**

Isolasi konflik → bukti → PM/Owner review → minimum repair.

---

**OWNER LOCK:** APPROVED  
**LOCK DATE:** 2026-08-22  
**CHANGE MODE:** OWNER AMENDMENT ONLY  

Soli Deo Gloria.  
Segala kemuliaan hanya bagi Tuhan Yesus Kristus.  
Amin.
