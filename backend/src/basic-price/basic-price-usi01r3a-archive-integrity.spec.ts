import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  promises as fs,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  INTAKE_STORAGE_DIR_ENV,
  StorageService,
} from '../reality-intake/storage.service';
import {
  ARCHIVE_DIGEST_MISMATCH,
  ARCHIVE_INTEGRITY_CONFLICT,
  BasicPriceSourceArchiveService,
} from './basic-price-source-archive.service';
import { buildBasicPriceCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import { HARNESS_WORKSPACE } from '../../test/fixtures/usi01r-intake-harness';

/**
 * USI-01R3A §14–§19 — STORED BYTES MUST PROVE THE IDENTITY THEY CLAIM.
 *
 * `<workspace>/<sha256>/source` is not a filename. It is an assertion: THE
 * BYTES HERE HASH TO THIS DIGEST. USI-01R3 reused an existing artifact as soon
 * as it was READABLE, and readable is not verified — a truncated, replaced or
 * half-written file opens exactly as happily as the real one. The batch would
 * go on pointing at it, and every downstream check would compare the wrong
 * things and agree.
 *
 * So the claim is now proven before it is relied on, and a broken claim stops
 * the request rather than being quietly repaired. Repairing it would be the
 * worse outcome: the archive cannot know which bytes the existing batches were
 * describing, and overwriting would destroy the evidence needed to find out.
 */

/**
 * A storage port that loses the rename race, exactly as Windows loses it: a
 * concurrent writer's bytes are already at the final path, and `rename` fails
 * with EPERM instead of silently replacing (POSIX) it.
 *
 * Simulated rather than raced, because the LOSER'S code path is what is under
 * test and a genuine race decides at random which process runs it.
 */
class RaceLosingStorage extends StorageService {
  constructor(private readonly winnerBytes: Buffer) {
    super();
  }

  async moveToFinal(tempPath: string, safeKey: string): Promise<string> {
    const finalPath = this.resolveFinalPath(safeKey);
    await fs.mkdir(dirname(finalPath), { recursive: true });
    // The winner got there first.
    await fs.writeFile(finalPath, this.winnerBytes);
    const error: NodeJS.ErrnoException = new Error(
      'EPERM: operation not permitted, rename',
    );
    error.code = 'EPERM';
    throw error;
  }
}

describe('USI-01R3A — ARCHIVE INTEGRITY: readable is not verified', () => {
  let root: string;
  let bytes: Buffer;
  let digest: string;

  const archiveAt = (root: string, storage?: StorageService) => {
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    return new BasicPriceSourceArchiveService(storage ?? new StorageService());
  };

  /** The absolute path a logical ref resolves to, for TEST setup only. */
  const finalPathOf = (logicalRef: string) =>
    new StorageService().resolveFinalPath(logicalRef);

  const expectedRef = `${HARNESS_WORKSPACE}/${BasicPriceSourceArchiveService.digestOf(
    buildBasicPriceCsv(),
  ).toLowerCase()}/source`;

  /** Puts bytes at a content address WITHOUT going through the archive. */
  const prePlace = (logicalRef: string, content: Buffer) => {
    const path = finalPathOf(logicalRef);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  };

  const orphanTempFiles = (root: string) => {
    const tempDir = join(root, 'tmp');
    try {
      return readdirSync(tempDir, { withFileTypes: true }).filter((e) =>
        e.isFile(),
      );
    } catch {
      return [];
    }
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'usi01r3a-archive-'));
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    bytes = buildBasicPriceCsv();
    digest = BasicPriceSourceArchiveService.digestOf(bytes);
  });

  afterEach(() => {
    delete process.env[INTAKE_STORAGE_DIR_ENV];
    rmSync(root, { recursive: true, force: true });
  });

  it('ARCHIVE-INT-01: correct stored bytes are re-read, re-hashed, and reused', async () => {
    const archive = archiveAt(root);
    const first = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });
    expect(first).toBe(expectedRef);

    // Second retention of the same artifact takes the REUSE path — and takes
    // it because the stored bytes proved themselves, not because they opened.
    const second = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });
    expect(second).toBe(first);
    expect(await archive.read(second)).toEqual(bytes);
    expect(
      BasicPriceSourceArchiveService.digestOf(await archive.read(second)),
    ).toBe(digest);
  });

  it('ARCHIVE-INT-02: WRONG bytes at the content address fail closed and are not touched', async () => {
    // Something already on disk claims an identity it does not have. It opens
    // perfectly, which is exactly why the old readability probe trusted it.
    const impostor = Buffer.from(
      'these bytes are not the artifact they claim\n',
      'utf8',
    );
    const path = prePlace(expectedRef, impostor);

    const archive = archiveAt(root);
    await expect(
      archive.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest,
        bytes,
      }),
    ).rejects.toThrow(ARCHIVE_INTEGRITY_CONFLICT);

    // NOT SILENTLY OVERWRITTEN. The incoming upload does not get to rewrite
    // history — the archive cannot know which bytes existing batches meant.
    expect(readFileSync(path)).toEqual(impostor);
    // NOT SILENTLY DELETED either: the corrupt artifact is the evidence an
    // operator will need.
    expect(readFileSync(path).length).toBe(impostor.length);
    // AND NO SECOND SILENT TRUTH: the good bytes were not filed somewhere else.
    expect(orphanTempFiles(root)).toEqual([]);
  });

  it('ARCHIVE-INT-02: the refusal names the artifact and both digests, and no OS path', async () => {
    prePlace(expectedRef, Buffer.from('impostor\n', 'utf8'));
    const archive = archiveAt(root);

    const error = await archive
      .retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest,
        bytes,
      })
      .then(() => null)
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    // Enough for operational recovery...
    expect(message).toContain(ARCHIVE_INTEGRITY_CONFLICT);
    expect(message).toContain(expectedRef);
    expect(message).toContain(digest);
    // ...and never the machine's directory layout (§18/§25).
    expect(message).not.toContain(root);
    expect(message).not.toMatch(/[A-Za-z]:\\/);
  });

  it('ARCHIVE-INT-03: a LOST race whose winner holds correct bytes reuses them', async () => {
    // The winner wrote the identical, content-addressed artifact. The loser
    // inherits it — after proving it, not merely opening it.
    const archive = archiveAt(root, new RaceLosingStorage(bytes));

    const logicalRef = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });

    expect(logicalRef).toBe(expectedRef);
    expect(await archive.read(logicalRef)).toEqual(bytes);
    // The loser cleaned up only its OWN temp file, never the winner's artifact.
    expect(orphanTempFiles(root)).toEqual([]);
  });

  it('ARCHIVE-INT-04: a LOST race whose winner holds WRONG bytes fails closed', async () => {
    // Losing a race is not a licence to trust whatever now occupies the path.
    const impostor = Buffer.from(
      'winner wrote something else entirely\n',
      'utf8',
    );
    const archive = archiveAt(root, new RaceLosingStorage(impostor));

    await expect(
      archive.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest,
        bytes,
      }),
    ).rejects.toThrow(ARCHIVE_INTEGRITY_CONFLICT);

    expect(readFileSync(finalPathOf(expectedRef))).toEqual(impostor);
    expect(orphanTempFiles(root)).toEqual([]);
  });

  it('ARCHIVE-INT-03: genuinely simultaneous identical uploads still converge on one verified copy', async () => {
    // The real race, not the simulation — the behaviour STORE-01/02 proved,
    // re-proven now that a verification step sits on the reuse path.
    const archive = archiveAt(root);
    const refs = await Promise.all(
      Array.from({ length: 5 }, () =>
        archive.retain({
          workspaceId: HARNESS_WORKSPACE,
          contentDigestSha256: digest,
          bytes,
        }),
      ),
    );

    expect(new Set(refs).size).toBe(1);
    expect(refs[0]).toBe(expectedRef);
    expect(await archive.read(refs[0])).toEqual(bytes);
    expect(orphanTempFiles(root)).toEqual([]);
  });

  it('ARCHIVE-INT-05: after a restart the integrity check still passes and reuse succeeds', async () => {
    const first = await archiveAt(root).retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });

    // A brand-new process: fresh service instances, nothing carried in memory.
    const afterRestart = archiveAt(root);
    expect(await afterRestart.read(first)).toEqual(bytes);
    // ...and the verification path, not a cache, is what accepts it.
    expect(
      await afterRestart.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest,
        bytes,
      }),
    ).toBe(first);
  });

  it('ARCHIVE-INT-05: a CORRUPTED artifact is caught on the next run, not carried forward', async () => {
    const logicalRef = await archiveAt(root).retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });

    // Bit rot, a bad restore, a partial copy — the file still opens.
    writeFileSync(
      finalPathOf(logicalRef),
      Buffer.concat([bytes, Buffer.from('x')]),
    );

    await expect(
      archiveAt(root).retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest,
        bytes,
      }),
    ).rejects.toThrow(ARCHIVE_INTEGRITY_CONFLICT);
  });

  it('ARCHIVE-INT-06: the logical reference still survives a storage-root relocation', async () => {
    const rootB = mkdtempSync(join(tmpdir(), 'usi01r3a-archive-b-'));
    try {
      const logicalRef = await archiveAt(root).retain({
        workspaceId: HARNESS_WORKSPACE,
        bytes,
      });

      // What is persisted is LOGICAL, never machine-bound.
      expect(logicalRef).toBe(expectedRef);
      expect(logicalRef).not.toMatch(/^[A-Za-z]:[/\\]/);
      expect(logicalRef).not.toContain(root);

      // Relocate the stored hierarchy, exactly as a move or reconfiguration
      // would, and the same reference resolves — and still verifies.
      cpSync(root, rootB, { recursive: true });
      rmSync(root, { recursive: true, force: true });

      const relocated = archiveAt(rootB);
      expect(await relocated.read(logicalRef)).toEqual(bytes);
      expect(
        await relocated.retain({ workspaceId: HARNESS_WORKSPACE, bytes }),
      ).toBe(logicalRef);
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('ARCHIVE-INT-07: a caller-declared digest that does not describe its bytes still fails closed', async () => {
    const archive = archiveAt(root);
    await expect(
      archive.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: 'F'.repeat(64),
        bytes,
      }),
    ).rejects.toThrow(ARCHIVE_DIGEST_MISMATCH);

    // Nothing was written under the false name, and nothing under the true one
    // either — the request never earned a retention at all.
    expect(readdirSync(root).filter((entry) => entry !== 'tmp')).toEqual([]);
  });

  it('ARCHIVE-INT-07: digest CASE never decides the verdict, in either direction', async () => {
    // A HEX DIGEST IS A NUMBER, NOT A STRING, AND CASE IS NOT PART OF IT.
    //
    // This service deliberately spells the same digest two ways: `digestOf`
    // returns UPPERCASE, and `logicalRef` lowercases it for the path. That is
    // exactly the arrangement in which a single missed `.toUpperCase()` turns
    // into either a false integrity conflict (correct bytes refused) or, far
    // worse, a comparison that can never fail. Both directions are pinned here.
    const archive = archiveAt(root);

    // A caller declaring the TRUE digest in lowercase is declaring the truth.
    const lower = await archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest.toLowerCase(),
      bytes,
    });
    expect(lower).toBe(expectedRef);

    // Re-retaining takes the VERIFY-then-reuse path, where the stored bytes are
    // re-hashed to UPPERCASE and compared against a lowercase declaration. A
    // case-blind comparison here would report the artifact corrupt.
    expect(
      await archive.retain({
        workspaceId: HARNESS_WORKSPACE,
        contentDigestSha256: digest.toLowerCase(),
        bytes,
      }),
    ).toBe(lower);

    // ...and case-insensitivity must not have been bought by weakening the
    // check: a genuinely WRONG digest still fails closed in either spelling.
    for (const wrong of ['a'.repeat(64), 'A'.repeat(64)]) {
      await expect(
        archive.retain({
          workspaceId: HARNESS_WORKSPACE,
          contentDigestSha256: wrong,
          bytes,
        }),
      ).rejects.toThrow(ARCHIVE_DIGEST_MISMATCH);
    }
  });
});
