import { RAB_LOCKED_REASON } from './rabLockDisplay.ts';

export interface RabLifecycleProjection {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: string | null;
  projectStatus?: string | null;
  workingDraftCount: number;
  activeBaselineCount: number;
  approvedRabCount: number;
  lockedRabCount: number;
}

export interface ProjectCardActionInput {
  id: string;
  rabLifecycle?: RabLifecycleProjection;
}

export interface ProjectCardAction {
  label: string;
  /** Present when the slot leads somewhere real. */
  path?: string;
  /** Present when the next capability is not built yet — said plainly. */
  disabledReason?: string;
}

export const buildRabPath = (id: string) => `/project/${id}/rab`;
export const buildDetailPath = (id: string) => `/project/${id}/detail`;
export const buildContinueDraftPath = (id: string) => `/project/${id}/rab/workspace`;

/**
 * The card's RAB lifecycle action slot.
 *
 * The slot is permanent. It is where each stage of the RAB's life offers its
 * own next step — continuing a draft today, and in later milestones the
 * gateways that follow approval and execution. Removing it whenever the next
 * capability is unbuilt would mean tearing the card apart and rebuilding it
 * every time one lands, so the slot stays and only its contents change.
 *
 * What the slot must never do is lie. It leads somewhere real, or it says
 * plainly that the machine behind it is not built. It is also not a second
 * way into a room the card already opens: the project name opens Ruang Hidup
 * RAB and "Lihat Detail" opens Detail Proyek, so this slot leads to Ruang
 * Kerja RAB — the RAB's own working room — and nowhere else.
 */
const LOCKED_GATEWAY_LABEL = 'Buka Ruang Kerja';

/**
 * Why the slot is waiting. Each states what is actually true of that project;
 * none claims a capability, and none borrows another reason's words.
 */
const WAITING_REASON: Record<string, string> = {
  APPROVED_RAB_EXISTS: 'RAB proyek ini sudah disetujui. Tindakan pelaksanaan belum bermesin.',
  ACTIVE_BASELINE_EXISTS:
    'RAB proyek ini sudah menjadi baseline aktif. Tindakan lanjutan belum bermesin.',
  MULTIPLE_WORKING_DRAFTS:
    'Ada lebih dari satu draft kerja pada proyek ini. SIMPROK tidak memilih salah satu untuk Anda.',
  PROJECT_NOT_DRAFT: 'Proyek ini tidak lagi berada pada tahap perencanaan RAB.',
};

export function primaryAction(project: ProjectCardActionInput): ProjectCardAction {
  const lifecycle = project.rabLifecycle;

  // DRAFT — the draft is open, so the slot opens it.
  if (lifecycle?.canEnterEditableDraftWorkspace) {
    return {
      label: lifecycle.workingDraftCount === 0 ? 'Mulai RAB' : 'Lanjutkan Draft',
      path: buildContinueDraftPath(project.id),
    };
  }

  // TERKUNCI — a frozen RAB is finished, not hidden. Ruang Kerja RAB opens it
  // read-only (RAB_LOCKED is the one refusal that presents as frozen rather
  // than denied), so this is a real door and not a reopen.
  if (lifecycle?.reasonCode === RAB_LOCKED_REASON) {
    return { label: LOCKED_GATEWAY_LABEL, path: buildContinueDraftPath(project.id) };
  }

  // Every other stage: the slot is held, and says so. No approval, monitoring,
  // progress, revision or addendum capability is implied or invented here.
  return {
    label: 'Menunggu Mesin',
    disabledReason:
      WAITING_REASON[lifecycle?.reasonCode ?? ''] ??
      'Tindakan lanjutan untuk status ini belum bermesin.',
  };
}
