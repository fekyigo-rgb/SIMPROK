export type ResourceKategori = 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
export type WorkDomain =
  | 'GALIAN'
  | 'TIMBUNAN'
  | 'MOBILISASI'
  | 'DIREKSI_KEET'
  | 'ADMINISTRASI'
  | 'SMKK'
  | 'POMPA_DEWATERING'
  | 'LAINNYA';

const humanTokens = [
  'operator',
  'tukang',
  'sopir',
  'pekerja',
  'mandor',
  'kepala',
  'buruh',
  'helper',
];

const equipmentTokens = [
  'excavator',
  'exavator',
  'vibrator',
  'vibrator beton',
  'concrete vibrator',
  'dump truck',
  'truck',
  'molen',
  'concrete mixer',
  'pompa',
  'roller',
  'bulldozer',
  'crane',
  'mixer',
  'grader',
  'loader',
  'tandem',
];

const materialTokens = [
  'semen',
  'cement',
  'pasir',
  'sand',
  'batu',
  'split',
  'aggregate',
  'agregat',
  'besi',
  'baja',
  'steel',
  'rebar',
  'kayu',
  'timber',
  'tanah',
  'kerikil',
  'mortar',
  'kawat',
  'beton',
];

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hasToken = (value: string, tokens: string[]) =>
  tokens.some((token) => value.includes(normalizeText(token)));

const hasAny = (value: string, tokens: string[]) =>
  tokens.some((token) => value.includes(token));

export function klasifikasiResource(namaAsli: string): ResourceKategori | null {
  const normalized = normalizeText(namaAsli);
  if (!normalized) return null;

  const hasHuman = hasToken(normalized, humanTokens);
  const hasEquipment = hasToken(normalized, equipmentTokens);

  if (hasHuman) return 'LABOR';
  if (hasEquipment || normalized.startsWith('sewa ')) return 'EQUIPMENT';
  if (hasToken(normalized, materialTokens)) return 'MATERIAL';

  return null;
}

export function canonicalResourceName(namaAsli: string): string {
  const normalized = normalizeText(namaAsli)
    .replace(/\bexavator\b/g, 'excavator')
    .replace(/\bexcavtor\b/g, 'excavator')
    .replace(/\bconcreate\b/g, 'concrete')
    .replace(/\bvibraator\b/g, 'vibrator');

  if (normalized.includes('kepala tukang')) return 'tukang';
  if (normalized.includes('tukang batu')) return 'tukang batu';
  if (normalized.includes('tukang besi')) return 'tukang besi';
  if (normalized.includes('tukang kayu')) return 'tukang kayu';
  if (normalized.includes('tukang vibrator')) return 'tukang vibrator';
  if (normalized.includes('pekerja')) return 'pekerja';
  if (normalized.includes('mandor')) return 'mandor';
  if (normalized.includes('excavator')) return 'excavator';
  if (normalized.includes('dump truck')) return 'dump truck';
  if (normalized.includes('truck')) return 'truck';
  if (normalized.includes('crane')) return 'crane';
  if (normalized.includes('semen') || normalized.includes('cement')) return 'semen';
  if (normalized.includes('pasir')) return 'pasir';
  if (normalized.includes('tanah biasa')) return 'tanah biasa';
  if (normalized.includes('tanah berpasir')) return 'tanah berpasir';
  if (normalized.includes('tanah pilihan')) return 'tanah pilihan';
  if (normalized.includes('tanah')) return 'tanah';
  if (normalized.includes('kerikil') || normalized.includes('agregat') || normalized.includes('aggregate')) return 'kerikil';

  return normalized;
}

