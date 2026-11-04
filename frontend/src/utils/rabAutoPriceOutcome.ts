/**
 * RAB Workspace only — interpret the existing official auto-price API counts.
 * No calculation, eligibility or price decision is made in the frontend.
 */
export interface RabAutoPriceOutcome {
  readonly calculatedAndPersisted: number;
  readonly unpriced: number;
  readonly requiresRevalidation: number;
}

export interface RabAutoPricePage {
  readonly hasNext: boolean;
  readonly counts: RabAutoPriceOutcome;
}

export const emptyRabAutoPriceOutcome = (): RabAutoPriceOutcome => ({
  calculatedAndPersisted: 0,
  unpriced: 0,
  requiresRevalidation: 0,
});

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Invalid or incomplete API evidence is NEVER interpreted as zero failures. */
export function parseRabAutoPricePage(
  payload: unknown,
  expectedProjectId: string,
): RabAutoPricePage | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (raw.projectId !== expectedProjectId || typeof raw.hasNext !== 'boolean' ||
      !raw.counts || typeof raw.counts !== 'object') return null;
  const counts = raw.counts as Record<string, unknown>;
  if (!isCount(counts.calculatedAndPersisted) ||
      !isCount(counts.unpriced) ||
      !isCount(counts.requiresRevalidation)) return null;
  return {
    hasNext: raw.hasNext,
    counts: {
      calculatedAndPersisted: counts.calculatedAndPersisted,
      unpriced: counts.unpriced,
      requiresRevalidation: counts.requiresRevalidation,
    },
  };
}

/** Accumulate EVERY page; a later page's failed writes cannot disappear. */
export function accumulateRabAutoPriceOutcome(
  total: RabAutoPriceOutcome,
  page: RabAutoPriceOutcome,
): RabAutoPriceOutcome {
  return {
    calculatedAndPersisted: total.calculatedAndPersisted + page.calculatedAndPersisted,
    unpriced: total.unpriced + page.unpriced,
    requiresRevalidation: total.requiresRevalidation + page.requiresRevalidation,
  };
}

/**
 * The last failed write needs a separate, source-scoped notice: the ordinary
 * statusMessage is replaced by the canonical BOQ reload. A retryToken-only
 * refresh is NOT a change in the source/context and must not hide this alert.
 */
export interface RabAutoPriceNotice {
  readonly projectId: string;
  readonly date: string;
  readonly draftRevision: number;
  readonly message: string;
}

export function isRabAutoPriceNoticeCurrent(
  notice: RabAutoPriceNotice | null,
  context: {
    readonly projectId: string | null;
    readonly date: string;
    readonly draftRevision: number;
    readonly draftDirty: boolean;
  },
): notice is RabAutoPriceNotice {
  return Boolean(
    notice &&
    notice.projectId === context.projectId &&
    notice.date === context.date &&
    notice.draftRevision === context.draftRevision &&
    !context.draftDirty,
  );
}

/** Show only server-reported outcomes, and never call failed writes successful. */
export function describeRabAutoPriceOutcome(total: RabAutoPriceOutcome): string {
  const completed = `${total.calculatedAndPersisted} baris dihitung dan disimpan otomatis. ${total.unpriced} baris belum memenuhi syarat harga.`;
  if (total.requiresRevalidation > 0) {
    return `${completed} ${total.requiresRevalidation} baris belum berhasil disimpan karena memerlukan validasi ulang. Periksa kembali baris tersebut dan hasil RAB yang tersimpan; jangan menganggap seluruh pekerjaan selesai.`;
  }
  return `${completed} Pemeriksaan tetap menggunakan Cost Kernel.`;
}
