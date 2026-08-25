# SIMPROK — INTELLIGENCE CAPABILITY MAP

## Peta Kecerdasan yang SUDAH ADA di SIMPROK

### Dalam Nama Tuhan Yesus Kristus. Soli Deo Gloria. Haleluya. Amin.

---

| Atribut | Nilai |
|---|---|
| **Document ID** | `SIMPROK-INTELLIGENCE-CAPABILITY-MAP` |
| **Dibuat oleh** | INT-CONNECT-01 (Existing Intelligence Reconnection) |
| **Baseline repository** | `3dbdeed82d27df73657c08044a327651877f9fb7` |
| **Cabang kerja saat ditulis** | `feat/int-connect-01-existing-intelligence-wiring` — **belum di-merge, belum dipromosikan ke runtime** |
| **Sifat dokumen** | **INGATAN INSTITUSIONAL — BUKAN HUKUM, BUKAN RUNTIME** |
| **Status** | Deskriptif. Ia melaporkan keadaan repository, bukan menetapkannya. |
| **Hukum di atasnya** | Owner Constitution · Owner Decisions · locked ADR |
| **Rujukan, BUKAN hukum** | `docs/product-intelligence/P7C_PRODUCT_INTELLIGENCE_LAW.md` berstatus **`v1.0-DRAFT` — DESIGN ONLY, Owner PASS BELUM DIBERIKAN, implementation authority NONE**. Ia dicatat di sini sebagai **draf rujukan**, dan **tidak** berdiri setara Constitution / Owner Decisions / locked ADR. `policyVersion` yang aktif hari ini tetap `P8A_CONSTITUTIONAL_AI_BOUNDARY_V1`. |

---

## MENGAPA DOKUMEN INI ADA

SIMPROK sudah memiliki mesin-mesin yang benar. Yang berulang kali terjadi bukan
kekurangan kecerdasan, melainkan **kecerdasan yang tidak pernah ditanya**.

Contoh nyata yang memicu dokumen ini: Basic Price sudah meng-*inject*
`UnitKernelService` **dan** `ResourceIdentityResolutionService` ke dalam modulnya
sejak lama. Keduanya hanya dipanggil **setelah** manusia mengetik dan memilih
sendiri — satu untuk memverifikasi pilihan manusia, satu untuk **menolak**
pembuatan katalog baru. Tidak ada yang pernah bertanya lebih dulu. Akibatnya
Owner diminta melakukan 172 pencarian manual untuk 86 baris, padahal mesin dapat
membuktikan sebagian besar di antaranya.

Dokumen ini ada supaya eksekutor berikutnya **menemukan** otoritas itu sebelum
membangun yang kedua.

> **ENAM FAKTA BERBEDA. JANGAN DILEBUR.**
> `ENGINE EXISTS` → `ENGINE IS HEALTHY` → `ENGINE CAN DO THE JOB` →
> `ENGINE IS CALLED` → `RESULT IS CONSUMED/PERSISTED` → `RESULT IS SURFACED & EXPLAINABLE`.
> "Ada mesinnya" bukan "mesinnya bekerja untuk pengguna".

---

## KOSAKATA STATUS

| Status | Arti |
|---|---|
| `CONNECTED_HEALTHY` | dipanggil oleh workflow produksi, hasilnya dikonsumsi, dan terlihat oleh manusia. |
| `PARTIALLY_CONNECTED` | dipanggil, tetapi salah satu dari konsumsi / persistensi / penampakan masih kurang. |
| `ISOLATED` | ada, sehat, ter-*export*, tetapi **tidak ada konsumen produksi**. |
| `INTENTIONALLY_DORMANT` | sengaja tidak aktif sampai keputusan Owner/konfigurasi. |
| `FUTURE_ROADMAP` | belum ada di repository. Jangan diciptakan tanpa gate tersendiri. |
| `DUPLICATE_SUSPECT` | mengandung logika domain yang sudah dimiliki otoritas kanonik. |

---

# BAGIAN A — OTORITAS KANONIK

## A.1 UNIT AUTHORITY

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-UNIT-01` |
| **CANONICAL_AUTHORITY** | `UnitKernelService` |
| **SOURCE_FILES** | `backend/src/unit-kernel/unit-kernel.service.ts` · `unit-kernel.contracts.ts` · `unit-normalization.ts` |
| **ENTRYPOINTS** | `resolve(rawSource, rawTarget, resourceCatalogId?, context?)` — "bolehkah A menjadi B?"<br>`resolveCanonicalUnitIdentities(rawUnits[], context?, client?)` — "satuan kanonik apa ini?" (batched) |
| **INPUT** | ejaan mentah + konteks kelas tepercaya (`MATERIAL`/`LABOR`/`EQUIPMENT`) |
| **OUTPUT** | `RESOLVED` / `NEEDS_REVIEW` / `NOT_CONVERTIBLE` + `reasonCode` + alias id sebagai provenance |
| **DETERMINISM_RULE** | tepat satu alias aktif yang lolos hukum eligibility. Empat kegagalan dibedakan: `UNKNOWN_UNIT_ALIAS`, `AMBIGUOUS_UNIT_ALIAS`, `CONTEXT_REQUIRED_UNIT_ALIAS`, `FOREIGN_CONTEXT_UNIT_ALIAS`. Makna dari konteks lain **tidak pernah dipinjam**. |
| **HUMAN_BOUNDARY** | tanpa konteks tepercaya, alias context-scoped tetap tidak eligible. Konversi non-identitas ditolak di Basic Price karena harga belum punya seam transformasi. |
| **PERSISTENCE** | tidak menulis. Data referensi berasal dari migrasi (`unit_definitions`, `unit_aliases`). |
| **CURRENT_CONSUMERS** | `BasicPriceRowResolutionService` (verifikasi pilihan manusia + admission) · `ResourceIdentityResolutionService` (RM-03D2 tie-break) · `AhspResourceResolutionOrchestrator` · **`BasicPriceRowResolutionProposalService` (INT-CONNECT-01, baru)** |
| **VISIBLE_SURFACE** | Peninjauan Basic Price: `"Satuan sumber \"ltr\" terbukti berarti Litre."` |
| **TEST_COVERAGE** | `unit-kernel.service.spec.ts` · `b1b12-golden-unit-coverage.spec.ts` (159 baris Golden, nol ambigu) |
| **STATE** | **`CONNECTED_HEALTHY`** |

## A.2 RESOURCE IDENTITY AUTHORITY

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-RESID-01` |
| **CANONICAL_AUTHORITY** | `resolveResourceIdentity` (kernel murni) + `ResourceIdentityResolutionService` (pemuat bukti & delegator) |
| **SOURCE_FILES** | `backend/src/resource-catalog/resource-identity-resolution.kernel.ts` · `resource-identity-resolution.service.ts` |
| **ENTRYPOINTS** | `loadEvidence(client, workspaceId, ghxAhspResourceIds?)` · `resolve(evidence, reference, client?)` · `resolveForWorkspace(...)` |
| **INPUT** | nama mentah, kode sumber, satuan mentah, kelas sumber daya, katalog workspace + global, sighting, keputusan manusia terdahulu |
| **OUTPUT** | `RESOLVED` / `NEEDS_REVIEW` / `UNRESOLVED` + `authority` + kandidat + `reasonCodes` + penjelasan Bahasa Indonesia |
| **DETERMINISM_RULE** | LEVEL 1 kecocokan kanonik eksak → LEVEL 1b *representation tie* diputus konteks satuan → LEVEL 2 kandidat berbasis bukti → LEVEL 4a/4b konflik spesifikasi/kelas → LEVEL 5 benar-benar nihil |
| **HUMAN_BOUNDARY** | hanya `EXACT_CANONICAL_MATCH`, `EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT`, dan `VERIFIED_MAPPING_REUSED` yang menetapkan identitas. Kandidat tidak pernah otomatis. Spesifikasi yang tak dinyatakan sumber menahan kecocokan eksak sekalipun. |
| **PERSISTENCE** | tidak menulis. Membaca `resource_catalogs`, `resource_source_identities`, `basic_price_import_row_resource_mappings`, `ahsp_resource_identity_decisions`. |
| **CURRENT_CONSUMERS** | `AhspResourceResolutionOrchestrator` · `ProjectAhspService` · `GhxResourceIdentityDecisionService` · `BasicPriceRowResolutionService` (**hanya** sebagai gerbang penolak di `admitResourceForRow`) · **`BasicPriceRowResolutionProposalService` (INT-CONNECT-01, baru)** |
| **VISIBLE_SURFACE** | Peninjauan Basic Price: verdict + daftar kandidat + alasan; Golden Thread di RAB |
| **TEST_COVERAGE** | `resource-identity-resolution.kernel.spec.ts` (recall & precision) · `resource-identity-resolution.service.spec.ts` · `ghx-identity-seam.spec.ts` |
| **STATE** | **`CONNECTED_HEALTHY`** |

