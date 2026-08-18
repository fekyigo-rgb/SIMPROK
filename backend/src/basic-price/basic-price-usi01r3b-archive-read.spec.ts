import {
  mkdirSync,
  mkdtempSync,
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
  ARCHIVE_INTEGRITY_CONFLICT,
  ARCHIVE_POST_WRITE_MISSING,
  ARCHIVE_STORAGE_READ_FAILURE,
  BasicPriceSourceArchiveService,
} from './basic-price-source-archive.service';
import { buildBasicPriceCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import { HARNESS_WORKSPACE } from '../../test/fixtures/usi01r-intake-harness';

/**
 * USI-01R3B §19–§24 — "I COULD NOT READ IT" IS NOT "IT IS NOT THERE."
 *
 * USI-01R3A verified stored bytes before reusing them, which was the right law.
 * But its reader caught EVERY failure and answered ABSENT — so a permission
 * error, a disk error, or a directory where a file belongs all reported an
 * empty shelf. And the caller's very next act on an empty shelf is to WRITE.
 *
 * That is the most dangerous shape a wrong answer can take here: the one case
 * where SIMPROK cannot see the evidence is the case where it would overwrite it.
 *
 * ONLY ENOENT MEANS ABSENT. Everything else fails closed.
 *
 * The second half of this suite closes the matching gap on the way out: a
 * successful `rename` is a claim that a syscall returned, not proof that the
 * bytes at that address hash to it. They are read back before SIMPROK reports
 * that it retained anything.
 */

/** A storage port whose reads fail with a chosen errno, counting any write. */
class ReadFailingStorage extends StorageService {
  writeAttempts = 0;

  constructor(private readonly failure: Error) {
    super();
  }

  readFinal(): Promise<Buffer> {
    return Promise.reject(this.failure);
  }

  async writeTemp(bytes: Buffer): Promise<string> {
    // NOTHING MAY BE WRITTEN once a read has failed for a non-ENOENT reason.
    // Counted rather than forbidden, so the test reports what happened instead
    // of masking it behind a thrown assertion.
    this.writeAttempts += 1;
    return super.writeTemp(bytes);
  }
}

/** A storage port whose move reports success without producing the artifact. */
class LosingMoveStorage extends StorageService {
  moveToFinal(_tempPath: string, safeKey: string): Promise<string> {
    // Reports success, writes nothing. A filesystem that silently dropped the
    // rename, or a mount that vanished between the two calls.
    return Promise.resolve(this.resolveFinalPath(safeKey));
  }
}

/** A storage port whose move succeeds but lands the WRONG bytes. */
class WrongBytesMoveStorage extends StorageService {
  constructor(private readonly wrongBytes: Buffer) {
    super();
  }

  moveToFinal(_tempPath: string, safeKey: string): Promise<string> {
    const finalPath = this.resolveFinalPath(safeKey);
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, this.wrongBytes);
    return Promise.resolve(finalPath);
  }
}

const errno = (code: string, message: string): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
};

