import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { StorageService } from '../reality-intake/storage.service';

/**
 * USI-01R2 §5 / USI-01R3 §11-12 — RAW SOURCE BYTES FOR THE BASIC PRICE
 * VERTICAL INTAKE.
 *
 * WHY THIS IS NOT `SourceDocument`
 * --------------------------------
 * USI-01R briefly registered every Basic Price arrival as a Reality Intake
 * `SourceDocument`. That was withdrawn, because ROADMAP.md §15 gives RM-12 —
 * and only RM-12 — the job of "memindahkan intake ke Platform Layer", with
 * §57 forbidding the order to shift without a written Owner decision. DEBT.md
 * records today's Basic Price intake as `UTANG-PLATFORM-03: vertical-local
 * temporary intake`, closing at RM-12. Moving it onto the platform's evidence
 * model early would have closed that debt ahead of its gate.
 *
 * So the arrival stays VERTICAL-LOCAL, and this service is the smallest
 * truthful way to still answer LAW B's question — *what exactly was
 * received?* — at batch level.
 *
 * `StorageService` is reused because it is a plain filesystem port with no
 * knowledge of `IntakeJob`, `ExtractionArtifact` or the workers: infrastructure
 * shared, no RM-12 concept imported.
 */

/** The digest the caller supplied does not describe the bytes it sent. */
export const ARCHIVE_DIGEST_MISMATCH = 'SOURCE_ARCHIVE_DIGEST_MISMATCH';

/**
 * USI-01R3A §15/§18 — THE BYTES ALREADY STORED UNDER A CONTENT ADDRESS DO NOT
 * HASH TO IT.
 *
 * This is not a caller error and it is not recoverable here. Something already
 * on disk claims an identity it does not have, and the archive refuses to
 * decide which of the two is history: it does not overwrite, it does not
 * delete, and it never returns the reference as though nothing were wrong.
 */
export const ARCHIVE_INTEGRITY_CONFLICT = 'SOURCE_ARCHIVE_INTEGRITY_CONFLICT';

/**
 * USI-01R3B §19/§20 — SIMPROK COULD NOT READ IT. THAT IS NOT THE SAME AS
 * "IT IS NOT THERE."
 *
 * USI-01R3A caught every read failure and answered ABSENT. Only ENOENT means
 * absent. EACCES, EPERM, EIO, EISDIR, EBUSY and every unexpected fault mean
 * something quite different: an artifact MAY exist here and SIMPROK cannot see
 * it. Answering "absent" to that question is the most dangerous kind of wrong,
 * because the caller's next move is to WRITE — over evidence it never read.
 *
 * So a read it cannot complete fails closed, and says which operation failed.
 */
export const ARCHIVE_STORAGE_READ_FAILURE =
  'SOURCE_ARCHIVE_STORAGE_READ_FAILURE';

/**
 * USI-01R3B §23 — bytes were written, the move reported success, and the final
 * location does not hold them. Distinct from CORRUPT: nothing wrong was found
 * there, nothing at all was found there.
 */
export const ARCHIVE_POST_WRITE_MISSING =
  'SOURCE_ARCHIVE_POST_WRITE_ARTIFACT_MISSING';

/**
 * What an existing content-addressed artifact turned out to be.
 *
 * Four outcomes, because four different things can be true and only one of them
 * licenses a write:
 *
 *   ABSENT       ENOENT, and ONLY ENOENT. Nothing is stored here.
 *   VERIFIED     bytes read, and they hash to the address they sit under.
 *   CORRUPT      bytes read, and they do not. Fail closed.
 *   READ_FAILED  SIMPROK could not read. Fail closed — never write over this.
 */
export type StoredArtifactVerdict =
  | { status: 'ABSENT' }
  | { status: 'VERIFIED'; bytes: Buffer }
  | { status: 'CORRUPT'; actualDigest: string }
  | { status: 'READ_FAILED'; code: string | null; cause: unknown };

@Injectable()
export class BasicPriceSourceArchiveService {
  constructor(private readonly storage: StorageService) {}

  /**
   * THE ONE PLACE THIS DOMAIN HASHES SOURCE BYTES.
   *
   * Every other digest in the Basic Price intake path is compared against this
   * one rather than computed independently, so there is a single authority for
   * "what is the SHA-256 of this artifact".
   */
  static digestOf(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex').toUpperCase();
  }

