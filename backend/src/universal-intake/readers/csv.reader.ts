import { INTAKE_ERRORS, IntakeError } from '../intake-errors';
import { SourceEnvelope } from '../source-envelope';
import { SourceReader } from './source-reader';
import { SourceCell, SourceRead, SourceRow, SourceTable } from './source-table';
import { MAX_SOURCE_COLUMNS, MAX_SOURCE_ROWS } from './xlsx.reader';

export const CSV_READER_ID = 'CSV_DELIMITED_TEXT';
export const CSV_READER_CONTRACT_VERSION = 'USI01_CSV_V1';

/**
 * Bounded, ORDERED candidate set (§4 "delimiter detection within bounded
 * deterministic rules"). The order is the tie-break, so detection is a pure
 * function of the bytes and never of chance.
 */
export const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CandidateDelimiter = (typeof CANDIDATE_DELIMITERS)[number];

interface ParsedRecord {
  /** 1-based physical line the record STARTS on. A quoted field may span more. */
  line: number;
  fields: string[];
}

/**
 * RFC 4180-shaped scan: quoted fields, `""` as an escaped quote, delimiters and
 * newlines inside quotes, and CRLF / LF / bare-CR line endings all handled.
 *
 * This is DECODING, not normalization: unescaping `""` to `"` recovers what the
 * writer meant to store, and no other character is altered (LAW 5).
 */
function parseDelimited(text: string, delimiter: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawAnyChar = false;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (!sawAnyChar && fields.length === 0 && field === '' && !inQuotes) {
      recordLine = line;
    }

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line += 1;
        field += char;
      }
      sawAnyChar = true;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      sawAnyChar = true;
      continue;
    }
    if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      continue;
    }
    if (char === '\n') {
      endRecord();
      line += 1;
      continue;
    }
    field += char;
    sawAnyChar = true;
  }

  // A file that does not end with a newline still has a final record; a file
  // that does must not gain a phantom empty one.
  if (inQuotes || field !== '' || fields.length > 0) {
    endField();
    records.push({ line: recordLine, fields });
  }

  return records;
}

export interface DelimiterDetection {
  delimiter: CandidateDelimiter;
  /** How many records share the modal field count. */
  consistentRecords: number;
  modalFieldCount: number;
  /** Every candidate's score, retained so the choice is auditable. */
  scores: Array<{
    delimiter: CandidateDelimiter;
    modalFieldCount: number;
    consistentRecords: number;
  }>;
}

/**
 * DETERMINISTIC delimiter choice. For each candidate the file is parsed and
 * scored by `modalFieldCount x consistentRecords` — the delimiter that
 * produces the widest table that the most lines actually agree on. Ties are
 * broken by `CANDIDATE_DELIMITERS` order, so identical bytes always yield an
 * identical answer.
 *
 * A single-column result is returned honestly rather than forced: "this file
 * has one column" is a real reading, and it is the STRUCTURE DETECTOR's job to
 * then say there is no price table here (§17) — not the reader's job to guess
 * a different separator until it likes the shape.
 */
export function detectDelimiter(text: string): DelimiterDetection {
  const scores = CANDIDATE_DELIMITERS.map((delimiter) => {
    const records = parseDelimited(text, delimiter).filter(
      (record) => record.fields.some((f) => f.trim() !== ''),
    );
    const counts = new Map<number, number>();
    for (const record of records) {
      counts.set(record.fields.length, (counts.get(record.fields.length) ?? 0) + 1);
    }
    let modalFieldCount = 0;
    let consistentRecords = 0;
    for (const [fieldCount, occurrences] of counts) {
      if (
        occurrences > consistentRecords ||
        (occurrences === consistentRecords && fieldCount > modalFieldCount)
      ) {
        modalFieldCount = fieldCount;
        consistentRecords = occurrences;
      }
    }
    return { delimiter, modalFieldCount, consistentRecords };
  });

  let best = scores[0];
  for (const candidate of scores) {
    const candidateScore = candidate.modalFieldCount * candidate.consistentRecords;
    const bestScore = best.modalFieldCount * best.consistentRecords;
    if (candidateScore > bestScore) best = candidate;
  }

  return {
    delimiter: best.delimiter,
    consistentRecords: best.consistentRecords,
    modalFieldCount: best.modalFieldCount,
    scores,
  };
}

