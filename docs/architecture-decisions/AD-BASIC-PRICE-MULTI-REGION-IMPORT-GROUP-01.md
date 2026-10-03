# AD-BASIC-PRICE-MULTI-REGION-IMPORT-GROUP-01

```text
STATUS=PROVISIONAL_ARCHITECTURE_SEED
TARGET_ROADMAP=RM-02D
IMPLEMENTATION_AUTHORIZED=NO
DISCOVERY_REQUIRED=YES
OWNER_DECISION_RECORDED=YES
DATE=2026-07-25
BASELINE_MAIN=64a523365b319ee492170277afc93ebb12bc32d1
PREDECESSOR=RM-02B / PR #44
```

## 1. Purpose

Record the architectural direction for government Basic Price workbooks that place several regional price columns beside one shared resource identity column.

This decision seed prevents future agents from forcing a multi-region source into RM-02B's one-region-per-batch contract, creating region-specific database columns, discarding source provenance, or auto-publishing values.

This document is intentionally provisional. It preserves the direction and invariants; it does **not** freeze Prisma model names, migrations, API shapes, permissions, or parser rules for every government workbook.

## 2. Current locked boundary

```text
CURRENT_RM02B_CONTRACT=ONE_REGION_PER_BATCH
CURRENT_RM02B_DIRECT_MULTI_REGION_IMPORT=NOT_AUTHORIZED
FUTURE_MULTI_REGION_INTAKE=ONE_UPLOAD_MANY_REGION_BATCHES
IMPORT_GROUP_CONCEPT_REQUIRED=YES
REGION_COLUMN_MAPPING_REQUIRES_HUMAN_CONFIRMATION=YES
AUTO_REGION_CREATION=NO
AUTO_RESOURCE_MATCH=NO
AUTO_SUBMIT=NO
AUTO_PUBLISH=NO
```

RM-02B remains valid and unchanged. A future multi-region intake should fan out into several ordinary regional batches so that existing row review, tenancy, concurrency, submit, verification, publication, and audit controls remain reusable.

## 3. Source observation that triggered this decision

The Owner supplied a read-only example workbook:

```text
SOURCE_FILE_NAME=UPAH KERJA MALUKU.xlsx
SOURCE_SHA256=4BF7211604D9EF9A637FEE160E9660B594B8DB45AD51FB0FC80B11A0DFB48332
SOURCE_BYTE_SIZE=11401
SOURCE_STORAGE=OWNER_CONTROLLED_EXTERNAL_ARTIFACT
WORKBOOK_COMMITTED=NO
WORKSHEET_COUNT=1
WORKSHEET_NAME=Table 4
USED_RANGE=A1:G16
```

Read-only inspection found:

- one shared resource description column;
- one shared unit column;
- ten populated labor-resource rows at source rows 6-15;
- three price columns whose raw headers are:
  - `KECAMTAN SIRIMAU`;
  - `KECAMTAN  USANIWE` (two spaces preserved);
  - `KECAMTAN TELUK AMBON`;
- no stable resource-code column in this example;
- raw unit variants `org/hr` and `Org/hr`;
- source wording, casing, spacing, and typographical anomalies that must remain preserved as evidence.

Therefore this one source contains the following example observation:

```text
EXAMPLE_OBSERVATION_ONLY=YES
RESOURCE_ROWS=10
REGION_PRICE_COLUMNS=3
PRICE_CANDIDATE_CELLS=30
GENERIC_SCHEMA_ASSUMPTION=NO
```

The example proves that a government source can encode many regional facts in one matrix. It does not prove that all government workbooks use this layout.

## 4. Provisional architectural direction

The future intake should behave conceptually as follows:

```text
one uploaded workbook
  -> one source/import group
  -> detect candidate region-price columns
  -> preserve each raw header and source column address
  -> human confirms header-to-Region mapping
  -> fan out to one BasicPriceImportBatch per confirmed Region
  -> each price cell becomes one regional price candidate
  -> ordinary RM-02B review/submit/verify/publish gates continue per batch
```

For the observed workbook, the conceptual result would be:

```text
Import Group: UPAH KERJA MALUKU.xlsx
  -> Batch: Sirimau      (10 candidate prices)
  -> Batch: Usaniwe      (10 candidate prices)
  -> Batch: Teluk Ambon  (10 candidate prices)
```

`Import Group` is a conceptual role in this provisional decision. The final table/model name is not frozen.

## 5. Data-shape invariants

### 5.1 Do not create region-specific price fields

Forbidden direction:

```text
hargaSirimau
hargaUsaniwe
hargaTelukAmbon
```

Each regional cell represents a separate price fact. The durable Basic Price identity remains based on Resource, Region, effective date, and source/provenance rather than a changing set of columns.

### 5.2 Preserve source provenance

For every detected regional price column, retain enough evidence to reconstruct the source interpretation, including at minimum:

- source file hash;
- worksheet name;
- raw region-header text;
- source column address/index;
- source row number;
- raw resource name;
- raw unit text;
- raw price-cell evidence;
- parser contract version;
- confirmed mapped Region ID and confirming human actor when mapping occurs.

Raw text is evidence and must not be silently corrected.

### 5.3 Human-confirmed Region mapping

A detected header may generate a suggestion, but it must not automatically create a Region or silently bind to one.

```text
RAW_HEADER_PRESERVED=YES
REGION_SUGGESTION_ALLOWED=YES
REGION_AUTO_CREATION=NO
REGION_AUTO_CONFIRMATION=NO
HUMAN_CONFIRMATION_REQUIRED=YES
```

### 5.4 Resource resolution remains human-governed

This example contains no stable resource code, so name/unit evidence alone cannot become an automatic canonical identity.

RM-02C ResourceCatalog bootstrap and catalog search must precede practical RM-02D row resolution. Matching may suggest candidates, but ambiguity must remain unresolved until a human disposition is recorded.

### 5.5 Unit policy

Raw unit variants such as `org/hr` and `Org/hr` must be preserved. A future parser may suggest canonical `PERSON_DAY` only through existing UnitDefinition/UnitAlias rules and human-governed resolution.

No silent Unit Kernel expansion is authorized by this document.

### 5.6 Publication safety

One upload may be processed together for preview and mapping convenience, but review, verification, and publication safety remain explicit.

```text
ONE_UPLOAD=YES
ONE_PREVIEW_MATRIX=YES
MANY_REGION_BATCHES=YES
AUTO_SUBMIT=NO
AUTO_VERIFY=NO
AUTO_PUBLISH=NO
```

## 6. Shared government-source metadata

A future import-group layer may hold metadata shared by all generated regional batches, such as:

- source file name and SHA-256;
- issuing authority;
- document number;
- effective date;
- source type;
- source origin;
- uploader and workspace;
- parser contract version.

If the document is independently verified as an official government source, `sourceOrigin=GOVERNMENT` and an appropriate source type may be proposed. This document does not authorize classification based only on a filename or appearance.

## 7. Roadmap placement

```text
RM-02C
  -> canonical ResourceCatalog bootstrap
  -> catalog-search endpoint

RM-02D
  -> multi-region government Basic Price intake
```

Provisional RM-02D sequence:

1. `RM-02D0` — discover and compare multiple government workbook layouts;
2. `RM-02D1` — freeze import-group and column-to-region contract;
3. `RM-02D2` — multi-column parser and preview matrix;
4. `RM-02D3` — human Region mapping UI;
5. `RM-02D4` — deterministic fan-out into regional batches;
6. `RM-02D5` — E2E, negative tenancy tests, and Owner browser acceptance.

RM-02C execution must not be interrupted by this decision seed.

## 8. Required discovery before implementation

RM-02D0 must inspect more than one source and classify at least:

- one region per sheet versus many regions per sheet;
- region headers in rows versus columns;
- merged/multi-level headers;
- absent resource codes;
- repeated resource blocks;
- multiple years or price categories in one workbook;
- blank and formula price cells;
- unit variants;
- duplicate or ambiguous region names;
- government-document metadata placement;
- whether a column actually represents geography, price class, year, or another dimension.

No generic parser, schema migration, or endpoint may be authorized from the Maluku example alone.

## 9. Open questions — deliberately not frozen

- final persistence model/table names;
- whether an import group requires a schema object or can initially be represented by a source-document aggregate;
- exact endpoint paths and DTOs;
- maximum regional columns per source;
- fuzzy region-matching policy;
- permissions specific to group mapping/fan-out;
- rollback and supersession rules across generated batches;
- whether partial fan-out is permitted when one region mapping remains unresolved;
- treatment of non-geographic multi-column dimensions.

These questions belong to RM-02D0/RM-02D1 architecture review.

## 10. Non-goals and prohibitions

This decision does not authorize:

- application code;
- Prisma schema or migration changes;
- production database access;
- production permission seeding;
- automatic Region creation;
- automatic Resource identity creation;
- automatic submission, verification, or publication;
- committing the source workbook;
- changing RM-02B or RM-02C scope.

## 11. Handoff contract for all AI agents

Any agent encountering a government Basic Price workbook with several price columns must first classify the column dimension. It must not assume every price column is a Region and must not flatten the source into one region or region-specific database fields.

```text
DOCUMENT_AUTHORITY=PROVISIONAL_DIRECTION_ONLY
IMPLEMENTATION_AUTHORITY=NO
MUST_PRESERVE_SOURCE_EVIDENCE=YES
MUST_REQUIRE_HUMAN_REGION_MAPPING=YES
MUST_REUSE_RM02B_BATCH_SAFETY=YES
MUST_WAIT_FOR_RM02D0_DISCOVERY=YES
```

Soli Deo Gloria.