  /**
   * Retains the bytes and returns a DURABLE LOGICAL reference to them.
   *
   * SELF-VERIFYING (§11). The digest is computed from the bytes actually
   * received and, when the caller states one, the two must agree. An archive
   * that trusted a caller-supplied hash would happily file bytes under a name
   * that does not describe them — and every later integrity check would compare
   * the wrong things and pass. A mismatch fails closed.
   *
   * CONTENT-ADDRESSED, AND THAT IS THE CONCURRENCY FIX. The key derives from
   * the VERIFIED digest, so two simultaneous uploads of an identical file
   * converge on one path holding one copy.
   *
   * NOTHING HERE EVER DELETES A FINAL PATH. That was USI-01R's defect: its
   * loser-cleanup deleted the very bytes the winning row pointed at. A
   * content-addressed path belongs to every batch that references it and to no
   * single request; only the caller's own TEMP file is cleaned up.
   *
   * AND NOTHING HERE OVERWRITES ONE EITHER (USI-01R3A §18). If the artifact
   * already at this address does not hash to it, the archive fails closed. It
   * does not repair history with the incoming upload, because it cannot know
   * which of the two the existing batches were describing — that is an
   * operational recovery, not a silent second truth.
   */
  async retain(input: {
    workspaceId: string;
    /** Optional. When present it is VERIFIED, never trusted. */
    contentDigestSha256?: string | null;
    bytes: Buffer;
  }): Promise<string> {
    const digest = BasicPriceSourceArchiveService.digestOf(input.bytes);
    if (
      input.contentDigestSha256 &&
      input.contentDigestSha256.toUpperCase() !== digest
    ) {
      throw new Error(
        `${ARCHIVE_DIGEST_MISMATCH}: declared=${input.contentDigestSha256.toUpperCase()} actual=${digest}`,
      );
    }

    const logicalRef = this.logicalRef(input.workspaceId, digest);
    // ALREADY RETAINED? PROVE IT. USI-01R3 reused whatever was READABLE here,
    // and readable is not verified: a truncated or replaced file opens exactly
    // as happily as the real one, and the batch would go on claiming bytes that
    // no longer describe its own digest.
    const existing = await this.verifyStoredArtifact(logicalRef, digest);
    if (existing.status === 'VERIFIED') return logicalRef;
    if (existing.status === 'CORRUPT') {
      throw this.integrityConflict(logicalRef, digest, existing.actualDigest);
    }
    // R3B §20 — A READ SIMPROK COULD NOT COMPLETE IS NOT AN EMPTY SHELF.
    // Proceeding to write here would overwrite an artifact that may well exist
    // and that this process was merely not permitted to see.
    if (existing.status === 'READ_FAILED') {
      throw this.storageReadFailure(logicalRef, existing);
    }

    let tempPath: string | null = null;
    try {
      tempPath = await this.storage.writeTemp(input.bytes);
      await this.storage.moveToFinal(tempPath, logicalRef);
      tempPath = null;
    } catch (error) {
      // LOST THE RACE, AND THAT IS FINE.
      //
      // POSIX rename(2) replaces its destination silently, but Windows throws
      // EPERM/EEXIST when another writer renames onto the same path at the same
      // instant. Both mean the same thing: a concurrent writer put identical,
      // content-addressed bytes there first.
      //
      // THE WINNER STILL HAS TO PROVE ITSELF. Losing a race is not a licence to
      // trust whatever now occupies the path — the loser inherits the winner's
      // bytes as its own evidence, so it verifies them under exactly the same
      // law it would apply to bytes it found there on a quiet system.
      const winner = await this.verifyStoredArtifact(logicalRef, digest);
      if (winner.status === 'VERIFIED') return logicalRef;
      if (winner.status === 'CORRUPT') {
        throw this.integrityConflict(logicalRef, digest, winner.actualDigest);
      }
      if (winner.status === 'READ_FAILED') {
        throw this.storageReadFailure(logicalRef, winner);
      }
      // ABSENT: nothing is there, so no race was lost — the write simply
      // failed, and its own error is the truthful answer.
      throw error;
    } finally {
      await this.storage.deleteTemp(tempPath);
    }

    // R3B §23 — A SUCCESSFUL WRITE IS A CLAIM, NOT A PROOF.
    //
    // `rename` returning without error says the syscall succeeded; it does not
    // say the bytes now at that address hash to it. A half-flushed file, a
    // filesystem that reordered the operation, or a concurrent writer that
    // replaced the destination between the move and the return would all look
    // exactly like success from here.
    //
    // Deliberately OUTSIDE the write's own try/catch: a verification refusal is
    // not a failed write, and running it inside would let the lost-race handler
    // re-examine the path and answer a question nobody asked.
    const written = await this.verifyStoredArtifact(logicalRef, digest);
    if (written.status === 'VERIFIED') return logicalRef;
    if (written.status === 'CORRUPT') {
      throw this.integrityConflict(logicalRef, digest, written.actualDigest);
    }
    if (written.status === 'READ_FAILED') {
      throw this.storageReadFailure(logicalRef, written);
    }
    // The move reported success and the address holds nothing. Never report a
    // retention that cannot be produced.
    throw new Error(
      `${ARCHIVE_POST_WRITE_MISSING}: storageRef=${logicalRef} expected=${digest}`,
    );
  }