## A.3 BASIC PRICE ROW RESOLUTION (siklus keputusan manusia)

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-BPROW-01` |
| **CANONICAL_AUTHORITY** | `BasicPriceRowResolutionService` |
| **ENTRYPOINTS** | `resolveRow` · `rejectRow` · `admitResourceForRow` |
| **DETERMINISM_RULE** | **DUA TAHAP, dan perbedaannya menentukan.** <br>**Tahap 1 — gerbang identitas, fail-closed berlapis:** `ROW_SOURCE_SECTION_UNRESOLVED` → `ROW_NOT_MUTABLE` → `ROW_VERSION_STALE` → `RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE` (workspace **sama persis**) → `RESOURCE_TYPE_MISMATCH` → `UNIT_UNKNOWN_OR_INACTIVE` → bukti Unit Kernel (`RESOLVED` **dan** `priceOperation = IDENTITY`).<br>**Tahap 2 — sesudah seluruh gerbang lolos, tak ada lagi yang dilempar.** Status akhir baris diputus dua fakta lain: `collisionType === 'NONE'` **dan** `proposedCanonicalPrice !== null` → `READY_FOR_SUBMISSION`; selain itu baris **tetap** `NEEDS_REVIEW` ([:410-425](../../backend/src/basic-price/basic-price-row-resolution.service.ts#L410-L425)). Tabrakan adalah fakta tentang **batch** dan tentang keputusan yang belum terjadi — bukan fakta tentang identitas baris. Inilah sebabnya `CAP-BPPROP-01` tidak boleh mengklaim baris "selesai". |
| **HUMAN_BOUNDARY** | **INI BATAS OTORITAS MANUSIA.** `BasicPriceImportRowResourceMapping.reviewerAccountId` adalah `NOT NULL` dengan FK ke `Account`. Tidak ada cara jujur bagi mesin untuk menulis rekaman itu. |
| **PERSISTENCE** | menulis baris + rekaman keputusan append-only berisi **tepat delapan** field: `workspaceId`, `rowId`, `resourceCatalogId`, `unitDefinitionId`, `reviewerAccountId`, `reason`, `suggestionSource` (dihitung server), `candidateCountAtDecision`. |
| **STATE** | **`CONNECTED_HEALTHY`** |

## A.4 MACHINE-FIRST PROPOSAL SEAM — **DISAMBUNG OLEH TUGAS INI**

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-BPPROP-01` |
| **CANONICAL_AUTHORITY** | `BasicPriceRowResolutionProposalService` — **komposisi, bukan otoritas baru** |
| **SOURCE_FILES** | `backend/src/basic-price/basic-price-row-resolution-proposal.service.ts` |
| **ENTRYPOINT** | `proposeForRows(workspaceId, rows[])` |
| **OUTPUT** | per baris: verdict Unit + verdict Resource Identity **yang diproyeksikan** (bukan salinan byte-per-byte) + `admissibleForResolve` + `identityPairProven` + `blockingFacts`. <br>**PROYEKSI, BUKAN PIPA.** Otoritas Unit dan Resource Identity tetap SUMBER KEBENARAN resolusi, dan seam ini tidak menurunkan ulang identitas, tidak menambah matcher, dan tidak menggantikan keduanya. Namun ia sah **menambahkan** state khusus alur kerja Basic Price (`NOT_STATED`, `ROW_SOURCE_SECTION_UNRESOLVED`, `UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY`, `admissibleForResolve`, `identityPairProven`, `blockingFacts`) dan sah **menghilangkan** apa yang alur kerja ini tidak perlukan (lihat baris PROVENANCE soal `explanation`). Menyebutnya "verbatim" adalah klaim yang terlalu luas dan sudah dikoreksi. |
| **DETERMINISM_RULE** | tidak punya hukum sendiri. **`identityPairProven` menamai SATU fakta: kaki Resource dan kaki Unit yang dibutuhkan sebuah PEMILIHAN identitas Basic Price sudah terbukti dan admissible.** Ia **BUKAN** "baris selesai" — lihat Tahap 2 pada A.3: status akhir baris masih diputus harga kanonik dan tabrakan same-identity, dua fakta yang seam ini secara struktural tidak pernah lihat (`BasicPriceRowProposalInput` tidak membawa harga maupun data baris saudara). |
| **ADMISSIBILITY** | Otoritas identitas dipakai bersama dan bukti-nya mencakup baris katalog **global** (`workspaceId = null`) yang sah bagi AHSP. `resolveRow` menuntut **kesamaan workspace persis**. Karena itu seam ini menanyakan satu kueri terikat yang **mencerminkan predikat `resolveRow` persis** (`{ id: { in }, workspaceId, status: 'ACTIVE' }`) dan menolak actionability sebuah identitas global dengan kode milik endpoint itu sendiri, `RESOURCE_UNKNOWN_OR_OUTSIDE_WORKSPACE`. **Otoritas bersama tidak dipersempit** — mempersempitnya akan diam-diam mengubah apa yang dapat diselesaikan Golden Thread. |
| **HUMAN_BOUNDARY** | **mengusulkan, tidak pernah memutuskan, tidak pernah menulis.** Nol kapabilitas mutasi. |
| **PERSISTENCE** | **NOL.** Dihitung saat baca. Alasannya tercatat di A.3 dan di C.1: rekaman keputusan menuntut manusia nyata, dan tidak ada sink yang sah untuk verdict mesin. |
| **PROVENANCE YANG BENAR-BENAR DIBAWA** | per kaki Unit: `reasonCode`, `contextScoped`, `trustedContext`, `policyVersion`. Per kaki Resource: `authority`, `reasonCodes`, `policyVersion`, dan per kandidat `evidence[]`, `specificationUnproved`, `unprovedSpecificationFacts[]`, `hasPriorHumanDecision`. <br>**KAYA DI DALAM, SECUKUPNYA DI LUAR.** Otoritas internal tetap menyimpan seluruh pengetahuannya; yang dipersempit adalah PROYEKSI, bukan ingatan. <br>**DUA LAPIS, JANGAN DISAMAKAN:** di DALAM otoritas Resource Identity, `PriorHumanDecision` memang objek kaya (`reviewerAccountId`, `decidedAt`, `reason`) dan itu sah — ia bukti internal. Yang KELUAR pada proposal Basic Price hanyalah `hasPriorHumanDecision: boolean`. Reviewer, waktu, dan alasan **tidak pernah menjadi payload browser**; jangan menulis atau membaca dokumen ini seolah-olah ia demikian. <br>**`explanation` TIDAK DIBAWA OLEH `machineProposal` (INT-CONNECT / `getBatch`).** Kedua kaki proposal — `machineProposal.unit` dan `machineProposal.resource` — berisi **fakta terstruktur saja**. Kedua otoritas tetap membangun `explanation` mereka dan isinya tetap kaya secara sengaja: id baris ResourceCatalog, kosakata model, kode alasan mentah, provenance alias, dan pada cabang keputusan tergovernansi juga akun/waktu/catatan privat manusia. Semua itu **tetap ada di dalam mesin** dan boleh dibaca permukaan audit yang kelak punya hukumnya sendiri. Yang berubah: kontrak `machineProposal` **tidak memiliki field `explanation`** pada kaki mana pun, sehingga prosa itu bukan sekadar tidak dirender — ia tidak dikirim pada jalur baca peninjauan. Jangan menghidupkannya kembali dengan nama lain (`rawExplanation`, `internalExplanation`, `debugExplanation`, `machineExplanation`). <br>**409 RESOLVE (`admit-resource`) KINI MEMAKAI PROYEKSI AMAN YANG SAMA.** `identityRefusal` dahulu menyalin `ResourceIdentityResolution` apa adanya, sehingga badan 409 membawa `candidates` kanonik lengkap dengan `priorHumanDecision` (**reviewerAccountId, decidedAt, catatan privat**), blob `specifications`, dan `identity.explanation`. Kini ia memetakan kandidat lewat `toBasicPriceSafeCandidate` — **satu-satunya definisi "kandidat aman Basic Price"**, dipakai bersama oleh ruang peninjauan dan lifecycle resolve agar keduanya tidak bisa menyimpang — dan `explanation` kanonik **tidak lagi dikirim** (nol konsumen; pemanggil membaca `message`). Gerbang admisi tetap dinilai atas verdict UTUH lewat `isIdentityExhausted`; hanya BALASANnya yang dipersempit. <br>**JANGAN BACA INI SEBAGAI KLAIM UNIVERSAL.** "Tidak ada di kedua seam Basic Price" **bukan** "tidak ada `explanation` di respons Basic Price mana pun". `unitResolution.explanation` pada lifecycle resolve **tetap ada dan sengaja tidak diubah**: buktinya menunjukkan ia prosa Unit Kernel biasa (mis. "Kedua alias menunjuk identitas unit canonical yang sama") tanpa id ResourceCatalog, tanpa identitas reviewer, tanpa catatan privat. Menilainya adalah pekerjaan tersendiri yang belum diminta; jangan mencatatnya di sini seolah sudah selesai. <br>**NARASI PENGGUNA NORMAL** disusun dari field TERSTRUKTUR oleh `rowMachineNarrative` di sisi frontend, dan itulah satu-satunya narasi pengguna biasa. Kode yang belum punya kalimat pengguna **tidak pernah dicetak mentah** — termasuk di bawah Detail Teknis, yang hanya menyebut JUMLAHnya. <br>**TIDAK dibawa, dan jangan diklaim:** `matchedAliasIds` (nol kemunculan di seam ini) dan digest kandidat (**tidak ada** untuk kaki Resource — `candidateContextDigest` hanya milik `AhspResourceIdentityDecision`). `RESOURCE_IDENTITY_POLICY_VERSION` pun, menurut dokumentasinya sendiri, "persisted on no row and compared in no query… a contract marker, not an audit-trail guarantee". |
| **PERFORMANCE** | **Tidak ada N+1 per-baris.** Kerja kueri di-*batch* dan dibatasi oleh **bukti**, bukan oleh jumlah baris: 1× `loadEvidence` (3 kueri) + ≤1 panggilan identitas satuan **per konteks tepercaya berbeda** + 1 batch bukti round-trip untuk kode kanonik berbeda + 1 label + 1 admissibility untuk id berbeda. Terukur (**snapshot**, bukan konstanta): gladi kanonik terakhir yang tercatat memakai **16 kueri Prisma untuk 86 baris**. Angka itu adalah HASIL PENGUKURAN pada satu dataset, bukan jaminan universal — dataset lain sah memakai jumlah lain. <br>**BUKAN diklaim konstan.** Uji membuktikan 6 vs 600 baris ber-*shape* sama memakai kueri identik, **dan** uji pendamping membuktikan bahwa menambah konteks tepercaya berbeda memang menambah kueri — batas yang jujur, bukan teorema universal. |
| **CURRENT_CONSUMERS** | `BasicPriceImportService.getBatch` (jalur baca peninjauan saja — **bukan** preview/patch/submit) |
| **VISIBLE_SURFACE** | `BasicPriceReviewPage`: pra-isi per kaki + "Dikenali otomatis / Perlu keputusan Anda / Belum dikenali" + alasan + ringkasan batch yang membedakan *perlu keputusan* dari *belum dikenali* |
| **TEST_COVERAGE** | `basic-price-row-resolution-proposal.service.spec.ts` — spec khusus seam ini, memakai otoritas **asli**, mencakup admissibility global, batas semantik `identityPairProven`, determinisme per-baris, batas kueri, dan **minimisasi data outward** (otoritas internal tetap memegang id/akun/catatan privat, sementara proposal terserialisasi tidak memuat satu pun sentinel tersebut, dan bentuk kedua kaki dipagari kunci-per-kunci). <br>*(Jumlah uji sengaja TIDAK dicatat di sini: hitungan berubah setiap kali sebuah hukum ditambahkan, dan angka basi di memori institusional lebih buruk daripada tidak ada angka. Hitungan yang bertanggal adalah milik laporan eksekusi.)* · `basic-price-import.service.spec.ts` (wiring `getBatch`) · `basicPriceImportDisplay.test.ts` |
| **STATE** | **`PARTIALLY_CONNECTED`** — terimplementasi dan teruji di cabang kerja `feat/int-connect-01-existing-intelligence-wiring`. **Belum** di canonical main, **belum** ada runtime promotion, **belum** ada bukti browser Owner. Naikkan ke `CONNECTED_HEALTHY` hanya setelah merge + promosi runtime + mata Owner. |

