import type {
  IntakeRefusalDetails,
  PriceTableStructure,
  ResourceType,
} from '../../api/basicPriceImport';
import { unitColumnOptions } from '../../utils/basicPriceColumnRole';

/**
 * USI-01 §16/§17 — HOW SIMPROK SPEAKS WHEN IT WILL NOT GUESS.
 *
 * Two different things can go wrong with an upload, and collapsing them is what
 * produced the old "Gagal membaca workbook. Periksa format file" — a message
 * that blamed the user's document for SIMPROK's own limits:
 *
 *   A REFUSAL is final. SIMPROK cannot read this, and says so plainly, in its
 *   own name, without implying the file is at fault.
 *
 *   A QUESTION is not a failure at all. The file is fine and SIMPROK read it;
 *   it found a genuine choice only a person has the authority to make, and it
 *   asks ONCE rather than picking for them.
 *
 * Everything here is product language. No parser internals reach the user.
 */

export type IntakeAnswerKey =
  | 'selectedSheet'
  | 'selectedStructure'
  | 'selectedRegionLabel'
  | 'declaredSection'
  | 'selectedNameColumn'
  | 'selectedUnitColumn';

export interface IntakeQuestionModel {
  /** What SIMPROK needs answered, in the user's language. */
  prompt: string;
  answerKey: IntakeAnswerKey;
  options: { value: string; label: string }[];
}

const SECTION_LABELS: Record<ResourceType, string> = {
  LABOR: 'Upah / Tenaga Kerja',
  MATERIAL: 'Bahan',
  EQUIPMENT: 'Peralatan',
};

const STRUCTURE_LABELS: Record<PriceTableStructure, string> = {
  SECTIONED_PRICE_LIST: 'Daftar harga bersection (Upah / Bahan / Peralatan)',
  SEMANTIC_HEADER_TABLE: 'Tabel harga berjudul kolom',
  REGIONAL_MATRIX: 'Matriks harga per wilayah',
};

/**
 * Turns a refusal code into either a question a person can answer, or null when
 * the situation is genuinely final and only a message is owed.
 */
export function intakeQuestionOf(
  code: string,
  details: IntakeRefusalDetails,
  /** Answers already given about THIS file, so a question is never re-asked. */
  answered: { selectedNameColumn?: number } = {},
): IntakeQuestionModel | null {
  switch (code) {
    case 'SECTION_DECLARATION_REQUIRED':
      return {
        prompt:
          'Berkas ini tidak menyebutkan sendiri golongan sumber dayanya. Golongan apa isi daftar harga ini?',
        answerKey: 'declaredSection',
        options: (details.acceptedSections ?? ['LABOR', 'MATERIAL', 'EQUIPMENT']).map(
          (section) => ({ value: section, label: SECTION_LABELS[section] ?? section }),
        ),
      };

    case 'REGION_COLUMN_SELECTION_REQUIRED':
    case 'REGION_COLUMN_NOT_FOUND':
      return {
        prompt:
          'Berkas ini memuat harga untuk beberapa wilayah sekaligus. Satu batch hanya boleh mewakili satu wilayah — wilayah mana yang diimpor sekarang?',
        answerKey: 'selectedRegionLabel',
        // The source's OWN wording is shown, never a canonical Region name.
        // Mapping it to a Region stays a separate, deliberate human step.
        options: (details.choices ?? []).map((label) => ({ value: label, label })),
      };

    case 'SOURCE_TABLE_AMBIGUOUS':
      return {
        prompt:
          'SIMPROK menemukan lebih dari satu tabel harga di berkas ini. Tabel mana yang dimaksud?',
        answerKey: 'selectedSheet',
        options: (details.tables ?? []).map((table) => ({
          value: table.tableName,
          label: table.tableName,
        })),
      };

    case 'WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND':
      return {
        prompt: 'Lembar yang diminta tidak ada di berkas ini. Lembar mana yang dimaksud?',
        answerKey: 'selectedSheet',
        options: (details.availableTables ?? []).map((name) => ({ value: name, label: name })),
      };

    case 'COLUMN_ROLE_SELECTION_REQUIRED': {
      // The file's shape is understood; only the column meanings are unstated.
      // Real sample values are shown so the choice is made from the document
      // itself rather than from a column number.
      // The backend asks again until BOTH columns are named, so the page's own
      // record of what it has already answered decides which half is being
      // asked now.
      const askingUnit = answered.selectedNameColumn !== undefined;
      const offered = (askingUnit ? details.unitCandidates : details.nameCandidates) ?? [];
      // ONE COLUMN CANNOT HOLD TWO ROLES, so the column already named as the
      // resource name is never offered again as the unit column. See
      // `unitColumnOptions` for why — and for the fail-open rule it keeps.
      const candidates = askingUnit
        ? unitColumnOptions(offered, answered.selectedNameColumn)
        : offered;
      return {
        prompt: askingUnit
          ? 'Kolom mana yang berisi SATUAN?'
          : 'Berkas ini tidak memberi judul pada kolomnya. Kolom mana yang berisi NAMA sumber daya?',
        answerKey: askingUnit ? 'selectedUnitColumn' : 'selectedNameColumn',
        options: candidates.map((candidate) => ({
          value: String(candidate.columnNumber),
          label: `Kolom ${candidate.columnNumber} — contoh: ${candidate.samples.slice(0, 2).join(' / ') || '(kosong)'}`,
        })),
      };
    }

    case 'SOURCE_STRUCTURE_AMBIGUOUS':
      return {
        prompt:
          'Tabel ini bisa dibaca dengan lebih dari satu cara. Bentuk mana yang benar?',
        answerKey: 'selectedStructure',
        options: (details.availableStructures ?? []).map((structure) => ({
          value: structure,
          label: STRUCTURE_LABELS[structure] ?? structure,
        })),
      };

    default:
      return null;
  }
}

