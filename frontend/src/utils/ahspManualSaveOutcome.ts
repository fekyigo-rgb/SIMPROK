/**
 * Wording is a projection of the existing POST /ahsp/manual disposition.
 * It NEVER decides whether the AHSP is a new parent, a revision or an
 * additional classification: that authority belongs to the backend.
 */
export type ManualSaveDisposition =
  | 'CREATED'
  | 'REVISION_CREATED'
  | 'CLASSIFICATION_EXTENDED'
  | 'UNCONFIRMED';

export function manualSaveDisposition(value: unknown): ManualSaveDisposition {
  if (value === 'CREATED' || value === 'REVISION_CREATED' || value === 'CLASSIFICATION_EXTENDED') {
    return value;
  }
  return 'UNCONFIRMED';
}

export function manualSaveOutcomeMessage(result: {
  name: string;
  disposition: ManualSaveDisposition;
  resourceReviewPrepared?: boolean;
}): string {
  const name = result.name;
  const base = result.disposition === 'CREATED'
    ? `AHSP "${name}" berhasil dibuat.`
    : result.disposition === 'REVISION_CREATED'
      ? `Revisi AHSP "${name}" berhasil disimpan pada AHSP yang sudah ada.`
      : result.disposition === 'CLASSIFICATION_EXTENDED'
        ? `Jalur klasifikasi untuk AHSP "${name}" berhasil ditambahkan pada AHSP yang sudah ada.`
        : `Server menerima penyimpanan AHSP "${name}", tetapi jenis hasil belum terkonfirmasi. Periksa Detail sebelum menyimpulkan bahwa AHSP baru dibuat.`;

  return result.resourceReviewPrepared === false
    ? `${base} Pemeriksaan sumber daya belum siap; lanjutkan pemeriksaan melalui Detail AHSP.`
    : base;
}
