/**
 * P1-B JOURNAL COMPATIBILITY FIXTURE — journal knowledge exactly as the PRE-TITLE reader produced it.
 *
 * Generated, not written by hand: the reader snapshot taken before the work-title output-unit seam
 * existed (same knowledge contract "AHSP_DOCUMENT_USI01_V1"), transpiled and run over
 * buildAhspAnalisaXlsx() with only the title (C5) and summary (B21) cells changed — and, for LEGACY_C, a
 * "satuan : m2" row (B6) above the header moved to row 7. Reader provenance:
 *   ahsp-document-understanding.ts sha256 734764D7974553FD53559C66C8D482C93EBEF88037707A5C4744B59FF13D7437
 *   ahsp-document-knowledge.ts sha256 53C5AC95661825BA1CB44C71211802D5B1C0093A045EFC1BFCE31C252BAE79B8
 * Test data only — not Owner data, not a copy of any real document.
 */
/* eslint-disable */
import type { AhspDocumentKnowledge } from '../../src/ahsp/document/ahsp-document-knowledge';

export const PRE_TITLE_READER_KNOWLEDGE = {
  "LEGACY_A_TITLE_ONLY": {
    "contractVersion": "AHSP_DOCUMENT_USI01_V1",
    "source": {
      "fileName": "legacy_a_title_only.xlsx",
      "contentDigestSha256": "7721A29D2B9C64892EF8C8863DF0EA8805C4CCE3B10DBE82CC6764732FB00145",
      "readerId": "XLSX_EXCELJS",
      "readerContractVersion": "USI01_XLSX_V1",
      "byteSize": 6839
    },
    "document": {
      "title": {
        "sheetName": "ANALISA HARGA",
        "locator": "A1",
        "rowNumber": 1,
        "raw": "ANALISA HARGA SATUAN UNTUK PENAWARAN"
      },
      "regulationReference": {
        "sheetName": "ANALISA HARGA",
        "locator": "A3",
        "rowNumber": 3,
        "raw": "BERDSARAKAN PERMEN PUPR NO. 1 THN 2022"
      },
      "effectiveDate": null,
      "authorityProven": true
    },
    "status": "UNRESOLVED",
    "reasonCodes": [
      "CURRENTNESS_UNPROVEN"
    ],
    "workItems": [
      {
        "status": "UNRESOLVED",
        "reasonCodes": [
          "MISSING_OUTPUT_UNIT"
        ],
        "workType": {
          "sheetName": "ANALISA HARGA",
          "locator": "A5",
          "rowNumber": 5,
          "raw": "1.7.7.1.1.b (a)"
        },
        "methodName": {
          "sheetName": "ANALISA HARGA",
          "locator": "C5",
          "rowNumber": 5,
          "raw": "PEMASANGAN 1 M2 PLESTERAN DINDING"
        },
        "outputUnitRaw": null,
        "resolvedOutputUnit": null,
        "regulationReference": {
          "sheetName": "ANALISA HARGA",
          "locator": "K5",
          "rowNumber": 5,
          "raw": "AHSP PUPR NO. 1 Bidang Umum"
        },
        "effectiveDate": null,
        "sheetName": "ANALISA HARGA",
        "resources": [
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Pekerja",
            "rawCode": "L.01",
            "rawUnit": "OH",
            "coefficient": 0.4,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B10",
              "rowNumber": 10,
              "raw": "Pekerja"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E10",
              "rowNumber": 10,
              "raw": "L.01"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F10",
              "rowNumber": 10,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G10",
              "rowNumber": 10,
              "raw": "0.4"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          },
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Mandor",
            "rawCode": "L.04",
            "rawUnit": "OH",
            "coefficient": 0.04,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B11",
              "rowNumber": 11,
              "raw": "Mandor"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E11",
              "rowNumber": 11,
              "raw": "L.04"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F11",
              "rowNumber": 11,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G11",
              "rowNumber": 11,
              "raw": "0.04"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          }
        ]
      }
    ]
  },
  "LEGACY_B_TITLE_M2_SUMMARY_M3": {
    "contractVersion": "AHSP_DOCUMENT_USI01_V1",
    "source": {
      "fileName": "legacy_b_title_m2_summary_m3.xlsx",
      "contentDigestSha256": "1444E972DA228B1D7F03652C9DDDBA3DCA0A9A2723516D83C2566CE1A944C24B",
      "readerId": "XLSX_EXCELJS",
      "readerContractVersion": "USI01_XLSX_V1",
      "byteSize": 6840
    },
    "document": {
      "title": {
        "sheetName": "ANALISA HARGA",
        "locator": "A1",
        "rowNumber": 1,
        "raw": "ANALISA HARGA SATUAN UNTUK PENAWARAN"
      },
      "regulationReference": {
        "sheetName": "ANALISA HARGA",
        "locator": "A3",
        "rowNumber": 3,
        "raw": "BERDSARAKAN PERMEN PUPR NO. 1 THN 2022"
      },
      "effectiveDate": null,
      "authorityProven": true
    },
    "status": "READY",
    "reasonCodes": [
      "CURRENTNESS_UNPROVEN"
    ],
    "workItems": [
      {
        "status": "READY",
        "reasonCodes": [],
        "workType": {
          "sheetName": "ANALISA HARGA",
          "locator": "A5",
          "rowNumber": 5,
          "raw": "1.7.7.1.1.b (a)"
        },
        "methodName": {
          "sheetName": "ANALISA HARGA",
          "locator": "C5",
          "rowNumber": 5,
          "raw": "PEMASANGAN 1 M2 PLESTERAN DINDING"
        },
        "outputUnitRaw": {
          "sheetName": "ANALISA HARGA",
          "locator": "B21",
          "rowNumber": 21,
          "raw": "m3"
        },
        "resolvedOutputUnit": null,
        "regulationReference": {
          "sheetName": "ANALISA HARGA",
          "locator": "K5",
          "rowNumber": 5,
          "raw": "AHSP PUPR NO. 1 Bidang Umum"
        },
        "effectiveDate": null,
        "sheetName": "ANALISA HARGA",
        "resources": [
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Pekerja",
            "rawCode": "L.01",
            "rawUnit": "OH",
            "coefficient": 0.4,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B10",
              "rowNumber": 10,
              "raw": "Pekerja"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E10",
              "rowNumber": 10,
              "raw": "L.01"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F10",
              "rowNumber": 10,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G10",
              "rowNumber": 10,
              "raw": "0.4"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          },
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Mandor",
            "rawCode": "L.04",
            "rawUnit": "OH",
            "coefficient": 0.04,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B11",
              "rowNumber": 11,
              "raw": "Mandor"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E11",
              "rowNumber": 11,
              "raw": "L.04"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F11",
              "rowNumber": 11,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G11",
              "rowNumber": 11,
              "raw": "0.04"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          }
        ]
      }
    ]
  },
  "POSITIVE_TITLE_M3_SUPERSCRIPT_SUMMARY_M3": {
    "contractVersion": "AHSP_DOCUMENT_USI01_V1",
    "source": {
      "fileName": "positive_title_m3_superscript_summary_m3.xlsx",
      "contentDigestSha256": "EAF8C97030A086A8CB8150CBE4496E07122F320F670A9B87586DBB6DEB3D266B",
      "readerId": "XLSX_EXCELJS",
      "readerContractVersion": "USI01_XLSX_V1",
      "byteSize": 6853
    },
    "document": {
      "title": {
        "sheetName": "ANALISA HARGA",
        "locator": "A1",
        "rowNumber": 1,
        "raw": "ANALISA HARGA SATUAN UNTUK PENAWARAN"
      },
      "regulationReference": {
        "sheetName": "ANALISA HARGA",
        "locator": "A3",
        "rowNumber": 3,
        "raw": "BERDSARAKAN PERMEN PUPR NO. 1 THN 2022"
      },
      "effectiveDate": null,
      "authorityProven": true
    },
    "status": "READY",
    "reasonCodes": [
      "CURRENTNESS_UNPROVEN"
    ],
    "workItems": [
      {
        "status": "READY",
        "reasonCodes": [],
        "workType": {
          "sheetName": "ANALISA HARGA",
          "locator": "A5",
          "rowNumber": 5,
          "raw": "1.7.7.1.1.b (a)"
        },
        "methodName": {
          "sheetName": "ANALISA HARGA",
          "locator": "C5",
          "rowNumber": 5,
          "raw": "Pembuatan s.d Pengecoran 1 m³ beton mutu sedang"
        },
        "outputUnitRaw": {
          "sheetName": "ANALISA HARGA",
          "locator": "B21",
          "rowNumber": 21,
          "raw": "m3"
        },
        "resolvedOutputUnit": null,
        "regulationReference": {
          "sheetName": "ANALISA HARGA",
          "locator": "K5",
          "rowNumber": 5,
          "raw": "AHSP PUPR NO. 1 Bidang Umum"
        },
        "effectiveDate": null,
        "sheetName": "ANALISA HARGA",
        "resources": [
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Pekerja",
            "rawCode": "L.01",
            "rawUnit": "OH",
            "coefficient": 0.4,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B10",
              "rowNumber": 10,
              "raw": "Pekerja"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E10",
              "rowNumber": 10,
              "raw": "L.01"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F10",
              "rowNumber": 10,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G10",
              "rowNumber": 10,
              "raw": "0.4"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          },
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Mandor",
            "rawCode": "L.04",
            "rawUnit": "OH",
            "coefficient": 0.04,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B11",
              "rowNumber": 11,
              "raw": "Mandor"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E11",
              "rowNumber": 11,
              "raw": "L.04"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F11",
              "rowNumber": 11,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G11",
              "rowNumber": 11,
              "raw": "0.04"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          }
        ]
      }
    ]
  },
  "LEGACY_C_CONTRADICTION_NOT_KEPT": {
    "contractVersion": "AHSP_DOCUMENT_USI01_V1",
    "source": {
      "fileName": "legacy_c_contradiction_not_kept.xlsx",
      "contentDigestSha256": "4872F270D37FBC159F63FB7DDA0651A052EA9DD60DB383C64F5A540906178EFB",
      "readerId": "XLSX_EXCELJS",
      "readerContractVersion": "USI01_XLSX_V1",
      "byteSize": 6862
    },
    "document": {
      "title": {
        "sheetName": "ANALISA HARGA",
        "locator": "A1",
        "rowNumber": 1,
        "raw": "ANALISA HARGA SATUAN UNTUK PENAWARAN"
      },
      "regulationReference": {
        "sheetName": "ANALISA HARGA",
        "locator": "A3",
        "rowNumber": 3,
        "raw": "BERDSARAKAN PERMEN PUPR NO. 1 THN 2022"
      },
      "effectiveDate": null,
      "authorityProven": true
    },
    "status": "UNRESOLVED",
    "reasonCodes": [
      "CURRENTNESS_UNPROVEN"
    ],
    "workItems": [
      {
        "status": "UNRESOLVED",
        "reasonCodes": [
          "SEMANTIC_AMBIGUITY"
        ],
        "workType": {
          "sheetName": "ANALISA HARGA",
          "locator": "A5",
          "rowNumber": 5,
          "raw": "1.7.7.1.1.b (a)"
        },
        "methodName": {
          "sheetName": "ANALISA HARGA",
          "locator": "C5",
          "rowNumber": 5,
          "raw": "PEMASANGAN 1 M2 PLESTERAN DINDING"
        },
        "outputUnitRaw": null,
        "resolvedOutputUnit": null,
        "regulationReference": {
          "sheetName": "ANALISA HARGA",
          "locator": "K5",
          "rowNumber": 5,
          "raw": "AHSP PUPR NO. 1 Bidang Umum"
        },
        "effectiveDate": null,
        "sheetName": "ANALISA HARGA",
        "resources": [
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Pekerja",
            "rawCode": "L.01",
            "rawUnit": "OH",
            "coefficient": 0.4,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B10",
              "rowNumber": 10,
              "raw": "Pekerja"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E10",
              "rowNumber": 10,
              "raw": "L.01"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F10",
              "rowNumber": 10,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G10",
              "rowNumber": 10,
              "raw": "0.4"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          },
          {
            "status": "READY",
            "reasonCodes": [],
            "group": "LABOR",
            "rawName": "Mandor",
            "rawCode": "L.04",
            "rawUnit": "OH",
            "coefficient": 0.04,
            "nameEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "B11",
              "rowNumber": 11,
              "raw": "Mandor"
            },
            "codeEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "E11",
              "rowNumber": 11,
              "raw": "L.04"
            },
            "unitEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "F11",
              "rowNumber": 11,
              "raw": "OH"
            },
            "coefficientEvidence": {
              "sheetName": "ANALISA HARGA",
              "locator": "G11",
              "rowNumber": 11,
              "raw": "0.04"
            },
            "resolvedResourceCatalogId": null,
            "resolvedBaseUnit": null
          }
        ]
      }
    ]
  }
} as unknown as Record<
  | 'LEGACY_A_TITLE_ONLY'
  | 'LEGACY_B_TITLE_M2_SUMMARY_M3'
  | 'POSITIVE_TITLE_M3_SUPERSCRIPT_SUMMARY_M3'
  | 'LEGACY_C_CONTRADICTION_NOT_KEPT',
  AhspDocumentKnowledge
>;
