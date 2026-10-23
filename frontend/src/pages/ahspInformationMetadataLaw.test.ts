import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const manual = readFileSync('src/pages/AhspManualPage.tsx', 'utf8');
const panel = detail.slice(
  detail.indexOf('aria-label="Informasi AHSP"'),
  detail.indexOf('aria-label="Tentang AHSP Ini"'),
);

function ordered(source: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment, cursor + 1);
    assert.ok(position > cursor, 'Out of order/missing: ' + fragment);
    cursor = position;
  }
}

test('Owner UI: Informasi AHSP order begins with code, work description and output unit', () => {
  ordered(panel, [
    "infoRow('Kode'",
    "infoRow('Uraian'",
    "infoRow('Satuan'",
    'classificationPaths.length > 0',
  ]);
  assert.equal((panel.match(/infoRow\('Uraian'/g) ?? []).length, 1);
  assert.equal((panel.match(/infoRow\('Satuan'/g) ?? []).length, 1);
});

test('Owner UI: classifications precede note in BOTH canonical and fallback paths', () => {
  ordered(panel, [
    "groupedClassificationValue(classificationPaths, 'jenisPengadaan')",
    "groupedClassificationValue(classificationPaths, 'kategori')",
    "groupedClassificationValue(classificationPaths, 'subkategori')",
    "groupedClassificationValue(classificationPaths, 'jenisPekerjaan')",
    "infoRow('Jenis Pengadaan', orDash(ahsp.classification))",
    "infoRow('Kategori', orDash(ahsp.fieldCategory))",
    "infoRow('Subkategori', orDash(ahsp.subCategory))",
    "infoRow('Jenis Pekerjaan', orDash(presentAhspIdentity(ahsp).workType))",
    "infoRow('Keterangan'",
    "infoRow('Dasar AHSP'",
    "infoRow('Penerbit'",
    "infoRow('Tanggal berlaku versi'",
    "infoRow('Sumber'",
    "'Status Usulan'",
    "infoRow('Tanggal input'",
    "infoRow('Terakhir diperbarui'",
  ]);
});

test('private author is not mislabeled as a public proposer', () => {
  assert.match(panel, /ahsp\.workspaceId === null[\s\S]*?infoRow\('Diusulkan oleh', orDash\(ahsp\.proposedByName \?\? 'Tidak tercatat'\)\)[\s\S]*?infoRow\('Dibuat oleh', orDash\(ahsp\.createdByEmail\)\)/);
  assert.ok(!panel.includes("infoRow('Diusulkan oleh', orDash(ahsp.createdByEmail))"));
  assert.ok(panel.includes("infoRow('Penerbit', orDash(currentVersion?.issuerInstitution))"));
});

test('Keterangan stays a plain optional source note with no explanatory panel or fake intelligence', () => {
  assert.ok(panel.includes("infoRow('Keterangan', orDash(ahsp.keterangan))"));
  assert.ok(!panel.includes('Apa fungsi Keterangan?'));
  assert.ok(!panel.includes('AHSP_KETERANGAN_HELP'));
  assert.ok(manual.includes('<span className="ahsp-field__label">Keterangan</span>'));
  assert.ok(manual.includes('placeholder="Catatan singkat (opsional)"'));
  assert.ok(!manual.includes('ahsp-keterangan-guide'));
  // Display and storage only: no new resource matcher or schedule engine.
  assert.ok(!panel.includes('ResourceIdentityResolutionService'));
});
