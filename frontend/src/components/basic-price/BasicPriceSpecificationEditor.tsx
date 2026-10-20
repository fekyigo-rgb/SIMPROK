import { useState } from 'react';
import {
  SPEC_FIELDS,
  specificationInitialFields,
  specificationFormDecision,
  type SourceSpecFact,
  type StoredSpecDecision,
  type SpecFields,
  type SpecDecisionKind,
} from '../../utils/basicPriceSpecificationForm';

interface Props {
  rowNumber: number;
  sourceSpecifications?: SourceSpecFact[];
  specificationDecision?: StoredSpecDecision | null;
  mutable: boolean;
  disabled: boolean;
  onSave: (specifications: Record<string, string>, kind: SpecDecisionKind, reason?: string) => Promise<boolean>;
}

/** Human intent only. Existing Basic Price endpoint and canonical identity service remain the authorities. */
export function BasicPriceSpecificationEditor({
  rowNumber, sourceSpecifications, specificationDecision, mutable, disabled, onSave,
}: Props) {
  const [values, setValues] = useState<SpecFields>(
    () => specificationInitialFields(sourceSpecifications, specificationDecision),
  );
  const [kind, setKind] = useState<SpecDecisionKind>('SUPPLEMENT');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const decision = specificationFormDecision(values, sourceSpecifications, specificationDecision, kind, reason);

  return (
    <details className="bp-details" aria-label={'Spesifikasi manual baris ' + rowNumber}>
      <summary>
        {specificationDecision ? 'Spesifikasi terverifikasi — Lihat / Lengkapi' : 'Lengkapi Merek, Tipe, Ukuran & Spesifikasi (opsional)'}
      </summary>
      <p className="bp-field__help">
        Isi hanya fakta yang Anda periksa; kosong berarti belum diketahui. SIMPROK tidak menebak merek, tipe, atau ukuran dari nama item.
        Teks asli Excel tetap tersimpan dan pencocokan identitas diperiksa ulang setelah keputusan ini.
      </p>
      {sourceSpecifications?.length ? (
        <p className="bp-field__help" role="note">
          Nilai spesifikasi yang tertulis di Excel tidak boleh diubah melalui Tambahkan. Untuk memperbaikinya pilih Koreksi dan tulis alasan.
        </p>
      ) : (
        <p className="bp-field__help" role="note">Excel tidak menyediakan kolom spesifikasi tersendiri. Anda boleh melengkapi berdasarkan pemeriksaan manusia.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {SPEC_FIELDS.map((field) => (
          <label className="bp-field" key={field.key}>
            <span className="bp-field__label">{field.label}</span>
            <input
              className="bp-input"
              type="text"
              maxLength={240}
              aria-label={field.label + ' baris ' + rowNumber}
              value={values[field.key] ?? ''}
              disabled={!mutable || disabled || sending}
              placeholder="Belum diketahui"
              onChange={(event) => {
                setValues((current) => ({ ...current, [field.key]: event.target.value }));
                setMessage('');
              }}
            />
          </label>
        ))}
      </div>
      {mutable ? (
        <>
          <label className="bp-field">
            <span className="bp-field__label">Jenis keputusan spesifikasi</span>
            <select
              className="bp-input"
              value={kind}
              disabled={disabled || sending}
              onChange={(event) => { setKind(event.target.value as SpecDecisionKind); setMessage(''); }}
              aria-label={'Keputusan spesifikasi baris ' + rowNumber}
            >
              <option value="SUPPLEMENT">Tambahkan fakta tanpa mengganti yang telah diperiksa</option>
              <option value="CORRECT">Koreksi fakta sumber / keputusan sebelumnya (wajib alasan)</option>
            </select>
          </label>
          <label className="bp-field">
            <span className="bp-field__label">Alasan {kind === 'CORRECT' ? '(wajib)' : '(opsional)'}</span>
            <textarea className="bp-input" rows={2} maxLength={1000} value={reason}
              disabled={disabled || sending} aria-label={'Alasan spesifikasi baris ' + rowNumber}
              onChange={(event) => { setReason(event.target.value); setMessage(''); }}
              placeholder="Contoh: diperiksa dari label kemasan / spesifikasi teknis yang sah" />
          </label>
          <button type="button" className="bp-btn bp-btn--primary bp-btn--sm"
            disabled={disabled || sending || !decision.ok}
            aria-disabled={disabled || sending || !decision.ok}
            onClick={() => {
              if (!decision.ok || disabled || sending) return;
              setSending(true);
              void onSave(decision.confirmedSpecifications, kind, decision.reason)
                .then((ok) => { if (ok) setMessage('Keputusan tersimpan; pemeriksaan identitas telah diminta ulang dari SIMPROK.'); })
                .finally(() => setSending(false));
            }}>
            {sending ? 'Mencatat keputusan...' : 'Simpan spesifikasi yang telah diperiksa'}
          </button>
          {!decision.ok ? <p className="bp-field__help" role="status">{decision.message}</p> : null}
        </>
      ) : null}
      {message ? <p className="bp-field__help" role="status">{message}</p> : null}
      {specificationDecision ? (
        <p className="bp-field__help" role="status">
          Keputusan {specificationDecision.decisionKind} tersimpan pada versi {specificationDecision.resultingVersion}.
          Ini bukan otomatis persetujuan bahwa dua resource sama.
        </p>
      ) : null}
    </details>
  );
}
