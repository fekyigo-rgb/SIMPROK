import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileInput } from 'lucide-react';
import {
  IntakeRefusalError,
  previewBasicPriceImport,
  updateBasicPriceImportBatch,
  type BasicPriceImportMetadata,
  type BasicPriceIntakeSelection,
  type PriceSourceOrigin,
  type PriceSourceType,
} from '../api/basicPriceImport';
import {
  IntakeQuestionPanel,
  intakeQuestionOf,
  intakeRefusalMessage,
  type IntakeAnswerKey,
  type IntakeQuestionModel,
} from '../components/basic-price/IntakeQuestion';
import {
  batchStatusLabel,
  formatBatchProgress,
  type BasicPriceImportBatchSummary,
} from '../utils/basicPriceImportDisplay';
import { RegionSearchSelect } from '../components/basic-price/RegionSearchSelect';
import type { RegionLookupItem } from '../api/basicPriceWorkflow';

const SOURCE_TYPE_OPTIONS: { value: PriceSourceType; label: string }[] = [
  { value: 'VENDOR_QUOTE', label: 'Penawaran Vendor' },
  { value: 'MARKET_SURVEY', label: 'Survei Pasar' },
  { value: 'REGULATION', label: 'Regulasi' },
  { value: 'SYSTEM_ESTIMATE', label: 'Estimasi Sistem' },
];

const SOURCE_ORIGIN_OPTIONS: { value: PriceSourceOrigin; label: string }[] = [
  { value: 'GOVERNMENT', label: 'Pemerintah' },
  { value: 'SUPPLIER', label: 'Pemasok' },
  { value: 'STORE', label: 'Toko' },
  { value: 'DISTRIBUTOR', label: 'Distributor' },
  { value: 'FIELD_REPORT', label: 'Laporan Lapangan' },
  { value: 'COMMUNITY_REPORT', label: 'Laporan Komunitas' },
];

/**
 * RM-02 Basic Price import — upload -> preview -> confirm metadata -> hand
 * off to the review room (BasicPriceReviewPage). SIMPROK never auto-submits
 * a batch here: this page only ever creates/updates a batch in
 * NEEDS_REVIEW, mirroring the "SIMPROK menghitung, manusia memutuskan"
 * law — the human still resolves every row on the next page.
 */
