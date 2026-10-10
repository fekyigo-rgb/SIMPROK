import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBoqImportApprovalIdentity, dismissBoqImportPreview, requiresBoqImportConfirmation } from './boqImportApproval.ts';

test('preview identity is handed to approve without an account id input', () => {
  const fields: Array<[string, string]> = [];
  appendBoqImportApprovalIdentity(
    { append: (name, value) => fields.push([name, String(value)]) },
    {
      intakeRequestId: 'request-01',
      importFingerprint: 'ABC123',
      sheetName: 'RAB',
    },
  );

  assert.deepEqual(fields, [
    ['intakeRequestId', 'request-01'],
    ['selectedSheet', 'RAB'],
    ['importFingerprint', 'ABC123'],
  ]);
  assert.equal(fields.some(([name]) => /account/i.test(name)), false);
});

test('first import stays direct, replacing items or unsaved edits needs confirmation', () => {
  const empty = { existingItemCount: 0, previouslyAppliedToThisDraft: false };
  const reused = { existingItemCount: 4, previouslyAppliedToThisDraft: true };
  assert.equal(requiresBoqImportConfirmation(empty, false, 0), false);
  assert.equal(requiresBoqImportConfirmation(reused, false, 0), true);
  assert.equal(requiresBoqImportConfirmation(empty, true, 0), true);
  assert.equal(requiresBoqImportConfirmation(empty, false, 3), true);
  assert.equal(requiresBoqImportConfirmation(null, false, 3), true);
  assert.equal(requiresBoqImportConfirmation(undefined, false, 0), false);
});

test('X Hapus clears only transient BOQ preview/file/dialog and releases the file input', () => {
  let confirmOpen = true;
  let preview: { intakeRequestId: string } | null = { intakeRequestId: 'request-01' };
  let file: string | null = 'BOQ.xlsx';
  let status = 'Preview BOQ siap';
  const fileInput = { value: 'C:\\fakepath\\BOQ.xlsx' };
  const draftRows = ['PEKERJAAN PERSIAPAN', 'Mobilisasi', 'PEKERJAAN TANAH', 'Galian tanah'];
  const draftBefore = [...draftRows];

  const dismissed = dismissBoqImportPreview({
    isImporting: false,
    setConfirmOpen: (next) => { confirmOpen = next; },
    setPreview: (next) => { preview = next; },
    setFile: (next) => { file = next; },
    fileInput,
    setStatusMessage: (next) => { status = next; },
  });

  assert.equal(dismissed, true);
  assert.equal(confirmOpen, false);
  assert.equal(preview, null);
  assert.equal(file, null);
  assert.equal(fileInput.value, '');
  assert.match(status, /Working Draft tidak diubah/);
  assert.deepEqual(draftRows, draftBefore);
});

test('X Hapus is inert while import is running', () => {
  const calls: string[] = [];
  const fileInput = { value: 'BOQ.xlsx' };
  const dismissed = dismissBoqImportPreview({
    isImporting: true,
    setConfirmOpen: () => { calls.push('confirm'); },
    setPreview: () => { calls.push('preview'); },
    setFile: () => { calls.push('file'); },
    fileInput,
    setStatusMessage: () => { calls.push('message'); },
  });

  assert.equal(dismissed, false);
  assert.deepEqual(calls, []);
  assert.equal(fileInput.value, 'BOQ.xlsx');
});

test('X Hapus safely dismisses a preview without a mounted file input', () => {
  const cleared: string[] = [];
  assert.equal(dismissBoqImportPreview({
    isImporting: false,
    setConfirmOpen: () => { cleared.push('confirm'); },
    setPreview: () => { cleared.push('preview'); },
    setFile: () => { cleared.push('file'); },
    fileInput: null,
    setStatusMessage: () => { cleared.push('message'); },
  }), true);
  assert.deepEqual(cleared, ['confirm', 'preview', 'file', 'message']);
});
