import { buildPortableBoqXlsx } from '../../test/fixtures/boq-xlsx.fixture';
import { BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';

describe('BoqXlsxIntakeAdapter', () => {
  const adapter = new BoqXlsxIntakeAdapter();

  it('parses a portable hierarchy and excludes totals and source prices', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx(), 'portable.xlsx', 'RAB');
    expect(result.rows.map((row) => row.itemType)).toEqual(['FOLDER', 'WORK_ITEM', 'FOLDER', 'WORK_ITEM']);
    expect(result.rows[1]).toMatchObject({ description: 'Mobilisasi', quantityDecimalString: '1', unitRaw: 'LS', parentSourceReference: 'row:3' });
    expect(result.rows.some((row) => /total|profit|ppn/i.test(row.description))).toBe(false);
    expect(JSON.stringify(result.rows)).not.toContain('125000');
  });

  it('counts all fifteen scale violations but caps examples at ten', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ scaleViolations: 15 }), 'scale.xlsx', 'RAB');
    expect(result.sourceQuantityEvidence.rowsExceedingScale2).toBe(15);
    expect(result.sourceQuantityEvidence.examples).toHaveLength(10);
  });

  it('marks an invalid work-item quantity as a hard error', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ includeInvalid: true }), 'invalid.xlsx', 'RAB');
    expect(result.rows.find((row) => row.description === 'Item quantity invalid')?.errors).toContain('INVALID_QUANTITY');
  });

  it('marks a work item without a unit as a hard error', async () => {
    const result = await adapter.parse(await buildPortableBoqXlsx({ includeMissingUnit: true }), 'missing-unit.xlsx', 'RAB');
    expect(result.rows.find((row) => row.description === 'Item unit missing')?.errors).toContain('UNIT_REQUIRED');
  });
});
