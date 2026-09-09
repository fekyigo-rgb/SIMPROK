/**
 * SIMPROK — Shared construction taxonomy vocabulary.
 *
 * ONE knowledge, many consumers. This is the single frontend home for the
 * construction classification vocabulary — Bidang/Kategori -> Subkategori ->
 * Jenis Pekerjaan — approved by the Owner. AHSP consumes it today; BOQ and
 * Basic Price pickers may import the same module later WITHOUT growing a
 * second vocabulary (the resource-family axis LABOR/MATERIAL/EQUIPMENT and
 * unit normalisation stay in simprokKamus.ts — a different, orthogonal axis).
 *
 * It is a curated CODE constant, not a governed table. The AHSP row columns
 * (fieldCategory / subCategory / classification / workType) remain free text
 * that carries "what the source states". This vocabulary only GUIDES entry and
 * filtering; it never overwrites or reinterprets a stored value, and it must
 * never HIDE an existing value that is not (yet) in the list — see
 * mergeVocabulary (the filter honesty law: unresolved is not "does not exist").
 *
 * Content source: Owner decision (task §3 Bidang, §4 Subkategori per Bidang,
 * §5 Jenis Pekerjaan). A Bidang the Owner did not enumerate with subcategories
 * intentionally carries no curated subcategory list (honest empty) rather than
 * an invented one.
 *
 * NOTE (faithful, not reconciled): the Owner's lists mix construction DOMAIN
 * (e.g. Transportasi) with Indonesian AUTHORITY/SECTOR (e.g. Bina Marga), and
 * some entries appear on both axes — "Bandar Udara" and "Pelabuhan" exist as
 * top-level Bidang AND as subcategories under "Transportasi & Perkeretaapian".
 * That overlap is the Owner's model, encoded verbatim here; the executor does
 * not collapse or reinterpret it (that is a soul/architecture call for the
 * Owner). See task §3's DOMAIN-vs-AUTHORITY note.
 */

/** Bidang / Kategori — Owner §3 baseline (first 5 + Umum) then the approved enrichment; "Lainnya" always last. */
export const BIDANG: readonly string[] = [
  'Bina Marga',
  'Cipta Karya',
  'Sumber Daya Air',
  'Perumahan & Permukiman',
  'Umum',
  'Prasarana Strategis',
  'Transportasi & Perkeretaapian',
  'Bandar Udara & Penerbangan',
  'Pelabuhan & Kemaritiman',
  'Energi & Ketenagalistrikan',
  'Telekomunikasi & Infrastruktur Digital',
  'Industri & Fasilitas Industri',
  'Pertambangan & Infrastruktur Tambang',
  'Lingkungan & Pengelolaan Limbah',
  'Pertanian & Infrastruktur Agrikultur',
  'Perkotaan & Infrastruktur Kota',
  'Kawasan / Pengembangan Wilayah',
  'Pertahanan & Infrastruktur Khusus',
  'Bangunan Umum & Komersial',
  'Lainnya',
];

/**
 * Subkategori per Bidang (Owner §4), keyed by the canonical Bidang label above.
 * Only the Bidang the Owner enumerated carry a curated list; every other Bidang
 * resolves to [] via subkategoriForBidang so the UI stays honest instead of
 * inventing subcategories.
 */