## A.5 KANDIDAT PEMETAAN & PROVENANCE BARIS

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-BPCAND-01` |
| **AUTHORITY** | `findMappingCandidates` + `BasicPriceRowMappingCandidatesService` + `findProvenanceCandidate` |
| **CAKUPAN** | kecocokan nama ter-normalisasi eksak (setara LEVEL 1 milik `CAP-RESID-01`) + `SOURCE_ROW_PROVENANCE` yang fail-closed lewat `BasicPriceSourceEquivalence` |
| **CURRENT_CONSUMERS** | `BasicPriceRowResolutionService` (menghitung `suggestionSource` saat keputusan) · endpoint `GET /basic-price-imports/:batchId/rows/:rowId/candidates` |
| **CATATAN** | Endpoint kandidat **tidak pernah dipanggil frontend**. Setelah `CAP-BPPROP-01` tersambung, kandidat yang lebih kaya (LEVEL 2 milik `CAP-RESID-01`) sampai ke layar lewat proposal. Endpoint ini tetap sah untuk pemakaian per-baris/API. |
| **STATE** | **`PARTIALLY_CONNECTED`** — dipakai backend, belum disurface lewat rutenya sendiri. |

## A.6 KEBIJAKAN KELAYAKAN & PROVENANCE HARGA

| CAPABILITY_ID | AUTHORITY | KONSUMEN | STATE |
|---|---|---|---|
| `CAP-BPELIG-01` | `BasicPriceEligibilityPolicy` (satu predikat `usableWhere`, mencakup freshness/`validUntil`) | 6 berkas, termasuk orchestrator AHSP & publikasi | `CONNECTED_HEALTHY` |
| `CAP-BPPROV-01` | `basic-price-source-provenance.service` (`findProvenanceCandidate`) | resolusi baris + lookup kandidat | `CONNECTED_HEALTHY` |
| `CAP-BPFAM-01` | `basic-price-source-family.util` (`sourceOriginsForFamily`) | `BasicPriceService` + DTO | `CONNECTED_HEALTHY` |
| `CAP-BPACTOR-01` | `TrustedBasicPriceActorService` | jalur aset privat & publikasi | `CONNECTED_HEALTHY` |

## A.7 GOVERNED HUMAN DECISION MEMORY (GHX)

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-GHX-01` |
| **AUTHORITY** | `GhxResourceIdentityDecisionService` + `GhxDecisionContextTokenService` + `ghx-candidate-context` |
| **DETERMINISM_RULE** | hanya generasi terbaru; hanya bila `resolutionPolicyVersion` cocok; hanya bila `candidateContextDigest` masih identik; hanya bila mesin gagal **dan** kegagalannya boleh dijawab manusia |
| **CATATAN PENTING** | Ruang lingkupnya **fakta sumber AHSP**, bukan baris Basic Price. Pemetaan Basic Price yang sudah ditinjau tetap **tidak** dapat menghasilkan `VERIFIED_MAPPING_REUSED`. Basic Price tidak mengirim `ghxSubject`, jadi seam ini nol kueri di jalur Basic Price. |
| **STATE** | **`CONNECTED_HEALTHY`** (untuk domainnya sendiri) |

