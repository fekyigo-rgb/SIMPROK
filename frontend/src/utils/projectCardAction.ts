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
  path: string;
}

export const buildRabPath = (id: string) => `/project/${id}/rab`;
export const buildDetailPath = (id: string) => `/project/${id}/detail`;
export const buildContinueDraftPath = (id: string) => `/project/${id}/rab/workspace`;

/**
 * The card's action button, or nothing.
 *
 * A card used to always carry a button, so when there was nothing lawful to
 * do it invented something: an unlock control for a frozen RAB (there is no
 * reopen capability), monitoring and progress controls for engines that do
 * not exist yet, and a dead duplicate of the status badge sitting right next
 * to it. Each of those was a door painted on a wall.
 *
 * So there is one action here and only one: entering the Working Draft, which
 * the backend lifecycle says is genuinely open. Everything else on the card is
 * a real door already — the project name opens Ruang Hidup RAB and "Lihat
 * Detail" opens Detail Proyek — and the status badge is information, not a
 * control.
 */
export function primaryAction(project: ProjectCardActionInput): ProjectCardAction | null {
  if (!project.rabLifecycle?.canEnterEditableDraftWorkspace) return null;

  return {
    label: project.rabLifecycle.workingDraftCount === 0 ? 'Mulai RAB' : 'Lanjutkan Draft',
    path: buildContinueDraftPath(project.id),
  };
}
