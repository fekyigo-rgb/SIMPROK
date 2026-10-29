import ExcelJS from 'exceljs';
import { BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';

describe('RAB-AUTO-05 explicit approved-BOQ AHSP reference ΓÇö not WBS inference', () => {
  async function file(
    options: {
      referenceHeader?: string;
      referenceCode?: string;
      withWbs?: boolean;
    } = {},
  ): Promise<Buffer> {
    const x = new ExcelJS.Workbook();
    const sheet = x.addWorksheet('RAB');
    sheet.addRow([
      'No',
      'Uraian Pekerjaan',
      'Volume',
      'Satuan',
      options.referenceHeader ?? 'Catatan',
    ]);
    sheet.addRow([
      options.withWbs === false ? null : '2.1',
      'Saluran U Pracetak Tipe DS 10A (140 cm x 140 cm dengan tutup)',
      1,
      'm',
      options.referenceCode ?? 'B.64',
    ]);
    return Buffer.from(await x.xlsx.writeBuffer());
  }

  it('keeps BOQ source WBS code distinct from explicitly labelled AHSP code', async () => {
    const parsed = await new BoqXlsxIntakeAdapter().parse(
      await file({
        referenceHeader: 'Kode AHSP',
      }),
      'boq.xlsx',
    );
    expect(parsed.rows[0].sourceCode).toBe('2.1');
    expect(parsed.rows[0].sourceAhspCode).toBe('B.64');
    expect(parsed.rows[0].errors).toEqual([]);
  });

  it('does NOT infer a code from an arbitrary note or a WBS column', async () => {
    const result = await new BoqXlsxIntakeAdapter().parse(
      await file({ referenceHeader: 'Catatan' }),
      'boq.xlsx',
    );
    expect(result.rows[0].sourceCode).toBe('2.1');
    expect(result.rows[0].sourceAhspCode).toBeNull();
  });

  it('retains unknown codes as source assertions, never silently maps them', async () => {
    const result = await new BoqXlsxIntakeAdapter().parse(
      await file({
        referenceHeader: 'Referensi AHSP',
        referenceCode: 'X.UNKNOWN',
      }),
      'boq.xlsx',
    );
    expect(result.rows[0].sourceAhspCode).toBe('X.UNKNOWN');
    expect(result.rows[0].errors).toEqual([]);
  });

  it('rejects a reference exceeding the storage contract', async () => {
    const result = await new BoqXlsxIntakeAdapter().parse(
      await file({
        referenceHeader: 'Kode AHSP',
        referenceCode: 'B'.repeat(129),
      }),
      'boq.xlsx',
    );
    expect(result.rows[0].errors).toContain('SOURCE_AHSP_REFERENCE_TOO_LONG');
  });

  it('does not map a WBS-like source code to AHSP even when no WBS column exists', async () => {
    const result = await new BoqXlsxIntakeAdapter().parse(
      await file({ withWbs: false, referenceHeader: 'Kode AHSP' }),
      'boq.xlsx',
    );
    expect(result.rows[0].sourceAhspCode).toBe('B.64');
    expect(result.rows[0].sourceCode).toBeNull();
  });
});
