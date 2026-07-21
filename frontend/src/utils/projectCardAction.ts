export type RabStatus = 'draft' | 'terkunci' | 'approved' | 'berjalan' | 'selesai';

export interface RabLifecycleProjection {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: string | null;
  workingDraftCount: number;
  activeBaselineCount: number;
  approvedRabCount: number;
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
      return {
        label: 'RAB Terkunci',
        disabledReason: 'RAB proyek ini sudah menjadi baseline atau telah disetujui.',
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
