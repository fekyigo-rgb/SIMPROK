import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const style = readFileSync('src/styles/ahspDetailApproved.css', 'utf8');

test('locked AHSP validity card keeps existing source truth and distinguishes proposal approval', () => {
  assert.ok(detail.includes('aria-label="AHSP yang berlaku"'));
  assert.ok(detail.includes('currentVersion && !outOfForce'));
  assert.ok(detail.includes('ahsp-detail-action-card--valid'));
  assert.ok(detail.includes('AHSP yang saat ini digunakan SIMPROK.'));
  assert.ok(detail.includes('{workspaceOwned && currentVersion && !outOfForce ? ('));
  assert.ok(detail.includes('bukan pernyataan bahwa AHSP telah disetujui untuk pustaka SIMPROK'));
  assert.ok(detail.includes('Periksa Status Usulan pada Informasi AHSP.'));
  assert.ok(detail.includes('const proposalStatus = ahsp ? describeAhspProposalStatus(ahsp)'));
  assert.ok(detail.includes("infoRow(\n                  'Status Usulan'"));
  assert.ok(!detail.includes('className="ahsp-detail-action__status-scope"'));
  assert.ok(style.includes('.ahsp-detail-status-help__tooltip'));
});

test('validity explanation is hidden by default and available on hover, keyboard focus or info tap', () => {
  const card = detail.slice(detail.indexOf('{/*\n            AHSP YANG BERLAKU'), detail.indexOf('{/* Lower accordions: Update AHSP'));
  assert.ok(card.includes('<h2 className="ahsp-detail-action__title">AHSP yang berlaku</h2>'));
  assert.ok(card.includes('<p className="ahsp-detail-action__description">AHSP yang saat ini digunakan SIMPROK.</p>'));
  assert.ok(card.includes('className="ahsp-detail-status-help__trigger"'));
  assert.ok(card.includes('aria-label="Keterangan status AHSP yang berlaku"'));
  assert.ok(card.includes('aria-controls="ahsp-validity-note"'));
  assert.ok(card.includes('aria-expanded={showValidStatusNote}'));
  assert.ok(card.includes('onClick={() => setShowValidStatusNote((open) => !open)}'));
  assert.ok(card.includes("if (event.key === 'Escape') setShowValidStatusNote(false);"));
  assert.ok(card.includes('role="tooltip"'));
  assert.ok(card.includes('id="ahsp-validity-note"'));
  assert.ok(card.includes("data-open={showValidStatusNote ? 'true' : 'false'}"));
  assert.equal((card.match(/Berlaku sebagai versi AHSP saat ini;/g) ?? []).length, 1);
  assert.ok(!card.includes('ahsp-detail-action__status-scope'));
  assert.match(style, /\.ahsp-detail-status-help__tooltip\s*\{[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;/s);
  assert.match(style, /\.ahsp-detail-action-card--valid:hover \.ahsp-detail-status-help__tooltip/);
  assert.match(style, /\.ahsp-detail-status-help__trigger:focus-visible \+ \.ahsp-detail-status-help__tooltip/);
  assert.ok(style.includes(".ahsp-detail-status-help__tooltip[data-open='true']"));
  assert.match(style, /\.ahsp-detail-action-card--valid\s*\{[^}]*overflow:\s*visible;/s);
  assert.match(style, /\.ahsp-detail-status-help__tooltip\s*\{[^}]*bottom:\s*100%;/s);
  assert.ok(!card.includes('apiFetch('), 'UI tooltip must not mutate data');
});

test('validity tooltip is not clipped by the later base-card overflow rule (CSS cascade regression)', () => {
  const validRule = /^\.ahsp-detail-action-card\.ahsp-detail-action-card--valid\s*\{([^}]+)\}/m.exec(style);
  const baseRule = /^\.ahsp-detail-action-card\s*\{([^}]+)\}/m.exec(style);
  assert.ok(validRule, 'valid card must override generic clipping using a higher-specificity selector');
  assert.ok(baseRule, 'generic card rule remains untouched');
  assert.ok(validRule[1].includes('overflow: visible;'));
  assert.ok(baseRule[1].includes('overflow: hidden;'));
  assert.ok(style.indexOf(validRule[0]) < style.indexOf(baseRule[0]), 'regression: same specificity would be overwritten by later base rule');
  assert.ok(!/^\.ahsp-detail-action-card--valid\s*\{[^}]*overflow:\s*visible;/m.test(style), 'do not rely on same-specificity override');
  const trigger = /\.ahsp-detail-status-help__trigger\s*\{([^}]+)\}/.exec(style);
  assert.ok(trigger);
  assert.ok(trigger[1].includes('cursor: pointer;'), 'no misleading question-mark help cursor');
  assert.ok(!trigger[1].includes('cursor: help;'));
});

test('a repeated-looking component receives a non-destructive note, not a duplicate verdict', () => {
  assert.ok(detail.includes('const repeatedComponentLabels = useMemo(() => groups.flatMap((group) => {'));
  assert.ok(detail.includes('const seen = new Map<string, { name: string; unit: string; count: number }>()'));
  assert.ok(detail.includes("name.toLocaleLowerCase('id-ID')"));
  assert.ok(detail.includes("unit.toLocaleLowerCase('id-ID')"));
  assert.ok(detail.includes('if (prior) prior.count += 1;'));
  assert.ok(detail.includes('filter((row) => row.count > 1)'));
  assert.ok(detail.includes('repeatedComponentLabels.length > 0 ? ('));
  assert.ok(detail.includes('role="note" aria-label="Periksa komponen dengan uraian berulang"'));
  assert.ok(detail.includes('periksa apakah ini memang disengaja.'));
  assert.ok(style.includes('.ahsp-detail-repeated-note'));
});

test('duplicate-appearance notice retains every row and original coefficient', () => {
  assert.ok(detail.includes('groupAhspDefinitionResources(currentVersion?.resources)'));
  assert.ok(detail.includes('{groups.map((group) => ('));
  assert.ok(detail.includes('{group.rows.map((row, index) => ('));
  assert.ok(detail.includes('{row.coefficient}'));
  assert.ok(detail.includes('Baris serta koefisien tetap ditampilkan apa adanya'));
  const readPart = detail.slice(detail.indexOf('const repeatedComponentLabels = useMemo'), detail.indexOf('const presentedComponentUnit'));
  for (const forbidden of ['setResourceDrafts(', 'apiFetch(', '.splice(', '.filter((_,', 'POST', 'DELETE']) {
    assert.ok(!readPart.includes(forbidden), 'repeated hint must remain read-only: ' + forbidden);
  }
  assert.ok(detail.includes('if (!name ||'));
  assert.ok(detail.includes("'Nama sumber daya belum tersedia'"));
});