## A.8 UNIVERSAL INTAKE

| CAPABILITY_ID | AUTHORITY | STATE |
|---|---|---|
| `CAP-INTAKE-01` | `ReaderRegistry` + `xlsx/csv reader` + `SourceEnvelope` | `CONNECTED_HEALTHY` |
| `CAP-STRUCT-01` | `structure-detector` + `header-vocabulary` + `price-literal` | `CONNECTED_HEALTHY` |
| `CAP-BPADAPT-01` | `BasicPriceUniversalIntakeAdapter` | `CONNECTED_HEALTHY` |

> **Batas yang disengaja:** intake **tidak** memanggil otoritas resolusi. Ia membaca sumber; ia tidak memutuskan arti sumber. Ini ditegakkan oleh test harness (`test/fixtures/usi01r-intake-harness.ts`) yang **melempar** bila `preview` menyentuh seam proposal.

## A.9 KERNEL BIAYA & RAB

| CAPABILITY_ID | AUTHORITY | STATE |
|---|---|---|
| `CAP-COST-01` | `cost-kernel.kernel.ts` + `CostKernelService` | `CONNECTED_HEALTHY` |
| `CAP-AHSPRES-01` | `AhspResourceResolutionOrchestrator` (Golden Thread) | `CONNECTED_HEALTHY` |
| `CAP-AHSPPRICE-01` | `ahsp-resource-price-resolution.kernel.ts` | `CONNECTED_HEALTHY` |
| `CAP-INTAKEMODE-01` | `intake-mode.kernel.ts` | `CONNECTED_HEALTHY` |

## A.10 AI PROPOSAL (P8A)

| | |
|---|---|
| **CAPABILITY_ID** | `CAP-AI-01` |
| **AUTHORITY** | `SimprokIntelligenceOrchestrator` + `ConstitutionalAiBoundaryService` + `IntelligenceEvidenceService` + `IntelligenceProviderRegistry` |
| **HUMAN_BOUNDARY** | keluaran provider selalu melewati Constitutional Boundary, dicatat sebagai Evidence append-only, dan **hanya menghasilkan draft** |
| **KONSUMEN** | `RabIntelligenceProposalService` (RAB) |
| **CATATAN** | Bila provider tidak dikonfigurasi, `DisabledIntelligenceProvider` menjawab *provider-unavailable* — **tidak pernah** mengarang proposal. **Ini kecerdasan berbasis LLM dan tidak ada hubungannya dengan `CAP-UNIT-01`/`CAP-RESID-01`, yang deterministik dan berbasis bukti.** Jangan pernah menggantikan resolusi deterministik dengan jalur ini. |
| **STATE** | **`INTENTIONALLY_DORMANT`** bila provider tidak dikonfigurasi; `CONNECTED_HEALTHY` bila dikonfigurasi |

