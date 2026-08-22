import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  actualStateLabel,
  buildMonitoringRows,
  captureMethodLabel,
  dataThroughLabel,
  effectiveActual,
  lastRecordedLabel,
  lifecycleLabel,
  progressDetailPath,
  recordedAtLabel,
  selectedWorkItem,
  type MonitoringItem,
} from './monitoringCurrent.ts';

const item = (
  values: Partial<MonitoringItem> & Pick<MonitoringItem, 'id' | 'name'>,
): MonitoringItem => ({
  parentId: null,
  wbsNodeId: null,
  wbsCode: values.id,
  itemType: 'WORK_ITEM',
  sortOrder: 0,
  planned: { quantity: '10', unit: 'm3' },
  actual: {
    state: 'NOT_YET_RECORDED',
    effectiveRecord: null,
  },
  ...values,
});

test('H2-A0-1 hierarchy stays depth-first and structural rows remain visible', () => {
  const rows = buildMonitoringRows([
    item({ id: 'child-2', name: 'Child 2', parentId: 'folder', sortOrder: 3 }),
    item({
      id: 'folder',
      name: 'Folder',
      itemType: 'FOLDER',
      sortOrder: 1,
      actual: null,
    }),
    item({ id: 'child-1', name: 'Child 1', parentId: 'folder', sortOrder: 2 }),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.id, row.number, row.depth]),
    [
      ['folder', '1', 0],
      ['child-1', '1.1', 1],
      ['child-2', '1.2', 1],
    ],
  );
});

test('H2-A0-2 only a selected WORK_ITEM may drive contextual Actual', () => {
  const rows = buildMonitoringRows([
    item({ id: 'folder', name: 'Folder', itemType: 'FOLDER', actual: null }),
    item({ id: 'work', name: 'Work', parentId: 'folder', sortOrder: 1 }),
  ]);
  assert.equal(selectedWorkItem(rows, 'folder'), null);
  assert.equal(selectedWorkItem(rows, 'work')?.name, 'Work');
});

test('H2-A0-3 effectiveRecord is consumed and compatibility latestRecord is ignored', () => {
  const monitored = item({
    id: 'work',
    name: 'Work',
    actual: {
      state: 'RECORDED',
      lifecycleState: 'VERIFIED',
      effectiveRecord: {
        id: 'effective',
        installedQuantity: '2',
        workDate: '2026-05-20T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_MEASUREMENT',
        evidenceReferences: [],
        recordedByAccountId: 'actor',
        supersedesEntryId: 'original',
        recordedAt: '2026-05-22T00:00:00.000Z',
      },
      latestRecord: { id: 'compatibility', installedQuantity: '999' },
    },
  });

  assert.equal(effectiveActual(monitored)?.id, 'effective');
  assert.equal(effectiveActual(monitored)?.installedQuantity, '2');
});

test('H2-A0-4 numeric zero remains recorded and differs from no record', () => {
  const zero = item({
    id: 'zero',
    name: 'Zero',
    actual: {
      state: 'RECORDED',
      lifecycleState: 'SUBMITTED',
      effectiveRecord: {
        id: 'zero-entry',
        installedQuantity: '0',
        workDate: '2026-08-31T00:00:00.000Z',
        notes: null,
        captureMethod: 'FIELD_OBSERVATION',
        evidenceReferences: [],
        recordedByAccountId: null,
        supersedesEntryId: null,
        recordedAt: '2026-08-31T01:00:00.000Z',
      },
    },
  });
  const missing = item({ id: 'missing', name: 'Missing' });

  assert.equal(effectiveActual(zero)?.installedQuantity, '0');
  assert.equal(actualStateLabel(zero.actual), 'Diajukan');
  assert.equal(effectiveActual(missing), null);
  assert.equal(actualStateLabel(missing.actual), 'BELUM DICATAT');
  assert.equal(
    actualStateLabel({ state: 'UNAVAILABLE', effectiveRecord: null }),
    'TIDAK TERSEDIA',
  );
});

test('H2-A0-5 lifecycle governance states use bounded Indonesian labels', () => {
  assert.equal(lifecycleLabel('LEGACY_UNSPECIFIED'), 'Status lama');
  assert.equal(lifecycleLabel('RECORDED'), 'Tercatat');
  assert.equal(lifecycleLabel('SUBMITTED'), 'Diajukan');
  assert.equal(lifecycleLabel('VERIFIED'), 'Terverifikasi');
  assert.equal(lifecycleLabel('ACCEPTED'), 'Diterima');
  const unknown = lifecycleLabel('SOME_FUTURE_UNKNOWN_STATE');
  assert.equal(unknown, 'Status belum dikenali');
  assert.ok(
    ![
      'TIDAK TERSEDIA',
      'Tercatat',
      'Diajukan',
      'Terverifikasi',
      'Diterima',
    ].includes(unknown),
  );
});

