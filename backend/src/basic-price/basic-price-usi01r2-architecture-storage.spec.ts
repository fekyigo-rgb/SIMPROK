import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  INTAKE_STORAGE_DIR_ENV,
  INTAKE_STORAGE_DIR_REQUIRED,
  StorageService,
  resolveIntakeStorageRoot,
} from '../reality-intake/storage.service';
import {
  ARCHIVE_DIGEST_MISMATCH,
  BasicPriceSourceArchiveService,
} from './basic-price-source-archive.service';
import { BasicPriceImportService } from './basic-price-import.service';
import { buildBasicPriceCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import {
  HARNESS_ACCOUNT,
  HARNESS_WORKSPACE,
  createIntakeHarness,
} from '../../test/fixtures/usi01r-intake-harness';

const sourceRoot = join(__dirname, '..');
const repoRoot = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(sourceRoot, relative), 'utf8');

/**
 * USI-01R2 §4 — THE ARCHITECTURE ADJUDICATION, MADE ENFORCEABLE.
 *
 * USI-01R briefly registered every Basic Price arrival as a Reality Intake
 * `SourceDocument`. That was withdrawn on authority, not preference:
 *
 *   ROADMAP.md §15 gives RM-12 the job of "memindahkan intake ke Platform
 *   Layer", and §57 forbids the roadmap order to shift without a written Owner
 *   decision. DEBT.md records today's Basic Price intake as UTANG-PLATFORM-03,
 *   a vertical-local temporary intake closing at RM-12. And
 *   09-RM02B0-AUTOPILOT-CONSTRUCTION-CONTRACT.md lists the generalized worker
 *   pipeline as REUSE_CANDIDATE, never a required dependency.
 *
 * These tests are what stop that decision from quietly eroding.
 */
describe('USI-01R2 architecture — RM-12 is not pulled forward', () => {
  const importService = read('basic-price/basic-price-import.service.ts');
  const archiveService = read('basic-price/basic-price-source-archive.service.ts');

  it('ARCH-01: Basic Price intake never writes Reality Intake platform models', () => {
    const intakeFiles = [
      'basic-price/basic-price-import.service.ts',
      'basic-price/basic-price-source-archive.service.ts',
      'basic-price/basic-price-supplier-bridge.service.ts',
      'basic-price/basic-price-universal-intake.adapter.ts',
    ].map(read);

    for (const source of intakeFiles) {
      for (const model of [
        'sourceDocument',
        'intakeJob',
        'extractionArtifact',
        'knowledgeCandidate',
        'canonicalPricePoint',
        'knowledgeEvent',
      ]) {
        // Neither create nor read: the vertical intake does not participate in
        // the platform pipeline at all.
        expect(source).not.toMatch(new RegExp(`(?:tx|prisma)\\.${model}\\.`));
      }
    }
  });

  it('ARCH-01: no standalone SourceEvidence service survives anywhere in src', () => {
    // A second source-evidence implementation living beside this one is exactly
    // what §5 forbids. The withdrawal has to be complete, not partial.
    const collect = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? collect(join(dir, entry.name))
          : entry.name.endsWith('.ts')
            ? [join(dir, entry.name)]
            : [],
      );
    const offenders = collect(sourceRoot).filter((file) =>
      /source-evidence/.test(file),
    );
    expect(offenders).toEqual([]);
  });

  it('ARCH-02: no RM-12 worker is activated by Basic Price intake', () => {
    // The extraction/understanding/publication workers stay dormant unless the
    // platform explicitly enables them. Nothing in the Basic Price path may
    // enqueue work for them.
    for (const source of [importService, archiveService]) {
      expect(source).not.toContain('enqueueUpload');
      expect(source).not.toContain('IntakeEnqueueService');
      expect(source).not.toContain('ExtractionWorkerService');
    }
    // The worker's own opt-in switch is untouched and still default-off.
    expect(read('reality-intake/extraction-worker.service.ts')).toContain(
      "process.env.INTAKE_WORKER_ENABLED !== 'true'",
    );
  });

  it('ARCH-03: there is still exactly one review and one publication pipeline', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
    const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
    for (const model of [
      'PriceSubmission',
      'PriceSubmissionReview',
      'BasicPriceImportBatch',
      'SourceDocument',
      'IntakeJob',
    ]) {
      expect(models.filter((name) => name === model)).toEqual([model]);
    }
    // And intake still writes no trusted price of any kind.
    expect(importService).not.toMatch(/(?:tx|prisma)\.basicPrice\.(create|update)/);
  });

  it('the withdrawal is recorded where the next reader will look', () => {
    // A decision this consequential must be readable from the code it shaped,
    // not only from a report nobody re-opens.
    expect(archiveService).toContain('RM-12');
    expect(archiveService).toContain('UTANG-PLATFORM-03');
  });
});