/**
 * The final-refusal wording. Each one names WHOSE limitation it is — §17
 * forbids blaming the sender's document when the reader is what fell short.
 */
export function intakeRefusalMessage(code: string, details: IntakeRefusalDetails): string {
  switch (code) {
    case 'UNSUPPORTED_SOURCE_FORMAT': {
      const supported = (details.supportedExtensions ?? []).join(', ');
      return `SIMPROK belum bisa membaca format berkas ini. Yang sudah bisa dibaca: ${supported || '.xlsx, .csv'}.`;
    }
    case 'SOURCE_UNREADABLE':
      return 'SIMPROK tidak berhasil membuka berkas ini. Isinya tidak cocok dengan format yang tertulis pada namanya, atau berkasnya rusak.';
    case 'NO_PRICE_TABLE_DETECTED':
      return 'SIMPROK berhasil membaca berkas ini, tetapi tidak menemukan tabel harga di dalamnya. Belum ada yang bisa diimpor.';
    case 'SOURCE_EXCEEDS_MAX_BYTES':
      return 'Berkas ini melampaui batas ukuran unggahan SIMPROK (10 MB).';
    case 'SOURCE_ROW_LIMIT_EXCEEDED':
      return 'Berkas ini melampaui batas jumlah baris yang diproses SIMPROK dalam satu unggahan.';
    case 'SOURCE_BYTES_REQUIRED':
      return 'Berkas yang dipilih kosong.';
    case 'WORKBOOK_HAS_NO_SHEETS':
      return 'Berkas ini terbaca sebagai workbook, tetapi tidak memuat satu pun lembar kerja.';
    default:
      // REACHED ONLY BY A GENUINELY UNKNOWN INTAKE CODE. Every code the backend
      // can emit today has its own sentence above or its own question, and a
      // NON-intake failure — permission, session, server — no longer arrives
      // here at all (see `isIntakeRefusalCode` in api/basicPriceImport). That
      // misrouting is what made this sentence the Owner's dead end: a 403 was
      // worded as SIMPROK being careful about a workbook it had never rejected.
      //
      // What remains must still not read as a verdict on the document, and must
      // say what did NOT happen: nothing guessed, nothing stored.
      return 'SIMPROK belum dapat melanjutkan karena ada kondisi yang belum dapat dijelaskan dengan aman. Tidak ada data yang diterka atau disimpan sebagai fakta.';
  }
}

export function IntakeQuestionPanel({
  question,
  disabled,
  onAnswer,
}: {
  question: IntakeQuestionModel;
  disabled: boolean;
  onAnswer: (key: IntakeAnswerKey, value: string) => void;
}) {
  return (
    <section
      className="simprok-rab-validation-alert simprok-rab-validation-alert--info"
      aria-label="Pertanyaan Impor Basic Price"
    >
      <strong>SIMPROK butuh satu keputusan Anda</strong>
      <p>{question.prompt}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
        {question.options.map((option) => (
          <button
            key={option.value}
            disabled={disabled}
            onClick={() => onAnswer(question.answerKey, option.value)}
            title={option.label}
          >
            {option.label}
          </button>
        ))}
      </div>
      {question.options.length === 0 ? (
        <p>SIMPROK tidak dapat menyusun pilihan untuk pertanyaan ini.</p>
      ) : null}
    </section>
  );
}