---

# BAGIAN B — TEMUAN ISOLASI & DUPLIKASI

Dicatat dengan tepat, **tidak** dipaksa masuk ke penutupan INT-CONNECT-01. Lihat
Bagian C untuk alasannya.

## B.1 `BoqUnitCompatibilityService` — ISOLATED

- `backend/src/unit-kernel/boq-unit-compatibility.service.ts`
- Sehat, benar, tipis, dan **konsumen produksi = 0**. Ia sudah disediakan dan
  di-*export* oleh `UnitKernelModule`, hanya belum ada workflow yang memanggilnya.
- Ia **bukan** duplikat: ia mendelegasikan ke `UnitKernelService`.
- **STATE:** `ISOLATED`. Apakah impor BOQ seharusnya memakainya adalah keputusan
  produk tersendiri, bukan kekurangan yang boleh ditambal di sini.

## B.2 `RealityNormalizationEngine` — DUPLICATE_SUSPECT + ISOLATED

- `backend/src/ahsp/services/reality-normalization.engine.ts`
- Memuat `normalizeUnit()` sendiri dengan tabel alias mini
  (`['m^3','m3','meter kubik'] → 'm3'`). Ini **hukum satuan tandingan**.
- **Tidak terdaftar di modul mana pun. Nol konsumen.** Kode mati.
- **REKOMENDASI:** hapus, atau — bila ada niat produk di baliknya — tulis ulang
  sebagai konsumen `CAP-UNIT-01`. Jangan biarkan ia tumbuh menjadi otoritas kedua.
- **STATE:** `DUPLICATE_SUSPECT` / `ISOLATED` — **menunggu keputusan terpisah.**

## B.3 `UniversalDiscoveryEngine`, `UniversalMappingEngine` — ISOLATED

- `backend/src/ahsp/services/` — keduanya nol konsumen, tidak terdaftar di modul.
- **STATE:** `ISOLATED` — menunggu keputusan terpisah.

## B.4 `frontend/src/simprokKamus.ts` — **DUPLICATE AUTHORITY (paling serius)**

- `normalisasiSatuan(teks, { kategori, dimensi })`, 242 baris, dengan kamus alias
  satuan lengkap dan penanganan konteks sendiri (`OH`, `OJ`, `OB`, `JAM`, …).
- **Ini otoritas satuan KEDUA, hidup di browser.** Konsumen:
  `frontend/src/utils/goldenThread.ts` dan `frontend/src/pages/FirstRealInputPreviewPage.tsx`.
- Ia melanggar prinsip "frontend tidak menentukan kebenaran kanonik", dan ia dapat
  tidak sepakat dengan `CAP-UNIT-01` tanpa ada yang menyadarinya.
- **MENGAPA TIDAK DIPERBAIKI DI SINI:** kontraknya tidak cocok. `CAP-UNIT-01`
  adalah layanan backend berbasis database; menyambungkan Golden Thread ke sana
  memerlukan permukaan API baru dan menyentuh tampilan RAB — di luar seam
  Basic Price, dan lebih besar daripada "pekerjaan penyambungan".
- **STATE:** `DUPLICATE_SUSPECT` — **butuh gate roadmap tersendiri.** Prioritas
  tertinggi di antara temuan Bagian B.

## B.5 `normalizeResourceName` terdefinisi dua kali — duplikasi yang sudah diakui

- `basic-price/basic-price-row-mapping-candidates.service.ts:41` dan
  `resource-catalog/resource-identity-resolution.kernel.ts:396` — badan identik
  byte-per-byte, dan kernel **sudah mendokumentasikan** duplikasi ini sebagai
  pembersihan aman yang terpisah.
- **STATE:** duplikasi diakui, risiko rendah. Bukan kecerdasan tandingan.

---

# BAGIAN C — YANG BELUM TERSAMBUNG (JANGAN DICIPTAKAN DIAM-DIAM)

> **TIGA FAKTA BERBEDA, JANGAN DILEBUR:**
> **FONDASI ADA** (kolom/field sudah di skema) ≠ **WORKFLOW TERSAMBUNG**
> (ada yang membaca/menulis/menampilkannya) ≠ **BENAR-BENAR TIDAK ADA**.
> Versi pertama dokumen ini melanggar itu untuk TKDN dan menyatakan "nol
> kemunculan" tanpa audit penuh. Itu **salah** dan dikoreksi di bawah.

## C.1 %KDN dan TKDN — **LIMA KAPABILITAS BERBEDA. ISTILAHNYA TERKUNCI.**

