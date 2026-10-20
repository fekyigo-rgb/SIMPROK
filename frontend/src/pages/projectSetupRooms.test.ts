import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./ProjectSetupPage.tsx', import.meta.url),
  'utf8',
);

test('Persiapan RAB keeps the five owner rooms in order', () => {
  const labels = [
    'Informasi Proyek',
    'Klasifikasi Resmi',
    'Lokasi Resmi',
    'Alamat Detail',
    'Data Pendukung',
  ];
  let cursor = -1;
  for (const label of labels) {
    const at = source.indexOf(`aria-label="${label}"`, cursor + 1);
    assert.ok(at > cursor, label);
    cursor = at;
  }

  const information = source.slice(
    source.indexOf('aria-label="Informasi Proyek"'),
    source.indexOf('aria-label="Klasifikasi Resmi"'),
  );
  for (const field of [
    'Nama Proyek',
    'Tahun Anggaran / Tahun Harga',
    'Pemilik / Instansi',
    'Pagu Anggaran',
    'Kode Proyek / Kode RAB',
  ]) {
    assert.equal(information.includes(field), true, field);
  }

  const informationStart = source.indexOf('aria-label="Informasi Proyek"');
  const columns = source.indexOf('simprok-rab-identity__column', informationStart);
  const secondColumn = source.indexOf('simprok-rab-identity__column', columns + 1);
  const classification = source.indexOf('aria-label="Klasifikasi Resmi"');
  const left = source.slice(columns, secondColumn);
  const right = source.slice(secondColumn, classification);
  assert.ok(source.indexOf('simprok-rab-field--wide', informationStart) < columns);
  assert.equal(left.includes('Tahun Anggaran / Tahun Harga'), true);
  assert.equal(left.includes('Pemilik / Instansi'), true);
  assert.equal(left.includes('Pagu Anggaran'), false);
  assert.equal(right.includes('Pagu Anggaran'), true);
  assert.equal(right.includes('Kode Proyek / Kode RAB'), true);
  assert.equal(right.includes('Isi kode jika tersedia'), true);
  assert.equal(right.includes('Jika kosong, SIMPROK membuat kode draft unik.'), true);
  assert.equal(source.includes('Otomatis bila pola tersedia'), false);
  assert.equal(source.includes('{createView.primaryLabel}'), true);
  assert.equal(source.includes('Simpan Data'), false);
  assert.equal(source.includes('aria-required="true"'), true);

  const support = source.slice(source.indexOf('aria-label="Data Pendukung"'));
  assert.equal(support.includes('Pagu Anggaran'), false);
  assert.equal(support.includes('Kode Proyek / Kode RAB'), false);
  assert.equal(support.includes('Spesifikasi Material Utama'), true);
  assert.equal(source.includes('Tahan keterangan'), true);
  assert.equal(
    source.includes('Tidak menggantikan pilihan wilayah resmi.'),
    true,
  );
});
