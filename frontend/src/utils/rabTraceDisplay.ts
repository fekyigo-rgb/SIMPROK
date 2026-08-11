/**
 * RAB-TRACE-01 — origin vocabulary and price-trace presentation, in one place.
 *
 * Owner Law fixes four user-facing origins:
 *
 *   Dari Akun Pengguna : Auto SIMPROK · Input Pengguna
 *   Import             : Import SIMPROK · Import Pengguna
 *
 * Only two of those can be proved from what SIMPROK persists today, so only
 * two are emitted. The repository has exactly one price-origin enum —
 * SERVER_COST_KERNEL and MANUAL_CLIENT — and no field recording that a row
 * arrived from outside. The XLSX import writes rows with no price at all, so
 * an imported price cannot exist yet; every MANUAL_CLIENT price was typed by a
 * person inside SIMPROK, which is what Input Pengguna means.
 *
 * The two Import origins are therefore deliberately absent rather than
 * guessed. When import provenance is actually persisted they can be added
 * here, and only here.
 */

export type PersistedPriceOriginValue = 'SERVER_COST_KERNEL' | 'MANUAL_CLIENT' | null;

export type OriginCategory = 'DARI_AKUN_PENGGUNA' | 'IMPORT';

export interface PriceOriginView {
  /** '' when the row carries no price at all — a folder, a note, or unpriced work. */
  label: string;
  categoryLabel: string;
  category: OriginCategory | null;
  /** How the number came to be, in one sentence, for the evidence surface. */
  explanation: string;
}

const NO_ORIGIN: PriceOriginView = {
  label: '',
  categoryLabel: '',
  category: null,
  explanation: '',
};

const UNPRICED: PriceOriginView = {
  label: 'Belum ada harga',
  categoryLabel: '',
  category: null,
  explanation: 'Item pekerjaan ini belum mempunyai harga.',
};

/**
 * Origin is where a price entered this context — never a verification, a
 * status, or an approval.
 */
export const resolvePriceOrigin = (
  priceOrigin: PersistedPriceOriginValue,
  options: { isWorkItem: boolean } = { isWorkItem: true },
): PriceOriginView => {
  if (!options.isWorkItem) return NO_ORIGIN;

  if (priceOrigin === 'SERVER_COST_KERNEL') {
    return {
      label: 'Auto SIMPROK',
      categoryLabel: 'Dari Akun Pengguna',
      category: 'DARI_AKUN_PENGGUNA',
      explanation:
        'Harga dihitung otomatis oleh SIMPROK dari AHSP dan Harga Dasar yang berlaku, di dalam ruang kerja akun ini.',
    };
  }

  if (priceOrigin === 'MANUAL_CLIENT') {
    return {
      label: 'Input Pengguna',
      categoryLabel: 'Dari Akun Pengguna',
      category: 'DARI_AKUN_PENGGUNA',
      explanation:
        'Harga diisi langsung oleh pengguna di dalam SIMPROK. SIMPROK tidak menghitung ulang dan tidak menyimpan rincian pembentuk harganya.',
    };
  }

  return UNPRICED;
};

/* ------------------------------------------------------------------ *
 * AHSP identity
 *
 * There is no AHSP code in the domain model: an AHSP is identified by its
 * work type, its method, and a version number. `wbsCode` is the RAB row's own
 * code and is not an AHSP identity, so it is never presented as one.
 * ------------------------------------------------------------------ */

export interface AhspIdentityWire {
  workType?: string | null;
  methodName?: string | null;
  versionNumber?: number | null;
  outputUnit?: string | null;
}

export interface AhspIdentityView {
  linked: boolean;
  /** Compact label for a table cell. */
  shortLabel: string;
  /** Full proven identity, for the AHSP door and the cell's title. */
  fullLabel: string;
}

export const NOT_LINKED_AHSP = 'Belum terhubung';

export const resolveAhspIdentity = (
  ahsp: AhspIdentityWire | null | undefined,
): AhspIdentityView => {
  const workType = ahsp?.workType?.trim();
  const methodName = ahsp?.methodName?.trim();
  const versionNumber = ahsp?.versionNumber;

  if (!workType && !methodName && (versionNumber === undefined || versionNumber === null)) {
    return { linked: false, shortLabel: NOT_LINKED_AHSP, fullLabel: NOT_LINKED_AHSP };
  }

  const version = typeof versionNumber === 'number' ? `v${versionNumber}` : '';
  const parts = [workType, methodName].filter(Boolean).join(' — ');
  const unit = ahsp?.outputUnit?.trim();

  return {
    linked: true,
    shortLabel: [methodName || workType, version].filter(Boolean).join(' · ') || 'AHSP',
    fullLabel: [parts, version, unit].filter(Boolean).join(' · '),
  };
};

