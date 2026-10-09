import assert from 'node:assert/strict';
import test from 'node:test';
import { appendBoqImportApprovalIdentity } from './boqImportApproval.ts';

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
