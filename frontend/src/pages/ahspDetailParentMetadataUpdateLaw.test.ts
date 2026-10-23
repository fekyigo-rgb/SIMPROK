import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync('src/pages/AhspDetailPage.tsx', 'utf8');
const styles = readFileSync('src/styles/ahspDetailApproved.css', 'utf8');
const controller = readFileSync('../backend/src/ahsp/ahsp.controller.ts', 'utf8');
const service = readFileSync('../backend/src/ahsp/services/ahsp.service.ts', 'utf8');
const policy = readFileSync('../backend/src/ahsp/domain/ahsp-ownership.policy.ts', 'utf8');

test('Uraian, Kode and Keterangan read from one canonical parent response', () => {
  for (const f of ['setEditMethodName(data.methodName ??', 'setEditCode(data.code ??', 'setEditKeterangan(data.keterangan ??']) {
    assert.ok(detail.includes(f), f);
  }
  assert.ok(detail.includes("infoRow('Kode', orDash(presentAhspIdentity(ahsp).code))"));
  assert.ok(detail.includes("infoRow('Uraian', orDash(ahsp.methodName))"));
  assert.ok(detail.includes("infoRow('Keterangan', orDash(ahsp.keterangan))"));
  assert.ok(detail.includes("infoRow('Tanggal input', formatIndoDate(ahsp.createdAt))"));
  assert.ok(!detail.includes("infoRow('Tanggal dibuat'"));
});

test('one audited PATCH handles all changed parent fields in one transaction', () => {
  const writer = detail.slice(detail.indexOf('const saveBasicInfo = async'), detail.indexOf('const addVersion = async'));
  assert.ok(writer.includes("apiFetch('/ahsp/' + encodeURIComponent(ahspId)"));
  assert.ok(writer.includes("method: 'PATCH'"));
  assert.ok(writer.includes('...(nameChanged ? { methodName } : {})'));
  assert.ok(writer.includes('...(codeChanged ? { code: code || null } : {})'));
  assert.ok(writer.includes('...(noteChanged ? { keterangan } : {})'));
  assert.ok(writer.includes('reason,'));
  assert.ok(writer.includes('setMetadataBusy(true)'));
  assert.equal((writer.match(/method: 'PATCH'/g) ?? []).length, 1);
  assert.ok(!writer.includes('resourceId:'));
  assert.ok(!writer.includes("'/versions'"));
  assert.ok(!detail.includes('const saveAhspCode = async'));
  assert.ok(!detail.includes('const saveParentMetadata = async'));
});

test('atomic form validates title, optional code, reason and frozen proposal', () => {
  const writer = detail.slice(detail.indexOf('const saveBasicInfo = async'), detail.indexOf('const addVersion = async'));
  assert.ok(writer.includes('if (!methodName)'));
  assert.ok(writer.includes('if (!nameChanged && !codeChanged && !noteChanged)'));
  assert.ok(writer.includes('if (codeChanged && prior.proposedAt)'));
  assert.ok(writer.includes('if (!reason)'));
  assert.ok(writer.includes("prior.ownershipType !== 'USER_ASSET'"));
  assert.ok(writer.includes('prior.workspaceId === null'));
  assert.ok(writer.includes('prior.archivedAt'));
  assert.ok(writer.includes("response.status === 409"));
});

test('canonical read-back checks ALL three values and preserves unsaved version edits', () => {
  const writer = detail.slice(detail.indexOf('const saveBasicInfo = async'), detail.indexOf('const addVersion = async'));
  assert.ok(writer.includes("const updated = (await readBack.json()) as AhspDetail"));
  for (const check of [
    "(updated.methodName ?? '').trim() !== methodName",
    "(updated.code ?? '').trim() !== code",
    "(updated.keterangan ?? '').trim() !== keterangan",
  ]) assert.ok(writer.includes(check), check);
  assert.ok(writer.includes("setState({ phase: 'READY', ahsp: updated })"));
  assert.ok(!writer.includes('applyPayload(updated)'));
  const versionWriter = detail.slice(detail.indexOf('const addVersion = async'), detail.indexOf('const ahsp = state.phase'));
  assert.ok(versionWriter.includes("apiFetch('/ahsp/' + ahspId + '/versions'"));
  assert.ok(!versionWriter.includes('editMethodName'));
  assert.ok(!versionWriter.includes('editKeterangan'));
  assert.ok(!versionWriter.includes('editCode'));
});

test('one action button, cancel and fields remain outside recipe POST form', () => {
  const start = detail.indexOf('<section className="ahsp-detail-metadata-editor"');
  const end = detail.indexOf('<form aria-label="Update AHSP"', start);
  assert.ok(start > 0 && end > start);
  const section = detail.slice(start, end);
  for (const s of ['Uraian / Judul AHSP', 'Kode (opsional)', 'Keterangan (opsional)', 'Alasan perubahan (untuk audit)', 'Simpan Informasi Dasar', 'Batal']) {
    assert.ok(section.includes(s), s);
  }
  assert.equal((section.match(/Simpan Informasi Dasar/g) ?? []).length, 1);
  assert.ok(!section.includes('Simpan Kode'));
  assert.ok(!section.includes('Simpan Uraian & Keterangan'));
  assert.ok(!section.includes('<form'));
  assert.ok(detail.includes("ahsp.ownershipType === 'USER_ASSET' ? ("));
  assert.match(styles, /\.ahsp-detail-metadata-editor__field textarea\s*\{[^}]*min-height:\s*70px;/s);
});

test('Dasar AHSP and Penerbit keep canonical current-version linkage', () => {
  assert.ok(detail.includes('aria-label="Dasar AHSP"'));
  assert.ok(detail.includes('value={regulationReference}'));
  assert.ok(detail.includes("infoRow('Dasar AHSP', orDash(currentVersion?.regulationReference))"));
  assert.ok(detail.includes('aria-label="Penerbit AHSP"'));
  assert.ok(detail.includes('value={issuerInstitution}'));
  assert.ok(detail.includes("infoRow('Penerbit', orDash(currentVersion?.issuerInstitution))"));
});

test('existing backend guards parent updates and official assets', () => {
  assert.ok(controller.includes("@Patch(':id')"));
  assert.ok(controller.includes("@Permissions('AHSP_MANAGE')"));
  assert.ok(service.includes('identitySafe.methodName = updateData.methodName'));
  assert.ok(service.includes('identitySafe.keterangan = note.length > 0 ? note : null'));
  assert.ok(policy.includes("SIMPROK_ASSET cannot be updated."));
  assert.ok(policy.includes("APPROVED_COMMUNITY_ASSET cannot be updated."));
  assert.ok(policy.includes("this.ensureReasonProvided(reason, 'update')"));
});
