import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { confirmImportDoorRows, confirmImportFigures, previewIdentityQuestions } from '../utils/ahspImportIntakeDisplay.ts';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

test('four summary doors use the existing admission truth and do not invent AHSP creation', () => {
  const cases = [
    { admission: 'PROVEN', identityVerdict: 'DISTINCT' },
    { admission: 'IDENTITY_PENDING', identityVerdict: 'UNRESOLVED' },
    { admission: 'HELD', identityVerdict: 'UNRESOLVED' },
    { admission: 'PROVEN', identityVerdict: 'IDENTICAL' },
    { admission: 'HELD', identityVerdict: 'IDENTICAL' },
  ];
  assert.deepEqual(confirmImportFigures(cases), {
    understood: 5, already: 1, willSave: 2, needsReview: 3, cannotSave: 2,
  });
  assert.deepEqual(confirmImportDoorRows(cases, 'understood').map((row) => row.index), [0,1,2,3,4]);
  assert.deepEqual(confirmImportDoorRows(cases, 'existing').map((row) => row.index), [3]);
  assert.deepEqual(confirmImportDoorRows(cases, 'willSave').map((row) => row.index), [0,1]);
  assert.deepEqual(confirmImportDoorRows(cases, 'review').map((row) => row.index), [1,2,4]);
  for (const name of ['understood','existing','willSave','review']) {
    assert.ok(page.includes("onClick={() => openConfirmDoor('" + name + "')}"), name);
  }
  assert.match(css, /button\.ahsp-confirm-summary__card:focus-visible/);
});

test('an identity review click before save opens a preview rather than a missing saved queue', () => {
  assert.match(page, /const previewIdentityDoor = unitScope\?\.source === 'preview' && !settled && isIdentity/);
  assert.match(page, /if \(previewIdentityDoor\) openConfirmDoor\('review'\)/);
  assert.match(page, /previewIdentityRows\.slice\(0, showAllPreviewQuestions \? undefined : 12\)/);
  assert.match(page, /onClick=\{moveToPrimarySave\}/);
  assert.match(page, /ref=\{primarySaveRef\}/);
  assert.ok(!page.includes('POST /resource-observations'));
});

test('identical source questions are grouped without inferring unknown identities', () => {
  const resource = { group: 'MATERIAL', rawName: 'Pasir', rawCode: 'M1', rawUnit: 'm3', reasonCodes: ['RESOURCE_UNRESOLVED'] };
  const items = [
    { resources: [resource, resource, { ...resource, group: 'LABOR' }, { ...resource, resolvedResourceCatalogId: 'known' }] },
    { resources: [resource, { ...resource, rawCode: 'M2', reasonCodes: ['RESOURCE_CANDIDATES_FOUND'] }] },
  ];
  const questions = previewIdentityQuestions(items);
  assert.equal(questions.length, 3);
  assert.deepEqual(questions.map((q) => q.uses), [3,1,1]);
  assert.equal(questions.reduce((sum,q) => sum+q.uses,0), 5);
});

test('the saved document uses PR221 review route; no parallel writer or legacy route', () => {
  assert.match(page, /navigate\('\/ahsp\/import\/review\/' \+ encodeURIComponent\(commitResult\.importJobId!\)\)/);
  assert.match(page, /const isReviewPage = reviewJobId !== null/);
  assert.match(page, /\/ahsp\/document\/commit/);
  assert.match(page, /\/ahsp\/document\/jobs\//);
  assert.match(page, /settled && commitResult\?\.importJobId/);
  assert.ok(!page.includes('setResolutionOpen'));
});