> ### ISTILAH PRODUK TERKUNCI (hukum Owner)
>
> | Istilah | Milik | Menjawab |
> |---|---|---|
> | **`%KDN`** | item/sumber daya **Harga Dasar** | *"Berapa persen kandungan dalam negeri item Harga Dasar ini?"* |
> | **`TKDN`** | **hasil kalkulasi** di tingkat RAB/Proyek | *"Berapa TKDN proyek ini, dihitung dari komposisi yang benar-benar dipakai?"* |
>
> **DILARANG** memakai label campuran `"KDN/TKDN sumber daya"`, `"Resource TKDN"`,
> `"TKDN per item Basic Price"`, atau `"TKDN item price"`. Fakta tingkat-item
> selalu **`%KDN`**. Kata **`TKDN`** dicadangkan untuk hasil hitungan RAB/Proyek.
>
> ### CATATAN KOMPATIBILITAS TERMINOLOGI
>
> TKDN Foundation yang lebih lama menggunakan istilah **"TKDN"** juga untuk
> atribut kandungan dalam negeri pada **resource**. Berdasarkan klarifikasi Owner
> terbaru, bahasa produk SIMPROK **mempertajam nomenklatur tanpa mengubah
> substansi foundation**: nilai kandungan dalam negeri pada item/Harga Dasar
> disebut dan ditampilkan sebagai **`%KDN`**, sedangkan **`TKDN`** digunakan untuk
> hasil kalkulasi pada tingkat RAB/Proyek. Prinsip bahwa data kandungan dalam
> negeri **berasal dari resource** dan **menjadi dasar kalkulasi proyek** tetap
> **tidak berubah**.
>
> **Keduanya BUKAN hukum yang bersaing.** Yang lama dan yang baru menggambarkan
> rantai yang sama; yang baru hanya memberi dua nama berbeda pada dua ujung
> rantai itu supaya tidak lagi tertukar. Karena itu:
>
> - membaca "TKDN" pada Foundation lama di posisi **resource** harus dipahami
>   sebagai **`%KDN`** dalam bahasa produk hari ini;
> - nama field skema **`tkdnValue` TIDAK diganti** oleh tugas ini — penamaan
>   teknis legasi dibiarkan apa adanya, dan penggantian nama (bila pernah
>   diinginkan) adalah gate tersendiri dengan migrasinya sendiri.
>
> **`%KDN` BUKAN HARGA.** Harga menjawab *"berapa harga item ini?"*; `%KDN`
> menjawab *"berapa persen kandungan dalam negerinya?"*. Keduanya **fakta
> independen**: harga berubah tidak dengan sendirinya mengubah `%KDN`, dan
> sebaliknya. Contoh produk:
>
> ```
> Semen Portland 50 kg
>   Harga Dasar = Rp …
>   %KDN        = 92%
> ```
>
> Keduanya **boleh** tiba dari baris/berkas sumber yang sama, tetapi setelah
> dipahami keduanya menuju **domain berbeda**:
>
> ```
> BARIS SUMBER
> ├── fakta HARGA   → Domain Harga Dasar / Basic Price
> └── fakta %KDN    → Domain Kepatuhan / Kandungan Dalam Negeri
> ```
>
> ### RANTAI KANONIK
>
> ```
> Item Harga Dasar membawa %KDN
>         ↓
> sumber daya dikonsumsi lewat komposisi AHSP / RAB
>         ↓
> SIMPROK MENGHITUNG
>         ↓
> TKDN RAB / TKDN PROYEK
>         ↓
> SNAPSHOT TKDN PROYEK
> ```
>
> AHSP, BOQ, dan RAB/Proyek **tidak pernah** menjadi sumber TKDN yang diketik
> manusia — mereka **mewarisi dan menghitung**. **DILARANG** menyamakan
> `TKDN Proyek = %KDN satu sumber daya`, dan **dilarang** mengisi TKDN Proyek
> secara manual seolah ia field `%KDN` sumber daya.
>
> **JANGAN MENGARANG** rumus, bobot, persentase tenaga kerja, ambang regulasi,
> atau formula kepatuhan. Tak satu pun ada di repository ini. Semuanya
> **`UNPROVEN`** sampai gate-nya sendiri.
>
> ### DUA SUMBER KEBENARAN, JANGAN DILEBUR
>
> | Sumber | Isi | Status |
> |---|---|---|
> | **BUKTI REPOSITORY** | apa yang ada di Git hari ini | dapat diverifikasi, dikutip di bawah |
> | **HUKUM PRODUK TERKUNCI OWNER** | TKDN Foundation yang disediakan/diratifikasi Owner | **berlaku**, tetapi **saat ini tidak tersimpan di dalam repository Git ini** |
>
> Jadi rumusan yang benar bukan *"foundation-nya tidak ada"*, melainkan:
>
> **"Dokumen kanonik TKDN Foundation tidak ditemukan di repository Git saat ini.
> Namun jejak `%KDN`/TKDN memang terdapat pada schema, migration, label UI, dan
> beberapa dokumen/gate repository."**
>
> **DOKUMEN FOUNDATION TIDAK TERSIMPAN DI GIT ≠ TKDN NOL JEJAK DI REPOSITORY.**
> Versi dokumen ini sebelumnya menyatakan hanya tiga berkas Git menyinggung TKDN.
> **Itu salah** — jejaknya tersebar setidaknya pada skema (`tkdnValue`), migrasi
> yang menambahkannya, label UI di pintu RAB, dokumen audit baseline, dan
> referensi non-goal pada gate RM-03; seluruhnya dikutip pada C.1.1–C.1.5 di
> bawah. Klaim berbasis **hitungan berkas** sengaja tidak dipakai lagi: ia rapuh
> dan akan basi pada perubahan berikutnya. Yang berlaku adalah pernyataan
> kualitatif di atas, dan bukti per-kapabilitas di bawah.

### C.1.1 `%KDN` HARGA DASAR — FIELD DATA SKALAR