describe('USI-01R2 §5/§8 — source bytes are retained safely', () => {
  let root: string;
  let storage: StorageService;
  let archive: BasicPriceSourceArchiveService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'usi01r2-store-'));
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    storage = new StorageService();
    archive = new BasicPriceSourceArchiveService(storage);
  });

  afterEach(() => {
    delete process.env[INTAKE_STORAGE_DIR_ENV];
    rmSync(root, { recursive: true, force: true });
  });

  const countFiles = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce(
      (total, entry) =>
        total +
        (entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1),
      0,
    );

  it('STORE-01/02: two SIMULTANEOUS identical uploads keep the bytes readable', async () => {
    const bytes = buildBasicPriceCsv();
    const digest = BasicPriceSourceArchiveService.digestOf(bytes);

    // The exact race USI-01R got wrong: its loser-cleanup deleted the very file
    // the winner's row pointed at.
    const [first, second] = await Promise.all([
      archive.retain({ workspaceId: HARNESS_WORKSPACE, contentDigestSha256: digest, bytes }),
      archive.retain({ workspaceId: HARNESS_WORKSPACE, contentDigestSha256: digest, bytes }),
    ]);

    // ONE logical identity — content-addressed, so both requests converge.
    expect(second).toBe(first);
    // ...and the bytes are still there, readable, and exactly what arrived.
    expect(await archive.read(first)).toEqual(bytes);
    expect(await archive.read(second)).toEqual(bytes);
    expect(statSync(storage.resolveFinalPath(first)).size).toBe(bytes.length);
  });

  it('STORE-03: no temp file and no duplicate copy is left behind', async () => {
    const bytes = buildBasicPriceCsv();
    const digest = BasicPriceSourceArchiveService.digestOf(bytes);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        archive.retain({ workspaceId: HARNESS_WORKSPACE, contentDigestSha256: digest, bytes }),
      ),
    );

    // Five concurrent retentions of one artifact leave exactly one file.
    expect(countFiles(root)).toBe(1);
    const tempDir = join(root, 'tmp');
    const orphans = readdirSync(tempDir, { withFileTypes: true }).filter((e) => e.isFile());
    expect(orphans).toEqual([]);
  });

  it('STORE-04: retained bytes survive a restart and stay resolvable', async () => {
    const bytes = buildBasicPriceCsv();
    const storageRef = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: BasicPriceSourceArchiveService.digestOf(bytes),
      bytes,
    });

    // A brand-new process: fresh service instances, nothing carried in memory.
    const afterRestart = new BasicPriceSourceArchiveService(new StorageService());
    expect(await afterRestart.read(storageRef)).toEqual(bytes);
  });

  it('§8: live operation must NAME its durable storage root, or refuse to start', () => {
    // A cwd-relative default is fine for tests and fatal in production: a
    // redeploy would take every retained artifact with it, leaving batches
    // pointing at bytes that no longer exist.
    expect(() => resolveIntakeStorageRoot({ NODE_ENV: 'production' } as any)).toThrow(
      INTAKE_STORAGE_DIR_REQUIRED,
    );
    expect(
      resolveIntakeStorageRoot({ NODE_ENV: 'production', INTAKE_STORAGE_DIR: root } as any),
    ).toBe(root);
    // Development still gets a working default rather than a wall.
    expect(resolveIntakeStorageRoot({ NODE_ENV: 'test' } as any)).toContain('reality-intake');
  });

  it('a failure to retain bytes leaves ZERO domain rows behind', async () => {
    const harness = createIntakeHarness({ failStorage: true });
    const service = new BasicPriceImportService(
      harness.prisma,
      harness.reviewService,
      harness.sourceArchive,
    );
    const bytes = buildBasicPriceCsv();

    await expect(
      service.preview(
        HARNESS_WORKSPACE,
        HARNESS_ACCOUNT,
        { buffer: bytes, size: bytes.length, originalname: 'harga.csv' },
        { declaredSection: 'MATERIAL' } as any,
      ),
    ).rejects.toThrow('FORCED_SOURCE_STORAGE_FAILURE');

    // Bytes are retained BEFORE any domain write, so a storage failure can
    // never leave a batch claiming a source it cannot produce.
    expect(harness.batches).toHaveLength(0);
    expect(harness.rows).toHaveLength(0);
  });

  it('a batch records where its bytes went', async () => {
    const harness = createIntakeHarness();
    const service = new BasicPriceImportService(
      harness.prisma,
      harness.reviewService,
      harness.sourceArchive,
    );
    const bytes = buildBasicPriceCsv();

    await service.preview(
      HARNESS_WORKSPACE,
      HARNESS_ACCOUNT,
      { buffer: bytes, size: bytes.length, originalname: 'harga.csv' },
      { declaredSection: 'MATERIAL' } as any,
    );

    const batch = harness.batches[0];
    expect(batch.sourceStorageRef).toBeTruthy();
    // Read back through the SAME resolution the archive uses: what the batch
    // persists is a logical ref, and the root is applied at read time (§12).
    expect(
      harness.storedBytes.get(
        harness.storage.resolveFinalPath(batch.sourceStorageRef),
      ),
    ).toEqual(bytes);
    // The hash that IDENTIFIES the bytes travels beside the pointer to them.
    expect(batch.sourceSha256).toMatch(/^[0-9A-F]{64}$/);
  });
});

