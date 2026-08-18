import { INTAKE_ERRORS, IntakeError } from '../intake-errors';
import { SourceEnvelope, sealSourceEnvelope } from '../source-envelope';
import { CsvSourceReader } from './csv.reader';
import { ReaderRegistry } from './reader-registry';
import { SourceReader } from './source-reader';
import { SourceRead } from './source-table';
import { XlsxSourceReader } from './xlsx.reader';
import { buildBasicPriceCsv } from '../../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';

/** A third format, invented purely to prove that adding one costs nothing. */
class MockOdsReader implements SourceReader {
  readonly id = 'MOCK_ODS';
  readonly contractVersion = 'MOCK_V1';
  readonly extensions = ['.ods'] as const;
  readonly mediaTypes = ['application/vnd.oasis.opendocument.spreadsheet'] as const;
  async read(envelope: SourceEnvelope): Promise<SourceRead> {
    return {
      readerId: this.id,
      readerContractVersion: this.contractVersion,
      tables: [
        {
          readerId: this.id,
          readerContractVersion: this.contractVersion,
          locatorDialect: 'CSV_RC',
          name: envelope.fileName,
          scannedRowCount: 0,
          columnCount: 0,
          rows: [],
        },
      ],
    };
  }
}

describe('ReaderRegistry — USI-01 §4 pluggable format boundary', () => {
  const registry = ReaderRegistry.default();

  it('TEST A2: the boundary supports more than one format today', () => {
    expect(registry.supportedExtensions()).toEqual(['.csv', '.xlsx']);
    expect(registry.select(testEnvelope(Buffer.from('x'), 'a.xlsx'))).toBeInstanceOf(
      XlsxSourceReader,
    );
    expect(registry.select(testEnvelope(buildBasicPriceCsv(), 'a.csv'))).toBeInstanceOf(
      CsvSourceReader,
    );
  });

  it('TEST A3: a third reader is added by REGISTRATION, not by modification', () => {
    // Nothing in the Basic Price domain, and nothing in the two existing
    // readers, changes to make this work. That is the whole claim of A3, and
    // this is what it costs to satisfy it.
    const extended = new ReaderRegistry([
      new XlsxSourceReader(),
      new CsvSourceReader(),
      new MockOdsReader(),
    ]);
    expect(extended.supportedExtensions()).toEqual(['.csv', '.ods', '.xlsx']);
    expect(extended.select(testEnvelope(Buffer.from('x'), 'a.ods'))).toBeInstanceOf(
      MockOdsReader,
    );
    // ...and the pre-existing selections are untouched by its arrival.
    expect(extended.select(testEnvelope(Buffer.from('x'), 'a.xlsx'))).toBeInstanceOf(
      XlsxSourceReader,
    );
  });

  it('an unsupported format is named as SIMPROK’s limit, with the list of what it can read', () => {
    // §17: this is never "your file is invalid".
    try {
      registry.select(testEnvelope(Buffer.from('%PDF-1.7'), 'harga.pdf'));
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IntakeError);
      expect((error as IntakeError).code).toBe(INTAKE_ERRORS.UNSUPPORTED_SOURCE_FORMAT);
      expect((error as IntakeError).details).toMatchObject({
        extension: '.pdf',
        supportedExtensions: ['.csv', '.xlsx'],
      });
    }
  });

  it('media type can select a reader when the name carries no extension', () => {
    const envelope = testEnvelope(buildBasicPriceCsv(), 'export', {
      mediaType: 'text/csv; charset=utf-8',
    });
    expect(registry.select(envelope)).toBeInstanceOf(CsvSourceReader);
  });

  it('EXTENSION IS A HINT, NOT AUTHORITY: a mislabelled file fails closed', async () => {
    // §14 — the extension picks a candidate reader; the bytes decide. Text
    // wearing an .xlsx name must never be silently misparsed into candidates.
    const envelope = testEnvelope(
      Buffer.from('this is plainly not a workbook'),
      'pretend.xlsx',
    );
    await expect(registry.read(envelope)).rejects.toMatchObject({
      code: INTAKE_ERRORS.SOURCE_UNREADABLE,
    });
  });
});

describe('sealSourceEnvelope — USI-01 §3 the one arrival constructor', () => {
  it('digests exactly the bytes that arrived, and freezes them', () => {
    const bytes = buildBasicPriceCsv();
    const first = testEnvelope(bytes, 'a.csv');
    const second = testEnvelope(bytes, 'a.csv');
    expect(first.contentDigestSha256).toBe(second.contentDigestSha256);
    expect(first.contentDigestSha256).toMatch(/^[0-9A-F]{64}$/);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('bounds the payload (§14) and refuses an empty arrival', () => {
    expect(() =>
      sealSourceEnvelope({
        ingestionChannel: 'USER_UPLOAD',
        fileName: 'empty.csv',
        bytes: Buffer.alloc(0),
        workspaceId: 'w',
        organizationId: 'o',
        actorAccountId: 'a',
      }),
    ).toThrow(INTAKE_ERRORS.SOURCE_BYTES_REQUIRED);

    expect(() =>
      sealSourceEnvelope({
        ingestionChannel: 'USER_UPLOAD',
        fileName: 'huge.csv',
        bytes: Buffer.alloc(10_485_761),
        workspaceId: 'w',
        organizationId: 'o',
        actorAccountId: 'a',
      }),
    ).toThrow(INTAKE_ERRORS.SOURCE_EXCEEDS_MAX_BYTES);
  });

  it('TEST S4: channel, connector and origin are independent axes', () => {
    // The envelope records HOW something arrived. It has no field for whether
    // the data is true, verified, published, or whose price it is — and that
    // absence is the law, not an oversight.
    const supplier = testEnvelope(buildBasicPriceCsv(), 'a.csv', {
      ingestionChannel: 'SUPPLIER_BRIDGE',
      connectorId: 'connector-1',
      deliveryId: 'req-aaa',
      externalRecordId: 'SUP-4471',
      externalVersion: '3',
    });
    expect(supplier.ingestionChannel).toBe('SUPPLIER_BRIDGE');
    expect(supplier.connectorId).toBe('connector-1');
    expect(supplier.externalRecordId).toBe('SUP-4471');
    // USI-01R — delivery and observation are different axes, and the envelope
    // keeps them apart rather than collapsing both into one "external ref".
    expect(supplier.deliveryId).toBe('req-aaa');
    expect(supplier.externalVersion).toBe('3');
    expect(Object.keys(supplier)).not.toEqual(
      expect.arrayContaining([
        'sourceOrigin',
        'sourceType',
        'verificationStatus',
        'trusted',
      ]),
    );
  });
});
