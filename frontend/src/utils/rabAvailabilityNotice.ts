import type { AhspResolutionWire } from './ahspCompositionDisplay.ts';

/**
 * RAB-AUTO-01 — a read-only, exception-first presenter, NOT an AHSP matcher,
 * Resource Identity resolver or Basic Price eligibility authority.
 *
 * Only source-level reason codes delivered by the stored AHSP occurrence may
 * establish that a Basic Price is absent/expired. Never infer it from an
 * unpriced Cost Kernel line or a resource name.
 */
const PRICE_GAP_CODES = new Set([
  'NO_BASIC_PRICE_CANDIDATE',
  'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
]);

export interface RabBasicPriceException {
  readonly component: string;
  readonly explanation: string;
}

export interface RabBasicPriceNotice {
  readonly title: string;
  readonly message: string;
  readonly missing: readonly RabBasicPriceException[];
}

/** Empty/not-read response is NOT proof that Basic Price does not exist. */
export function describeAhspBasicPriceGaps(
  ahspLinked: boolean,
  resolutions: readonly AhspResolutionWire[] | null | undefined,
): RabBasicPriceNotice | null {
  if (!ahspLinked || !Array.isArray(resolutions) || resolutions.length === 0) return null;

  const missing = resolutions.flatMap((row): RabBasicPriceException[] => {
    if (row.status === 'RESOLVED') return [];
    const codes: readonly string[] = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
    const code = codes.find((candidate) => PRICE_GAP_CODES.has(candidate));
    if (!code) return [];
    return [{
      component: row.rawAhspResourceRef?.trim() || 'Komponen tanpa nama',
      explanation: code === 'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES'
        ? 'Harga dasar yang ditemukan sudah kedaluwarsa untuk konteks perhitungan.'
        : 'Belum ada Basic Price yang sah untuk konteks pekerjaan, wilayah, tanggal, dan satuan ini.',
    }];
  });

  if (missing.length === 0) return null;
  return {
    title: 'AHSP tersedia — harga komponen belum lengkap',
    message: `${missing.length} komponen AHSP belum mempunyai Basic Price yang dapat dipakai. SIMPROK tidak akan mengisi harga dengan Rp0 atau harga perkiraan tanpa persetujuan.`,
    missing,
  };
}

export type AhspSearchEvidence =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'ready';
      query: string;
      fetchedCount: number;
      hasNext: boolean;
      recommendedCount: number;
    };

export interface RabAhspAvailabilityNotice {
  readonly title: string;
  readonly message: string;
}

/**
 * Search results are paged and lexical: an empty search is NOT proof that no
 * suitable AHSP exists in the catalog. A recommended row is NOT identity proof.
 */
export function describeAhspAvailability(
  ahspLinked: boolean,
  search: AhspSearchEvidence,
): RabAhspAvailabilityNotice | null {
  if (ahspLinked) return null;
  if (search.kind === 'idle') return {
    title: 'AHSP belum terhubung',
    message: 'SIMPROK belum membuktikan kecocokan AHSP untuk baris ini. Katalog belum diperiksa secara menyeluruh.',
  };
  if (search.kind === 'loading') return {
    title: 'Sedang memeriksa kandidat AHSP',
    message: 'Belum dapat dipastikan apakah AHSP yang sesuai tersedia.',
  };
  if (search.kind === 'error') return {
    title: 'Ketersediaan AHSP belum dapat diperiksa',
    message: 'Pencarian tidak berhasil; ini bukan bukti bahwa AHSP tidak tersedia.',
  };

  const scope = search.query.trim()
    ? `untuk pencarian "${search.query.trim()}"`
    : 'pada hasil katalog yang diperiksa';
  if (search.fetchedCount === 0) return {
    title: 'Belum ditemukan kandidat AHSP',
    message: `Tidak ada AHSP yang muncul ${scope}. Coba uraian atau kode lain; hasil kosong tidak membuktikan seluruh katalog tidak memiliki AHSP yang cocok.`,
  };
  if (search.recommendedCount === 0) return {
    title: 'AHSP ada, kecocokannya belum terbukti',
    message: `Ditemukan ${search.fetchedCount} kandidat ${scope}, tetapi belum ada rekomendasi yang cocok. ${search.hasNext ? 'Masih ada halaman kandidat lain.' : 'Pencarian ini belum membuktikan ketidaktersediaan AHSP di seluruh katalog.'}`,
  };
  return {
    title: 'Kandidat AHSP ditemukan — belum diputuskan',
    message: `${search.recommendedCount} dari ${search.fetchedCount} kandidat yang dimuat direkomendasikan. Rekomendasi bukan bukti identitas; SIMPROK belum boleh menghubungkan AHSP secara otomatis.`,
  };
}
