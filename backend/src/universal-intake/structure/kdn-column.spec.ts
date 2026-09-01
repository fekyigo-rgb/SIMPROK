import { interpretKdnColumns } from './kdn-column';

const col = (columnNumber: number, headerText: string) => ({
  columnNumber,
  headerText,
});

describe('BP-KDN-01 column interpretation', () => {
  it('KDN-IMP-01 — a canonical KDN (%) heading is auto-mapped', () => {
    const decision = interpretKdnColumns([
      col(1, 'Nama Item'),
      col(2, 'Satuan'),
      col(3, 'Harga'),
      col(4, 'KDN (%)'),
    ]);
    expect(decision.status).toBe('ESTABLISHED');
    if (decision.status === 'ESTABLISHED') {
      expect(decision.column.columnNumber).toBe(4);
      expect(decision.column.headerText).toBe('KDN (%)');
      expect(decision.humanConfirmed).toBe(false);
    }
  });

  it('KDN-IMP-04 — LOCAL is not auto-established as KDN', () => {
    const decision = interpretKdnColumns([
      col(1, 'Nama Item'),
      col(2, 'Satuan'),
      col(3, 'Harga'),
      col(4, 'LOCAL'),
    ]);
    expect(decision.status).toBe('NEEDS_REVIEW');
    if (decision.status === 'NEEDS_REVIEW') {
      expect(decision.reason).toBe('AMBIGUOUS');
      expect(decision.candidates.map((c) => c.headerText)).toEqual(['LOCAL']);
    }
  });

  it('KDN-IMP-05 — no KDN column is ABSENT, never a guess from 0–100 values', () => {
    const decision = interpretKdnColumns([
      col(1, 'Nama Item'),
      col(2, 'Satuan'),
      col(3, 'Harga'),
      col(4, 'Diskon'),
    ]);
    expect(decision).toEqual({ status: 'ABSENT' });
  });

  it('multiple CLEAR KDN columns are a CONFLICT, never leftmost-wins', () => {
    const decision = interpretKdnColumns([
      col(4, 'KDN (%)'),
      col(8, 'Kandungan Dalam Negeri'),
    ]);
    expect(decision.status).toBe('NEEDS_REVIEW');
    if (decision.status === 'NEEDS_REVIEW') {
      expect(decision.reason).toBe('CONFLICT');
      expect(decision.candidates.map((c) => c.columnNumber)).toEqual([4, 8]);
    }
  });

  it('a human may confirm an AMBIGUOUS column; a CLEAR heading is not overridable', () => {
    const confirmed = interpretKdnColumns(
      [col(1, 'Nama'), col(2, 'Harga'), col(3, 'LOCAL')],
      3,
    );
    expect(confirmed.status).toBe('ESTABLISHED');
    if (confirmed.status === 'ESTABLISHED') {
      expect(confirmed.column.columnNumber).toBe(3);
      expect(confirmed.humanConfirmed).toBe(true);
    }

    const documented = interpretKdnColumns(
      [col(1, 'Nama'), col(2, 'KDN (%)'), col(3, 'LOCAL')],
      3,
    );
    expect(documented.status).toBe('ESTABLISHED');
    if (documented.status === 'ESTABLISHED') {
      expect(documented.column.columnNumber).toBe(2);
      expect(documented.humanConfirmed).toBe(false);
    }
  });

  it('one CLEAR heading plus weaker AMBIGUOUS headings stays ESTABLISHED on CLEAR', () => {
    const decision = interpretKdnColumns([
      col(1, 'Nama'),
      col(2, 'KDN (%)'),
      col(3, 'TKDN'),
      col(4, 'LOCAL'),
    ]);
    expect(decision.status).toBe('ESTABLISHED');
    if (decision.status === 'ESTABLISHED') {
      expect(decision.column.columnNumber).toBe(2);
      expect(decision.humanConfirmed).toBe(false);
    }
  });

  it('two CLEAR headings without a selection stay NEEDS_REVIEW CONFLICT', () => {
    const decision = interpretKdnColumns([
      col(4, 'KDN (%)'),
      col(8, 'Kandungan Dalam Negeri'),
    ]);
    expect(decision.status).toBe('NEEDS_REVIEW');
    if (decision.status === 'NEEDS_REVIEW') {
      expect(decision.reason).toBe('CONFLICT');
    }
  });

  it('two CLEAR headings plus a valid human selection are ESTABLISHED and humanConfirmed', () => {
    const decision = interpretKdnColumns(
      [col(4, 'KDN (%)'), col(8, 'Kandungan Dalam Negeri')],
      8,
    );
    expect(decision.status).toBe('ESTABLISHED');
    if (decision.status === 'ESTABLISHED') {
      expect(decision.column.columnNumber).toBe(8);
      expect(decision.humanConfirmed).toBe(true);
    }
  });

  it('one AMBIGUOUS heading plus a human selection is ESTABLISHED and humanConfirmed', () => {
    const decision = interpretKdnColumns([col(1, 'Nama'), col(3, 'LOCAL')], 3);
    expect(decision.status).toBe('ESTABLISHED');
    if (decision.status === 'ESTABLISHED') {
      expect(decision.column.columnNumber).toBe(3);
      expect(decision.humanConfirmed).toBe(true);
    }
  });

  it('a selected column that is not a KDN candidate is ignored', () => {
    const decision = interpretKdnColumns([col(1, 'Nama'), col(2, 'Harga')], 2);
    expect(decision).toEqual({ status: 'ABSENT' });
  });
});
