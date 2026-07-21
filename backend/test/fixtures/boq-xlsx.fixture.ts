import ExcelJS from 'exceljs';

export async function buildPortableBoqXlsx(options: { scaleViolations?: number; includeInvalid?: boolean; includeMissingUnit?: boolean } = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('RAB');
  sheet.getCell('B1').value = 'Uraian Pekerjaan';
  sheet.getCell('E1').value = 'Satuan';
  sheet.getCell('F1').value = 'Volume';
  sheet.addRow([]);
  sheet.addRow(['I', 'PEKERJAAN PERSIAPAN']);
  sheet.addRow(['1', 'Mobilisasi', '', '', 'LS', '1', 125000, 125000]);
  sheet.addRow(['II', 'PEKERJAAN TANAH']);
  sheet.addRow(['2', 'Galian tanah', '', '', 'm3', '12', 999999, 11999988]);
  for (let index = 0; index < (options.scaleViolations ?? 0); index += 1) {
    sheet.addRow([`S${index + 1}`, `Item skala ${index + 1}`, '', '', 'm', `1.${String(index).padStart(3, '0')}`, 1, 1]);
  }
  if (options.includeInvalid) sheet.addRow(['Z', 'Item quantity invalid', '', '', 'kg', 'bukan-angka', 1, 1]);
  if (options.includeMissingUnit) sheet.addRow(['Z2', 'Item unit missing', '', '', '', '1', 1, 1]);
  sheet.addRow(['', 'Total RAB']);
  sheet.addRow(['', 'Profit']);
  sheet.addRow(['', 'PPN']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
