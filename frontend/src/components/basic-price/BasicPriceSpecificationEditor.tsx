import { useState } from 'react';
import {
  SPEC_FIELDS,
  SPEC_IDENTITY_FIELDS,
  SPEC_TECHNICAL_FIELDS,
  SPEC_DIMENSION_FIELDS,
  SPEC_LEGACY_FIELDS,
  specificationInitialFields,
  specificationFormDecision,
  readCapacitySpecification,
  writeCapacitySpecification,
  nextUnusedCapacityRow,
  SPEC_CAPACITY_TYPES,
  SPEC_CAPACITY_GROUPS,
  SPEC_CAPACITY_ALL_UNITS,
  type CapacityRow,
  type SourceSpecFact,
  type StoredSpecDecision,
  type SpecFields,
  type SpecDecisionKind,
} from '../../utils/basicPriceSpecificationForm';

interface Props {
  rowNumber: number;
  sourceSpecifications?: SourceSpecFact[];
  sourceKeterangan?: string | null;
  specificationDecision?: StoredSpecDecision | null;
  reviewedCapacity?: { status: 'ABSENT' | 'STRUCTURED' | 'UNPARSED'; facts: Array<{ kind: string; value: string; unit: string }> };
  mutable: boolean;
  disabled: boolean;
  saveBlockedReason?: string | null;
  onSave: (specifications: Record<string, string>, kind: SpecDecisionKind, reason?: string) => Promise<boolean>;
}

