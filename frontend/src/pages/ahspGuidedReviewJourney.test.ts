import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { nextSavedImportAction, type ImportJobView } from '../utils/ahspImportIntakeDisplay.ts';

const page = readFileSync('src/pages/AhspImportPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahsp.css', 'utf8');

const base: ImportJobView = {
  key: 'stored-job-1',
  title: 'AHSP BINA MARGA.xlsx',
  recordedAtLine: '29 Okt 2026',
  receivedLine: '71 pekerjaan diterima',
  waitingLine: '0 menunggu',
  deletedAhsp: 0,
  historyOnlyDeleted: false,
  waitingItems: [],
  waitingShown: 5,
  moreWaitingLine: null,
  decisionLine: null,
  summaryLine: 'Belum ada yang lengkap untuk tahap AHSP.',
  attention: [],
  canRecheck: false,
  recheckWarranted: false,
};

test('direct saved-review URL selects its own journal, never stale temporary selection', () => {
  assert.match(page, /const effectiveSavedImportId = isReviewPage \? reviewJobId : selectedSavedImport/);
  assert.match(page, /entry\.item\.key === effectiveSavedImportId/);
  assert.match(page, /selectedReviewJob \? importJobList/);
});

test('one true next action chooses a person decision before identity, unit or recheck', () => {
  const job: ImportJobView = {
    ...base, canRecheck: true,
    waitingItems: [{
      key: '1',
      title: 'Galian tanah',
      reason: 'Kemungkinan sama',
      unknownUnits: [{ spelling: 'm3?', uses: 1 }],
      sameness: { verdict: 'POSSIBLY_IDENTICAL' } as ImportJobView['waitingItems'][number]['sameness'],
      decisionFor: { workType: 'a', methodName: 'b' },
    }],
    attention: [{ key: 'identity', tone: 'IDENTITY', title: 'Identitas', detail: 'Belum pasti' }],
  };
  const next = nextSavedImportAction(job, true);
  assert.equal(next.kind, 'DECIDE');
  assert.match(next.buttonLabel ?? '', /keputusan AHSP/);
});

test('unit questions precede resource identity; both open existing lawful controls', () => {
  const job: ImportJobView = {
    ...base, canRecheck: true,
    waitingItems: [{
      key: '1', title: 'Unit missing', reason: 'Satuan',
      unknownUnits: [{ spelling: 'kg?', uses: 3 }],
      sameness: null, decisionFor: null,
    }],
    attention: [{ key: 'identity', tone: 'IDENTITY', title: 'Identitas', detail: 'Belum pasti' }],
  };
  assert.equal(nextSavedImportAction(job, true).kind, 'UNIT');
  assert.equal(nextSavedImportAction({ ...job, waitingItems: [] }, true).kind, 'IDENTITY');
  assert.equal(nextSavedImportAction({ ...job, waitingItems: [] }, false).kind, 'BLOCKED');
  assert.match(page, /void openIdentityReview\(\{ kind: 'importJobId', importJobId: selectedReviewJob\.key \}\)/);
  assert.match(page, /setUnitDoor\(\{ spelling: null, lineKey: null, source: 'job'/);
});

test('recheck is available only for server journal with waiting items', () => {
  assert.equal(nextSavedImportAction({ ...base, canRecheck: true }, true).kind, 'RECHECK');
  assert.equal(nextSavedImportAction({ ...base, deletedAhsp: 68, historyOnlyDeleted: true }, true).kind, 'BLOCKED');
  assert.equal(nextSavedImportAction(base, true).kind, 'VERIFY');
});

test('cannot show a fake finish or deleted AHSP restore action', () => {
  assert.match(page, /Jalur penyelesaian dokumen ini/);
  assert.match(page, /Langkah Anda berikutnya/);
  assert.match(page, /68 AHSP terhapus belum aktif|selectedReviewJob\.deletedAhsp/);
  assert.match(page, /Tidak ada tindakan lanjutan yang sah dari halaman ini/);
  assert.ok(!page.includes('restoreDeletedAhsp('));
  assert.match(css, /\.ahsp-guided-review__steps/);
});
