import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileInput } from 'lucide-react';
import {
  previewBasicPriceImport,
  updateBasicPriceImportBatch,
  type BasicPriceImportMetadata,
  type PriceSourceOrigin,
  type PriceSourceType,
} from '../api/basicPriceImport';
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
  const [statusMessage, setStatusMessage] = useState('Pilih file XLSX Basic Price untuk memulai.');

  const updateMetadataField = <K extends keyof BasicPriceImportMetadata>(key: K, value: BasicPriceImportMetadata[K]) => {
    setMetadata((current) => ({ ...current, [key]: value }));
  };

  const handleFileChosen = async (file: File) => {
    setSelectedFile(file);
    setIsBusy(true);
    setStatusMessage('Membaca workbook Basic Price...');
    try {
      const result = await previewBasicPriceImport(file, 'HARGA SATUAN UPAH DAN BAHAN', metadata);
      setBatch(result);
      setStatusMessage(`Preview siap: ${result.totalRows} baris terbaca dari ${file.name}.`);
    } catch {
      setStatusMessage('Gagal membaca workbook. Periksa format file dan coba lagi.');
    } finally {
      setIsBusy(false);
    }
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
          accept=".xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileChosen(file);
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} disabled={isBusy} title="Pilih file XLSX Basic Price" aria-label="Pilih file Basic Price">
          <FileInput size={17} /> Pilih File Basic Price
        </button>
      </section>

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