const UTF8_BOM = '﻿';

/**
 * USI-01 §4 — the CSV reader.
 *
 * It performs TECHNICAL parsing only. Deciding that field 3 is a price, or
 * that "1.250" means one thousand two hundred fifty, is emphatically NOT this
 * class's business — §4 forbids confusing CSV technical parsing with semantic
 * interpretation, and every field leaves here as text.
 */
export class CsvSourceReader implements SourceReader {
  readonly id = CSV_READER_ID;
  readonly contractVersion = CSV_READER_CONTRACT_VERSION;
  readonly extensions = ['.csv'] as const;
  readonly mediaTypes = [
    'text/csv',
    'application/csv',
    'text/plain',
  ] as const;

  async read(envelope: SourceEnvelope): Promise<SourceRead> {
    const text = this.decode(envelope.bytes);
    const detection = detectDelimiter(text);
    const records = parseDelimited(text, detection.delimiter);

    if (records.length > MAX_SOURCE_ROWS) {
      throw new IntakeError(INTAKE_ERRORS.SOURCE_ROW_LIMIT_EXCEEDED, {
        rowCount: records.length,
        maxRows: MAX_SOURCE_ROWS,
      });
    }

    const columnCount = Math.min(
      Math.max(...records.map((r) => r.fields.length), 1),
      MAX_SOURCE_COLUMNS,
    );

    const rows: SourceRow[] = [];
    for (const record of records) {
      const cells: Array<SourceCell | null> = new Array(columnCount).fill(null);
      let hasContent = false;
      for (let index = 0; index < Math.min(record.fields.length, columnCount); index += 1) {
        const rawText = record.fields[index];
        const trimmed = rawText.trim();
        if (rawText === '') continue;
        cells[index] = {
          rawText,
          text: trimmed === '' ? null : trimmed,
          // A delimited text file has no typed cells. Leaving this null is the
          // whole point of §12: nothing downstream can mistake a CSV field for
          // a spreadsheet cell, because there is no spreadsheet evidence to
          // mistake it for.
          native: null,
        };
        hasContent = true;
      }
      if (hasContent) rows.push({ number: record.line, cells });
    }

    const table: SourceTable = {
      readerId: this.id,
      readerContractVersion: this.contractVersion,
      locatorDialect: 'CSV_RC',
      name: envelope.fileName,
      scannedRowCount: records.length,
      columnCount,
      rows,
    };

    return {
      readerId: this.id,
      readerContractVersion: this.contractVersion,
      tables: [table],
    };
  }

  /**
   * UTF-8 with an optional BOM is what this reader reads, and it says so.
   * A UTF-16 BOM is refused by name rather than decoded into mojibake — "this
   * encoding is not supported yet" is SIMPROK's limitation honestly stated,
   * and is not the same message as "your file is corrupt" (§17).
   */
  private decode(bytes: Buffer): string {
    if (bytes.length >= 2) {
      const isUtf16Le = bytes[0] === 0xff && bytes[1] === 0xfe;
      const isUtf16Be = bytes[0] === 0xfe && bytes[1] === 0xff;
      if (isUtf16Le || isUtf16Be) {
        throw new IntakeError(INTAKE_ERRORS.SOURCE_UNREADABLE, {
          readerId: this.id,
          reason: 'CSV_ENCODING_NOT_UTF8',
          detectedEncoding: isUtf16Le ? 'UTF-16LE' : 'UTF-16BE',
        });
      }
    }
    const text = bytes.toString('utf8');
    return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
  }
}
