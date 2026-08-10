/**
 * RM-03D1 — how the RAB workspace should present a project's lifecycle.
 *
 * The workspace used to ask one question, "may I edit?", and treat every "no"
 * the same way: a denial screen with no RAB on it. That is right for a project
 * whose draft belongs to someone else's baseline, and wrong for a RAB that is
 * simply frozen — LOCKED means the RAB is finished, not hidden. An Owner must
 * still be able to open a locked RAB and read every number in it.
 *
 * So there are three presentations, not two.
 */

export const RAB_LOCKED_REASON = 'RAB_LOCKED' as const;

export interface RabWorkspaceCapabilityWire {
  canEnterEditableDraftWorkspace?: boolean;
  canEditDraft?: boolean;
  reasonCode?: string | null;
}

export type RabWorkspacePresentation =
  /** Draft is alive: full editing. */
  | { mode: 'editable' }
  /** The SAME RAB, frozen. Every read still works; every control is read-only. */
  | { mode: 'frozen'; reasonCode: string }
  /** Genuinely not this user's draft to see here — unchanged existing behaviour. */
  | { mode: 'denied'; reasonCode: string | null };

/**
 * Only RAB_LOCKED opens the frozen presentation. APPROVED_RAB_EXISTS and
 * ACTIVE_BASELINE_EXISTS are deliberately NOT included: they mean *another*
 * document governs this project, which is a different situation with its own
 * existing behaviour, and quietly widening this would change screens this
 * slice was never asked to touch.
 */
export const resolveRabWorkspacePresentation = (
  capability: RabWorkspaceCapabilityWire | null | undefined,
): RabWorkspacePresentation => {
  if (capability?.canEditDraft === true) return { mode: 'editable' };
  if (capability?.reasonCode === RAB_LOCKED_REASON) {
    return { mode: 'frozen', reasonCode: RAB_LOCKED_REASON };
  }
  return { mode: 'denied', reasonCode: capability?.reasonCode ?? null };
};

/** Human copy. No reason code is ever shown to the Owner as-is. */
export const RAB_LOCK_COPY = {
  action: 'Kunci RAB',
  /** Shown before the command runs, so the pre-lock check is never a surprise. */
  confirm:
    'SIMPROK akan memeriksa ulang harga dan dasar perhitungan sebelum mengunci RAB.',
  confirmAccept: 'Periksa dan Kunci',
  confirmCancel: 'Batal',
  lockedBadge: 'TERKUNCI',
  lockedNote:
    'RAB ini sudah dikunci. Isinya dapat dibaca dan ditelusuri, tetapi tidak dapat diubah.',
  /** Shown when pre-lock revalidation refuses. */
  revalidationRequired:
    'Harga atau dasar perhitungan telah berubah. Perbarui RAB sebelum dikunci.',
  incomplete: 'Lengkapi harga seluruh item pekerjaan sebelum mengunci RAB.',
  failed: 'RAB belum dapat dikunci. Coba lagi atau periksa kembali isian RAB.',
} as const;

/**
 * One human sentence per pre-lock finding. The server's finding codes are an
 * engineering vocabulary; the Owner is told what happened to their RAB.
 */
const FINDING_COPY: Record<string, string> = {
  UNPRICED_WORK_ITEM: 'Item pekerjaan ini belum mempunyai harga.',
  CALCULATION_MISMATCH: 'Harga tersimpan tidak lagi sama dengan hasil hitung ulang.',
  CALCULATION_NOT_REPROVABLE: 'Perhitungan tersimpan tidak dapat dibuktikan ulang.',
  RESOURCE_COST_NOT_REPRODUCED: 'Salah satu komponen biaya tidak dapat dihitung ulang.',
  AHSP_VERSION_NO_LONGER_ELIGIBLE: 'Dasar analisa harga (AHSP) yang dipakai sudah diganti.',
  RAB_PRICING_INCOMPLETE: 'Masih ada item pekerjaan yang belum mempunyai harga.',
  MANUAL_PRICE_REQUIRES_CONFIRMATION:
    'Harga item ini diisi manual. SIMPROK belum dapat mengunci harga manual.',
  BASIC_PRICE_SELECTION_CHANGED:
    'Ada Harga Dasar lain yang kini lebih tepat untuk tanggal perhitungan item ini.',
  BASIC_PRICE_NO_LONGER_ELIGIBLE: 'Harga Dasar yang dipakai sudah tidak berlaku.',
  BASIC_PRICE_AMBIGUOUS:
    'Ada lebih dari satu Harga Dasar yang memenuhi syarat. SIMPROK tidak memilih untuk Anda.',
  BASIC_PRICE_MISSING: 'Tidak ada Harga Dasar yang memenuhi syarat untuk item ini.',
  WORKING_CALCULATION_PENDING:
    'Masih ada perhitungan yang belum disimpan pada item ini. Simpan dulu sebelum RAB dikunci.',
  CALCULATION_OCCURRENCE_MISMATCH:
    'Dasar perhitungan tersimpan untuk item ini tidak dapat ditelusuri dengan pasti.',
};

export interface PrelockFindingWire {
  wbsCode?: string;
  name?: string;
  finding?: string;
}

export interface PrelockFindingLine {
  /** e.g. "R75 — 1 m3 Timbunan..." or just the name when there is no code. */
  label: string;
  message: string;
}

export const toPrelockFindingLines = (
  findings: readonly PrelockFindingWire[] | null | undefined,
): PrelockFindingLine[] =>
  (findings ?? []).map((finding) => {
    const code = finding.wbsCode?.trim();
    const name = finding.name?.trim();
    const label = code && name ? `${code} — ${name}` : (code || name || 'RAB');
    return {
      label,
      message:
        (finding.finding ? FINDING_COPY[finding.finding] : undefined) ??
        'Ada yang berubah pada dasar perhitungan item ini.',
    };
  });