/* ------------------------------------------------------------------ *
 * Jejak Perhitungan Harga — the price trace, assembled from persisted truth
 *
 * "Asal Harga" says where the number came from in one phrase. This says how
 * it was formed. Both rooms read this one function, so the evidence a user
 * sees in Ruang Hidup is the same evidence Ruang Kerja shows — never a second
 * account of the same number. Nothing here computes money: every figure is
 * the string the server persisted.
 * ------------------------------------------------------------------ */

export const PRICE_TRACE_TITLE = 'Jejak Perhitungan Harga';
export const PRICE_TRACE_ACTION = 'Lihat Bukti Harga';
export const PRICE_TRACE_ROW_ACTION = 'Rincian Harga';
export const TECHNICAL_DETAIL_TITLE = 'Detail Teknis';

export interface PriceTraceInput {
  description: string;
  unit: string;
  quantityDisplay: string;
  unitPriceDisplay: string;
  lineTotalDisplay: string;
  priceOrigin: PersistedPriceOriginValue;
  isWorkItem: boolean;
  ahsp?: AhspIdentityWire | null;
  provenance?: {
    calculationPolicyVersion?: string | null;
    calculationAsOfDate?: string | null;
    calculatedAt?: string | null;
    calculationOccurrenceId?: string | null;
  } | null;
}

export interface TraceFact {
  label: string;
  value: string;
}

export interface PriceTraceView {
  title: string;
  subtitle: string;
  origin: PriceOriginView;
  /** What is known about how this number was formed. */
  facts: TraceFact[];
  /** Identifiers that belong to engineering, not to the Owner's first read. */
  technicalFacts: TraceFact[];
  /** Said plainly when a piece of the story genuinely is not recorded. */
  unavailable: string[];
}

const UNAVAILABLE_AHSP = 'Analisa AHSP tidak tercatat untuk baris ini.';
const UNAVAILABLE_BREAKDOWN =
  'Rincian pembentuk harga tidak tersedia — harga ini tidak dihitung oleh SIMPROK.';

/**
 * Never fabricates. A fact that was not persisted is listed as unavailable
 * rather than filled in with a plausible value or a zero.
 */
export const buildPriceTrace = (input: PriceTraceInput): PriceTraceView => {
  const origin = resolvePriceOrigin(input.priceOrigin, { isWorkItem: input.isWorkItem });
  const ahsp = resolveAhspIdentity(input.ahsp);

  const facts: TraceFact[] = [];
  const technicalFacts: TraceFact[] = [];
  const unavailable: string[] = [];

  if (origin.label) facts.push({ label: 'Asal Harga', value: origin.label });
  if (origin.categoryLabel) facts.push({ label: 'Kategori Asal', value: origin.categoryLabel });

  if (ahsp.linked) facts.push({ label: 'Analisa AHSP', value: ahsp.fullLabel });
  else unavailable.push(UNAVAILABLE_AHSP);

  if (input.unit) facts.push({ label: 'Satuan', value: input.unit });
  if (input.quantityDisplay) facts.push({ label: 'Volume', value: input.quantityDisplay });
  if (input.unitPriceDisplay) facts.push({ label: 'Harga Satuan', value: input.unitPriceDisplay });
  if (input.lineTotalDisplay) facts.push({ label: 'Jumlah', value: input.lineTotalDisplay });

  const asOf = input.provenance?.calculationAsOfDate?.trim();
  const calculatedAt = input.provenance?.calculatedAt?.trim();
  const policy = input.provenance?.calculationPolicyVersion?.trim();
  const occurrence = input.provenance?.calculationOccurrenceId?.trim();

  if (asOf) facts.push({ label: 'Harga berlaku per tanggal', value: asOf });
  if (calculatedAt) facts.push({ label: 'Dihitung pada', value: calculatedAt });

  if (policy) technicalFacts.push({ label: 'Kebijakan perhitungan', value: policy });
  if (occurrence) technicalFacts.push({ label: 'ID Bukti (occurrence)', value: occurrence });

  if (input.isWorkItem && input.priceOrigin === 'MANUAL_CLIENT') {
    unavailable.push(UNAVAILABLE_BREAKDOWN);
  }

  return {
    title: PRICE_TRACE_TITLE,
    subtitle: [input.description, input.unit].filter(Boolean).join(' · '),
    origin,
    facts,
    technicalFacts,
    unavailable,
  };
};