test('H2-A0-5b capture methods distinguish unrecognized from unavailable', () => {
  const knownLabels = [
    'Observasi lapangan',
    'Pengukuran lapangan',
    'Referensi dokumen',
    'Metode tidak tersedia',
  ];
  assert.equal(captureMethodLabel('FIELD_OBSERVATION'), knownLabels[0]);
  assert.equal(captureMethodLabel('FIELD_MEASUREMENT'), knownLabels[1]);
  assert.equal(captureMethodLabel('DOCUMENT_REFERENCE'), knownLabels[2]);
  assert.equal(captureMethodLabel('LEGACY_UNSPECIFIED'), knownLabels[3]);
  const unknown = captureMethodLabel('SOME_FUTURE_CAPTURE_METHOD');
  assert.equal(unknown, 'Metode belum dikenali');
  assert.ok(!['TIDAK TERSEDIA', ...knownLabels].includes(unknown));
});

test('H2-A0-6 workDate and recordedAt keep different meanings and timezone bases', () => {
  assert.equal(
    dataThroughLabel({
      state: 'RECORDED',
      workDate: '2026-05-20T00:00:00.000Z',
    }),
    '20 Mei 2026',
  );
  const freshness = lastRecordedLabel(
    { state: 'RECORDED', recordedAt: '2026-05-22T00:00:00.000Z' },
    'Asia/Jayapura',
  );
  assert.match(freshness.value, /22 Mei 2026/);
  assert.match(freshness.value, /09\.00/);
  assert.equal(freshness.basis, 'Waktu proyek (Asia/Jayapura)');
  assert.notEqual(
    dataThroughLabel({
      state: 'RECORDED',
      workDate: '2026-05-20T00:00:00.000Z',
    }),
    freshness.value,
  );
  assert.match(
    recordedAtLabel('2026-05-22T00:00:00.000Z', 'Asia/Jayapura').value,
    /09\.00/,
  );
});

test('H2-A0-7 empty freshness is explicit and never becomes the current date or zero', () => {
  assert.equal(
    dataThroughLabel({ state: 'NOT_YET_RECORDED', workDate: null }),
    'BELUM DICATAT',
  );
  assert.deepEqual(
    lastRecordedLabel(
      { state: 'NOT_YET_RECORDED', recordedAt: null },
      'Asia/Makassar',
    ),
    { value: 'BELUM DICATAT', basis: '' },
  );
});

test('H2-A0-8 the healthy progress-detail door remains exact', () => {
  assert.equal(
    progressDetailPath('project-1', 'item-1'),
    '/field/project/project-1/progress/item-1',
  );
});

test('H2-A0-9 the shell states project scope, Terkini, and both freshness meanings', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, /SELURUH PROYEK/);
  assert.match(page, />TERKINI</);
  assert.match(page, /Data pekerjaan sampai/);
  assert.match(page, /Terakhir diperbarui/);
  assert.match(page, /effectiveActual\(row\)/);
  assert.doesNotMatch(page, /actual\.latestRecord/);
});

test('H2-A0-10 the product surface uses human language without exposing internal identity', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.match(page, />Monitoring Proyek</);
  assert.match(page, /item pekerjaan/);
  assert.match(page, /Pekerjaan · \{selected\.number\}/);
  assert.match(page, /<dt>Status Realisasi<\/dt>/);
  assert.match(page, /<dt>Tanggal Pekerjaan<\/dt>/);
  assert.match(page, /<dt>Dicatat di SIMPROK<\/dt>/);
  assert.doesNotMatch(page, />[^<{]*WORK_ITEM[^<{]*</);
  assert.doesNotMatch(page, /\(workDate\)|\(recordedAt\)/);
  assert.doesNotMatch(page, /\{project\.code\}\s*·\s*\{project\.id\}/);
  assert.doesNotMatch(
    page,
    /<code>\{monitoring\.baseline\.id\}<\/code>/,
  );
  assert.equal((page.match(/<dt>Status Realisasi<\/dt>/g) ?? []).length, 1);
  assert.doesNotMatch(page, /<dt>Lifecycle<\/dt>/);
});

test('H2-A0-11 the shell neither consumes legacy reality nor paints later truth', () => {
  const page = readFileSync('src/pages/field/ProjectWorkPage.tsx', 'utf8');
  assert.doesNotMatch(page, /\/reality|ProjectWarRoomPage|DeviationService/);
  assert.doesNotMatch(
    page,
    /Kurva S|plannedWeight|planned-to-date|Forecast|Recovery|CPM/,
  );
  assert.doesNotMatch(page, />\s*Network\s*</);
  assert.match(page, /bukan persentase kemajuan proyek/);
  assert.match(page, /bukan\s+total realisasi, realisasi kumulatif, atau persentase kemajuan\s+proyek/);
  assert.match(page, /Buka Detail Progress/);
});