export function normalisasiSatuan(
  teks: string,
  konteks?: { kategori?: ResourceKategori | null; dimensi?: 'LUAS' | 'PANJANG' },
): string | null {
  const original = teks.trim();
  if (!original) return null;

  const compact = original
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/¹/g, '1')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const loose = compact.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const noSpace = loose.replace(/\s+/g, '');
  const kategori = konteks?.kategori ?? null;

  if (['oh', 'orghari', 'oranghari', 'hok', 'hariorang', 'orgh', 'orghri', 'o/h'.replace('/', '')].includes(noSpace)) return 'OH';
  if (['oj', 'orgjam', 'orangjam', 'jamorang', 'orgjm', 'o/j'.replace('/', '')].includes(noSpace)) return 'OJ';
  if (['ob', 'orgbulan', 'orangbulan', 'orgbln', 'o/b'.replace('/', '')].includes(noSpace)) return 'OB';

  if (['uj', 'unitjam', 'unitperjam'].includes(noSpace)) {
    return kategori === 'EQUIPMENT' ? 'JAM' : null;
  }

  if (['jamalat'].includes(noSpace)) return kategori === 'LABOR' ? null : 'JAM';
  if (['jam', 'j'].includes(noSpace)) return kategori === 'LABOR' ? null : 'JAM';

  if (['m3', 'meterkubik'].includes(noSpace)) return 'M3';
  if (['m2', 'meterpersegi'].includes(noSpace)) return 'M2';
  if (["m'", 'm1', 'meter', 'meterpanjang'].includes(compact) || ['m1', 'meter', 'meterpanjang'].includes(noSpace)) return 'M1';
  if (noSpace === 'm') {
    if (konteks?.dimensi === 'LUAS') return 'M2';
    if (konteks?.dimensi === 'PANJANG') return 'M1';
    return null;
  }

  if (['kg', 'kilogram'].includes(noSpace)) return 'KG';
  if (['ton', 't'].includes(noSpace)) return 'TON';
  if (['sak', 'zak'].includes(noSpace)) return 'SAK';
  if (['bh', 'buah', 'unit', 'u'].includes(noSpace)) return 'BH';
  if (['ls', 'lumpsum'].includes(noSpace) || loose === 'lump sum') return 'LS';
  if (noSpace === 'set') return 'SET';

  return null;
}

export function klasifikasiDomainPekerjaan(teks: string): WorkDomain {
  const normalized = normalizeText(teks);
  if (!normalized) return 'LAINNYA';

  if (hasAny(normalized, ['mobilisasi', 'demobilisasi'])) return 'MOBILISASI';
  if (hasAny(normalized, ['direksi keet', 'los kerja', 'gudang']) || /\bkantor\b/.test(normalized)) return 'DIREKSI_KEET';
  if (hasAny(normalized, ['smkk', 'rk3k', 'rmpk', 'rkk', 'rkppl', 'rmllp'])) return 'SMKK';
  if (hasAny(normalized, ['administrasi', 'dokumentasi', 'laporan', 'dokumen proyek'])) return 'ADMINISTRASI';
  if (hasAny(normalized, ['pompa', 'pumping', 'dewatering', 'discharge', 'suction'])) return 'POMPA_DEWATERING';

  if (
    hasAny(normalized, [
      'timbunan',
      'menimbun',
      'pemadatan tanah',
      'penghamparan',
      'sirtu',
      'tanah pilihan',
      'fill',
      'embankment',
    ])
  ) {
    return 'TIMBUNAN';
  }

  if (
    hasAny(normalized, [
      'menggali',
      'penggalian',
      'galian',
      'excavation',
      'tanah biasa dari hasil galian',
      'tanah biasa dari sp hasil galian',
    ]) ||
    /\bgali\b/.test(normalized)
  ) {
    return 'GALIAN';
  }

  return 'LAINNYA';
}

export function cekKecocokanDomain(boqName: string, ahspName: string) {
  const boqDomain = klasifikasiDomainPekerjaan(boqName);
  const ahspDomain = klasifikasiDomainPekerjaan(ahspName);
  const compatible = boqDomain !== 'LAINNYA' && boqDomain === ahspDomain;

  if (compatible) {
    return {
      compatible,
      boqDomain,
      ahspDomain,
      reason: `Domain cocok: BOQ ${boqDomain} dan AHSP ${ahspDomain}.`,
    };
  }

  if (boqDomain === 'LAINNYA' || ahspDomain === 'LAINNYA') {
    return {
      compatible,
      boqDomain,
      ahspDomain,
      reason: 'Domain pekerjaan perlu konfirmasi manusia.',
    };
  }

  return {
    compatible,
    boqDomain,
    ahspDomain,
    reason: `DOMAIN_MISMATCH: BOQ ${boqDomain} tidak cocok dengan AHSP ${ahspDomain}.`,
  };
}
