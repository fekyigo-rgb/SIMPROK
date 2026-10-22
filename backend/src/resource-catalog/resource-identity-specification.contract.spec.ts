import {
  compareConfirmedSpecifications,
  confirmedSpecifications,
} from './resource-identity-specification.contract';

describe('PR205 specification authority contract — optional, symmetric and fail-closed', () => {
  it('SPEC-A: absent is UNKNOWN, never an identity claim', () => {
    expect(confirmedSpecifications(null)).toBeNull();
    expect(confirmedSpecifications({})).toBeNull();
    expect(compareConfirmedSpecifications({ merek: 'Shimizu' }, null)).toBe('UNKNOWN');
  });
  it('SPEC-B: same proven brand/model gives a match irrespective of input order and letter case', () => {
    expect(confirmedSpecifications({ Brand: ' Shimizu ', model: 'PS-128' })).toEqual({
      merek: 'Shimizu', tipe: 'PS-128',
    });
    expect(compareConfirmedSpecifications({ merek: 'Shimizu', tipe: 'PS-128' }, {
      tipe: 'ps-128', merek: 'SHIMIZU',
    })).toBe('MATCH');
  });
  it('SPEC-C: positive differences on same key are a conflict, regardless of equal raw name', () => {
    expect(compareConfirmedSpecifications({ merek: 'Shimizu', tipe: 'PS-128' }, {
      merek: 'Panasonic', tipe: 'PS-128',
    })).toBe('CONFLICT');
  });
  it('SPEC-D: unprovided attribute and different attribute labels are UNKNOWN, not equivalent or different', () => {
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { ukuran: '50x70 mm' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { ukuran: '5/10 cm' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { dimensi: '50x70 mm' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ merek: 'Shimizu' }, { merek: 'Shimizu', tipe: 'PS-128' })).toBe('UNKNOWN');
  });
  it('SPEC-E: never admit unsupported fields, structural values, empty values or contradictory aliases', () => {
    expect(confirmedSpecifications({ status: 'APPROVED' })).toBeNull();
    expect(confirmedSpecifications({ merek: { text: 'A' } })).toBeNull();
    expect(confirmedSpecifications({ merek: '' })).toBeNull();
    expect(confirmedSpecifications({ merek: 'A', brand: 'B' })).toBeNull();
  });
});
