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
  | { kind: 'eligible_catalog_empty' }
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
 * Read-only discovery anchor: narrowing the EXISTING server search is not an
 * AHSP identity verdict. The server matches a contiguous substring of a
 * single AHSP code/workType/methodName field (q length <= 120), not the whole
 * BOQ's specifications. For an explicitly stated product/type code such as
 * "DS 10A" or "K-250", prefer that code over generic opening words. This
 * improves candidate recall, NOT authority or equivalence; dimensions and
 * accessory requirements remain independent hard constraints.
 */
export const ahspDiscoveryAnchor = (boqName: string): string | null => {
  const normalized = boqName.trim();
  const explicitTypeCode = normalized.match(/\b[A-Z]{1,5}[ -]?\d{1,4}[A-Z]?\b/);
  const query = (explicitTypeCode?.[0] ??
    normalized.split(/\s+/).slice(0, 3).join(' ')).slice(0, 120).trim();
  return query.length >= 2 ? query : null;
};

/** Read ONLY the count/recommendation metadata published by the existing API. */
export const ahspDiscoveryEvidence = (
  payload: unknown,
  query: string,
): AhspSearchEvidence | null => {
  if (!payload || typeof payload !== 'object') return null;
  const response = payload as { items?: unknown; hasNext?: unknown };
  if (!Array.isArray(response.items) || typeof response.hasNext !== 'boolean') return null;
  if (!response.items.every((v: unknown) => v && typeof v === 'object'
    && typeof (v as { id?: unknown }).id === 'string')) return null;
  return {
    kind: 'ready',
    query,
    fetchedCount: response.items.length,
    hasNext: response.hasNext,
    recommendedCount: response.items.filter((v: { preference?: { recommended?: unknown } }) =>
      v.preference?.recommended === true).length,
  };
};

/**
 * Catalogue emptiness proof uses the SAME eligibility endpoint with q EMPTY,
 * page 1 and an empty response. A filtered zero-hit is never eligible here.
 * The response body must echo the unfiltered query and first page; unknown,
 * malformed, or partial responses must fail closed.
 */
export const hasNoEligibleAhspInUnfilteredSearch = (payload: unknown): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const response = payload as {
    items?: unknown;
    hasNext?: unknown;
    page?: unknown;
    query?: unknown;
  };
  return response.query === '' && response.page === 1 &&
    Array.isArray(response.items) && response.items.length === 0 &&
    response.hasNext === false;
};

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
  if (search.kind === 'eligible_catalog_empty') return {
    title: 'Belum ada AHSP yang dapat digunakan',
    message: 'SIMPROK belum menemukan AHSP yang memenuhi syarat untuk proyek, workspace, dan tanggal perhitungan ini. AHSP historis, belum lengkap, atau yang telah dihapus tidak boleh otomatis digunakan. Baris tetap belum dihitung sampai ada AHSP yang sah.',
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
