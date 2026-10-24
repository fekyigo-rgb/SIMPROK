/** Bounded route-exit law, independent of UI and persistence implementation. */
export function shouldBlockRabLeave(input: {
  draftDirty: boolean;
  saving: boolean;
  currentPath: string;
  nextPath: string;
}): boolean {
  return (input.draftDirty || input.saving) && input.currentPath !== input.nextPath;
}

export function shouldWarnOnBrowserExit(input: { draftDirty: boolean; saving: boolean }): boolean {
  return input.draftDirty || input.saving;
}

/** A successful network reply cannot overwrite a later local revision. */
export function isFreshDraftSave(input: {
  submittedProjectId: string;
  currentProjectId: string | null;
  submittedRevision: number;
  currentRevision: number;
}): boolean {
  return input.currentProjectId === input.submittedProjectId
    && input.currentRevision === input.submittedRevision;
}
