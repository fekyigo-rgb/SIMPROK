export type RabStatus = 'draft' | 'terkunci' | 'approved' | 'berjalan' | 'selesai';

export interface RabLifecycleProjection {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: string | null;
  workingDraftCount: number;
  activeBaselineCount: number;
  approvedRabCount: number;
  lockedRabCount: number;
}

export interface ProjectCardActionInput {
  id: string;
  status: RabStatus;
  rabLifecycle?: RabLifecycleProjection;
}

export interface ProjectCardAction {
  label: string;
  path?: string;
  disabledReason?: string;
}

export const buildRabPath = (id: string) => `/project/${id}/rab`;
export const buildDetailPath = (id: string) => `/project/${id}/detail`;
export const buildContinueDraftPath = (id: string) => `/project/${id}/rab/workspace`;
export const buildUnlockPath = (id: string) => buildRabPath(id);

/**
 * One line per reason the server can give. Each states what is actually true
 * of that project — never a guess, and never a stronger claim (approved,
 * baseline) than the repository supports.
 */
const NOT_EDITABLE_LABEL: Record<string, string> = {
  ACTIVE_BASELINE_EXISTS: 'RAB Baseline',
  APPROVED_RAB_EXISTS: 'RAB Disetujui',
  RAB_LOCKED: 'RAB Terkunci',
  MULTIPLE_WORKING_DRAFTS: 'Draft Ganda',
  PROJECT_NOT_DRAFT: 'RAB Belum Dapat Diubah',
};

const NOT_EDITABLE_REASON: Record<string, string> = {
  ACTIVE_BASELINE_EXISTS: 'RAB proyek ini sudah menjadi baseline aktif.',
  APPROVED_RAB_EXISTS: 'RAB proyek ini sudah disetujui.',
  RAB_LOCKED:
    'RAB proyek ini sudah dikunci. Isinya dapat dibaca, tetapi tidak dapat diubah.',
  MULTIPLE_WORKING_DRAFTS:
    'Ada lebih dari satu draft kerja pada proyek ini. SIMPROK tidak memilih salah satu untuk Anda.',
  PROJECT_NOT_DRAFT: 'Proyek ini tidak lagi berada pada tahap perencanaan RAB.',
};

/**
 * Backend-derived RAB lifecycle is the sole authority on Working Draft
 * editability. Project.status only selects the informational fallback label
 * when the project is not lifecycle-editable — it never decides editability
 * itself.
 */
export function primaryAction(project: ProjectCardActionInput): ProjectCardAction {
  if (project.rabLifecycle?.canEnterEditableDraftWorkspace) {
    return project.rabLifecycle.workingDraftCount === 0
      ? { label: 'Mulai RAB', path: buildContinueDraftPath(project.id) }
      : { label: 'Lanjutkan Draft', path: buildContinueDraftPath(project.id) };
  }

  switch (project.status) {
    case 'draft':
      // Why the draft is not editable is a fact the server already states.
      // Guessing "baseline atau disetujui" told Owners their RAB was approved
      // when it was merely frozen, and named a baseline that did not exist.
      return {
        label: NOT_EDITABLE_LABEL[project.rabLifecycle?.reasonCode ?? ''] ?? 'RAB Belum Dapat Diubah',
        disabledReason:
          NOT_EDITABLE_REASON[project.rabLifecycle?.reasonCode ?? ''] ??
          'Draft RAB proyek ini belum dapat diubah.',
      };
    case 'terkunci':
      return {
        label: 'Buka Kunci',
        path: buildUnlockPath(project.id),
      };
    case 'approved':
      return {
        label: 'Monitoring HOLD',
        disabledReason: 'Monitoring belum aktif pada slice ini.',
      };
    case 'berjalan':
      return {
        label: 'Progress HOLD',
        disabledReason: 'Monitoring progress belum aktif pada slice ini.',
      };
    case 'selesai':
    default:
      return {
        label: 'Lihat Arsip',
        path: buildDetailPath(project.id),
      };
  }
}