  /**
   * USI-01R3 §12 — A LOGICAL KEY, NOT A MACHINE-BOUND PATH.
   *
   * What gets persisted in `BasicPriceImportBatch.sourceStorageRef` is this
   * string — `<workspaceId>/<sha256>/source` — never an absolute OS path.
   * Storing `C:\SIMPROK\backend\storage\…` would bind every historical batch to
   * one machine's directory layout: move the deployment, or change
   * INTAKE_STORAGE_DIR, and thousands of rows would point at nothing and the
   * database would have to be rewritten to fix it.
   *
   * The root is applied at READ time instead, so the same logical reference
   * resolves under whichever configured root currently holds the hierarchy.
   *
   * Both segments are SIMPROK-generated — a UUID and a hex digest — so no
   * attacker-controlled string ever reaches the filesystem, and there is no
   * path-traversal surface here.
   */
  private logicalRef(workspaceId: string, digest: string): string {
    return [workspaceId, digest.toLowerCase(), 'source'].join('/');
  }

  /** Reads back retained bytes by logical reference. Survives restart (§8). */
  async read(logicalRef: string): Promise<Buffer> {
    return this.storage.readFinal(this.storage.resolveFinalPath(logicalRef));
  }

  /**
   * USI-01R3A §15/§17 — THE ONE PLACE STORED BYTES ARE CHECKED AGAINST THE
   * IDENTITY THEY ARE FILED UNDER.
   *
   * `<workspace>/<sha256>/source` is not a name, it is a CLAIM: the bytes here
   * hash to that digest. Every reuse of an existing artifact rests on that
   * claim being true, so it is proven rather than assumed — once, centrally,
   * using the same digest authority that produced the address in the first
   * place. Scattering slightly different integrity checks across callers is how
   * one of them ends up being the lenient one.
   *
   * ARTIFACT-SCOPED (§24). This runs once per retained artifact, never per
   * candidate row, and it costs one read the previous readability probe was
   * already paying for.
   */
  private async verifyStoredArtifact(
    logicalRef: string,
    expectedDigest: string,
  ): Promise<StoredArtifactVerdict> {
    let bytes: Buffer;
    try {
      bytes = await this.read(logicalRef);
    } catch (error) {
      // R3B §19/§20 — ONLY ENOENT MEANS ABSENT.
      //
      // USI-01R3A answered ABSENT to every failure, which quietly turned "I was
      // not allowed to look" and "the disk errored" into "the shelf is empty" —
      // and the caller's very next act is to write. EACCES, EPERM, EIO, EISDIR,
      // EBUSY and anything unrecognized all fail closed instead.
      const code = (error as NodeJS.ErrnoException | null)?.code ?? null;
      if (code === 'ENOENT') return { status: 'ABSENT' };
      return { status: 'READ_FAILED', code, cause: error };
    }
    const actualDigest = BasicPriceSourceArchiveService.digestOf(bytes);
    if (actualDigest !== expectedDigest.toUpperCase()) {
      return { status: 'CORRUPT', actualDigest };
    }
    return { status: 'VERIFIED', bytes };
  }

  /**
   * The refusal itself. It names the LOGICAL reference — never the OS path
   * (§18/§25) — and both digests, because an operator recovering this later
   * needs to know which artifact and how far apart the two readings were.
   */
  private integrityConflict(
    logicalRef: string,
    expectedDigest: string,
    actualDigest: string,
  ): Error {
    return new Error(
      `${ARCHIVE_INTEGRITY_CONFLICT}: storageRef=${logicalRef} expected=${expectedDigest} stored=${actualDigest}`,
    );
  }

  /**
   * A read SIMPROK could not complete, reported without leaking the machine.
   *
   * R3B §21 — A RAW `fs` ERROR IS NOT SAFE TO FORWARD. Node puts the absolute
   * path into `message` and onto `.path`, so re-throwing it (or interpolating
   * its text) would publish `C:\…\storage\…` through a domain boundary that has
   * spent this whole architecture keeping storage refs logical. What travels is
   * the LOGICAL ref, the operation, and the errno — the three things an operator
   * actually needs.
   *
   * The original is preserved as `cause` rather than discarded: it is genuinely
   * useful in a server log, and it is reachable there without ever being
   * rendered into this message.
   */
  private storageReadFailure(
    logicalRef: string,
    verdict: { code: string | null; cause: unknown },
  ): Error {
    return new Error(
      `${ARCHIVE_STORAGE_READ_FAILURE}: storageRef=${logicalRef} operation=READ code=${verdict.code ?? 'UNKNOWN'}`,
      { cause: verdict.cause },
    );
  }
}
