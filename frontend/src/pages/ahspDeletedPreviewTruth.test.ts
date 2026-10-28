import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  confirmImportDoorRows,
  confirmImportFigures,
  isDeletedIdentical,
  previewIdentityQuestions,
  previewIntakeLine,
} from '../utils/ahspImportIntakeDisplay.ts';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

const live = (index: number) => ({
  admission: 'PROVEN',
  identityVerdict: 'IDENTICAL',
  identityMatches: [{ ahspId: 'live-' + index, deleted: false }],
});
const deleted = (index: number) => ({
  admission: 'PROVEN',
  identityVerdict: 'IDENTICAL',
  identityMatches: [{ ahspId: 'deleted-' + index, deleted: true }],
});

test('the Owner 71-case discloses 3 live, 68 deleted, 0 new and 68 requiring handling', () => {
  const cases = [
    ...Array.from({ length: 3 }, (_, index) => live(index)),
    ...Array.from({ length: 68 }, (_, index) => deleted(index)),
  ];
  assert.deepEqual(confirmImportFigures(cases), {
    understood: 71,
    already: 3,
    willSave: 0,
    needsReview: 68,
    cannotSave: 0,
    deleted: 68,
  });
  assert.equal(confirmImportDoorRows(cases, 'understood').length, 71);
  assert.equal(confirmImportDoorRows(cases, 'existing').length, 3);
  assert.equal(confirmImportDoorRows(cases, 'review').length, 68);
  assert.equal(confirmImportDoorRows(cases, 'willSave').length, 0);
  assert.match(previewIntakeLine(cases), /68 AHSP cocok dengan riwayat yang sudah dihapus/);
  assert.match(previewIntakeLine(cases), /3 AHSP masih ada di SIMPROK/);
  assert.doesNotMatch(previewIntakeLine(cases), /71 siap digunakan/);
});

test('soft-deleted canonical identity is never treated as active or a new parent', () => {
  assert.equal(isDeletedIdentical(deleted(1)), true);
  assert.equal(isDeletedIdentical(live(1)), false);
  assert.equal(isDeletedIdentical({ identityVerdict: 'POSSIBLY_IDENTICAL', identityMatches: [{ deleted: true }] }), false);
  const mixed = [
    { ...deleted(1), admission: 'HELD' },
    { admission: 'IDENTITY_PENDING', identityVerdict: 'DISTINCT' },
    live(2),
  ];
  assert.deepEqual(confirmImportFigures(mixed), {
    understood: 3, already: 1, willSave: 1, needsReview: 2, cannotSave: 1, deleted: 1,
  });
  assert.deepEqual(confirmImportDoorRows(mixed, 'review').map(({ index }) => index), [0,1]);
});

test('identity questions are independent of the deleted count and not multiplied into AHSPs', () => {
  const entries = [{
    resources: [
      { group: 'MATERIAL', rawName: 'Semen', rawCode: 'M12', rawUnit: 'Kg', reasonCodes: ['RESOURCE_UNRESOLVED'] },
      { group: 'MATERIAL', rawName: 'Semen', rawCode: 'M12', rawUnit: 'Kg', reasonCodes: ['RESOURCE_UNRESOLVED'] },
      { group: 'EQUIPMENT', rawName: 'Excavator', rawCode: 'E1', rawUnit: 'Jam', reasonCodes: ['RESOURCE_CANDIDATES_FOUND'] },
    ],
  }];
  const questions = previewIdentityQuestions(entries);
  assert.equal(questions.length, 2);
  assert.equal(questions.reduce((sum,q) => sum+q.uses,0),3);
  assert.equal(confirmImportFigures([deleted(1)]).needsReview,1);
});

test('deleted-card review is a real navigable door and not an automatic restore', () => {
  assert.match(page, /Periksa \{distinctIdentities\(deletedIdentical\)\} AHSP yang dihapus/);
  assert.match(page, /setJourneyStep\('confirm'\);\s*openConfirmDoor\('review'\)/);
  assert.match(page, /isDeletedIdentical\(item\)/);
  assert.match(page, /Terhapus — perlu pemeriksaan/);
  assert.match(page, /Tidak dapat digunakan, disimpan sebagai induk duplikat, atau dipulihkan otomatis/);
  assert.match(page, /previewIdentityRows\.slice\(0, showAllPreviewQuestions \? undefined : 12\)/);
  assert.match(css, /\.ahsp-deleted-review-notice/);
  assert.ok(!page.includes('restoreDeletedAhsp('));
});
