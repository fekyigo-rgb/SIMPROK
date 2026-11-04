import { projectReviewedCapacity } from './basic-price-reviewed-capacity.projection';

describe('GATE 1 reviewed capacity projection — one audited source of truth', () => {
  it('separates bucket volume, payload and engine power without conversions', () => {
    expect(projectReviewedCapacity({
      kapasitas: 'Kapasitas bak: 5,2 m³; Daya angkut: 35 ton; Daya mesin: 120 kW',
    })).toEqual({
      status: 'STRUCTURED',
      facts: [
        { kind: 'Kapasitas bak', value: '5,2', unit: 'm³' },
        { kind: 'Daya angkut', value: '35', unit: 'ton' },
        { kind: 'Daya mesin', value: '120', unit: 'kW' },
      ],
    });
  });
  it('roundtrips reviewed bucket, speed, vibration and motor data using the EXISTING decision',()=>{
    expect(projectReviewedCapacity({kapasitas:
      'Kapasitas bucket: 0,8 m³; Kecepatan: 18 km/jam; '+
      'Frekuensi tumbukan: 650 tumbukan/menit; Putaran mesin: 1800 rpm; '+
      'Percepatan: 9,8 m/s²; Daya mesin: 120 HP'
    })).toEqual({status:'STRUCTURED',facts:[
      {kind:'Kapasitas bucket',value:'0,8',unit:'m³'},
      {kind:'Kecepatan',value:'18',unit:'km/jam'},
      {kind:'Frekuensi tumbukan',value:'650',unit:'tumbukan/menit'},
      {kind:'Putaran mesin',value:'1800',unit:'rpm'},
      {kind:'Percepatan',value:'9,8',unit:'m/s²'},
      {kind:'Daya mesin',value:'120',unit:'HP'},
    ]});
    for(const unit of ['m/s','m/menit','m/jam','km/jam']){
      expect(projectReviewedCapacity({kapasitas:'Kecepatan: 3 '+unit}))
        .toEqual({status:'STRUCTURED',facts:[{kind:'Kecepatan',value:'3',unit}]});
    }
    expect(projectReviewedCapacity({kapasitas:'Kapasitas bucket: 3 ton'}))
      .toEqual({status:'UNPARSED',facts:[]});
    expect(projectReviewedCapacity({kapasitas:'Daya angkut: 3 liter'}))
      .toEqual({status:'UNPARSED',facts:[]});
    expect(projectReviewedCapacity({kapasitas:'Frekuensi tumbukan: 4 km/jam'}))
      .toEqual({status:'UNPARSED',facts:[]});
    expect(projectReviewedCapacity({kapasitas:'Kecepatan: 30 Hz'}))
      .toEqual({status:'UNPARSED',facts:[]});
  });
  it('does not infer technical capabilities from an absent decision', () => {
    expect(projectReviewedCapacity(null)).toEqual({ status: 'ABSENT', facts: [] });
    expect(projectReviewedCapacity({ merek: 'Hino' })).toEqual({ status: 'ABSENT', facts: [] });
  });
  it.each([
    'Kapasitas bak: 5,2 m³; Kapasitas bak: 7 m³',
    'Kapasitas bak: 5,2 ton',
    'Kapasitas bak: 5,2 m³; Dump Truck kapasitas standar 7m3',
    'Kapasitas bak: 1.000 m³',
    'Daya mesin: 120 kWh',
    'Kapasitas bak: lima m³',
    'Kapasitas bak: 5,2 m³;',
  ])('keeps uncertain/ambiguous reviewed text non-numeric: %s', value => {
    expect(projectReviewedCapacity({ kapasitas: value })).toEqual({
      status: 'UNPARSED', facts: [],
    });
  });
  it('accepts a reviewed custom type without inventing its meaning', () => {
    expect(projectReviewedCapacity({ kapasitas: 'Kapasitas pompa: 12,5 liter/jam' })).toEqual({
      status: 'STRUCTURED',
      facts: [{ kind: 'Kapasitas pompa', value: '12,5', unit: 'liter/jam' }],
    });
  });
  it('does not parse more than the bounded six rows', () => {
    const seven = Array.from({length: 7}, (_, i) => 'Besar ' + i + ': 1 kg').join('; ');
    expect(projectReviewedCapacity({ kapasitas: seven })).toEqual({
      status: 'UNPARSED', facts: [],
    });
  });
});
