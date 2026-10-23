import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const css = readFileSync('src/styles/ahspDetailUpdateResponsive.css', 'utf8');

test('responsive mockup scoped to AHSP Detail, not Basic Price or RAB', () => {
  assert.ok(page.includes("import '../styles/ahspDetailUpdateResponsive.css'"));
  assert.match(css, /\.ahsp-detail-basic-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.25fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.ahsp-detail-update__table thead\s*\{\s*display:\s*none;/);
  assert.match(css, /\.ahsp-detail-update__table td::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.ok(!css.includes('.bp-'));
  assert.ok(!css.includes('.rab-'));
});

test('Owner: Edit button has WHITE background, distinct from Hapus', () => {
  assert.match(css, /\.ahsp-detail-update__edit\s*\{[^}]*background:\s*#fff;[^}]*color:\s*#0878d1;/);
  assert.match(css, /\.ahsp-detail-update__delete\s*\{[^}]*background:\s*#fff3f3;/);
  assert.ok(page.includes('className="ahsp-detail-update__edit"'));
  assert.ok(page.includes('className="ahsp-detail-update__delete"'));
  assert.ok(page.includes("aria-label={(isEditing ? 'Selesai edit komponen ' : 'Edit komponen ')"));
  assert.ok(page.includes('aria-label={\'Hapus komponen \' + (index + 1)}'));
});

test('source metadata has 4 existing fields wired to existing version update', () => {
  assert.ok(page.includes('className="ahsp-detail-update__source-grid"'));
  for (const label of ['Satuan AHSP', 'Dasar AHSP', 'Penerbit AHSP', 'Tanggal berlaku versi AHSP']) {
    assert.ok(page.includes('aria-label="' + label + '"'), label);
  }
  const writer = page.slice(page.indexOf('const addVersion = async'), page.indexOf('const ahsp = state.phase'));
  for (const key of ['outputUnit:', 'regulationReference:', 'issuerInstitution:', 'effectiveDate:', 'resources,']) {
    assert.ok(writer.includes(key), key);
  }
});

test('source date is the stored effective version date, visible read-only with truthful save instructions', () => {
  const info = page.slice(page.indexOf('aria-label="Informasi AHSP"'), page.indexOf('aria-label="Tentang AHSP Ini"'));
  const source = page.slice(page.indexOf('aria-label="Informasi sumber AHSP"'), page.indexOf('aria-label="Edit komponen pembentuk AHSP"'));
  const writer = page.slice(page.indexOf('const addVersion = async'), page.indexOf('const ahsp = state.phase'));
  assert.ok(info.includes("infoRow('Tanggal berlaku versi', currentVersion?.effectiveDate ? formatIndoDate(currentVersion.effectiveDate) : '—')"));
  assert.ok(source.includes('<span>Tanggal berlaku versi AHSP</span>'));
  assert.ok(source.includes('aria-label="Tanggal berlaku versi AHSP"'));
  assert.ok(source.includes('value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}'));
  assert.ok(source.includes('Tanggal berlaku adalah tanggal versi AHSP, bukan tanggal penerbitan dokumen.'));
  assert.ok(source.includes('Perubahan Informasi Sumber disimpan bersama Komponen sebagai versi rumus baru'));
  assert.ok(source.includes('<strong>Simpan Perubahan Komponen</strong>'));
  assert.ok(css.includes('.ahsp-detail-update__source-hint {'));
  assert.ok(writer.includes("apiFetch('/ahsp/' + ahspId + '/versions'"));
  assert.ok(writer.includes('verifySavedVersion(detail, ahspId, receipt.id'));
  assert.ok(!source.includes('apiFetch('));
});

test('stored resource name is read-only while composition values enter edit mode', () => {
  assert.ok(page.includes("const [editingResourceIndex, setEditingResourceIndex]"));
  assert.ok(page.includes('const isEditing = editingResourceIndex === index'));
  assert.ok(page.includes('const active = isEditing || !row.stored'));
  assert.ok(page.includes('resolveDefinitionResourceName({ resourceId: row.resourceId, resourceName: row.resourceName })'));
  assert.ok(page.includes('Penggantian nama perlu pemadanan Resource Identity.'));
  assert.ok(page.includes('setEditingResourceOriginal({ ...row })'));
  assert.ok(page.includes('setEditingResourceIndex(null)'));
  assert.ok(page.includes('if (editingResourceIndex !== null)'));
  assert.ok(page.includes("aria-label={'Koefisien ' + (index + 1)}"));
  assert.ok(page.includes('Tambah Baris Komponen'));
  assert.ok(page.includes('Simpan Perubahan Komponen'));
});

test('table desktop headers and mobile card labels are aligned to mockup', () => {
  assert.ok(page.includes('className="ahsp-detail-update__table"'));
  for (const header of ['No.', 'Uraian', 'Jenis', 'Satuan', 'Koefisien', 'Aksi']) {
    assert.ok(page.includes('>' + header + '</th>'), header);
    assert.ok(page.includes('data-label="' + header + '"'), header);
  }
  assert.match(css, /\.ahsp-detail-update__table th\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);/);
  assert.match(css, /\.ahsp-detail-update__field input,[\s\S]*?min-width:\s*0;[\s\S]*?height:\s*42px;/);
  assert.ok(css.includes('overflow-x: auto;'));
  assert.ok(css.includes('max-width: 100%;'));
});

test('single basic-info button issues one change and does not call formula POST', () => {
  assert.ok(page.includes('Simpan Informasi Dasar'));
  assert.ok(!page.includes('Simpan Kode'));
  assert.ok(!page.includes('Simpan Uraian & Keterangan'));
  const meta = page.slice(page.indexOf('const saveBasicInfo = async'), page.indexOf('const addVersion = async'));
  assert.equal((meta.match(/method: 'PATCH'/g) ?? []).length, 1);
  assert.ok(meta.includes('...(codeChanged ? { code: code || null } : {})'));
  assert.ok(meta.includes('...(nameChanged ? { methodName } : {})'));
  assert.ok(meta.includes('...(noteChanged ? { keterangan } : {})'));
  assert.ok(meta.includes('if (codeChanged && prior.proposedAt)'));
  assert.ok(meta.includes('setState({ phase: \'READY\', ahsp: updated })'));
  assert.ok(!meta.includes("'/versions'"));
});


test('only ONE add-component control remains and it uses solid SIMPROK blue', () => {
  assert.ok(!page.includes('+ Tambah Komponen'));
  assert.equal((page.match(/Tambah Baris Komponen/g) ?? []).length, 1);
  assert.ok(page.includes('className="ahsp-detail-update__add ahsp-detail-update__add--primary"'));
  assert.match(css, /\.ahsp-detail-update__add\.ahsp-detail-update__add--primary\s*\{[^}]*background:\s*var\(--simprok-trust-blue-500\);/s);
  assert.match(page, /Tambah Baris Komponen[\s\S]*?Batal Perubahan[\s\S]*?Simpan Perubahan Komponen/);
});

test('global Batal Perubahan returns ALL version fields and rows to latest stored version', () => {
  const footer = page.slice(page.indexOf('className="ahsp-detail-update__footer"'), page.indexOf('</section>', page.indexOf('className="ahsp-detail-update__footer"')));
  assert.ok(footer.includes('type="button" className="ahsp-detail-update__cancel"'));
  assert.ok(footer.includes('setResourceDrafts(draftsFromVersion(currentVersion))'));
  for (const p of [
    "setOutputUnit(currentVersion?.outputUnit ?? '')",
    "setRegulationReference(currentVersion?.regulationReference ?? '')",
    "setIssuerInstitution(currentVersion?.issuerInstitution ?? '')",
    'setEffectiveDate(toDateInput(currentVersion?.effectiveDate))',
    'setEditingResourceIndex(null)',
    'setEditingResourceOriginal(null)',
    "setActionNotice('Perubahan Informasi Sumber dan Komponen dibatalkan.')",
    'clearSaveFeedback()',
  ]) assert.ok(footer.includes(p), p);
  assert.ok(!footer.includes('setEditMethodName('));
  assert.ok(!footer.includes('setEditKeterangan('));
  assert.ok(!footer.includes('setEditCode('));
  assert.ok(!footer.includes('apiFetch('));
});

test('all intentional AHSP cancellations use temporary neutral status, not error or success', () => {
  assert.ok(page.includes('const [actionNotice, setActionNotice] = useState<string | null>(null)'));
  assert.ok(page.includes('setActionNotice(null);'));
  assert.ok(page.includes('window.setTimeout(() => setActionNotice(null), 5000)'));
  assert.ok(page.includes('return () => window.clearTimeout(timeoutId)'));
  assert.ok(page.includes('}, [actionNotice]);'));
  assert.ok(page.includes('role="status" aria-live="polite" aria-atomic="true"'));
  assert.ok(page.includes("background: '#F5FBFF', border: '1px solid #B7DCFF', color: '#15365F'"));
  assert.ok(page.includes('onCancelled={onClassificationCancelled}'));
  for (const message of [
    'Penambahan klasifikasi dibatalkan.',
    'Perubahan Informasi Dasar dibatalkan.',
    'Perubahan Informasi Sumber dan Komponen dibatalkan.',
  ]) {
    assert.ok(page.includes(`setActionNotice('${message}')`), message);
    assert.ok(!page.includes(`setActionError('${message}')`), message);
    assert.ok(!page.includes(`setMetadataFeedback('${message}')`), message);
  }
  assert.ok(page.includes("background: '#FFF1F1', border: '1px solid #C0392B'"));
  assert.ok(page.includes("background: '#EAF8EF', border: '1px solid #16803C'"));
});

test('global save continues existing ONE immutable-version submission, no parallel writer', () => {
  const writer = page.slice(page.indexOf('const addVersion = async'), page.indexOf('const ahsp = state.phase'));
  assert.equal((writer.match(/method: 'POST'/g) ?? []).length, 1);
  assert.ok(writer.includes("apiFetch('/ahsp/' + ahspId + '/versions'"));
  assert.ok(writer.includes('resources,'));
  assert.ok(writer.includes('setBusy(true)'));
  const footer = page.slice(page.indexOf('className="ahsp-detail-update__footer"'), page.indexOf('</section>', page.indexOf('className="ahsp-detail-update__footer"')));
  assert.equal((footer.match(/type="submit"/g) ?? []).length, 1);
  assert.ok(footer.includes('Simpan Perubahan Komponen'));
  assert.ok(footer.includes('disabled={busy || editingResourceIndex !== null}'));
});

test('desktop rows are compact; mobile buttons and inputs remain large and accessible', () => {
  assert.match(css, /\.ahsp-detail-update__table td\s*\{\s*padding:\s*5px 8px;/);
  assert.match(css, /\.ahsp-detail-update__table :is\(input, select\)\s*\{\s*height:\s*34px;/);
  assert.match(css, /\.ahsp-detail-update__row-actions button\s*\{\s*min-height:\s*32px;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.ahsp-detail-update__row-actions button\s*\{[\s\S]*?min-height:\s*44px;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.ahsp-detail-update__table :is\(input, select\)\s*\{ height:\s*44px; \}/);
  assert.ok(css.includes('.ahsp-detail-update__footer-actions > button'));
});

test('hapus komponen is draft-only and displays truthful unsaved notice until cancel or verified save', () => {
  const remove = page.slice(page.indexOf("aria-label={'Hapus komponen '"), page.indexOf('}}>Hapus</button>') + 16);
  assert.ok(remove.includes('setResourceDrafts((current) => current.filter'));
  assert.ok(remove.includes('setComponentRemovalNotice(true)'));
  assert.ok(!remove.includes('apiFetch('));
  assert.ok(page.includes('role="status" aria-live="polite"'));
  assert.ok(page.includes('Baris telah dihapus dari draft saja, belum dari AHSP tersimpan.'));
  assert.ok(page.includes('Simpan Perubahan Komponen</strong> untuk menyimpan'));
  assert.ok(page.includes('Batal Perubahan</strong> untuk mengembalikan daftar.'));
  assert.ok(page.includes('setResourceDrafts(draftsFromVersion(current));\n    setComponentRemovalNotice(false);'));
  assert.ok(page.includes('setResourceDrafts(draftsFromVersion(currentVersion));\n                          setComponentRemovalNotice(false);'));
  assert.match(css, /\.ahsp-detail-update__draft-removal-notice\s*\{/);
});
