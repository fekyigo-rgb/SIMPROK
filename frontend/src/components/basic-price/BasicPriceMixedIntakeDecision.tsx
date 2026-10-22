import { useState } from 'react';
import { ArrowRight, Boxes, Construction, FileText, HardHat, Info, Layers, ListChecks } from 'lucide-react';
import type { ResourceType } from '../../api/basicPriceImport';

export type FileComposition = ResourceType | 'MIXED';

interface CompositionOption {
  value: FileComposition;
  title: string;
  help: string;
  Icon: typeof Layers;
}

const OPTIONS: CompositionOption[] = [
  { value: 'LABOR', title: 'Tenaga kerja', help: 'Contoh: Pekerja, Tukang batu, Mandor', Icon: HardHat },
  { value: 'MATERIAL', title: 'Bahan', help: 'Contoh: Semen, Pasir, Batu kali', Icon: Boxes },
  { value: 'EQUIPMENT', title: 'Peralatan', help: 'Contoh: Excavator, Concrete mixer, Dump truck', Icon: Construction },
  { value: 'MIXED', title: 'Campuran', help: 'Tenaga kerja, bahan, dan peralatan dalam satu berkas', Icon: ListChecks },
];

/**
 * Only SECTION_DECLARATION_REQUIRED shows this panel. MIXED describes the
 * composition of a file, never a fourth kind of resource or a batch-wide cast.
 * The visual default is not sent until the person clicks Lanjutkan.
 */
export function BasicPriceMixedIntakeDecision({
  disabled,
  onContinue,
}: {
  disabled: boolean;
  onContinue: (type: FileComposition) => void;
}) {
  const [choice, setChoice] = useState<FileComposition>('MIXED');
  const [showExample, setShowExample] = useState(false);
  return (
    <section className="bp-mixed-decision" aria-label="Jenis daftar harga">
      <div className="bp-mixed-decision__heading">
        <div className="bp-mixed-decision__heading-icon" aria-hidden="true"><Layers size={33} strokeWidth={2.1}/></div>
        <div>
          <h2>Apa isi daftar harga ini?</h2>
          <p>Pilih jenis data yang terdapat dalam berkas. SIMPROK tetap mengikuti keterangan setiap baris.</p>
          <p>Jika berkas memuat lebih dari satu jenis, pilih <strong>Campuran</strong>.</p>
        </div>
      </div>
      <fieldset className="bp-mixed-decision__fieldset" disabled={disabled}>
        <legend className="bp-mixed-decision__sr-only">Jenis isi berkas</legend>
        <div className="bp-mixed-decision__grid">
          {OPTIONS.map(({ value, title, help, Icon }) => (
            <label className={`bp-mixed-choice${choice === value ? ' bp-mixed-choice--selected' : ''}`} key={value}>
              <input
                type="radio"
                name="bp-file-composition"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                aria-label={title}
              />
              <span className="bp-mixed-choice__radio" aria-hidden="true" />
              {value === 'MIXED' ? <span className="bp-mixed-choice__badge">✦ Disarankan</span> : null}
              <Icon className={`bp-mixed-choice__icon bp-mixed-choice__icon--${value.toLowerCase()}`} size={49} strokeWidth={1.8} aria-hidden="true" />
              <strong>{title}</strong>
              <span className="bp-mixed-choice__help">{help}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <aside className="bp-mixed-decision__info">
        <Info size={21} aria-hidden="true"/>
        <div>
          <strong>Jika satu berkas memuat beberapa jenis item sekaligus, pilih Campuran.</strong>
          <p>Baris yang sudah memiliki bukti jenis sendiri tetap mengikuti bukti tersebut. Baris yang belum jelas akan ditandai untuk ditinjau, bukan dipaksa ke satu jenis.</p>
        </div>
      </aside>
      {showExample ? (
        <div className="bp-mixed-decision__example" id="bp-mixed-example">
          <strong>Contoh ilustrasi, bukan data dari berkas Anda</strong>
          <table>
            <thead><tr><th>Nama item</th><th>Jenis</th></tr></thead>
            <tbody>
              <tr><td>Pekerja</td><td>Tenaga kerja</td></tr>
              <tr><td>Pasir</td><td>Bahan</td></tr>
              <tr><td>Excavator</td><td>Peralatan</td></tr>
              <tr><td>Item tanpa jenis</td><td>Perlu ditinjau</td></tr>
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="bp-mixed-decision__footer">
        <button type="button" className="bp-mixed-decision__example-toggle" onClick={() => setShowExample((value) => !value)} aria-expanded={showExample} aria-controls="bp-mixed-example">
          <FileText size={17} aria-hidden="true" /> {showExample ? 'Tutup contoh hasil pembacaan' : 'Lihat contoh hasil pembacaan'}
        </button>
        <button className="bp-mixed-decision__continue" type="button" disabled={disabled} onClick={() => onContinue(choice)}>
          Lanjutkan <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