/** Human intent only. Existing Basic Price endpoint and canonical identity service remain the authorities. */
export function BasicPriceSpecificationEditor({
  rowNumber, sourceSpecifications, sourceKeterangan,
  specificationDecision, reviewedCapacity, mutable, disabled, saveBlockedReason, onSave,
}: Props) {
  const [values, setValues] = useState<SpecFields>(
    () => specificationInitialFields(sourceSpecifications, specificationDecision),
  );
  const [initialCapacity] = useState(() => readCapacitySpecification(
    specificationInitialFields(sourceSpecifications, specificationDecision).kapasitas,
  ));
  const [capacityRows, setCapacityRows] = useState<CapacityRow[]>(() => initialCapacity.rows);
  const [kind, setKind] = useState<SpecDecisionKind>('SUPPLEMENT');
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const capacity = writeCapacitySpecification(capacityRows, initialCapacity.legacy);
  const decision = capacity.error
    ? { ok: false as const, message: capacity.error }
    : specificationFormDecision({ ...values, kapasitas: capacity.text }, sourceSpecifications, specificationDecision, kind, reason);
  const updateCapacity = (index: number, patch: Partial<CapacityRow>) => {
    setCapacityRows(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    setMessage('');
  };
  const filledDimensions = SPEC_DIMENSION_FIELDS.filter((field) => values[field.key]?.trim()).length;
  const identityFieldsForDisplay = ['merek', 'tipe', 'warna', 'fungsi']
    .flatMap((key) => SPEC_IDENTITY_FIELDS.filter((field) => field.key === key));
  // Format A has two COMBINED supplier columns. Their values already enter
  // the canonical specification decision as SOURCE evidence, not certified
  // technical 'fungsi', 'mutu', or 'standar'. Expose that difference beside
  // the existing fields rather than making the Owner hunt in another panel.
  const supplierEvidence = (sourceLabel: string, storedKey: string) =>
    sourceSpecifications?.find(f =>
      f.label.trim().toLocaleLowerCase('id-ID') === sourceLabel)?.value?.trim() ||
    specificationDecision?.facts[storedKey] || null;
  const supplierUse = supplierEvidence('jenis/kegunaan', 'jenis_kegunaan_sumber');
  const supplierQuality = supplierEvidence('mutu dan standar', 'mutu_dan_standar_sumber');

  // One existing editor, one existing decision writer. Only presentation is grouped.
  const renderField = (field: typeof SPEC_FIELDS[number]) => (
    <label className="bp-field" key={field.key}>
      <span className="bp-field__label">{field.label}</span>
      {field.key === 'spesifikasi' ? (
        <textarea
          className="bp-input"
          rows={2}
          maxLength={240}
          aria-label={field.label + ' baris ' + rowNumber}
          value={values[field.key] ?? ''}
          disabled={!mutable || disabled || sending}
          placeholder="Tambahkan rincian teknis yang benar-benar diketahui"
          onChange={(event) => {
            setValues((current) => ({ ...current, [field.key]: event.target.value }));
            setMessage('');
          }}
        />
      ) : (
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
      )}

    </label>
  );

  return (
    <details id={'bp-spec-editor-' + rowNumber} className="bp-details" aria-label={'Spesifikasi manual baris ' + rowNumber}>
      <summary>Lengkapi Spesifikasi (opsional)</summary>
      <div className="bp-spec-editor">
        <p className="bp-field__help">
          Isi informasi yang diketahui saja. Data yang sudah ada tetap tersimpan.
        </p>
        <section className="bp-spec-editor__group" aria-label="Identitas dan Fungsi">
          <h4>Identitas &amp; Fungsi</h4>
          <div className="bp-spec-editor__grid">
            {identityFieldsForDisplay.map(renderField)}
          </div>
        </section>
        <section className="bp-spec-editor__group" aria-label="Mutu dan Standar">
          <h4>Mutu &amp; Standar</h4>
          <div className="bp-spec-editor__grid">
            {SPEC_TECHNICAL_FIELDS.map(renderField)}
          </div>
          {SPEC_FIELDS.filter((field) => field.key === 'spesifikasi').map(renderField)}
        </section>
        <details className="bp-details bp-spec-editor__dimensions"
          aria-label={'Ukuran dan Dimensi baris ' + rowNumber}>
          <summary>Ukuran &amp; Dimensi{filledDimensions ? ' · ' + filledDimensions + ' informasi' : ''}</summary>
          <div className="bp-spec-editor__grid">
            {SPEC_DIMENSION_FIELDS.map(renderField)}
          </div>
          {SPEC_LEGACY_FIELDS.filter((field) => values[field.key]).map((field) => (
            <p className="bp-field__help" key={field.key}>
              {field.label}: {values[field.key]}
            </p>
          ))}
        </details>
        <section className="bp-spec-editor__group bp-spec-editor__capacity"
          aria-label={'Kapasitas baris ' + rowNumber}>
          <h4>Kapasitas (opsional)</h4>
          <p className="bp-field__help">
            Tambahkan jenis, nilai, dan satuan kapasitas yang diketahui (maksimal enam). Nilai tidak ditebak atau diubah otomatis.
          </p>
          {reviewedCapacity?.status === 'STRUCTURED' ? (
            <p className="bp-field__help" role="status">
              Keputusan tersimpan: {reviewedCapacity.facts.length} jenis kapasitas sudah dapat dibaca ulang sebagai fakta teknis.
              Kesesuaian alat, konversi satuan, dan produktivitas tetap memerlukan pembuktian tersendiri.
            </p>
          ) : reviewedCapacity?.status === 'UNPARSED' ? (
            <p className="bp-field__help" role="status">
              Catatan kapasitas tersimpan, tetapi belum aman dibaca sebagai angka.
              Periksa rincian dan gunakan Koreksi dengan alasan bila diperlukan; teks lama tetap terjaga.
            </p>
          ) : null}
          {capacityRows.map((row, index) => {
            const preset = SPEC_CAPACITY_TYPES.find(type => type.kind === row.kind);
            const availableUnits: readonly string[] = preset?.units ?? SPEC_CAPACITY_ALL_UNITS;
            return (
              <div className="bp-spec-editor__capacity-row" key={index}>
                <label className="bp-field">
                  <span className="bp-field__label">Jenis kapasitas</span>
                  <select className="bp-input" value={preset ? row.kind : 'LAINNYA'}
                    aria-label={'Jenis kapasitas ' + (index + 1) + ' baris ' + rowNumber}
                    disabled={!mutable || disabled || sending}
                    onChange={(event) => {
                      const found = SPEC_CAPACITY_TYPES.find(x => x.kind === event.target.value);
                      updateCapacity(index, found
                        ? { kind: found.kind, unit: found.units[0] }
                        : { kind: '', unit: 'm³' });
                    }}>
                    {SPEC_CAPACITY_GROUPS.map(group => (
                      <optgroup key={group.key} label={group.label}>
                        {SPEC_CAPACITY_TYPES.filter(type => type.group === group.key)
                          .map(type => (
                            <option key={type.kind} value={type.kind}
                              disabled={capacityRows.some((other, otherIndex) =>
                                otherIndex !== index &&
                                other.kind.toLocaleLowerCase('id-ID') ===
                                  type.kind.toLocaleLowerCase('id-ID'))}>
                              {type.kind}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                    <option value="LAINNYA">Jenis lainnya</option>
                  </select>
                  {!preset ? (
                    <input className="bp-input" type="text" maxLength={60}
                      aria-label={'Nama jenis kapasitas lainnya ' + (index + 1) + ' baris ' + rowNumber}
                      placeholder="Nama kapasitas lainnya"
                      disabled={!mutable || disabled || sending}
                      value={row.kind}
                      onChange={event => updateCapacity(index, { kind: event.target.value })} />
                  ) : null}
                </label>
                <label className="bp-field">
                  <span className="bp-field__label">Nilai</span>
                  <input className="bp-input" type="text" inputMode="decimal"
                    aria-label={'Nilai kapasitas ' + (index + 1) + ' baris ' + rowNumber}
                    placeholder="Misalnya 5,2" value={row.value}
                    disabled={!mutable || disabled || sending}
                    onChange={event => updateCapacity(index, { value: event.target.value })} />
                </label>
                <label className="bp-field">
                  <span className="bp-field__label">Satuan</span>
                  <select className="bp-input" value={row.unit}
                    aria-label={'Satuan kapasitas ' + (index + 1) + ' baris ' + rowNumber}
                    disabled={!mutable || disabled || sending}
                    onChange={event => updateCapacity(index, { unit: event.target.value })}>
                    {availableUnits.map(unit =>
                      <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                {mutable ? (
                  <button className="bp-btn bp-btn--sm" type="button"
                    aria-label={'Hapus kapasitas ' + (index + 1) + ' baris ' + rowNumber}
                    disabled={disabled || sending}
                    onClick={() => setCapacityRows(rows => rows.filter((_, i) => i !== index))}>
                    Hapus
                  </button>
                ) : null}
              </div>
            );
          })}
          {initialCapacity.legacy.length ? (
            <p className="bp-field__help" role="note">
              Kapasitas lama tetap dipertahankan: {initialCapacity.legacy.join('; ')}.
              Koreksi memerlukan alasan; nilai sumber tidak dihapus otomatis.
            </p>
          ) : null}
          {mutable && capacityRows.length < 6 ? (
            <button type="button" className="bp-btn bp-btn--sm"
              disabled={disabled || sending}
              onClick={() => {
                setCapacityRows(rows => [...rows, nextUnusedCapacityRow(rows)]);
                setMessage('');
              }}>
              + Tambah kapasitas
            </button>
          ) : null}
        </section>
        {(sourceKeterangan || supplierUse || supplierQuality ||
          /^semua\s+mer(?:e)?k$/iu.test(values.merek?.trim() ?? '')) ? (
          <details className="bp-details bp-spec-editor__knowledge"
            aria-label={'Keterangan sumber baris ' + rowNumber}>
            <summary>Keterangan sumber</summary>
            <div role="note" className="bp-spec-editor__knowledge-content">
              {/^semua\s+mer(?:e)?k$/iu.test(values.merek?.trim() ?? '') ? (
                <p>Semua merek: tidak dibatasi merek tertentu.</p>
              ) : null}
              {supplierUse ? <p>Jenis/kegunaan sumber: {supplierUse}</p> : null}
              {supplierQuality ? <p>Mutu/standar sumber: {supplierQuality}</p> : null}
              {sourceKeterangan ? <p className="bp-spec-editor__source-note">{sourceKeterangan}</p> : null}

            </div>
          </details>
        ) : null}
      {mutable ? (
        <>
          <div className="bp-spec-editor__decision-bar">
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
              required={kind === 'CORRECT'}
              placeholder={kind === 'CORRECT'
                ? 'Wajib: jelaskan fakta yang dikoreksi dan sumber pemeriksaannya'
                : 'Alasan tambahan (bila diperlukan)'} />
            {kind === 'CORRECT' && !reason.trim() ? (
              <span className="bp-field__help" role="status">Isi alasan koreksi agar tombol Simpan aktif.</span>
            ) : null}
          </label>
          <button type="button" className="bp-btn bp-btn--primary bp-btn--sm bp-spec-editor__save"
            disabled={disabled || sending || !decision.ok || Boolean(saveBlockedReason)}
            aria-disabled={disabled || sending || !decision.ok || Boolean(saveBlockedReason)}
            onClick={() => {
              if (!decision.ok || disabled || sending || saveBlockedReason) return;
              setSending(true);
              void onSave(decision.confirmedSpecifications, kind, decision.reason)
                .then((ok) => { if (ok) setMessage('Keputusan tersimpan; pemeriksaan identitas telah diminta ulang dari SIMPROK.'); })
                .finally(() => setSending(false));
            }}>
            {sending ? 'Mencatat keputusan...' : 'Simpan spesifikasi yang telah diperiksa'}
          </button>
          </div>
          {saveBlockedReason ? <p className="bp-field__help" role="status">{saveBlockedReason}</p> : null}
          {!decision.ok ? <p className="bp-field__help" role="status">{decision.message}</p> : null}
        </>
      ) : null}
      {message ? <p className="bp-field__help" role="status">{message}</p> : null}
      </div>
    </details>
  );
}
