import ExcelJS from 'exceljs';

/**
 * In-memory AHSP analisa layout for negative/unit tests.
 * Not a copy of Owner business data. Columns are bound by HEADER TEXT in
 * production; this fixture uses the same captions the official Permen layout
 * writes, not B1B12 column letters.
 */
export async function buildAhspAnalisaXlsx(
  mutate?: (sheet: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ANALISA HARGA');
  sheet.getCell('A1').value = 'ANALISA HARGA SATUAN UNTUK PENAWARAN';
  sheet.getCell('A3').value = 'BERDSARAKAN PERMEN PUPR NO. 1 THN 2022';
  sheet.getCell('A5').value = '1.7.7.1.1.b (a)';
  sheet.getCell('C5').value =
    'Penggalian 1 m3 tanah biasa sedalam s.d. 1 m untuk volume > 2000 m3';
  sheet.getCell('K5').value = 'AHSP PUPR NO. 1 Bidang Umum';
  sheet.getCell('A6').value = 'No.';
  sheet.getCell('B6').value = 'Uraian';
  sheet.getCell('E6').value = 'Kode';
  sheet.getCell('F6').value = 'Satuan';
  sheet.getCell('G6').value = 'Koefisien';
  sheet.getCell('H6').value = 'Harga Satuan';
  sheet.getCell('A9').value = 'A';
  sheet.getCell('B9').value = 'Tenaga Kerja';
  sheet.getCell('A10').value = 1;
  sheet.getCell('B10').value = 'Pekerja';
  sheet.getCell('E10').value = 'L.01';
  sheet.getCell('F10').value = 'OH';
  sheet.getCell('G10').value = 0.4;
  sheet.getCell('A11').value = 2;
  sheet.getCell('B11').value = 'Mandor';
  sheet.getCell('E11').value = 'L.04';
  sheet.getCell('F11').value = 'OH';
  sheet.getCell('G11').value = 0.04;
  sheet.getCell('A13').value = 'B';
  sheet.getCell('B13').value = 'Bahan';
  sheet.getCell('A15').value = 'C';
  sheet.getCell('B15').value = 'Peralatan';
  sheet.getCell('A21').value = 'F';
  sheet.getCell('B21').value = 'Harga Satuan Pekerjaan per - m3 (D+E)';
  if (mutate) mutate(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
