import type { PersistedCalculationDisplay } from './rabPersistedCalculationDisplay.ts';

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

/**
 * THE THREE PRICE ORIGINS, and nothing else.
 *
 * They answer one question: how was the CURRENT amount formed?
 *
 *   AUTO_SIMPROK  SIMPROK computed it AND stands behind every source it used.
 *   MANUAL_INPUT  a person typed the amount into this RAB.
 *   USER_DATA     SIMPROK computed it, but at least one source in the chain is
 *                 the workspace's own private data, which SIMPROK has not
 *                 published or approved.
 *
 * "Belum ada harga" is deliberately NOT one of them — it is an availability
 * state, and forcing an origin onto a row that has no price would be inventing
 * a fact.
 */
export type PriceOriginKind =
  | 'AUTO_SIMPROK'
  | 'MANUAL_INPUT'
  | 'USER_DATA'
  /**
   * NOT A FOURTH PRICE ORIGIN — nothing persists it and no enum grows.
   *
   * It is a TRUST state: the calculation is real, but the authority that
   * formed it was never recorded, so neither "Auto SIMPROK" nor "Data
   * Pengguna" can be claimed. Saying either would be inventing evidence.
   */
  | 'UNDETERMINED'
  | 'NONE';

/**
 * How the row arrived in this project — an axis ORTHOGONAL to price origin.
 * A price can be imported and still be manual; imported and still automatic.
 * Collapsing the two into one list is what makes "Import" look like a kind of
 * price, which it is not.
 */
export type TransferLineage = 'LOCAL' | 'IMPORTED';

/**
 * The authority facts behind a calculated price, exactly as the server states
 * them. Absent (`undefined`) means "not read yet" — never "authoritative".
 */
export interface PriceSourceAuthorityWire {
  /** true = authoritative · false = proven user asset · null = never proven. */
  ahspAuthoritative?: boolean | null;
  privateBasicPriceCount?: number | null;
  catalogBasicPriceCount?: number | null;
}

export interface PriceOriginView {
  kind: PriceOriginKind;
  /** '' when the row carries no price at all — a folder, a note, or unpriced work. */
  label: string;
  /** Import · <origin> when the row was transferred in; otherwise the label. */
  lineageLabel: string;
  /** How the number came to be, in one sentence, for the evidence surface. */
  explanation: string;
}

const NO_ORIGIN: PriceOriginView = {
  kind: 'NONE',
  label: '',
  lineageLabel: '',
  explanation: '',
};

const UNPRICED: PriceOriginView = {
  kind: 'NONE',
  label: 'Belum ada harga',
  lineageLabel: 'Belum ada harga',
  explanation: 'Item pekerjaan ini belum mempunyai harga.',
};

/**
 * WHOSE DATA FORMED A CALCULATED PRICE — decided in the order the evidence
 * actually settles it:
 *
 *   1. a private Basic Price in the chain PROVES user data, whatever the AHSP
 *      was — the part SIMPROK cannot vouch for is still inside the number;
 *   2. otherwise a frozen ownership of USER_ASSET proves user data;
 *   3. otherwise a frozen ownership of SIMPROK/APPROVED, with no private price
 *      contradicting it, earns SIMPROK's own authority;
 *   4. otherwise the historical authority was never proven — and an unproven
 *      thing is reported as unproven, not resolved to whichever label feels
 *      safer. "Data Pengguna" is as much a claim as "Auto SIMPROK".
 */
const classifyCalculatedAuthority = (
  authority: PriceSourceAuthorityWire | null | undefined,
): 'AUTO_SIMPROK' | 'USER_DATA' | 'UNDETERMINED' => {
  if ((authority?.privateBasicPriceCount ?? 0) > 0) return 'USER_DATA';
  if (authority?.ahspAuthoritative === false) return 'USER_DATA';
  if (authority?.ahspAuthoritative === true) return 'AUTO_SIMPROK';
  return 'UNDETERMINED';
};

/**
 * Origin is how the CURRENT amount was formed — never a verification, a
 * status, or an approval. A manual override makes the row manual even if it
 * was once calculated: the earlier calculation belongs to history, not to the
 * current price.
 */
