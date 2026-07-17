import { BoqUnitCompatibilityService } from './boq-unit-compatibility.service';

describe('BoqUnitCompatibilityService', () => {
  const resolved = { status: 'RESOLVED', quantityFactor: '1', conversionRuleId: null, reasonCodes: [], sourceUnitDefinition: { id: 'u', code: 'M3' }, targetUnitDefinition: { id: 'u', code: 'M3' } };
  it('reports exact, convertible, review, and not-convertible without quantity arithmetic', async () => {
    const units = { resolve: jest.fn().mockResolvedValueOnce(resolved).mockResolvedValueOnce({ ...resolved, quantityFactor: '50', conversionRuleId: 'rule', priceOperation: 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR' }).mockResolvedValueOnce({ ...resolved, status: 'NEEDS_REVIEW' }).mockResolvedValueOnce({ ...resolved, status: 'NOT_CONVERTIBLE' }) };
    const service = new BoqUnitCompatibilityService(units as any);
    await expect(service.evaluate('M3', 'M3')).resolves.toMatchObject({ status: 'COMPATIBLE_EXACT' });
    await expect(service.evaluate('KG', 'SAK')).resolves.toMatchObject({ status: 'COMPATIBLE_CONVERTIBLE', quantityFactor: '50' });
    await expect(service.evaluate('M3', 'unknown')).resolves.toMatchObject({ status: 'NEEDS_REVIEW' });
    await expect(service.evaluate('M3', 'PERSON_DAY')).resolves.toMatchObject({ status: 'NOT_CONVERTIBLE' });
    await expect(service.evaluate(null, 'M3')).resolves.toMatchObject({ status: 'NEEDS_REVIEW', reasonCodes: ['AHSP_OUTPUT_UNIT_UNRESOLVED'] });
  });
});
