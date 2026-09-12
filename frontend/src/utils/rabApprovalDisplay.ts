/**
 * PAB-03 — how the RAB approval door presents itself to a reader.
 *
 * UI LAW. The human performs ONE meaningful decision: approve this RAB.
 * SIMPROK performs everything mechanical around it. So this file never asks
 * the reader to choose an approver, select a PositionAuthority, or create a
 * baseline — those are internal wiring the server already knows how to do.
 *
 * When the door is closed it says WHY in one human sentence, and, where the
 * existing governance can name them, WHO may act instead. A governance gap
 * ("nobody has been given this authority yet") is deliberately worded as a
 * configuration fact, not as a denial of the reader — it is an instruction to
 * the organization, and the only honest one.
 *
 * No reason code is ever shown to the Owner as-is.
 */

export interface RabApprovalPositionWire {
  id?: string;
  code?: string;
  name?: string;
}

export interface RabApprovalGateWire {
  rabStatus?: string | null;
  rabDocumentId?: string | null;
  canApprove?: boolean;
  blocker?: string | null;
  authorizedPositions?: RabApprovalPositionWire[];
  holderPositionId?: string | null;
  activeBaselineCount?: number;
}

export const RAB_APPROVAL_COPY = {
  action: 'Setujui RAB',
  /** Shown before the command runs, so the consequence is never a surprise. */
  confirm:
    'RAB yang disetujui menjadi rencana resmi proyek dan langsung menjadi baseline aktif. Isi RAB tidak dapat diubah lagi setelah ini.',
  confirmAccept: 'Setujui dan Jadikan Baseline',
  confirmCancel: 'Batal',
  approvedBadge: 'DISETUJUI',
  approvedNote:
    'RAB ini sudah disetujui dan menjadi baseline aktif proyek. Pelaksanaan dan progres mengacu pada RAB ini.',
  working: 'Menyetujui RAB...',
  failed: 'RAB belum dapat disetujui. Coba lagi atau periksa kembali status RAB.',
} as const;

/** One human sentence per server reason. */
const BLOCKER_COPY: Record<string, string> = {
  NO_CONFIGURED_AUTHORITY:
    'RAB belum dapat disetujui karena belum ada Jabatan yang memegang kewenangan persetujuan RAB pada organisasi ini.',
  ACTOR_IS_NOT_HOLDER:
    'Anda tidak sedang memegang jabatan yang berwenang menyetujui RAB pada proyek ini.',
  PERMISSION_REQUIRED:
    'Akun Anda belum diberi hak akses untuk menjalankan persetujuan RAB.',
  ACTIVE_BASELINE_EXISTS:
    'Proyek ini sudah memiliki baseline resmi yang aktif.',
  APPROVED_WITHOUT_ACTIVE_BASELINE:
    'RAB tercatat disetujui tetapi baseline resminya tidak ditemukan. Hubungi pengelola SIMPROK sebelum melanjutkan.',
  RAB_NOT_LOCKED: 'RAB harus dikunci lebih dulu sebelum dapat disetujui.',
  RAB_DOCUMENT_NOT_FOUND: 'Belum ada RAB pada proyek ini yang dapat disetujui.',
  WORKING_DRAFT_NOT_FOUND: 'Belum ada RAB pada proyek ini yang dapat disetujui.',
  AMBIGUOUS_WORKING_DRAFT:
    'Proyek ini memiliki lebih dari satu draft RAB, sehingga SIMPROK tidak menentukan sendiri mana yang disetujui.',
  RAB_LOCK_PROVENANCE_CORRUPT:
    'Catatan penguncian RAB ini tidak lengkap, sehingga belum dapat disetujui.',
  PROJECT_NOT_FOUND: 'Proyek ini tidak dapat diakses.',
  APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED:
    'Jabatan Anda belum termasuk dalam aturan persetujuan RAB yang berlaku di organisasi ini.',
  APPROVAL_MATRIX_VALUE_OUT_OF_BAND:
    'Nilai RAB ini berada di luar batas kewenangan jabatan Anda.',
  RAB_TOTAL_UNKNOWN:
    'Nilai akhir RAB belum lengkap, sehingga batas kewenangan persetujuan tidak dapat diperiksa.',
};

export interface RabApprovalDoor {
  /** Show the approve action at all? */
  visible: boolean;
  /** May the reader press it? */
  enabled: boolean;
  /** The honest sentence. Empty when the door is simply open. */
  message: string;
  /**
   * "Kewenangan: PPK, Kepala Bidang" — named from EXISTING governance so the
   * reader knows who to ask. Empty when SIMPROK cannot name anyone, which is
   * itself the governance blocker rather than a prompt to pick someone.
   */
  authorizedLabel: string;
}

const positionLabel = (position: RabApprovalPositionWire): string =>
  (position.name ?? '').trim() || (position.code ?? '').trim();

export const resolveRabApprovalDoor = (
  gate: RabApprovalGateWire | null | undefined,
): RabApprovalDoor => {
  const names = (gate?.authorizedPositions ?? [])
    .map(positionLabel)
    .filter((label) => label.length > 0);
  const authorizedLabel = names.length > 0 ? `Kewenangan: ${names.join(', ')}` : '';

  // Told nothing yet. Said plainly rather than guessed into an open door.
  if (!gate) {
    return { visible: false, enabled: false, message: '', authorizedLabel: '' };
  }

  if (gate.canApprove === true) {
    return { visible: true, enabled: true, message: '', authorizedLabel };
  }

  const blocker = gate.blocker ?? null;

  // Already approved, or already governed by a baseline: nothing to offer and
  // nothing to complain about. The status chip already states the truth.
  if (blocker === 'ACTIVE_BASELINE_EXISTS') {
    return { visible: false, enabled: false, message: '', authorizedLabel };
  }

  // A RAB that is not yet locked has its own door elsewhere ("Kunci RAB").
  // Repeating "lock it first" on this card would be a second instruction for
  // an act the reader already has a button for.
  if (blocker === 'RAB_NOT_LOCKED' || blocker === 'RAB_DOCUMENT_NOT_FOUND' || blocker === 'WORKING_DRAFT_NOT_FOUND') {
    return { visible: false, enabled: false, message: '', authorizedLabel: '' };
  }

  return {
    // HONEST, NOT HIDDEN. A locked RAB that cannot be approved says why, in
    // grey — never a full-colour door that lands nowhere.
    visible: true,
    enabled: false,
    message:
      (blocker ? BLOCKER_COPY[blocker] : undefined) ??
      'RAB belum dapat disetujui pada keadaan ini.',
    authorizedLabel,
  };
};

/** The refusal the command itself may return, in the Owner's own words. */
export const rabApprovalRefusalMessage = (reason?: string | null): string =>
  (reason ? BLOCKER_COPY[reason] : undefined) ?? RAB_APPROVAL_COPY.failed;