describe('USI-01R3 §11/§12 — the archive verifies itself and stays portable', () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), 'usi01r3-rootA-'));
    rootB = mkdtempSync(join(tmpdir(), 'usi01r3-rootB-'));
  });

  afterEach(() => {
    delete process.env[INTAKE_STORAGE_DIR_ENV];
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  });

  const archiveAt = (root: string) => {
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    return new BasicPriceSourceArchiveService(new StorageService());
  };

  it('ARCHIVE_HASH_MISMATCH_FAILS_CLOSED', async () => {
    const archive = archiveAt(rootA);
    const bytes = buildBasicPriceCsv();

    // A caller that states a digest which does not describe its own bytes is
    // either confused or hostile. Filing the bytes under a name that lies about
    // them would make every later integrity check compare the wrong things and
    // pass, so the archive refuses instead of trusting the claim.
    await expect(
      archive.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: 'F'.repeat(64),
        bytes,
      }),
    ).rejects.toThrow(ARCHIVE_DIGEST_MISMATCH);

    // Nothing was written under the false name.
    expect(readdirSync(rootA).filter((e) => e !== 'tmp')).toEqual([]);
  });

  it('ARCHIVE_KEY_DERIVED_FROM_ACTUAL_BYTES', async () => {
    const archive = archiveAt(rootA);
    const bytes = buildBasicPriceCsv();
    const trueDigest = BasicPriceSourceArchiveService.digestOf(bytes);

    // Declaring the correct digest and declaring none must reach the SAME key,
    // because the key comes from the bytes either way — the declaration is only
    // ever a cross-check.
    const withDeclared = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: trueDigest,
      bytes,
    });
    const withoutDeclared = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      bytes,
    });

    expect(withDeclared).toBe(withoutDeclared);
    expect(withDeclared).toBe(`${HARNESS_WORKSPACE}/${trueDigest.toLowerCase()}/source`);
    // Different bytes must never share a key.
    const other = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      bytes: Buffer.from('resource_name,source_unit,harga\nX,M3,1\nY,M3,2\n', 'utf8'),
    });
    expect(other).not.toBe(withDeclared);
  });

  it('ARCHIVE_LOGICAL_REF_SURVIVES_ROOT_CHANGE', async () => {
    const bytes = buildBasicPriceCsv();
    const logicalRef = await archiveAt(rootA).retain({
      workspaceId: HARNESS_WORKSPACE,
      bytes,
    });

    // WHAT IS PERSISTED IS LOGICAL, NOT MACHINE-BOUND. An absolute path would
    // tie every historical batch to one machine's directory layout, and moving
    // the deployment would require rewriting the database to fix it.
    expect(logicalRef).not.toMatch(/^[A-Za-z]:[\/]/);
    expect(logicalRef).not.toContain(rootA);
    expect(logicalRef).toBe(
      `${HARNESS_WORKSPACE}/${BasicPriceSourceArchiveService.digestOf(bytes).toLowerCase()}/source`,
    );

    // Relocate the stored hierarchy to a DIFFERENT root, exactly as a move or a
    // reconfiguration would.
    cpSync(rootA, rootB, { recursive: true });
    rmSync(rootA, { recursive: true, force: true });

    // The very same stored reference resolves under the new root.
    expect(await archiveAt(rootB).read(logicalRef)).toEqual(bytes);
  });
});
