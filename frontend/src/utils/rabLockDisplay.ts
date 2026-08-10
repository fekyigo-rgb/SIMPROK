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

/* ------------------------------------------------------------------ *
 * One truth about "what state is this RAB in", for every surface.
 *
 * A project's status and its RAB's status are two different facts about
 * two different things. A project may still be in perencanaan while its
 * RAB is already frozen; freezing a RAB does not move the project on.
 * Every screen that derived "RAB status" from Project.status was reading
 * the wrong fact and could tell the Owner their RAB was an open draft
 * while it was, in the repository, locked.
 *
 * So the RAB's state is read from the RAB's own lifecycle counts, here,
 * once — and every surface asks this function instead of deciding for
 * itself.
 * ------------------------------------------------------------------ */

/**
 * Lifecycle facts as the server states them. Every count is optional on
 * purpose: an endpoint that does not send them has told us nothing, and
 * "nothing" must never be read as "zero".
 */
export interface RabLifecycleFactsWire extends RabWorkspaceCapabilityWire {
  workingDraftCount?: number;
  lockedRabCount?: number;
  approvedRabCount?: number;
  activeBaselineCount?: number;
}

export type RabDocumentState =
  /** An APPROVED RAB governs this project. */
  | 'APPROVED'
  /** A LOCKED RAB exists: frozen, readable, not yet approved. */
  | 'LOCKED'
  /** Only a working draft exists. */
  | 'DRAFT'
  /** The project has no RAB document at all yet. */
  | 'NONE'
  /** The surface was not given the lifecycle facts. Said plainly, never guessed. */
  | 'UNKNOWN';

export interface RabLifecycleStatusView {
  rab: RabDocumentState;
  /** Owner-facing, and always names the RAB so it cannot be read as the project. */
  rabLabel: string;
  /** null means "not told" — distinct from false, which means "told: no". */
  approved: boolean | null;
  approvalLabel: string;
  baseline: boolean | null;
  baselineLabel: string;
  /**
   * Existing chip vocabulary only. Approved and locked both carry Navy
   * authority; the words, not the colour, separate them. No new colour is
   * introduced here.
   */
  chipModifier: 'approved' | 'terkunci' | 'draft';
}

const RAB_STATE_LABEL: Record<RabDocumentState, string> = {
  APPROVED: 'RAB Disetujui',
  LOCKED: 'RAB Terkunci',
  DRAFT: 'RAB Draft',
  NONE: 'RAB Belum Dibuat',
  UNKNOWN: 'Status RAB Menunggu Data',
};

const RAB_STATE_CHIP: Record<RabDocumentState, RabLifecycleStatusView['chipModifier']> = {
  APPROVED: 'approved',
  LOCKED: 'terkunci',
  DRAFT: 'draft',
  NONE: 'draft',
  UNKNOWN: 'draft',
};

/**
 * Precedence mirrors the server's own reason priority: the most binding
 * document wins, because that is the one the Owner is held to. Approval
 * outranks a freeze, a freeze outranks a working draft.
 *
 * Baseline is reported alongside, never folded in — a project can hold an
 * active baseline and a RAB in any state, and collapsing the two would
 * hide exactly the distinction this function exists to keep.
 */
export const resolveRabLifecycleStatus = (
  lifecycle: RabLifecycleFactsWire | null | undefined,
): RabLifecycleStatusView => {
  const approvedCount = lifecycle?.approvedRabCount;
  const lockedCount = lifecycle?.lockedRabCount;
  const draftCount = lifecycle?.workingDraftCount;
  const baselineCount = lifecycle?.activeBaselineCount;

  let rab: RabDocumentState;
  if (approvedCount === undefined && lockedCount === undefined && draftCount === undefined) {
    rab = 'UNKNOWN';
  } else if ((approvedCount ?? 0) > 0) {
    rab = 'APPROVED';
  } else if ((lockedCount ?? 0) > 0) {
    rab = 'LOCKED';
  } else if ((draftCount ?? 0) > 0) {
    rab = 'DRAFT';
  } else {
    rab = 'NONE';
  }

  const approved = rab === 'UNKNOWN' ? null : rab === 'APPROVED';
  const baseline = baselineCount === undefined ? null : baselineCount > 0;

  return {
    rab,
    rabLabel: RAB_STATE_LABEL[rab],
    approved,
    approvalLabel:
      approved === null ? 'Belum diketahui' : approved ? 'Sudah disetujui' : 'Belum disetujui',
    baseline,
    baselineLabel:
      baseline === null ? 'Belum diketahui' : baseline ? 'Baseline aktif' : 'Belum ada baseline',
    chipModifier: RAB_STATE_CHIP[rab],
  };
};

/**
 * The project's own status, in the project's own words. It lives beside the
 * RAB resolver deliberately: the two labels are only ever safe next to each
 * other if neither surface is free to invent its own wording. "Terkunci" in
 * particular belongs to a RAB and never to a project — a running project is
 * berjalan, not locked.
 */
const PROJECT_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Perencanaan',
  ACTIVE: 'Berjalan',
  ON_HOLD: 'Ditahan',
  COMPLETED: 'Selesai',
  ARCHIVED: 'Arsip',
};

export const resolveProjectStatusLabel = (rawStatus: unknown): string => {
  const key = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
  return PROJECT_STATUS_LABEL[key] ?? 'Belum diketahui';
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