| Bukti repository | Berkas |
|---|---|
| `tkdnValue Decimal? @db.Decimal(5, 2)` pada `ResourceCatalog` | [prisma/schema.prisma:1055](../../backend/prisma/schema.prisma#L1055) |
| migrasi yang menambahkannya | `prisma/migrations/20260624091701_baseline_002_rework/migration.sql:130` |
| dicatat sebagai keputusan baseline-002 | `docs/audits/REPORT-BASELINE-002.md:19` |
| pembaca/penulis `tkdnValue` di backend, frontend, atau test | **NOL** |

**STATE = `SCALAR_DATA_FIELD_PRESENT` / `GOVERNED_WORKFLOW_NOT_CONNECTED`.**

> **PENAMAAN LEGASI ≠ ISTILAH PRODUK.** Nama teknis `tkdnValue` adalah bukti
> penamaan skema/legasi. Ia **tidak menentukan** istilah produk. Istilah produk
> untuk fakta tingkat-item ini adalah **`%KDN`**.

**SATU FIELD `Decimal?` YANG NULLABLE TIDAK MEMBUKTIKAN APA PUN TENTANG:**
sumber · nomor referensi · bukti/evidence · verifikasi · tanggal berlaku ·
riwayat multi-sumber · rincian komponen (bahan/alat/tenaga) · intake · detail UI.
Tak satu pun dari itu terimplementasi. Menyebut ini *"fondasi `%KDN` lengkap"*
akan menjadi klaim berlebih.

### C.1.2 IMPOR BASIC PRICE → `%KDN` — `NOT_CONNECTED`

Sebuah sumber Harga Dasar **boleh** membawa harga **dan** `%KDN` di baris yang
sama. Itu **tidak** berarti `%KDN` menjadi bagian dari harga — ia adalah fakta
kepatuhan terpisah yang kebetulan seperjalanan.

| Bukti repository | Hasil |
|---|---|
| kosakata header intake universal | **nol** konsep `%KDN` / kandungan dalam negeri |
| adapter domain Basic Price | **nol** pembaca/penulis `%KDN` |
| importer / parser / reader / writer untuk `tkdnValue` | **tidak ada** |
| uji untuk intake `%KDN` | **tidak ada** |

**STATE = `NOT_CONNECTED`.** Keberadaan kolom `ResourceCatalog.tkdnValue`
**bukan** bukti kesambungan. **Tidak diimplementasikan di sini.**

### C.1.3 DETAIL HARGA DASAR → `%KDN` + RINCIAN — `NOT_IMPLEMENTED`

**Hukum produk Owner.** Pada halaman Detail Harga Dasar sebuah item — misalnya
*"Semen Portland 50 kg"* — SIMPROK harus mampu menampilkan:

- **`%KDN` item**;
- rincian/komponen `%KDN` **bahan/material**;
- rincian/komponen `%KDN` **alat/peralatan**;
- rincian/komponen `%KDN` **tenaga**;
- sumber / referensi / bukti / tanggal / verifikasi —
  **bila fakta-fakta itu tersedia dan terbukti.**

> **ATURAN KEJUJURAN.** Bila hanya **total `%KDN`** yang tersedia, SIMPROK
> menampilkan total yang terbukti itu dan **TIDAK BOLEH mengarang** rincian
> bahan/alat/tenaga. Bila bukti rinciannya ada, tampilkan.

| Bukti repository | Hasil |
|---|---|
| halaman Basic Price mana pun yang menyebut `%KDN`/KDN | **nol** (`BasicPriceExplorerPage`, `BasicPriceImportPage`, `BasicPricePublicationQueuePage`, `BasicPriceReviewDetailPage`, `BasicPriceReviewPage`, `BasicPriceReviewQueuePage`) |
| model rincian komponen `%KDN` di skema | **tidak ada** |
| field sumber/referensi/verifikasi di samping `tkdnValue` | **tidak ada** |

**STATE = `NOT_CONNECTED` / `NOT_IMPLEMENTED`.** Dicatat di sini sebagai
**ingatan institusional untuk slice masa depan yang benar**. **Tidak dibangun di sini.**

### C.1.4 MESIN KALKULASI TKDN RAB/PROYEK

TKDN RAB/Proyek adalah **hasil turunan yang dihitung** dari komposisi sumber daya
yang benar-benar dipakai proyek — bukan angka yang diketik, dan bukan salinan
`%KDN` satu item. Ia boleh memiliki rincian kontribusi dari bahan/material,
peralatan/alat, dan tenaga, serta komponen lain yang terbukti secara hukum —
**tetapi rumus, bobot, dan ambangnya tidak boleh dikarang.**

| Bukti repository | Hasil |
|---|---|
| modul/servis/kernel TKDN di `backend/src` | **tidak ada** |
| berkas `.ts` di `backend/src` yang menyebut TKDN | **nol** |
| pembaca/penulis runtime atau uji untuk kalkulasi TKDN | **tidak ada** |

**STATE = `FOUNDATION_REQUIRED` / `RUNTIME_IMPLEMENTATION_NOT_FOUND`.**
Foundation terkunci Owner **menuntut** kapabilitas ini; runtime-nya **belum
ditemukan** di repository. Ini bukan sekadar "roadmap opsional". **Tidak
diimplementasikan di sini.**

### C.1.5 SNAPSHOT TKDN RAB/PROYEK

Hukum foundation: setelah lock/approval, Proyek **tidak** memakai TKDN live — ia
memakai **Snapshot**, agar perubahan master-data di kemudian hari tidak diam-diam
menulis ulang kebenaran historis proyek. Ini hukum yang **berbeda** dari C.1.4.

| Bukti repository | Hasil |
|---|---|
| model persistensi snapshot TKDN di skema | **tidak ada** — satu-satunya model bernama `*Snapshot` adalah `AHSPSnapshot` dan `AHSPSnapshotResource` |
| servis snapshot TKDN | **tidak ada** |
| `frontend/src/pages/ProjectRabDoorPage.tsx:88` — `'TKDN'` | **label dokumen pendukung** di pintu RAB, dirender *"Belum tersedia"*. Pintu jujur — **bukan** mesin, **bukan** snapshot. |

**STATE = `FOUNDATION_REQUIRED` / `RUNTIME_IMPLEMENTATION_NOT_FOUND`.**
**Tidak diimplementasikan di sini.**

> **RINGKASNYA:** hukum foundation yang berlaku **tidak sama dengan** implementasi
> runtime yang tersambung. C.1.1 ada sebagai satu field skalar; C.1.2, C.1.3,
> C.1.4, dan C.1.5 belum ada. **INT-CONNECT-01 tidak mengubah perilaku
> executable, skema, migrasi, persistensi, maupun implementasi runtime apa pun
> yang berkaitan dengan `%KDN` atau TKDN.** Yang ia ubah di wilayah ini adalah
> **dokumentasi/klasifikasi institusional saja** — termasuk paragraf ini.
> ("Tidak satu byte pun" adalah klaim yang keliru secara harfiah, karena dokumen
> ini sendiri berubah.)

## C.2 TRUST ROUTING — **TIDAK ADA, TETAPI "TRUST" BUKAN BERARTI TIDAK ADA**

Tidak ada konsep *routing* di `backend/src` maupun `prisma` (nol kemunculan di luar
dokumen ini sendiri). Namun hukum **kepercayaan** lain memang ada dan sedang
berjalan, sehingga menyebut "trust tidak ada" akan menyesatkan:
`TrustedBasicPriceActorService`, `TrustedAhspActorService`, `trustedContext` /
`trustedUnitContext` pada otoritas satuan, dan `BasicPriceEligibilityPolicy`.

**STATE = `FUTURE_ROADMAP`** untuk Trust Routing secara spesifik.

## C.3 PROVENANCE MESIN YANG DURABLE — **`NEEDS_OWNER_DECISION`**

Pertanyaannya: *setelah manusia menekan Selesaikan dan baris meninggalkan
`NEEDS_REVIEW`, dapatkah SIMPROK menjelaskan secara durable apa yang **mesin**
buktikan?*

**Sisi manusia: LENGKAP dan durable.** `reviewerAccountId`, `decidedAt`, `reason`,
`resourceCatalogId`, `unitDefinitionId`, `suggestionSource`,
`candidateCountAtDecision`, plus `row.resolvedByAccountId` / `resolvedAt`. **Jangan
disentuh.**

**Sisi mesin: TIDAK ADA SINK YANG SAH.**

| Yang hilang | Bukti |
|---|---|
| `BasicPriceImportRowResourceMapping` menulis **tepat delapan** field; tak satu pun dapat menampung verdict otoritas Satuan (`reasonCode`, `contextScoped`, `resolvedContext`, `matchedAliasIds`, `policyVersion`) maupun otoritas Identitas (`authority`, `reasonCodes`) | [basic-price-row-resolution.service.ts:520-529](../../backend/src/basic-price/basic-price-row-resolution.service.ts#L520-L529) |
| enum `BasicPriceImportRowMappingSuggestionSource` tidak punya nilai yang berarti "manusia menerima usulan otoritas kanonik"; kelima nilainya menamai sinyal RM-02D1 (nama ter-normalisasi / provenance) yang dihitung `findMappingCandidates` + `findProvenanceCandidate` — **bukan** `UnitKernelService` atau `ResourceIdentityResolutionService` | schema + `basic-price-row-resolution.service.ts:487-511` |
| bukti satuan **sudah dihitung** di dalam transaksi resolve dan **dibuang saat sukses** — hanya dilempar ke klien saat gagal | `basic-price-row-resolution.service.ts:258-276` |

Setiap sink alternatif diperiksa dan **ditolak**: `suggestionSource`, `reason`
(teks dari klien — akan menjadi klaim manusia tentang mesin, tak terverifikasi),
`resolutionStatus`, `rawSourceContext` (dokumennya menyatakan "EVIDENCE, never
input to any calculation"), `IntelligenceEvidence` (menuntut `projectId` NOT NULL
dan milik jalur LLM P8A), `KnowledgeEvent` (buku besar publikasi — hukum lain),
`AhspResourceIdentityDecision` (menuntut `ahspResourceId` NOT NULL),
`AHSPAuditLog`, `PriceSubmissionAudit`, `BasicPricePublicationAudit`,
`ResourceSourceIdentity`.

**Yang hilang adalah SINK, bukan bukti.** Menutupnya menuntut nilai enum baru atau
kolom baru — **perubahan skema, kewenangan Owner.** INT-CONNECT-01 **tidak**
mengarang jalan pintas dan **tidak** memalsukan `reviewerAccountId`.

**MENGAPA "TANYAKAN ULANG SAJA NANTI" TIDAK SETARA.** Baris memang menyimpan
`rawUnitText`, `rawResourceNameText`, dan `sourceSection`, sehingga kedua otoritas
dapat ditanya lagi kapan pun. Tetapi mereka akan menjawab dengan **tabel alias
hari ini, katalog hari ini, dan policy hari ini** — bukan dengan keadaan pada saat
manusia memutuskan. Sebuah alias yang ditambahkan bulan depan, sebuah baris
katalog yang dinonaktifkan, atau sebuah policy yang naik versi, semuanya akan
mengubah jawaban itu secara diam-diam. Reproduksi bukan pelestarian.

**PERTANYAAN UNTUK OWNER.** *Haruskah SIMPROK melestarikan bukti mesin yang persis
ada pada saat seorang manusia mengonfirmasi identitas Basic Price?*
**Rekomendasi PM: YA**, demi auditabilitas dan reproduksibilitas.
**Implementasi TIDAK diotorisasi pada tugas ini.**

## C.4 IDENTITAS GLOBAL — **KEPUTUSAN HUKUM OWNER YANG LATEN, BUKAN PENGHALANG RUNTIME KANONIK**

Bila otoritas identitas menetapkan sebuah baris katalog **global**
(`workspaceId = null`) untuk baris Basic Price, peninjau hari ini **tidak punya
langkah sah apa pun**:

- `resolveRow` menolak — workspace harus sama persis;
- `admitResourceForRow` menolak — `isIdentityExhausted` menuntut `UNRESOLVED`
  dengan nol kandidat, sehingga identitas yang RESOLVED gagal gerbang itu;
- kotak pencarian tidak dapat menampilkannya — `searchResources` juga
  workspace-strict.

Tidak ada hukum adopsi/bridge di `resource-catalog/` maupun `basic-price/`.
INT-CONNECT-01 menutup bahaya **actionability**-nya (tak pernah dipra-isi, dan
alasannya dijelaskan), tetapi pertanyaan doktrin — *apakah baris katalog global
boleh ada sama sekali, dan bila ya apa langkah sah peninjau* — adalah keputusan
produk.

**Catatan keterjangkauan, jujur:** tidak ada jalur kode di repo ini yang membuat
baris katalog ber-`workspaceId = null` (setiap `ResourceCatalog.create` mengisi
workspace; provisioning kanonik memakai `CANONICAL_REFERENCE_WORKSPACE_ID`), dan
DB kanonik hari ini berisi **268 baris, seluruhnya milik workspace, nol global**.
Jadi celah ini **laten, bukan sedang terjadi**. Penjaganya tetap benar terlepas
dari itu.

**STATE = `LATENT_OWNER_LAW_DECISION` — BUKAN penghalang runtime kanonik saat
ini.** Bila baris `ResourceCatalog` global suatu saat diperkenalkan, Basic Price
memerlukan kebijakan adopsi/pemilihan yang sah dan eksplisit. **Tidak
diimplementasikan di sini.**

## C.5 SISANYA

| Kapabilitas | Bukti | STATE |
|---|---|---|
| **Region identity resolution** | tidak ada resolver wilayah; pemilihan wilayah tetap eksplisit oleh manusia | `FUTURE_ROADMAP` |
| **Konversi harga lintas satuan** | Unit Kernel dapat menghitung faktor, tetapi Basic Price **menolak** apa pun selain `priceOperation = IDENTITY` karena tidak ada seam transformasi harga | `FUTURE_ROADMAP` (penolakan saat ini benar) |
| **Konfirmasi massal baris terbukti** | menyentuh batas otoritas manusia | `NEEDS_OWNER_DECISION` |

> **Auto-resolve identitas dan satuan BUKAN kepercayaan harga.** Menyelesaikan
> identitas teknis satu baris tidak melewati review, tidak menerbitkan harga, dan
> tidak menjadikan harga itu kebenaran milik SIMPROK. Siklus
> kepercayaan/publikasi Basic Price tetap utuh dan tidak disentuh tugas ini.

---

# BAGIAN D — HUKUM UNTUK EKSEKUTOR BERIKUTNYA

1. **Cari dulu di dokumen ini.** Bila kapabilitas sudah terdaftar, **sambungkan**,
   jangan bangun ulang.
2. **Satu domain, satu otoritas.** Satuan → `CAP-UNIT-01`. Identitas sumber daya →
   `CAP-RESID-01`. Resolusi baris Basic Price → `CAP-BPROW-01`.
3. **Jangan menyalin logika domain ke seam.** `CAP-BPPROP-01` sengaja tidak punya
   pencocokan sendiri; bila ada yang menambahkannya, itu cacat, bukan optimisasi.
4. **Jangan pernah menaruh hukum kanonik di frontend.** Lihat B.4 sebagai contoh
   apa yang terjadi bila hal itu dibiarkan.
5. **Hasil otomatis wajib dapat dijelaskan** dalam bahasa yang dapat dibaca
   pengguna yang tidak tahu nama service apa pun.
6. **Fail-closed berlaku pada FAKTA, bukan pada WORKFLOW.** Satu baris yang tidak
   terselesaikan tidak boleh menghentikan saudaranya yang sehat.
7. **Kepastian mesin bukan otoritas manusia.** Di mana domain menuntut keputusan
   manusia, SIMPROK boleh menghitung, mencocokkan, dan merekomendasikan otomatis —
   tetapi tidak boleh menyamar sebagai keputusan manusia.

---

Soli Deo Gloria. Haleluya. Amin.