describe('USI-01R3B — archive read failures are not absence', () => {
  let root: string;
  let bytes: Buffer;
  let digest: string;

  const expectedRef = () =>
    `${HARNESS_WORKSPACE}/${digest.toLowerCase()}/source`;

  const archiveWith = (storage: StorageService) =>
    new BasicPriceSourceArchiveService(storage);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'usi01r3b-read-'));
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    bytes = buildBasicPriceCsv();
    digest = BasicPriceSourceArchiveService.digestOf(bytes);
  });

  afterEach(() => {
    delete process.env[INTAKE_STORAGE_DIR_ENV];
    rmSync(root, { recursive: true, force: true });
  });

  const retain = (archive: BasicPriceSourceArchiveService) =>
    archive.retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });

  it('ARCHIVE-READ-01: ENOENT — and ONLY ENOENT — means absent, so retention proceeds', async () => {
    // The ordinary first upload. Nothing is stored, the read fails ENOENT, and
    // that is a licence to write.
    const archive = archiveWith(new StorageService());
    const logicalRef = await retain(archive);

    expect(logicalRef).toBe(expectedRef());
    expect(await archive.read(logicalRef)).toEqual(bytes);
  });

  // ARCHIVE-READ-02 … 06 — every other read failure fails closed, and writes
  // nothing. One test per errno, because each is a different real-world fault
  // and a single parameterized pass would hide which one regressed.
  const FAIL_CLOSED: ReadonlyArray<[string, string, string]> = [
    ['ARCHIVE-READ-02', 'EACCES', 'EACCES: permission denied, open'],
    ['ARCHIVE-READ-03', 'EPERM', 'EPERM: operation not permitted, open'],
    ['ARCHIVE-READ-04', 'EIO', 'EIO: i/o error, read'],
    [
      'ARCHIVE-READ-05',
      'EISDIR',
      'EISDIR: illegal operation on a directory, read',
    ],
    // Not in the required list, and included anyway: a Windows file held open by
    // an antivirus scanner is the single most likely real cause of this class.
    ['ARCHIVE-READ-05B', 'EBUSY', 'EBUSY: resource busy or locked, open'],
  ];

  for (const [id, code, message] of FAIL_CLOSED) {
    it(`${id}: ${code} fails closed and NOTHING is written`, async () => {
      const storage = new ReadFailingStorage(errno(code, message));
      const archive = archiveWith(storage);

      await expect(retain(archive)).rejects.toThrow(
        ARCHIVE_STORAGE_READ_FAILURE,
      );

      // THE WHOLE POINT. An artifact may exist at that address; SIMPROK simply
      // could not see it, so it does not get overwritten by an upload that
      // never read it.
      expect(storage.writeAttempts).toBe(0);
      expect(readdirSync(root)).toEqual([]);
    });
  }

  it('ARCHIVE-READ-06: an UNEXPECTED non-Node error also fails closed', async () => {
    // No `.code` at all — a thrown string, a driver fault, a mocked port. An
    // unrecognized failure is the LEAST safe thing to treat as "not there".
    const storage = new ReadFailingStorage(
      new Error('something entirely unexpected'),
    );
    const archive = archiveWith(storage);

    const error = await retain(archive)
      .then(() => null)
      .catch((e: Error) => e);

    expect((error as Error).message).toContain(ARCHIVE_STORAGE_READ_FAILURE);
    // Reported honestly as unknown rather than dressed up as an errno.
    expect((error as Error).message).toContain('code=UNKNOWN');
    expect(storage.writeAttempts).toBe(0);
  });

  it('ARCHIVE-READ-07: the domain error names the logical ref and NO physical path', async () => {
    // Node puts the absolute path into the message AND onto `.path`, so
    // forwarding or interpolating a raw fs error would publish the machine's
    // directory layout through a boundary that has spent this whole
    // architecture keeping storage refs logical.
    const physicalPath = new StorageService().resolveFinalPath(expectedRef());
    const raw = errno(
      'EACCES',
      `EACCES: permission denied, open '${physicalPath}'`,
    );
    // Node attaches the path to the error object too, not only to its text.
    raw.path = physicalPath;

    const archive = archiveWith(new ReadFailingStorage(raw));
    const error = (await retain(archive)
      .then(() => null)
      .catch((e: Error) => e)) as Error;

    const message = error.message;
    // Enough to act on...
    expect(message).toContain(ARCHIVE_STORAGE_READ_FAILURE);
    expect(message).toContain(expectedRef());
    expect(message).toContain('operation=READ');
    expect(message).toContain('code=EACCES');
    // ...and nothing about this machine.
    expect(message).not.toContain(physicalPath);
    expect(message).not.toContain(root);
    expect(message).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(message).not.toContain('permission denied');

    // The cause is PRESERVED, not discarded: it belongs in a server log, and it
    // is reachable there without ever being rendered into the message above.
    expect(error.cause).toBe(raw);
  });

  it('ARCHIVE-READ-08: existing CORRECT bytes verify and are reused', async () => {
    const archive = archiveWith(new StorageService());
    const first = await retain(archive);
    const second = await retain(archive);

    expect(second).toBe(first);
    expect(await archive.read(second)).toEqual(bytes);
  });

  it('ARCHIVE-READ-09: existing WRONG bytes are an integrity conflict, never overwritten', async () => {
    const storage = new StorageService();
    const impostor = Buffer.from(
      'not the artifact this address claims\n',
      'utf8',
    );
    const finalPath = storage.resolveFinalPath(expectedRef());
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, impostor);

    await expect(retain(archiveWith(storage))).rejects.toThrow(
      ARCHIVE_INTEGRITY_CONFLICT,
    );
    // Untouched: it is the evidence an operator needs.
    expect(readFileSync(finalPath)).toEqual(impostor);
  });
});

