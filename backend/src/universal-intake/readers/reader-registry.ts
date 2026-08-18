import { INTAKE_ERRORS, IntakeError } from '../intake-errors';
import { SourceEnvelope } from '../source-envelope';
import { CsvSourceReader } from './csv.reader';
import { SourceReader, extensionOf } from './source-reader';
import { SourceRead } from './source-table';
import { XlsxSourceReader } from './xlsx.reader';

/**
 * USI-01 §4 — THE READER REGISTRY.
 *
 * Format support is a LIST, not a branch. Teaching SIMPROK to read XLS, ODS,
 * JSON or an API payload is `new ReaderRegistry([...readers, new OdsReader()])`
 * — no Basic Price structure detection, resolution, review, verification or
 * publication code is touched (test A3), because none of them ever names a
 * format.
 */
export class ReaderRegistry {
  private readonly readers: readonly SourceReader[];

  constructor(readers: readonly SourceReader[]) {
    this.readers = readers;
  }

  /** The default production set: what SIMPROK can read TODAY, and nothing more. */
  static default(): ReaderRegistry {
    return new ReaderRegistry([new XlsxSourceReader(), new CsvSourceReader()]);
  }

  supportedExtensions(): string[] {
    return [...new Set(this.readers.flatMap((reader) => [...reader.extensions]))].sort();
  }

  /**
   * Picks the reader for an arrival.
   *
   * EXTENSION IS A HINT, NEVER SOLE AUTHORITY (§14). It selects a candidate;
   * the reader then has to actually decode the bytes, and fails closed with
   * SOURCE_UNREADABLE if it cannot. A `.xlsx` name over a text payload
   * therefore gets a truthful "SIMPROK could not decode this", never a silent
   * misparse. The declared media type is accepted as corroborating evidence
   * only — a browser that sends `application/octet-stream` for a real workbook
   * is not punished for its own vagueness.
   */
  select(envelope: SourceEnvelope): SourceReader {
    const extension = extensionOf(envelope.fileName);
    const byExtension = this.readers.find((reader) =>
      reader.extensions.includes(extension),
    );
    if (byExtension) return byExtension;

    const mediaType = (envelope.mediaType ?? '').split(';')[0].trim().toLowerCase();
    const byMediaType = mediaType
      ? this.readers.find((reader) => reader.mediaTypes.includes(mediaType))
      : undefined;
    if (byMediaType) return byMediaType;

    throw new IntakeError(INTAKE_ERRORS.UNSUPPORTED_SOURCE_FORMAT, {
      fileName: envelope.fileName,
      extension,
      declaredMediaType: envelope.mediaType,
      supportedExtensions: this.supportedExtensions(),
    });
  }

  async read(envelope: SourceEnvelope): Promise<SourceRead> {
    return this.select(envelope).read(envelope);
  }
}