export const SUBKATEGORI_BY_BIDANG: Readonly<Record<string, readonly string[]>> = {
  'Bina Marga': [
    'Jalan', 'Jembatan', 'Terowongan', 'Interchange / Simpang Susun',
    'Struktur Jalan', 'Preservasi Jalan', 'Preservasi Jembatan',
    'Perlengkapan Jalan', 'Drainase Jalan',
  ],
  'Sumber Daya Air': [
    'Sungai', 'Pantai & Pesisir', 'Bendungan', 'Waduk', 'Embung', 'Danau',
    'Situ', 'Irigasi', 'Rawa', 'Tambak', 'Air Baku', 'Air Tanah',
    'Pengendalian Banjir', 'Pengamanan Pantai', 'Bangunan Hidraulik',
    'Konservasi SDA',
  ],
  'Cipta Karya': [
    'Air Minum', 'Sanitasi', 'Air Limbah', 'Drainase Lingkungan', 'Persampahan',
    'Bangunan Gedung', 'Kawasan Permukiman', 'Penataan Bangunan',
    'Infrastruktur Kawasan',
  ],
  'Perumahan & Permukiman': [
    'Rumah Tapak', 'Rumah Susun', 'Hunian Vertikal', 'Perumahan Sosial',
    'Perumahan Terjangkau', 'Kawasan Perumahan', 'Infrastruktur Perumahan',
    'PSU Perumahan', 'Kawasan Permukiman', 'Penataan Permukiman',
  ],
  'Prasarana Strategis': [
    'Pendidikan', 'Kesehatan', 'Perekonomian', 'Peribadatan', 'Olahraga',
    'Sosial Budaya', 'Pasar', 'Fasilitas Publik',
    'Infrastruktur Strategis Lainnya',
  ],
  'Transportasi & Perkeretaapian': [
    'Jalan', 'Kereta Api', 'MRT', 'LRT', 'BRT', 'Terminal', 'Stasiun', 'Depo',
    'Bandar Udara', 'Runway', 'Taxiway', 'Apron', 'Pelabuhan', 'Dermaga',
    'Terminal Penumpang', 'Terminal Barang',
  ],
  'Energi & Ketenagalistrikan': [
    'Pembangkit', 'Transmisi', 'Gardu Induk', 'Distribusi', 'Jaringan Listrik',
    'PLTA', 'PLTS', 'PLTB', 'PLTP', 'Oil & Gas', 'Pipeline', 'Fasilitas Energi',
  ],
  'Industri & Fasilitas Industri': [
    'Pabrik', 'Gudang', 'Workshop', 'Processing Plant', 'Manufacturing Facility',
    'Refinery', 'Chemical Plant', 'Data Center', 'Cold Storage',
    'Industrial Utilities',
  ],
  'Lingkungan & Pengelolaan Limbah': [
    'Persampahan', 'TPA', 'TPS', 'TPS3R', 'Pengolahan Limbah', 'IPAL',
    'Remediasi', 'Infrastruktur Lingkungan',
  ],
};

/** Jenis Pekerjaan — Owner §5. Real construction work types (never AHSP codes, never authority names). */
export const JENIS_PEKERJAAN: readonly string[] = [
  'Persiapan', 'Pembersihan Lahan', 'Tanah', 'Galian', 'Timbunan', 'Pemadatan',
  'Pondasi', 'Struktur', 'Beton', 'Baja', 'Dinding', 'Atap', 'Waterproofing',
  'Plesteran', 'Lantai', 'Plafon', 'Pintu & Jendela', 'Finishing', 'Jalan',
  'Perkerasan', 'Aspal', 'Drainase', 'Jembatan', 'Struktur Hidraulik', 'Irigasi',
  'Bangunan Air', 'Plumbing', 'Elektrikal', 'HVAC', 'Fire Protection',
  'Telekomunikasi', 'Landscape', 'Mekanikal', 'Instrumentasi', 'Pengujian',
  'Commissioning', 'Pemeliharaan', 'Rehabilitasi', 'Preservasi', 'Demolition',
];

/**
 * Context-aware Subkategori for a selected Bidang. Returns the curated list, or
 * [] for an unknown / unmapped / blank Bidang — an honest empty, never a guess.
 */
export function subkategoriForBidang(bidang: string | null | undefined): readonly string[] {
  if (!bidang) return [];
  return SUBKATEGORI_BY_BIDANG[bidang.trim()] ?? [];
}

/**
 * Filter honesty: the curated vocabulary FIRST (in curated order), then any
 * value actually present in the data that the curated list does not already
 * contain — so a real stored value is never hidden from a filter. Blank/nullish
 * present values are ignored; duplicates are removed; the appended data values
 * are sorted for a stable order.
 */
export function mergeVocabulary(
  curated: readonly string[],
  present: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of curated) {
    const value = item.trim();
    if (value !== '' && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  const extra: string[] = [];
  for (const item of present) {
    const value = (item ?? '').trim();
    if (value !== '' && !seen.has(value)) {
      seen.add(value);
      extra.push(value);
    }
  }
  extra.sort((a, b) => a.localeCompare(b, 'id'));
  return [...out, ...extra];
}
