import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { BasicPriceImportService } from './basic-price-import.service';
import { BASIC_PRICE_PARSER_CONTRACT_VERSION } from './basic-price-universal-intake.adapter';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';
import { buildBasicPriceCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import {
  HARNESS_ACCOUNT,
  HARNESS_ORGANIZATION,
  HARNESS_WORKSPACE,
  createIntakeHarness,
} from '../../test/fixtures/usi01r-intake-harness';

const sourceRoot = join(__dirname, '..');
const repoRoot = join(__dirname, '..', '..');

const collectTs = (dir: string): string[] =>
  readdirSync(dir)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory()
        ? collectTs(path)
        : name.endsWith('.ts') && !name.endsWith('.spec.ts')
          ? [path]
          : [];
    });

const relative = (path: string) => path.replace(/\\/g, '/').split('/src/')[1];
const readSource = (relativePath: string) =>
  readFileSync(join(sourceRoot, relativePath), 'utf8');

/**
 * Strips comments before scanning.
 *
 * These guards assert what the code DOES, and prose is not behaviour. A comment
 * explaining that a service must never touch a workbook is evidence the rule is
 * understood — failing the build over it would train the next author to delete
 * the explanation rather than keep the rule.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('USI-01 architecture guards', () => {
  const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
  const modelNames = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]);

  describe('TEST A1 — the existing Reality Intake is REUSED, never duplicated', () => {
    it('every Reality Intake model still exists exactly once', () => {
      // USI-01 was explicitly forbidden from building a second intake. If any
      // of these had been forked into a "v2", this count would move.
      for (const model of [
        'SourceDocument',
        'IntakeJob',
        'ExtractionArtifact',
        'KnowledgeCandidate',
        'ValidationResult',
        'ReviewTask',
        'ReviewDecision',
        'KnowledgeEvent',
        'PriceSubmission',
        'PriceSubmissionReview',
        'BasicPriceImportBatch',
        'BasicPriceImportRow',
      ]) {
        expect(modelNames.filter((name) => name === model)).toEqual([model]);
      }
    });

    it('no parallel intake pipeline was introduced', () => {
      const suspicious = modelNames.filter((name) =>
        /(V2|Universal(IntakeJob|SourceDocument|Candidate)|IntakeJob2)/.test(name),
      );
      expect(suspicious).toEqual([]);
    });

    it('the universal intake layer owns exactly one persisted concept: the connector', () => {
      // Everything else it contributes — envelope, readers, structure detector,
      // numeric interpreter — is stateless. A boundary that needed its own
      // tables would have been a second pipeline wearing a new name.
      const universalModels = [...schema.matchAll(/^model (\w+) \{[\s\S]*?^\}/gm)]
        .filter(([body]) => body.includes('ingestion_connectors'))
        .map((match) => match[1]);
      expect(universalModels).toEqual(['IngestionConnector']);
    });
  });

  describe('TEST A3 — a new reader cannot reach the trust lifecycle', () => {
    const TRUST_LIFECYCLE_FILES = [
      'basic-price/basic-price-publication.service.ts',
      'basic-price/basic-price-row-resolution.service.ts',
      'basic-price/basic-price-eligibility.policy.ts',
      'basic-price/basic-price-private-asset.service.ts',
      'reality-intake/price-submission-review.service.ts',
    ];

    it.each(TRUST_LIFECYCLE_FILES)('%s names no file format at all', (file) => {
      const source = codeOnly(readSource(file));
      // If verification or publication ever branched on "is this XLSX?", adding
      // a third reader would mean editing verification law. It does not, so it
      // does not — and this test is what keeps it that way.
      for (const formatWord of [
        'xlsx',
        'exceljs',
        'ExcelJS',
        'csv',
        'CSV',
        'workbook',
        'worksheet',
        'delimiter',
        'SourceReader',
        'ReaderRegistry',
      ]) {
        expect(source).not.toContain(formatWord);
      }
    });

    it('no reader and no structure detector can reach a database at all', () => {
      // The strongest form of "a new reader cannot affect trust": the layers a
      // new reader joins have no way to persist anything. They take bytes and
      // return values, so a third reader has nothing to corrupt.
      const statelessFiles = [
        ...collectTs(join(sourceRoot, 'universal-intake', 'readers')),
        ...collectTs(join(sourceRoot, 'universal-intake', 'structure')),
      ];
      expect(statelessFiles.length).toBeGreaterThan(0);
      for (const file of statelessFiles) {
        const source = readFileSync(file, 'utf8');
        expect({ file: relative(file), persists: /PrismaService|@prisma\/client/.test(source) }).toEqual(
          { file: relative(file), persists: false },
        );
      }
    });

    it('the whole universal intake layer names no trust or publication state', () => {
      for (const file of collectTs(join(sourceRoot, 'universal-intake'))) {
        const source = codeOnly(readFileSync(file, 'utf8'));
        for (const trustWord of [
          'verificationStatus',
          'PUBLISHED',
          'basicPrice.',
          'priceSubmission.',
        ]) {
          expect({ file: relative(file), contains: source.includes(trustWord) }).toEqual({
            file: relative(file),
            contains: false,
          });
        }
      }
    });
  });

  describe('TESTS I1/I2/S3 — receiving is never believing', () => {
    it('no intake code path writes a BasicPrice, a submission, or a publication', () => {
      const intakeFiles = [
        ...collectTs(join(sourceRoot, 'universal-intake')),
        join(sourceRoot, 'basic-price', 'basic-price-universal-intake.adapter.ts'),
        join(sourceRoot, 'basic-price', 'basic-price-supplier-bridge.service.ts'),
      ];
      const writers = intakeFiles.flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [
          ...source.matchAll(
            /(?:tx|prisma)\.(basicPrice|priceSubmission|priceSubmissionRevision|basicPricePublicationAudit)\.(create|update|updateMany|upsert|delete|deleteMany)\s*\(/g,
          ),
        ].map((match) => ({ file: relative(file), model: match[1], method: match[2] }));
      });
      expect(writers).toEqual([]);
    });

    it('the Supplier Bridge has exactly one way out, and it is the shared intake door', () => {
      const source = readSource('basic-price/basic-price-supplier-bridge.service.ts');
      const importServiceCalls = [...source.matchAll(/this\.imports\.(\w+)\(/g)].map(
        (match) => match[1],
      );
      expect(importServiceCalls).toEqual(['intake']);
    });

    it('TEST I2: intake never sets a verification or publication state', () => {
      const source = codeOnly(readSource('basic-price/basic-price-import.service.ts'));
      // The one status intake may write is the batch/row review state. Nothing
      // it writes can mean "verified" or "published", however confident the
      // parser was (LAW 4).
      expect(source).not.toMatch(/verificationStatus\s*:/);
      expect(source).not.toMatch(/status\s*:\s*'PUBLISHED'/);
      expect(source).toContain("status: 'NEEDS_REVIEW'");
    });

    it('the Universal Intake module opens no network surface of its own', () => {
      // §23 — a supplier-facing endpoint needs real network, credential-issuance
      // and rate-limit decisions that belong to the Owner. The seam is built;
      // the door is deliberately not cut.
      const moduleSource = readSource('universal-intake/universal-intake.module.ts');
      expect(moduleSource).not.toContain('controllers');
      for (const file of collectTs(join(sourceRoot, 'universal-intake'))) {
        expect(readFileSync(file, 'utf8')).not.toContain('@Controller');
      }
    });
  });

  describe('TEST I6 — an intake identity that already existed must not move', () => {
    const WORKSPACE = HARNESS_WORKSPACE;
    const ORGANIZATION = HARNESS_ORGANIZATION;

    const FINGERPRINT_METADATA_KEYS = [
      'regionId',
      'effectiveDate',
      'sourceType',
      'sourceOrigin',
      'sourceOrganizationName',
      'sourceVendorName',
      'sourcePeriodLabel',
      'sourcePeriodGranularity',
      'effectiveDateProvenance',
      'effectiveDateDerivationRule',
      'priceCoverageDeclared',
      'transportIncluded',
      'loadingIncluded',
      'unloadingIncluded',
      'deliveredToProject',
    ];

    /** The RM-02 formula, reproduced verbatim as it stood before USI-01. */
    const legacyFingerprint = (sourceSha256: string, sheetName: string) =>
      createHash('sha256')
        .update(
          [
            WORKSPACE,
            ORGANIZATION,
            sourceSha256,
            sheetName,
            BASIC_PRICE_PARSER_CONTRACT_VERSION,
            FINGERPRINT_METADATA_KEYS.map((key) => `${key}:`).join('|'),
          ].join('|'),
        )
        .digest('hex')
        .toUpperCase();

    const runIntake = async (
      file: { buffer: Buffer; size: number; originalname: string; mimetype?: string },
      metadata: Record<string, unknown> = {},
    ) => {
      const harness = createIntakeHarness();
      const service = new BasicPriceImportService(
        harness.prisma,
        harness.reviewService,
        harness.sourceArchive,
        harness.proposals,
      );
      const summary = await service.preview(
        HARNESS_WORKSPACE,
        HARNESS_ACCOUNT,
        file,
        metadata as any,
      );
      return { summary, batch: harness.batches[0], harness };
    };

    it('a legacy sectioned workbook uploaded from a browser keeps its exact RM-02 fingerprint', async () => {
      const buffer = await buildBasicPriceXlsx();
      const { summary, batch } = await runIntake({
        buffer,
        size: buffer.length,
        originalname: 'BASIC PRICE.xlsx',
      });

      // If USI-01 had appended its new segments unconditionally, this hash would
      // differ — and every batch ever imported would have become unreachable by
      // replay, silently duplicating on the Owner's next upload.
      expect(summary.importFingerprint).toBe(
        legacyFingerprint(batch.sourceSha256, 'HARGA SATUAN UPAH DAN BAHAN'),
      );
      expect(batch.parserContractVersion).toBe(BASIC_PRICE_PARSER_CONTRACT_VERSION);
    });

    it('a legacy batch is recorded with the intake provenance that is TRUE of it', async () => {
      const buffer = await buildBasicPriceXlsx();
      const { batch } = await runIntake({
        buffer,
        size: buffer.length,
        originalname: 'BASIC PRICE.xlsx',
      });
      expect(batch).toMatchObject({
        ingestionChannel: 'USER_UPLOAD',
        ingestionConnectorId: null,
        sourceLocatorDialect: 'EXCEL_A1',
        sourceRegionScopeLabel: null,
        // OBS-05 — a human's file upload states no external record identity, and
        // SIMPROK invents none for it. Its replay law stays the bytes-and-context
        // one it always had.
        ingestionDeliveryId: null,
        ingestionExternalSourceId: null,
        ingestionExternalRecordId: null,
        ingestionExternalVersion: null,
        sourceObservedAt: null,
      });
    });

    it('a CSV upload is a different reading, and says so in its own contract', async () => {
      const buffer = buildBasicPriceCsv();
      const { batch } = await runIntake(
        { buffer, size: buffer.length, originalname: 'harga.csv' },
        { declaredSection: 'MATERIAL' },
      );

      expect(batch).toMatchObject({
        sourceLocatorDialect: 'CSV_RC',
        parserContractVersion: 'USI01_BASIC_PRICE_SEMANTIC_HEADER_V1',
        ingestionChannel: 'USER_UPLOAD',
      });
    });
  });
});