export const resolvePriceOrigin = (
  priceOrigin: PersistedPriceOriginValue,
  options: {
    isWorkItem: boolean;
    authority?: PriceSourceAuthorityWire | null;
    lineage?: TransferLineage;
  } = { isWorkItem: true },
): PriceOriginView => {
  if (!options.isWorkItem) return NO_ORIGIN;

  const withLineage = (view: Omit<PriceOriginView, 'lineageLabel'>): PriceOriginView => ({
    ...view,
    lineageLabel:
      options.lineage === 'IMPORTED' ? `Import · ${view.label}` : view.label,
  });

  if (priceOrigin === 'SERVER_COST_KERNEL') {
    const authority = classifyCalculatedAuthority(options.authority);
    if (authority === 'AUTO_SIMPROK') {
      return withLineage({
        kind: 'AUTO_SIMPROK',
        label: 'Auto SIMPROK',
        explanation:
          'Harga dihitung SIMPROK dari AHSP dan Harga Dasar yang sudah menjadi sumber resmi SIMPROK.',
      });
    }
    if (authority === 'USER_DATA') {
      return withLineage({
        kind: 'USER_DATA',
        label: 'Data Pengguna',
        explanation:
          'Harga dihitung SIMPROK, tetapi sebagian sumber pembentuknya adalah data milik ruang kerja ini yang belum menjadi sumber resmi SIMPROK.',
      });
    }
    return withLineage({
      kind: 'UNDETERMINED',
      label: 'Asal belum dapat dipastikan',
      explanation:
        'Harga ini dihitung SIMPROK, tetapi kewenangan sumber pembentuknya pada saat perhitungan tidak tercatat. SIMPROK tidak menyatakan angka ini resmi maupun milik pengguna tanpa bukti.',
    });
  }

  if (priceOrigin === 'MANUAL_CLIENT') {
    return withLineage({
      kind: 'MANUAL_INPUT',
      label: 'Ketik Manual',
      explanation:
        'Harga diketik langsung oleh pengguna di ruang kerja RAB. SIMPROK menyimpannya apa adanya dan tidak membentuk angka ini dari perhitungan AHSP.',
    });
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
 * Komponen Pembentuk Harga — the price trace, assembled from persisted truth
 *
 * "Asal Harga" says where the number came from in one phrase. This says how
 * it was formed. Both rooms read this one function, so the evidence a user
 * sees in Ruang Hidup is the same evidence Ruang Kerja shows — never a second
 * account of the same number. Nothing here computes money: every figure is
 * the string the server persisted.
 * ------------------------------------------------------------------ */

export const PRICE_TRACE_TITLE = 'Komponen Pembentuk Harga';
export const PRICE_TRACE_ACTION = 'Lihat Komponen Pembentuk Harga';
export const PRICE_TRACE_ROW_ACTION = 'Rincian Harga';
export const TECHNICAL_DETAIL_TITLE = 'Detail Teknis';

export interface PriceTraceInput {
  /**
   * The authoritative persisted-calculation proof for this row.
   *
   * For a SERVER_COST_KERNEL price this is the truth: SIMPROK already owns a
   * service that re-proves the stored money from its own frozen provenance,
   * and describing that price from the row's loose fields instead would be a
   * second, thinner account of the same number. Pass `undefined` while it is
   * still loading and `null` when it could not be read.
   */
  authoritative?: PersistedCalculationDisplay | null;
  description: string;
  unit: string;
  quantityDisplay: string;
  unitPriceDisplay: string;
  lineTotalDisplay: string;
  priceOrigin: PersistedPriceOriginValue;
  isWorkItem: boolean;
  /**
   * Whose data formed the price, when it is known outside the authoritative
   * proof (a draft row that has not fetched its proof yet). The proof's own
   * facts win when both are present.
   */
  authority?: PriceSourceAuthorityWire | null;
  /** How the row arrived in this project. Orthogonal to price origin. */
  lineage?: TransferLineage;
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

export type PriceTraceStatus =
  /** Authoritative proof re-proved the stored money. */
  | 'VERIFIED'
  /** Authoritative proof read, but stored and recomputed disagree. */
  | 'MISMATCH'
  /** A kernel price whose proof could not be read — never dressed up as proven. */
  | 'UNAVAILABLE'
  /** The proof has not been fetched yet. */
  | 'LOADING'
  /** A hand-entered price: lawful, with no machine proof to show. */
  | 'MANUAL'
  /** No price on this row at all. */
  | 'NONE';

export interface PriceTraceView {
  status: PriceTraceStatus;
  /** One honest sentence about how far the evidence goes. */
  verdict: string;
  /** Resource breakdown from the authoritative proof, never re-derived. */
  resources: PersistedCalculationDisplay['resources'];
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
const UNPROVEN_KERNEL =
  'Bukti perhitungan tersimpan belum dapat dibaca, sehingga harga ini belum dapat dibuktikan ulang di sini.';
const UNAVAILABLE_BREAKDOWN =
  'Rincian pembentuk harga tidak tersedia — harga ini tidak dihitung oleh SIMPROK.';

/**
 * Never fabricates, and never becomes a second account of the money.
 *
 * For a SERVER_COST_KERNEL price the authoritative persisted-calculation proof
 * owns every figure and the verdict. The row's own fields are not used as a
 * quiet fallback: a kernel price whose proof cannot be read is reported as
 * unproven, because showing the same numbers without the proof would look
 * exactly like a verified price while proving nothing.
 *
 * A hand-entered price has no machine proof to show, and is not given one.
 */
export const buildPriceTrace = (input: PriceTraceInput): PriceTraceView => {
  /**
   * The authority facts travel with the authoritative proof, so the trace and
   * the table cannot disagree about whose data formed the price: both ask the
   * same resolver with the same evidence.
   */
  const origin = resolvePriceOrigin(input.priceOrigin, {
    isWorkItem: input.isWorkItem,
    authority: input.authoritative?.sourceAuthority ?? input.authority ?? null,
    lineage: input.lineage,
  });
  const ahsp = resolveAhspIdentity(input.ahsp);
  const authoritative = input.authoritative;

  const facts: TraceFact[] = [];
  const technicalFacts: TraceFact[] = [];
  const unavailable: string[] = [];

  /**
   * "Kategori Asal: Dari Akun Pengguna" used to sit directly under "Asal
   * Harga: Auto SIMPROK", and the two read as contradictory claims about the
   * same thing — is this SIMPROK's number or the account's? The category axis
   * added nothing the origin did not already say, so it is gone. Whose data
   * formed the price is now carried BY the origin itself: Auto SIMPROK versus
   * Data Pengguna.
   */
  if (origin.label) facts.push({ label: 'Asal Harga', value: origin.label });
  if (origin.explanation) facts.push({ label: 'Cara Terbentuk', value: origin.explanation });
  if (ahsp.linked) facts.push({ label: 'Analisa AHSP', value: ahsp.fullLabel });
  else if (input.isWorkItem) unavailable.push(UNAVAILABLE_AHSP);

  const kernelPrice = input.isWorkItem && input.priceOrigin === 'SERVER_COST_KERNEL';

  let status: PriceTraceStatus;
  let verdict: string;
  let resources: PersistedCalculationDisplay['resources'] = [];

  if (!input.isWorkItem || !input.priceOrigin) {
    status = 'NONE';
    verdict = 'Baris ini belum mempunyai harga untuk ditelusuri.';
  } else if (kernelPrice && authoritative === undefined) {
    status = 'LOADING';
    verdict = 'Memuat bukti perhitungan...';
  } else if (kernelPrice && !authoritative) {
    status = 'UNAVAILABLE';
    verdict = UNPROVEN_KERNEL;
    unavailable.push(UNPROVEN_KERNEL);
  } else if (kernelPrice && authoritative) {
    status =
      authoritative.kind === 'verified'
        ? 'VERIFIED'
        : authoritative.kind === 'mismatch'
        ? 'MISMATCH'
        : 'UNAVAILABLE';
    verdict = authoritative.message;
    resources = authoritative.resources;

    // Every figure below is the authoritative proof's own string.
    facts.push({ label: 'Satuan', value: authoritative.unit });
    facts.push({ label: 'Volume', value: authoritative.volumeDisplay });
    facts.push({ label: 'Harga Satuan (tersimpan)', value: authoritative.storedUnitPriceDisplay });
    facts.push({ label: 'Jumlah (tersimpan)', value: authoritative.storedLineTotalDisplay });
    facts.push({
      label: 'Hasil hitung ulang',
      value: authoritative.reproduced
        ? `Sama dengan tersimpan (${authoritative.recomputedUnitPriceDisplay})`
        : authoritative.recomputedUnitPriceDisplay,
    });

    if (authoritative.provenance) {
      facts.push({ label: 'Harga berlaku per tanggal', value: authoritative.provenance.asOfDate });
      facts.push({ label: 'Region harga', value: authoritative.provenance.regionName });
      facts.push({ label: 'Dihitung pada', value: authoritative.provenance.calculatedAt });
      technicalFacts.push({ label: 'Kebijakan perhitungan', value: authoritative.provenance.policyVersion });
      technicalFacts.push({ label: 'Kebijakan resolusi', value: authoritative.provenance.resolutionPolicyVersion });
      technicalFacts.push({ label: 'ID Bukti (occurrence)', value: authoritative.provenance.occurrenceId });
      technicalFacts.push({ label: 'ID Versi AHSP', value: authoritative.provenance.ahspVersionId });
      technicalFacts.push({ label: 'Generasi occurrence', value: authoritative.provenance.generation });
    } else {
      unavailable.push('Rincian provenance tidak lengkap pada bukti tersimpan.');
    }
  } else {
    // MANUAL_CLIENT — lawful, and honest about what it is not.
    status = 'MANUAL';
    verdict = origin.explanation;
    if (input.unit) facts.push({ label: 'Satuan', value: input.unit });
    if (input.quantityDisplay) facts.push({ label: 'Volume', value: input.quantityDisplay });
    if (input.unitPriceDisplay) facts.push({ label: 'Harga Satuan', value: input.unitPriceDisplay });
    if (input.lineTotalDisplay) facts.push({ label: 'Jumlah', value: input.lineTotalDisplay });
    unavailable.push(UNAVAILABLE_BREAKDOWN);
  }

  return {
    status,
    verdict,
    resources,
    title: PRICE_TRACE_TITLE,
    subtitle: [input.description, input.unit].filter(Boolean).join(' · '),
    origin,
    facts,
    technicalFacts,
    unavailable,
  };
};