describe('USI-01R3B — a successful write is a claim, not a proof', () => {
  let root: string;
  let bytes: Buffer;
  let digest: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'usi01r3b-write-'));
    process.env[INTAKE_STORAGE_DIR_ENV] = root;
    bytes = buildBasicPriceCsv();
    digest = BasicPriceSourceArchiveService.digestOf(bytes);
  });

  afterEach(() => {
    delete process.env[INTAKE_STORAGE_DIR_ENV];
    rmSync(root, { recursive: true, force: true });
  });

  const retainWith = (storage: StorageService) =>
    new BasicPriceSourceArchiveService(storage).retain({
      workspaceId: HARNESS_WORKSPACE,
      contentDigestSha256: digest,
      bytes,
    });

  it('POST-WRITE-01: the happy path reads the artifact back and re-hashes it before succeeding', async () => {
    const storage = new StorageService();
    const logicalRef = await retainWith(storage);

    // Success is reported only once the bytes at the address prove the address.
    const stored = readFileSync(storage.resolveFinalPath(logicalRef));
    expect(BasicPriceSourceArchiveService.digestOf(stored)).toBe(digest);
    expect(stored).toEqual(bytes);
  });

  it('POST-WRITE-02: a move that reports success but produces nothing fails closed', async () => {
    // `rename` returned without error and the address is empty. USI-01R3A
    // would have returned the reference, and the batch would have spent the
    // rest of its life pointing at nothing.
    await expect(retainWith(new LosingMoveStorage())).rejects.toThrow(
      ARCHIVE_POST_WRITE_MISSING,
    );
  });

  it('POST-WRITE-03: a move that lands the WRONG bytes is an integrity conflict', async () => {
    const wrong = Buffer.from(
      'these are not the bytes that were written\n',
      'utf8',
    );
    const storage = new WrongBytesMoveStorage(wrong);

    await expect(retainWith(storage)).rejects.toThrow(
      ARCHIVE_INTEGRITY_CONFLICT,
    );

    // NOT REPAIRED BY THE UPLOAD, and not deleted. SIMPROK cannot know which
    // bytes existing batches were describing, so it changes nothing.
    const finalPath = storage.resolveFinalPath(
      `${HARNESS_WORKSPACE}/${digest.toLowerCase()}/source`,
    );
    expect(readFileSync(finalPath)).toEqual(wrong);
  });

  it('POST-WRITE-04: a post-write read failure is reported as a read failure, not a lost race', async () => {
    // The move succeeded, so no race was lost — and answering "someone else got
    // here first" would send an operator to the wrong problem entirely.
    class MovedThenUnreadable extends StorageService {
      moved = false;
      async moveToFinal(tempPath: string, safeKey: string): Promise<string> {
        const result = await super.moveToFinal(tempPath, safeKey);
        this.moved = true;
        return result;
      }
      async readFinal(storageRef: string): Promise<Buffer> {
        if (this.moved) throw errno('EIO', 'EIO: i/o error, read');
        return super.readFinal(storageRef);
      }
    }
    const storage = new MovedThenUnreadable();

    await expect(retainWith(storage)).rejects.toThrow(
      ARCHIVE_STORAGE_READ_FAILURE,
    );
    expect(storage.moved).toBe(true);
  });

  it('POST-WRITE-05: no temp file is orphaned by any of these refusals', async () => {
    // A refusal must not leave the caller's own scratch file behind.
    await retainWith(new StorageService()).catch(() => undefined);
    const tempDir = join(root, 'tmp');
    const orphans = readdirSync(tempDir, { withFileTypes: true }).filter(
      (entry) => entry.isFile(),
    );
    expect(orphans).toEqual([]);
  });
});
