export interface BoqImportApprovalIdentity {
  intakeRequestId: string;
  importFingerprint: string;
  sheetName: string;
}

export interface BoqImportDraftImpact {
  existingItemCount: number;
  previouslyAppliedToThisDraft: boolean;
}

/** Only a presentation decision: the canonical backend approve stays unchanged. */
export function requiresBoqImportConfirmation(
  impact: BoqImportDraftImpact | null | undefined,
  hasUnsavedEdits: boolean,
  visibleRowCount: number,
): boolean {
  return hasUnsavedEdits || visibleRowCount > 0 || (impact?.existingItemCount ?? 0) > 0;
}

/** Presentation-only cleanup: never receives an API client or Working Draft writer. */
export interface BoqImportPreviewDismissPorts {
  isImporting: boolean;
  setConfirmOpen: (open: boolean) => void;
  setPreview: (preview: null) => void;
  setFile: (file: null) => void;
  fileInput: { value: string } | null;
  setStatusMessage: (message: string) => void;
}

export function dismissBoqImportPreview(ports: BoqImportPreviewDismissPorts): boolean {
  if (ports.isImporting) return false;
  ports.setConfirmOpen(false);
  ports.setPreview(null);
  ports.setFile(null);
  if (ports.fileInput) ports.fileInput.value = '';
  ports.setStatusMessage('Preview BOQ dibersihkan. Working Draft tidak diubah.');
  return true;
}

type ApprovalForm = Pick<FormData, 'append'>;

/** Carries the server-minted preview identity into approve without user input. */
export function appendBoqImportApprovalIdentity(
  form: ApprovalForm,
  preview: BoqImportApprovalIdentity,
): void {
  form.append('intakeRequestId', preview.intakeRequestId);
  form.append('selectedSheet', preview.sheetName);
  form.append('importFingerprint', preview.importFingerprint);
}