export function BasicPriceImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<BasicPriceImportMetadata>({});
  const [batch, setBatch] = useState<BasicPriceImportBatchSummary | null>(null);
  const [region, setRegion] = useState<RegionLookupItem | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Pilih berkas daftar harga (XLSX atau CSV) untuk memulai.');
  // USI-01 — the answers a human has given about THIS file. Empty on the first
  // attempt: SIMPROK asks nothing until the source proves it must.
  const [selection, setSelection] = useState<BasicPriceIntakeSelection>({});
  const [question, setQuestion] = useState<IntakeQuestionModel | null>(null);

  const updateMetadataField = <K extends keyof BasicPriceImportMetadata>(key: K, value: BasicPriceImportMetadata[K]) => {
    setMetadata((current) => ({ ...current, [key]: value }));
  };

  /**
   * USI-01 — reads a source, and asks at most one question at a time.
   *
   * NOTE WHAT IS NOT SENT: a sheet name. The previous version pinned every
   * upload to the literal sheet "HARGA SATUAN UPAH DAN BAHAN", so any workbook
   * organized differently was rejected before it was ever read — the exact
   * exact-sheet-name requirement §18 forbids. SIMPROK now finds the table by
   * evidence, and only asks when a file genuinely proves more than one reading.
   */
  const readSource = async (file: File, answers: BasicPriceIntakeSelection) => {
    setIsBusy(true);
    setStatusMessage('SIMPROK sedang membaca berkas...');
    try {
      const result = await previewBasicPriceImport(file, answers, metadata);
      setBatch(result);
      setQuestion(null);
      setStatusMessage(
        `SIMPROK mengenali daftar harga ini — ${result.totalRows} baris terbaca dari ${file.name}.`,
      );
    } catch (error) {
      setBatch(null);
      if (error instanceof IntakeRefusalError) {
        const next = intakeQuestionOf(error.code, error.details, answers);
        setQuestion(next);
        // A question is not a failure, and is never worded as one.
        setStatusMessage(
          next
            ? 'SIMPROK sudah membaca berkas ini dan menemukan satu hal yang harus Anda putuskan.'
            : intakeRefusalMessage(error.code, error.details),
        );
      } else {
        setQuestion(null);
        setStatusMessage('Unggahan tidak sampai ke SIMPROK. Periksa koneksi lalu coba lagi.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleFileChosen = async (file: File) => {
    setSelectedFile(file);
    // A new file is a new subject: answers given about the previous one must
    // never be carried onto it.
    setSelection({});
    setQuestion(null);
    await readSource(file, {});
  };

  const handleAnswer = async (key: IntakeAnswerKey, value: string) => {
    if (!selectedFile) return;
    const isColumn = key === 'selectedNameColumn' || key === 'selectedUnitColumn';
    const answers = { ...selection, [key]: isColumn ? Number(value) : value };
    setSelection(answers);
    await readSource(selectedFile, answers);
  };

  const handleSaveMetadata = async () => {
    if (!batch) return;
    setIsBusy(true);
    setStatusMessage('Menyimpan metadata batch...');
    try {
      const updated = await updateBasicPriceImportBatch(batch.batchId, batch.version, metadata);
      setBatch(updated);
      setStatusMessage('Metadata batch tersimpan.');
    } catch {
      setStatusMessage('Gagal menyimpan metadata. Batch mungkin sudah berubah — muat ulang dan coba lagi.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Impor Basic Price">
        <button onClick={() => navigate('/')} title="Kembali ke Beranda" aria-label="Kembali ke Beranda">
          <ArrowLeft size={17} /> Kembali
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price / Impor</div>
          <h1>Impor Basic Price</h1>
          <p>Unggah workbook Basic Price (Upah, Bahan, Peralatan). SIMPROK membaca dan menghitung; setiap baris tetap menunggu keputusan manusia sebelum diajukan.</p>
        </div>
        <span className="simprok-rab-workspace__status">{statusMessage}</span>
      </header>

      <section className="simprok-rab-toolbar" aria-label="Aksi Impor Basic Price">
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileChosen(file);
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={isBusy} title="Pilih berkas daftar harga (XLSX atau CSV)" aria-label="Pilih berkas daftar harga">
          <FileInput size={17} /> Pilih Berkas Daftar Harga
        </button>
      </section>

      {question ? (
        <IntakeQuestionPanel question={question} disabled={isBusy} onAnswer={(key, value) => void handleAnswer(key, value)} />
      ) : null}

      {batch ? (
        <section className="simprok-rab-validation-alert simprok-rab-validation-alert--info" aria-label="Preview Impor Basic Price">
          <strong>{selectedFile?.name} — {batchStatusLabel(batch.status)}</strong>
          <p>{formatBatchProgress(batch)}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: '12px', marginTop: '12px' }}>
            <label>
              Jenis Sumber Harga
              <select value={metadata.sourceType ?? ''} onChange={(event) => updateMetadataField('sourceType', (event.target.value || undefined) as PriceSourceType | undefined)}>
                <option value="">— Belum dipilih —</option>
                {SOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Asal Sumber
              <select value={metadata.sourceOrigin ?? ''} onChange={(event) => updateMetadataField('sourceOrigin', (event.target.value || undefined) as PriceSourceOrigin | undefined)}>
                <option value="">— Belum dipilih —</option>
                {SOURCE_ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              Tanggal Berlaku
              <input type="date" value={metadata.effectiveDate ?? ''} onChange={(event) => updateMetadataField('effectiveDate', event.target.value || undefined)} />
            </label>
            <div>
              <RegionSearchSelect
                selected={region}
                disabled={isBusy}
                onSelect={(next) => {
                  setRegion(next);
                  updateMetadataField('regionId', next?.id ?? undefined);
                }}
              />
            </div>
          </div>

          <button onClick={() => void handleSaveMetadata()} disabled={isBusy} style={{ marginTop: '12px' }}>
            {isBusy ? 'Menyimpan...' : 'Simpan Metadata'}
          </button>
          <button
            onClick={() => navigate(`/basic-price/import/${batch.batchId}/review`)}
            disabled={isBusy}
            style={{ marginTop: '12px', marginLeft: '8px' }}
          >
            Lanjut ke Peninjauan Baris
          </button>
        </section>
      ) : null}
    </div>
  );
}
