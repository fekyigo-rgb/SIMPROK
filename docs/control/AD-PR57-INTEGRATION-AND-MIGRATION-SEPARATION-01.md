# AD-PR57-INTEGRATION-AND-MIGRATION-SEPARATION-01

Dalam Nama Tuhan Yesus Kristus. Amin.

```text
OWNER_DECISION_ID=AD-PR57-INTEGRATION-AND-MIGRATION-SEPARATION-01
OWNER=FEKY_DE_FRETES
STATUS=OWNER_LOCKED
LOCK_DATE=2026-07-31

PRODUCT_CODE_ANCHOR=30132237de782d06043cdca3cfbc064781e8042a

MERGE_GATE=OPEN
MIGRATION_EXECUTION_GATE=CLOSED
PRODUCTION_ACTIVATION_GATE=CLOSED

INTEGRATION_METHOD=ONE_INTEGRATION_PR_FROM_PRODUCT_CODE_ANCHOR_TO_MAIN
SEQUENTIAL_MERGE_PR53_TO_PR57=FORBIDDEN
CURRENT_STACKED_PR57_DIRECT_MERGE=FORBIDDEN
MERGE_COMMIT_REQUIRED=YES
CI_ON_MAIN_TARGET_REQUIRED=YES

MIGRATION_ID=20260731090000_gate2a_boq_item_kernel_provenance
MIGRATION_PRODUCTION_PRECONDITION=UNVERIFIED

SIMPROK_DB_WRITE=NO
MIGRATION_EXECUTION=NO
PRODUCTION_ACTIVATION=NO
```

## 1. Pemisahan gerbang

Merge kode ke `main` adalah operasi integrasi Git. Merge tidak memberi
izin untuk menjalankan migration atau mengaktifkan perubahan di produksi.

```text
MERGED_TO_MAIN != MIGRATION_EXECUTED
MIGRATION_EXECUTED != PRODUCTION_ACTIVATED
```

Tidak ada inferensi otomatis dari satu gerbang ke gerbang lainnya.

## 2. Precondition wajib sebelum migrate deploy

Migration berikut dilarang dijalankan terhadap `simprok_db`:

```text
backend/prisma/migrations/
20260731090000_gate2a_boq_item_kernel_provenance/migration.sql
```

Migration baru boleh dijalankan setelah seluruh bukti berikut tersedia:

```text
MONEY_PAIR_MISMATCH_COUNT=0
ORPHAN_PUBLICATION_ACTOR_COUNT=0
PRICED_BOQ_ITEM_BACKFILL_COUNT=MEASURED
READ_ONLY_DATA_PROOF=PASS
```

Query minimum:

```sql
SELECT count(*)
FROM boq_items
WHERE ("unitPrice" IS NULL) <> ("lineTotal" IS NULL);

SELECT count(*)
FROM boq_items
WHERE "unitPrice" IS NOT NULL;

SELECT count(*)
FROM basic_price_publication_audits audit
LEFT JOIN accounts account
  ON account.id = audit."actorAccountId"
WHERE account.id IS NULL;
```

Larangan:

```text
MIGRATE_DEPLOY_BEFORE_PRECONDITION_PASS=FORBIDDEN
MIGRATION_BYPASS_WITH_NOT_VALID_CONSTRAINT=FORBIDDEN
DATA_FABRICATION_TO_PASS_PREFLIGHT=FORBIDDEN
SIMPROK_DB_WRITE_FOR_PREFLIGHT=FORBIDDEN
```

## 3. Jalur pembuktian data warisan

```text
DATA_PROOF_PATH_PRIMARY=
RESTORE_VERIFIED_SIMPROK_DB_BACKUP_TO_ISOLATED_NON_PRODUCTION_DATABASE

PRODUCTION_CREDENTIAL_RECOVERY=SEPARATE_WORKSTREAM
```

Restore dan query pembuktian tidak boleh mengubah `simprok_db`.

## 4. Reklasifikasi UTANG-TESTCRED-01

Dua konfigurasi produksi yang diketahui telah diuji pada endpoint yang
sama. Keduanya gagal autentikasi PostgreSQL dengan kode `28P01`.

```text
UTANG_TESTCRED_01_RECLASSIFIED=YES
OLD_EXPOSED_CREDENTIAL_AUTHENTICATION=FAIL_28P01_AT_VERIFIED_ENDPOINT

ACTIVE_SECRET_EXPOSURE_RISK=REDUCED
PRODUCTION_ADMIN_ACCESS_STATUS=UNKNOWN_OR_LOST
ACCESS_RECOVERY_REQUIRED=YES
ROTATION_STATUS=UNKNOWN
FULL_SECURITY_CLOSURE=NOT_CLAIMED
```

Password tidak boleh ditebak atau dicetak. Pemulihan akses tidak boleh
dicampurkan dengan implementasi atau integrasi Gate 2A.

## 5. Scope integrasi

Integration PR membawa tree produk yang berakar tepat pada:

```text
30132237de782d06043cdca3cfbc064781e8042a
```

Commit dokumentasi keputusan ini tidak mengubah:

```text
SOURCE_CODE=UNCHANGED
SCHEMA=UNCHANGED
MIGRATION_SQL=UNCHANGED
TESTS=UNCHANGED
PRODUCT_CODE_ANCHOR=UNCHANGED
```

## 6. Status

```text
MERGE_AUTHORIZATION=NOT_IMPLIED_BY_THIS_FILE
MIGRATION_EXECUTION=NO
PRODUCTION_ACTIVATION=NO
SIMPROK_DB_WRITE=NO
```

Soli Deo Gloria.
