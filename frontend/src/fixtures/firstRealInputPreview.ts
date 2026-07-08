export const firstRealInputPreview = {
  "basicPrices": [
    {
      "code": "BP-9",
      "name": "Pekerja",
      "type": "LABOR",
      "unit": "Org/Hari",
      "price": 158333.33333333334
    },
    {
      "code": "BP-10",
      "name": "Tukang",
      "type": "LABOR",
      "unit": "Org/Hari",
      "price": 208333.33333333334
    },
    {
      "code": "BP-11",
      "name": "Tukang Batu",
      "type": "LABOR",
      "unit": "Org/Hari",
      "price": 208333.33333333334
    }
  ],
  "ahspAnalyses": [
    {
      "code": "A",
      "name": "Tenaga Kerja",
      "workType": "Pekerjaan",
      "unit": "ls",
      "components": [
        {
          "resourceName": "Pekerja",
          "resourceType": "LABOR",
          "coefficient": 0.4,
          "baseUnit": "OH"
        },
        {
          "resourceName": "Mandor",
          "resourceType": "LABOR",
          "coefficient": 0.04,
          "baseUnit": "OH"
        }
      ]
    },
    {
      "code": "A",
      "name": "Tenaga Kerja",
      "workType": "Pekerjaan",
      "unit": "ls",
      "components": [
        {
          "resourceName": "Pekerja",
          "resourceType": "LABOR",
          "coefficient": 0.3087,
          "baseUnit": "OJ"
        },
        {
          "resourceName": "Mandor",
          "resourceType": "LABOR",
          "coefficient": 0.030869999999999998,
          "baseUnit": "OJ"
        },
        {
          "resourceName": "Exavator (Standar) - 125 HP",
          "resourceType": "MATERIAL",
          "coefficient": 0.1224,
          "baseUnit": "Jam"
        }
      ]
    }
  ],
  "boqItems": [
    {
      "wbsCode": "1",
      "name": "Mobilisasi dan Demobilisasi",
      "unit": "LS",
      "quantity": 1
    },
    {
      "wbsCode": "2",
      "name": "Pembuatan 1 m2 direksi keet (Kantor), los kerja dan gudang",
      "unit": "m2",
      "quantity": 36
    },
    {
      "wbsCode": "3",
      "name": "Administrasi Proyek, Dokumentasi dan Lain-Lain",
      "unit": "LS",
      "quantity": 1
    },
    {
      "wbsCode": "4",
      "name": "Pengoperasian 1 Buah pompa air per-Jam kapasitas 10 L\\/s pada head suction 3 m dan discharge 10 m1, Dia. out 4inch",
      "unit": "Jam",
      "quantity": 843
    },
    {
      "wbsCode": "1",
      "name": "Pembuatan dokumen SMKK (RKK, RMPK, RKPPL, RMLLP)",
      "unit": "Set",
      "quantity": 2
    }
  ],
  "matches": [
    {
      "type": "AHSP_TO_BASIC_PRICE",
      "from": "Pekerja",
      "to": "Pekerja",
      "confidence": "MEDIUM"
    },
    {
      "type": "AHSP_TO_BASIC_PRICE",
      "from": "Pekerja",
      "to": "Pekerja",
      "confidence": "MEDIUM"
    }
  ],
  "warnings": []
};

export const fixtureMetadata = {
  sourceFile: "BASIC PRICE(1).xlsx, AHSP ok(1).xlsx, BOQ(1).xlsx",
  sourceSheet: "Sheet1 (auto-detected)",
  isPreviewOnly: true,
  notSavedToDatabase: true,
  warnings: firstRealInputPreview.warnings
};