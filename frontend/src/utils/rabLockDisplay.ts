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
 * THE ONE PRESENTATION STATUS
 *
 * A user reads one lifecycle, in this order:
 *
 *   Draft → Terkunci → Approved → Berjalan → Selesai
 *
 * That sequence is a presentation, not a schema. Internally the two
 * truths stay separate and untouched — RabDocument is DRAFT/LOCKED/
 * APPROVED, and the project keeps its own lifecycle — because a status
 * a person can read is not a reason to bend a domain enum.
 *
 * This function joins those truths without lying about either, and it
 * is the ONLY place the join happens. My Projects (card and filter),
 * Detail Proyek and Ruang Hidup RAB all ask it. When the combination it
 * is handed is not lawful, it says so instead of guessing a status.
 * ------------------------------------------------------------------ */

/**
 * Lifecycle facts as the server states them, from RabLifecyclePolicyService.
 * Every field is optional on purpose: an endpoint that did not send them has
 * told us nothing, and "nothing" must never be read as "zero".
 */
export interface RabLifecycleFactsWire extends RabWorkspaceCapabilityWire {
  projectStatus?: string | null;
  workingDraftCount?: number;
  lockedRabCount?: number;
  approvedRabCount?: number;
  activeBaselineCount?: number;
}

export type ProjectPresentationStatus =
  | 'DRAFT'
  | 'TERKUNCI'
  | 'APPROVED'
  | 'BERJALAN'
  | 'SELESAI'
  /** Facts missing, or a combination no lawful project can be in. */
  | 'UNKNOWN';

export interface ProjectPresentationView {
  status: ProjectPresentationStatus;
  /** Short form, for the filter. */
  label: string;
  /** Card and header badge. Names the RAB where the RAB is what moved. */
  badgeLabel: string;
  /** Existing chip vocabulary only — no new colour enters the Color Lock. */
  chipModifier: 'draft' | 'terkunci' | 'approved' | 'berjalan' | 'selesai';
}

const PRESENTATION: Record<ProjectPresentationStatus, Omit<ProjectPresentationView, 'status'>> = {
  DRAFT: { label: 'Draft', badgeLabel: 'RAB Draft', chipModifier: 'draft' },
  TERKUNCI: { label: 'Terkunci', badgeLabel: 'RAB Terkunci', chipModifier: 'terkunci' },
  APPROVED: { label: 'Approved', badgeLabel: 'RAB Approved', chipModifier: 'approved' },
  // Once an approved RAB is being executed, the project is what moved — so
  // these two are named for the project, not for the RAB.
  BERJALAN: { label: 'Berjalan', badgeLabel: 'Berjalan', chipModifier: 'berjalan' },
  SELESAI: { label: 'Selesai', badgeLabel: 'Selesai', chipModifier: 'selesai' },
  UNKNOWN: { label: 'Menunggu Data', badgeLabel: 'Menunggu Data', chipModifier: 'draft' },
};

/** Project lifecycle stages that mean execution has begun. */
const EXECUTION_PROJECT_STATUSES = ['ACTIVE', 'ON_HOLD'];
const FINISHED_PROJECT_STATUSES = ['COMPLETED', 'ARCHIVED'];
const PRE_EXECUTION_PROJECT_STATUSES = ['PLANNED'];

const view = (status: ProjectPresentationStatus): ProjectPresentationView => ({
  status,
  ...PRESENTATION[status],
});

export const resolveProjectPresentationStatus = (
  lifecycle: RabLifecycleFactsWire | null | undefined,
): ProjectPresentationView => {
  const approved = lifecycle?.approvedRabCount;
  const locked = lifecycle?.lockedRabCount;
  const draft = lifecycle?.workingDraftCount;

  // Told nothing. Said plainly, never filled in with a plausible status.
  if (approved === undefined && locked === undefined && draft === undefined) {
    return view('UNKNOWN');
  }

  // One RAB, one house, three states. An APPROVED and a LOCKED document on the
  // same project means two documents claim to govern it — not a state to pick
  // a winner from.
  if ((approved ?? 0) > 0 && (locked ?? 0) > 0) return view('UNKNOWN');

  if ((approved ?? 0) > 0) {
    const projectStatus = (lifecycle?.projectStatus ?? '').trim().toUpperCase();
    if (PRE_EXECUTION_PROJECT_STATUSES.includes(projectStatus)) return view('APPROVED');
    if (EXECUTION_PROJECT_STATUSES.includes(projectStatus)) return view('BERJALAN');
    if (FINISHED_PROJECT_STATUSES.includes(projectStatus)) return view('SELESAI');
    // Approved against a project stage this resolver does not recognise.
    return view('UNKNOWN');
  }

  if ((locked ?? 0) > 0) return view('TERKUNCI');

  // A working draft, or no RAB document yet: both sit at the first stage of
  // the lifecycle the user reads. "Mulai RAB" vs "Lanjutkan Draft" is what
  // tells them which, and that is the action's job, not the badge's.
  return view('DRAFT');
};

/** The filter offers exactly the lifecycle the user reads, in its own order. */
export const PRESENTATION_FILTER_ORDER: ProjectPresentationStatus[] = [
  'DRAFT',
  'TERKUNCI',
  'APPROVED',
  'BERJALAN',
  'SELESAI',
];

export const presentationLabel = (status: ProjectPresentationStatus): string =>
  PRESENTATION[status].label;

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
