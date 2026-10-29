import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  previewCatalogNameImpact,
  correctActiveResourceCatalogName,
  type CatalogNameImpact,
} from '../../api/basicPriceExplorer';

/**
 * AHSP is a SECOND CONSUMER of the existing BP-C3 preview + canonical
 * ResourceCatalogNameCorrectionService, NOT a new catalog writer or matcher.
 *
 * The source observation spelling door and the catalog-name door are strictly
 * independent. This component never selects a resource candidate.
 */
export function CatalogNameReviewDoor({
  resourceCatalogId,
  resourceName,
  onCatalogNameSaved,
}: {
  resourceCatalogId: string;
  resourceName: string;
  onCatalogNameSaved: () => Promise<void>;
}) {
  const { hasPermission } = useAuth();
  const canPreview = hasPermission('BASIC_PRICE_VIEW');
  const canCorrect = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  const [proposal, setProposal] = useState(resourceName);
  const [result, setResult] = useState<CatalogNameImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [verified, setVerified] = useState(false);
  const [sourceReference, setSourceReference] = useState('');
  const [catalogCode, setCatalogCode] = useState('');
  const [nomenclatureVerified, setNomenclatureVerified] = useState(false);

  const changeProposal = (value: string) => {
    setProposal(value);
    setResult(null);
    setError(null);
    setReceipt(null);
    setVerified(false);
    setNomenclatureVerified(false);
  };
  const preview = async () => {
    if (busy || !canPreview || proposal.trim().length < 3) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setReceipt(null);
    try {
      setResult(await previewCatalogNameImpact(resourceCatalogId, proposal.trim()));
    } catch {
      setError('Dampak nama katalog tidak dapat diperiksa untuk resource ini. Bisa jadi katalog bersama, tidak aktif, atau akses belum sesuai. Tidak ada data diubah; keputusan identitas tetap terpisah.');
    } finally {
      setBusy(false);
    }
  };
  const writableVerdict = result?.verdict === 'SPELLING_ONLY_PREVIEW' ||
    result?.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED';
  const nomenclature = result?.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED';
  const codeCorrect = !!result?.resourceCode &&
    catalogCode.trim().toLocaleLowerCase('id-ID') === result.resourceCode.toLocaleLowerCase('id-ID');
  const ready = canCorrect && writableVerdict && verified &&
    reason.trim().length >= 10 && evidence.trim().length >= 20 &&
    (!nomenclature || (nomenclatureVerified && sourceReference.trim().length >= 12 && codeCorrect));

  const save = async () => {
    if (!result || !ready || busy) return;
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      await correctActiveResourceCatalogName(resourceCatalogId, {
        previousName: result.currentName,
        correctedName: result.proposedName,
        expectedUpdatedAt: result.observedVersion,
        reason: reason.trim(),
        evidence: evidence.trim(),
        sameIdentityConfirmed: true,
        nomenclatureVerified: nomenclature && nomenclatureVerified,
        confirmedCatalogCode: nomenclature ? catalogCode.trim() : undefined,
        sourceReference: nomenclature ? sourceReference.trim() : undefined,
      });
      // BP-C3's live read is the authority for the visible after-save state.
      // A successful POST alone is not proof of an updated catalog name.
      const readback = await previewCatalogNameImpact(resourceCatalogId, result.proposedName);
      if (readback.verdict !== 'NO_CHANGE' || readback.currentName !== result.proposedName) {
        setError('Permintaan diterima, tetapi nama baru belum terbukti lewat pembacaan ulang. Periksa kembali katalog sebelum melanjutkan.');
        setResult(null);
        return;
      }
      setProposal(readback.currentName);
      setVerified(false);
      setNomenclatureVerified(false);
      setReceipt('Nama katalog telah disimpan dan dibaca kembali pada ID resource yang sama. Nama Excel asli, harga, dan satuan tidak diubah. Keputusan padanan tetap dilakukan terpisah.');
      setResult(null);
      try {
        await onCatalogNameSaved();
      } catch {
        setError('Nama katalog sudah terbukti berubah, tetapi daftar AHSP belum dapat dimuat ulang. Muat ulang daftar sebelum menentukan padanan.');
      }
    } catch {
      setError('Koreksi nama katalog belum terbukti berhasil. Izin, kepemilikan resource, kesamaan identitas, atau versi dapat menjadi penyebab. Periksa dampaknya kembali; jangan membuat resource duplikat.');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="ahsp-catalog-name-door">
      <summary>Nama padanan di katalog kurang tepat? Periksa namanya</summary>
      <p className="ahsp-line ahsp-line--abu">
        Jika nama dalam Excel juga salah, gunakan “Perbaiki ejaan sumber” di atas. Bagian ini hanya memeriksa dan membenahi nama katalog SIMPROK, bukan memilih padanan atau membuat item baru. Pemeriksaannya sama dengan di Basic Price.
      </p>
      <p className="ahsp-line">Nama katalog saat ini: <strong>{resourceName}</strong></p>
      {!canPreview ? (
        <p className="ahsp-line ahsp-line--abu" role="status">
          Akun ini belum memiliki izin melihat pemeriksaan dampak Basic Price. Keputusan identitas AHSP tetap dapat dilanjutkan; nama katalog belum dikoreksi.
        </p>
      ) : (
        <>
          <label className="ahsp-catalog-name-door__field">
            Usulan nama katalog yang benar
            <input value={proposal} maxLength={180} disabled={busy}
              onChange={(event) => changeProposal(event.target.value)} />
          </label>
          <button type="button" className="ahsp-action ahsp-action--outline"
            disabled={busy || proposal.trim().length < 3 || proposal.trim() === resourceName}
            onClick={() => void preview()}>
            {busy ? 'Memeriksa…' : 'Periksa dampak tanpa menyimpan'}
          </button>
          {result ? (
            <div className="ahsp-catalog-name-door__result" role="status">
              <p><strong>Nama lama:</strong> {result.currentName}</p>
              <p><strong>Usulan:</strong> {result.proposedName}</p>
              <p><strong>Jenis:</strong> {result.resourceType} · <strong>Kode:</strong> {result.resourceCode ?? 'tidak tersedia'} · <strong>Satuan:</strong> {result.baseUnit}</p>
              <p><strong>Spesifikasi terbukti:</strong> {result.specificationFacts.length > 0
                ? result.specificationFacts.map((entry) => entry.name + ': ' + entry.value).join('; ')
                : 'belum tersedia'}</p>
              <p>Dipakai oleh {result.impact.basicPrices} Basic Price, {result.impact.projectAhspResolutions} AHSP proyek, {result.impact.importRows} baris impor, {result.impact.sourceIdentityRecords} catatan sumber, dan {result.impact.conversionRules} aturan konversi.</p>
              <p>{result.verdict === 'SPELLING_ONLY_PREVIEW'
                ? 'Penulisan tampak berbeda tanpa indikasi perubahan teknis. Tetap wajib bukti identitas.'
                : result.verdict === 'NOMENCLATURE_VERIFICATION_REQUIRED'
                  ? 'Nomenklatur perlu penetapan nyata oleh kurator; kode dan referensi koreksi harus dikonfirmasi.'
                  : result.verdict === 'NO_CHANGE'
                    ? 'Tidak ada perubahan nama.'
                    : result.verdict === 'IDENTITY_CONFLICT_REVIEW_REQUIRED'
                      ? 'Ada benturan dengan identitas lain. Jangan mengubah nama atau memaksakan padanan.'
                      : 'Perubahan mungkin mengubah identitas atau spesifikasi. Gunakan pemeriksaan identitas, bukan koreksi nama.'}</p>
              {writableVerdict && !canCorrect ? (
                <p className="ahsp-line ahsp-line--abu">Pemeriksaan selesai, tetapi akun ini tidak memiliki kewenangan koreksi katalog.</p>
              ) : null}
              {writableVerdict && canCorrect ? (
                <>
                  {nomenclature ? (
                    <>
                      <label className="ahsp-catalog-name-door__field">
                        Referensi nyata penetapan nama oleh Owner/kurator
                        <input value={sourceReference} maxLength={350}
                          onChange={(event) => setSourceReference(event.target.value)} />
                      </label>
                      <label className="ahsp-catalog-name-door__field">
                        Ketik ulang kode katalog ({result.resourceCode ?? 'tidak tersedia'})
                        <input value={catalogCode} maxLength={80}
                          onChange={(event) => setCatalogCode(event.target.value)} />
                      </label>
                      <label className="ahsp-catalog-name-door__check">
                        <input type="checkbox" checked={nomenclatureVerified}
                          onChange={(event) => setNomenclatureVerified(event.target.checked)} />
                        Saya telah memeriksa penetapan nomenklatur untuk resource yang sama, bukan menyatakan dua istilah otomatis sinonim.
                      </label>
                    </>
                  ) : null}
                  <label className="ahsp-catalog-name-door__field">
                    Alasan koreksi (minimal 10 karakter)
                    <textarea value={reason} rows={2} maxLength={500}
                      onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <label className="ahsp-catalog-name-door__field">
                    Bukti identitas dan spesifikasi tetap sama (minimal 20 karakter)
                    <textarea value={evidence} rows={3} maxLength={2000}
                      onChange={(event) => setEvidence(event.target.value)} />
                  </label>
                  <label className="ahsp-catalog-name-door__check">
                    <input type="checkbox" checked={verified}
                      onChange={(event) => setVerified(event.target.checked)} />
                    Saya telah memeriksa bahwa yang diperbaiki hanya nama katalog dari resource yang sama.
                  </label>
                  <button type="button" className="ahsp-action ahsp-action--primary"
                    disabled={busy || !ready} onClick={() => void save()}>
                    {busy ? 'Menyimpan dan membaca ulang…' : 'Konfirmasi & Simpan Koreksi Nama Katalog'}
                  </button>
                  {!ready ? <p className="ahsp-line ahsp-line--abu">Simpan hanya aktif setelah alasan, bukti, dan konfirmasi dipenuhi. Server tetap memeriksa izin, pemilik, versi, spesifikasi, benturan, dan jurnal audit.</p> : null}
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {error ? <p role="alert" className="ahsp-line ahsp-line--abu">{error}</p> : null}
      {receipt ? <p role="status" className="ahsp-line">{receipt}</p> : null}
    </details>
  );
}
