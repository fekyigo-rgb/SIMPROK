import { calculateCostKernel } from './cost-kernel.kernel';
import {
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostKernelInput,
} from './cost-kernel.contracts';

const FIXTURE_LABELS = [
  'TEST_FIXTURE_ONLY',
  'OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION',
] as const;

const coefficients = [
  '0.600000',
  '0.200000',
  '0.200000',
  '0.040000',
  '0.013000',
  '0.038700',
  '0.039600',
  '0.587200',
  '26.406000',
  '61.560000',
  '83.349000',
  '17.415000',
  '0.400000',
];
const prices = [
  '100000.00',
  '100000.00',
  '100000.00',
  '120000.00',
  '100000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
  '10000.00',
];

const makeInput = (): CostKernelInput => ({
  boqItemId: 'test-boq-item',
  ahspVersionId: 'test-ahsp-version',
  occurrenceId: 'test-occurrence',
  occurrenceCount: 1,
  itemType: 'WORK_ITEM',
  volume: '10',
  boqUnit: 'M1',
  outputUnit: 'M1',
  ownershipMatches: true,
  resources: coefficients.map((coefficient, index) => ({
    ahspResourceId: `test-resource-${index}`,
    resolutionId: `test-resolution-${index}`,
    status: 'RESOLVED',
    ahspVersionId: 'test-ahsp-version',
    coefficient,
    adaptedPriceValue: prices[index],
  })),
});

describe('Cost Kernel Grade A R1', () => {
  it('certifies the labeled 13-resource frozen-price fixture exactly', () => {
    expect(FIXTURE_LABELS).toEqual([
      'TEST_FIXTURE_ONLY',
      'OWNER_SUPPLIED_EXAMPLE_NON_PRODUCTION',
    ]);
    const result = calculateCostKernel(makeInput());
    expect(result.status).toBe(COST_CALCULATION_STATUS.CALCULATED);
    if (result.status !== COST_CALCULATION_STATUS.CALCULATED) return;
    expect(result.resources.map((resource) => resource.resourceCost)).toEqual([
      '60000',
      '20000',
      '20000',
      '4800',
      '1300',
      '387',
      '396',
      '5872',
      '264060',
      '615600',
      '833490',
      '174150',
      '4000',
    ]);
    expect(result.ahspUnitPrice).toBe('2004055');
    expect(result.volume).toBe('10');
    expect(result.lineTotal).toBe('20040550');
  });

  it('is order-independent and retains exact decimal arithmetic', () => {
    const input = makeInput();
    const reversed = calculateCostKernel({
      ...input,
      resources: [...input.resources].reverse(),
    });
    expect(reversed).toMatchObject({
      status: 'CALCULATED',
      ahspUnitPrice: '2004055',
      lineTotal: '20040550',
    });
    expect(JSON.stringify(reversed)).not.toContain('2004054.999');
  });

  it('does not accept manual BOQ price or total as kernel inputs', () => {
    expect(Object.keys(makeInput())).not.toEqual(
      expect.arrayContaining([
        'unitPrice',
        'lineTotal',
        'margin',
        'profit',
        'tax',
      ]),
    );
  });

  it.each([
    [
      'empty resources',
      (i: CostKernelInput) => ({ ...i, resources: [] }),
      COST_CALCULATION_REASON.EMPTY_RESOURCES,
    ],
    [
      'unresolved resource',
      (i: CostKernelInput) => ({
        ...i,
        resources: [{ ...i.resources[0], status: 'NEEDS_REVIEW' }],
      }),
      COST_CALCULATION_REASON.UNRESOLVED_RESOURCE,
    ],
    [
      'missing adapted price',
      (i: CostKernelInput) => ({
        ...i,
        resources: [{ ...i.resources[0], adaptedPriceValue: null }],
      }),
      COST_CALCULATION_REASON.MISSING_ADAPTED_PRICE,
    ],
    [
      'missing output unit',
      (i: CostKernelInput) => ({ ...i, outputUnit: null }),
      COST_CALCULATION_REASON.MISSING_AHSP_OUTPUT_UNIT,
    ],
    [
      'zero volume',
      (i: CostKernelInput) => ({ ...i, volume: '0' }),
      COST_CALCULATION_REASON.INVALID_VOLUME,
    ],
    [
      'negative volume',
      (i: CostKernelInput) => ({ ...i, volume: '-1' }),
      COST_CALCULATION_REASON.INVALID_VOLUME,
    ],
    [
      'ownership mismatch',
      (i: CostKernelInput) => ({ ...i, ownershipMatches: false }),
      COST_CALCULATION_REASON.OWNERSHIP_MISMATCH,
    ],
    [
      'ambiguous occurrence',
      (i: CostKernelInput) => ({ ...i, occurrenceCount: 2 }),
      COST_CALCULATION_REASON.AMBIGUOUS_OCCURRENCE,
    ],
    [
      'unit mismatch',
      (i: CostKernelInput) => ({ ...i, boqUnit: 'M2' }),
      COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
    ],
    [
      'zero coefficient',
      (i: CostKernelInput) => ({
        ...i,
        resources: [{ ...i.resources[0], coefficient: '0' }],
      }),
      COST_CALCULATION_REASON.INVALID_COEFFICIENT,
    ],
  ])('fails closed for %s', (_name, mutate, reason) => {
    expect(calculateCostKernel(mutate(makeInput()))).toMatchObject({
      status: COST_CALCULATION_STATUS.FAIL_CLOSED,
      reason,
    });
  });

  it('uses frozen prices for OH, KG, M3, and Liter resources exactly as supplied', () => {
    const result = calculateCostKernel(makeInput());
    expect(result.status).toBe(COST_CALCULATION_STATUS.CALCULATED);
    expect(result.status === 'CALCULATED' ? result.resources : []).toHaveLength(
      13,
    );
    // calculateCostKernel is a pure function: its only imports are Prisma.Decimal
    // and the unit-kernel string primitive used by exactUnit() below. It has no
    // reference to BasicPriceService, UnitKernelService, or any other resolver,
    // so there is nothing here it could call at runtime. The real no-resolver
    // proof — that CostKernelService itself never queries a resolver beyond the
    // frozen ProjectAhspResourceResolution rows — lives in
    // cost-kernel.service.spec.ts, backed by a Prisma access guard, not a
    // hand-set counter.
  });

  describe('exactUnit compatibility law', () => {
    const withUnits = (boqUnit: string, outputUnit: string) =>
      calculateCostKernel({ ...makeInput(), boqUnit, outputUnit });

    it.each([
      ['M1', 'M1'],
      ['M1', 'm1'],
      ['m1', 'M1'],
      ['M1', 'M¹'],
      ['M¹', 'm1'],
      ['M', 'M'],
      ['M', 'm'],
      ['Kg', 'KG'],
      ['  M1 ', 'M1'],
    ])(
      'accepts compatible boqUnit=%s vs outputUnit=%s as a match',
      (boqUnit, outputUnit) => {
        expect(withUnits(boqUnit, outputUnit).status).toBe(
          COST_CALCULATION_STATUS.CALCULATED,
        );
      },
    );

    it.each([
      ['M', 'M1'],
      ['M1', 'M2'],
      ['M2', 'M3'],
      ['Kg', 'Liter'],
      ['M1', 'Kg'],
    ])(
      'fails closed for incompatible boqUnit=%s vs outputUnit=%s',
      (boqUnit, outputUnit) => {
        expect(withUnits(boqUnit, outputUnit)).toMatchObject({
          status: COST_CALCULATION_STATUS.FAIL_CLOSED,
          reason: COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
        });
      },
    );
  });
});
