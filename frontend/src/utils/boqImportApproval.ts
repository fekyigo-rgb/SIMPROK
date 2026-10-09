export interface BoqImportApprovalIdentity {
  intakeRequestId: string;
  importFingerprint: string;
  sheetName: string;
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
