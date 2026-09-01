import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

const adapter = new BasicPriceUniversalIntakeAdapter();

const csv = (header: string, ...rows: string[]) =>
  Buffer.from(
    ['resource_name,source_unit,harga satuan,' + header, ...rows, ''].join(
      '\r\n',
    ),
    'utf8',
  );

const parse = (bytes: Buffer, selection: { selectedKdnColumn?: number } = {}) =>
  adapter.parse(testEnvelope(bytes, 'kdn.csv'), {
    declaredSection: 'MATERIAL',
    ...selection,
  });

describe('BP-KDN-01 intake pipeline', () => {
  it('KDN-IMP-01/VAL-01/FLOW-03 — canonical heading maps and 72.5 becomes 72.50', async () => {
    const knowledge = await parse(csv('KDN (%)', 'Pasir KDN,M3,398000,72.5'));
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    expect(knowledge.rows).toHaveLength(1);
    expect(knowledge.rows[0].proposedCanonicalPrice).toBe('398000.00');
    expect(knowledge.rows[0].proposedCanonicalKdn).toBe('72.50');
    expect(knowledge.rows[0].kdnReasonCode).toBeNull();
    expect(knowledge.rows[0].sourceKdnHeaderText).toBe('KDN (%)');
    expect(knowledge.rows[0].sourceKdnCellAddress).toMatch(/^R\d+C4$/);
    expect(knowledge.interpretation?.kdnColumn ?? null).toBeNull();
  });

  it('KDN-IMP-02 — alias KDN is detected', async () => {
    const knowledge = await parse(csv('KDN', 'Semen,Zak,68500,80'));
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    expect(knowledge.rows[0].proposedCanonicalKdn).toBe('80.00');
  });

  it('KDN-IMP-03 — Kandungan Dalam Negeri is detected', async () => {
    const knowledge = await parse(
      csv('Kandungan Dalam Negeri', 'Besi,Kg,15000,"92,5%"'),
    );
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    expect(knowledge.rows[0].proposedCanonicalKdn).toBe('92.50');
  });

  it('KDN-IMP-04 — LOCAL is not auto-established as KDN', async () => {
    const knowledge = await parse(csv('LOCAL', 'Pasir,M3,398000,72.5'));
    expect(knowledge.kdnMapping.status).toBe('NEEDS_REVIEW');
    if (knowledge.kdnMapping.status === 'NEEDS_REVIEW') {
      expect(knowledge.kdnMapping.reason).toBe('AMBIGUOUS');
      expect(knowledge.kdnMapping.candidates[0].headerText).toBe('LOCAL');
    }
    expect(knowledge.rows[0].proposedCanonicalKdn).toBeNull();
    expect(knowledge.rows[0].proposedCanonicalPrice).toBe('398000.00');
    expect(knowledge.rows[0].rawSourceContext).toMatchObject({ LOCAL: '72.5' });
  });

  it('KDN-IMP-05 / FLOW-01 — no KDN column does not block a lawful price', async () => {
    const knowledge = await parse(
      Buffer.from(
        [
          'resource_name,source_unit,harga satuan,sumber',
          'Pasir,M3,398000,Survei',
          '',
        ].join('\r\n'),
        'utf8',
      ),
    );
    expect(knowledge.kdnMapping.status).toBe('ABSENT');
    expect(knowledge.rows[0].proposedCanonicalPrice).toBe('398000.00');
    expect(knowledge.rows[0].proposedCanonicalKdn).toBeNull();
    expect(knowledge.rows[0].kdnReasonCode).toBeNull();
  });

  it('KDN-VAL-04/06 — stated zero is a fact; blank is unknown', async () => {
    const knowledge = await parse(
      csv('KDN (%)', 'Nol,M3,1000,0', 'Kosong,M3,2000,'),
    );
    const zero = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Nol',
    )!;
    const blank = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Kosong',
    )!;
    expect(zero.proposedCanonicalKdn).toBe('0.00');
    expect(blank.proposedCanonicalKdn).toBeNull();
    expect(blank.kdnReasonCode).toBeNull();
  });

  it('KDN-FLOW-02 — invalid KDN is isolated; the price row continues', async () => {
    const knowledge = await parse(
      csv(
        'KDN (%)',
        'Valid,M3,1000,72.5',
        'Tinggi,M3,2000,130',
        'Kata,M3,3000,tinggi',
      ),
    );
    expect(knowledge.rows).toHaveLength(3);
    const valid = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Valid',
    )!;
    const tinggi = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Tinggi',
    )!;
    const kata = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Kata',
    )!;
    expect(valid.proposedCanonicalKdn).toBe('72.50');
    expect(valid.proposedCanonicalPrice).toBe('1000.00');
    expect(tinggi.proposedCanonicalKdn).toBeNull();
    expect(tinggi.kdnReasonCode).toBe('KDN_OUT_OF_RANGE');
    expect(tinggi.proposedCanonicalPrice).toBe('2000.00');
    expect(kata.proposedCanonicalKdn).toBeNull();
    expect(kata.kdnReasonCode).toBe('KDN_NOT_NUMERIC');
    expect(kata.proposedCanonicalPrice).toBe('3000.00');
  });

  it('KDN-DOM-01/03 — the knowledge object never says TKDN and never folds KDN into money', async () => {
    const knowledge = await parse(csv('KDN (%)', 'Pasir,M3,398000,72.5'));
    const serialised = JSON.stringify(knowledge);
    expect(serialised).not.toContain('TKDN');
    expect(knowledge.rows[0].proposedCanonicalPrice).toBe('398000.00');
    expect(knowledge.rows[0].proposedCanonicalKdn).toBe('72.50');
  });

  it('a human may confirm LOCAL; confirming does not fail-stop other rows', async () => {
    const knowledge = await parse(
      csv('LOCAL', 'Pasir,M3,398000,40', 'Semen,Zak,1000,'),
      {
        selectedKdnColumn: 4,
      },
    );
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    expect(knowledge.interpretation?.kdnColumn).toBe(4);
    expect(knowledge.rows[0].proposedCanonicalKdn).toBe('40.00');
    expect(knowledge.rows[1].proposedCanonicalKdn).toBeNull();
    expect(knowledge.rows[1].proposedCanonicalPrice).toBe('1000.00');
  });

  it('KDN-IMP-01 on a sectioned workbook — the NO-header overlay maps column H', async () => {
    const knowledge = await adapter.parse(
      testEnvelope(
        await buildBasicPriceXlsx({ includeKdnColumn: true }),
        'kdn.xlsx',
      ),
    );
    expect(knowledge.kdnMapping.status).toBe('ESTABLISHED');
    const pekerja = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Pekerja',
    )!;
    const kawat = knowledge.rows.find(
      (row) => row.rawResourceNameText === 'Kawat jaring',
    )!;
    expect(pekerja.proposedCanonicalKdn).toBe('72.50');
    expect(pekerja.proposedCanonicalPrice).toBe('100000.00');
    expect(pekerja.sourceKdnHeaderText).toBe('KDN (%)');
    expect(kawat.proposedCanonicalKdn).toBeNull();
    expect(kawat.kdnReasonCode).toBeNull();
  });
});
