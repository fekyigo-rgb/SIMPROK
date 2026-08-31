import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';

/** The real Prisma error class, so `instanceof` checks in the service hold. */
const PrismaKnownError = Prisma.PrismaClientKnownRequestError;
import { BasicPriceSourceArchiveService } from '../../src/basic-price/basic-price-source-archive.service';
import { StorageService } from '../../src/reality-intake/storage.service';

export const HARNESS_WORKSPACE = '11111111-1111-4111-8111-111111111111';
export const HARNESS_OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';
export const HARNESS_ORGANIZATION = '22222222-2222-4222-8222-222222222222';
export const HARNESS_ACCOUNT = '33333333-3333-4333-8333-333333333333';

/**
 * USI-01R test harness.
 *
 * An in-memory stand-in for the two collaborators Basic Price intake now has:
 * Prisma, and Reality Intake's source-evidence authority. Two properties make
 * it useful as EVIDENCE rather than merely as scaffolding:
 *
 *   1. The Prisma proxy THROWS on any model outside the allowed set, so
 *      "intake never writes a BasicPrice" is enforced by the harness rather
 *      than merely hoped for.
 *   2. The storage port is in-memory, so `BasicPriceSourceArchiveService` runs
 *      its REAL logic — content-addressed keys, temp cleanup, no deletion of a
 *      shared final path — instead of being mocked away. The thing under test
 *      is the actual service, not a fake of it.
 */
/**
 * LOCAL, TEST-ONLY shapes for this in-memory fake.
 *
 * The fake stores whatever Prisma was asked to write, so a stored record is an
 * open bag of fields rather than a generated model type. `unknown` values keep
 * every read honest — a caller must narrow before using one — where `any` would
 * have let the whole store leak untyped into the specs that consume it.
 */
type HarnessRecord = Record<string, unknown>;
type HarnessWhere = Record<string, unknown>;

/**
 * The ONE method intake would reach for if it (wrongly) consulted the proposal
 * authority. Named rather than `as any` so this deliberately-throwing stub
 * cannot drift away from the call site it exists to forbid.
 */
interface ThrowingProposalAuthority {
  proposeForRows: (...args: never[]) => never;
}

/**
 * A Prisma failure the SERVICE's own `instanceof` checks will recognise.
 *
 * The prototype swap is what makes it real: the code under test narrows on
 * `PrismaClientKnownRequestError` before it ever reads `.code`, so an ordinary
 * Error carrying a code field would fall straight through the branch this fake
 * exists to exercise.
 */
function prismaError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  error.name = 'PrismaClientKnownRequestError';
  Object.setPrototypeOf(error, PrismaKnownError.prototype);
  return error;
}

/** Any one statement this fake can be asked to run inside a transaction. */
type HarnessStatement = (...args: never[]) => Promise<unknown>;

/**
 * BP-REGION-TRUTH-07U — POSTGRESQL'S OWN LAW, MODELLED.
 *
 * A statement that fails inside a transaction ABORTS it. Every later statement
 * on the same connection is refused with SQLSTATE 25P02 until the block ends,
 * and a JavaScript `catch` does nothing about that: it catches the exception,
 * not the server-side state.
 *
 * WHY THE FAKE MUST KNOW THIS. Without it a recovery read issued from inside a
 * `catch` — through the very transaction the failed write had just poisoned —
 * ran happily against this harness and returned a perfectly good answer, while
 * the real database answered 25P02 and turned a lawful 409 into a 500. The unit
 * pins stayed green for exactly as long as the fake was more forgiving than
 * PostgreSQL. It no longer is.
 */
function abortedTransactionError(): Error {
  return new Error(
    'ERROR: current transaction is aborted, commands ignored until end of ' +
      'transaction block (SQLSTATE 25P02)',
  );
}

export function createIntakeHarness(options: { failStorage?: boolean } = {}) {
  const batches: HarnessRecord[] = [];
  const rows: HarnessRecord[] = [];
  const storedBytes = new Map<string, Buffer>();
  const temporaryPaths = new Set<string>();

  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const batchModel = {
    findUnique: async ({ where }: any) => {
      const byFingerprint = where.workspaceId_importFingerprint;
      if (byFingerprint) {
        return (
          batches.find(
            (batch) =>
              batch.importFingerprint === byFingerprint.importFingerprint &&
              batch.workspaceId === byFingerprint.workspaceId,
          ) ?? null
        );
      }
      const byObservation = where.workspaceId_sourceObservationKey;
      if (byObservation) {
        return (
          batches.find(
            (batch) =>
              batch.sourceObservationKey ===
                byObservation.sourceObservationKey &&
              batch.workspaceId === byObservation.workspaceId,
          ) ?? null
        );
      }
      return null;
    },
    findMany: async ({ where, select }: any) => {
      const matches = batches.filter((batch) =>
        Object.entries(where ?? {}).every(([field, value]) => {
          // Support the one Prisma filter operator this intake actually uses.
          if (value && typeof value === 'object' && 'not' in (value as any)) {
            return (batch as any)[field] !== (value as any).not;
          }
          return (batch as any)[field] === value;
        }),
      );
      if (!select) return matches;
      return matches.map((batch) =>
        Object.fromEntries(
          Object.keys(select).map((field) => [field, (batch as any)[field]]),
        ),
      );
    },
    create: async ({ data }: { data: HarnessRecord }) => {
      // BOTH unique indexes are enforced here, exactly as PostgreSQL enforces
      // them. Without this the concurrency tests would pass against a fake that
      // simply never says no.
      const clash = batches.find(
        (batch) =>
          (batch.workspaceId === data.workspaceId &&
            batch.importFingerprint === data.importFingerprint) ||
          (batch.workspaceId === data.workspaceId &&
            data.sourceObservationKey != null &&
            batch.sourceObservationKey === data.sourceObservationKey),
      );
      if (clash) {
        const error: any = new Error('Unique constraint failed');
        error.code = 'P2002';
        error.name = 'PrismaClientKnownRequestError';
        Object.setPrototypeOf(error, PrismaKnownError.prototype);
        throw error;
      }
      const now = new Date();
      const batch = {
        id: id('batch'),
        version: 0,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      batches.push(batch);
      return batch;
    },
    /**
     * BP-REGION-TRUTH-07S §11 — THE OTHER HALF OF THE BROWSER LIFECYCLE.
     *
     * `preview` mints a batch; the metadata form finalizes it. Proving that
     * identity describes FINAL facts is impossible against a fake that only
     * knows how to create, so this fake now finalizes too — and enforces the
     * SAME unique index on the way, because the whole question is what happens
     * when two batches finalize into one identity.
     *
     * `undefined` means unchanged, exactly as Prisma treats it. Anything else,
     * including an explicit null, is written.
     */
    update: ({ where, data }: { where: HarnessWhere; data: HarnessRecord }) => {
      const batch = batches.find((candidate) => candidate.id === where.id);
      if (!batch) throw prismaError('P2025', 'Record to update not found');

      const next: HarnessRecord = { ...batch };
      for (const [field, value] of Object.entries(data)) {
        if (value === undefined) continue;
        // The one Prisma write operator this save uses. Read through a named
        // shape rather than an `any` hop, so a future operator lands as a type
        // error instead of silently writing an object into a column.
        const increment =
          field === 'version' && value !== null && typeof value === 'object'
            ? (value as { increment?: number }).increment
            : undefined;
        if (increment !== undefined) {
          next.version = (next.version as number) + increment;
          continue;
        }
        next[field] = value;
      }
      // THE UNIQUE INDEX, ENFORCED ON UPDATE TOO. Without this the fake would
      // happily let two batches claim one identity and the concurrency pin
      // would pass against a database that says no.
      const clash = batches.find(
        (candidate) =>
          candidate.id !== batch.id &&
          candidate.workspaceId === next.workspaceId &&
          candidate.importFingerprint === next.importFingerprint,
      );
      if (clash) throw prismaError('P2002', 'Unique constraint failed');

      Object.assign(batch, next);
      // A resolved promise, not an `async` body: the fake does no awaiting, and
      // the caller awaits this exactly as it awaits the real client.
      return Promise.resolve(batch);
    },
  };

  /**
   * The row lock the metadata save takes. The service selects a named column
   * list `FOR UPDATE`; this fake answers with the whole stored record, which is
   * a superset of it, and finds the row by the ONE bound parameter the
   * statement carries.
   */
  const queryRaw = (sql: unknown) => {
    const values = (sql as { values?: unknown[] } | null)?.values;
    const batchId = Array.isArray(values) ? values[0] : undefined;
    const batch = batches.find((candidate) => candidate.id === batchId);
    return Promise.resolve(batch ? [batch] : []);
  };

  const rowModel = {
    create: async ({ data }: { data: HarnessRecord }) => {
      const row = { id: id('row'), version: 0, ...data };
      rows.push(row);
      return row;
    },
    // Intake writes its rows SET-BASED, one bounded statement per chunk, and
    // supplies the id itself so the source's order survives a read-back that
    // has no order of its own. The fake honours both: it keeps what it is
    // given, and it answers with a count rather than rows — exactly as Prisma
    // does, and exactly what makes the id the only thing left to order by.
    createMany: async ({ data }: { data: HarnessRecord[] }) => {
      for (const row of data) rows.push({ version: 0, ...row });
      return { count: data.length };
    },
    count: async ({ where }: any) =>
      rows.filter((row) => row.batchId === where.batchId).length,
    findMany: async ({ where }: { where: HarnessWhere }) =>
      rows.filter((row) => row.batchId === where.batchId),
  };

  const allowed: Record<string, unknown> = {
    workspace: {
      findUnique: () =>
        Promise.resolve({ organizationId: HARNESS_ORGANIZATION }),
    },
    basicPriceImportBatch: batchModel,
    basicPriceImportRow: rowModel,
    $queryRaw: queryRaw,
    /**
     * The transaction client is the SAME store, wrapped in the abort law above:
     * the first statement to fail poisons it, and everything after that is
     * refused rather than answered.
     */
    $transaction: async (
      callback: (tx: Record<string, unknown>) => Promise<unknown>,
    ): Promise<unknown> => {
      let poisoned = false;
      const inTransaction =
        (statement: HarnessStatement): HarnessStatement =>
        async (...args: never[]) => {
          if (poisoned) throw abortedTransactionError();
          try {
            return await statement(...args);
          } catch (error) {
            poisoned = true;
            throw error;
          }
        };
      const guardModel = (model: object): Record<string, HarnessStatement> =>
        Object.fromEntries(
          Object.entries(model).map(([name, statement]) => [
            name,
            inTransaction(statement as HarnessStatement),
          ]),
        );

      return await callback({
        basicPriceImportBatch: guardModel(batchModel),
        basicPriceImportRow: guardModel(rowModel),
        $queryRaw: inTransaction(queryRaw),
      });
    },
  };

  const prisma: any = new Proxy(allowed, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !(property in target)) {
        // Reaching for basicPrice, priceSubmission or a publication table from
        // intake is a law violation, and it fails the test that triggers it
        // rather than passing quietly.
        throw new Error(`INTAKE_TOUCHED_FORBIDDEN_MODEL:${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });

  /**
   * A stand-in "root" prefix, so a test can tell a LOGICAL reference from a
   * resolved physical path — and so this fake resolves them in exactly one
   * place, the way the real service does.
   */
  const resolvedFinalPath = (safeKey: string) => `memory-root/${safeKey}`;

  /** In-memory storage port with the same contract as the real one. */
  const storage: StorageService = {
    async writeTemp(bytes: Buffer) {
      if (options.failStorage) throw new Error('FORCED_SOURCE_STORAGE_FAILURE');
      const path = id('tmp');
      temporaryPaths.add(path);
      storedBytes.set(path, bytes);
      return path;
    },
    computeChecksum(bytes: Buffer) {
      return createHash('sha256').update(bytes).digest('hex');
    },
    async moveToFinal(tempPath: string, safeKey: string) {
      const bytes = storedBytes.get(tempPath)!;
      temporaryPaths.delete(tempPath);
      storedBytes.delete(tempPath);
      // STORED UNDER THE RESOLVED PATH, exactly as the real port does: it joins
      // the configured root before writing, and `readFinal` is given a resolved
      // path in return. Keying this by the LOGICAL ref made every read miss, so
      // a written artifact looked absent — invisible while the archive only ever
      // asked "is anything here?", and caught the moment USI-01R3B started
      // proving the bytes it had just written.
      storedBytes.set(resolvedFinalPath(safeKey), bytes);
      return resolvedFinalPath(safeKey);
    },
    resolveFinalPath(safeKey: string) {
      return resolvedFinalPath(safeKey);
    },
    async readFinal(storageRef: string) {
      // Must THROW when absent, exactly as the filesystem does — the archive's
      // race handling asks "is this readable?" and a silent undefined would
      // make a missing file look retained.
      const bytes = storedBytes.get(storageRef);
      if (!bytes) {
        const error: NodeJS.ErrnoException = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      return bytes;
    },
    async deleteTemp(tempPath: string | null) {
      if (!tempPath) return;
      temporaryPaths.delete(tempPath);
      storedBytes.delete(tempPath);
    },
    async deleteFinal(storageRef: string | null) {
      if (!storageRef) return;
      storedBytes.delete(storageRef);
    },
  } as unknown as StorageService;

  const sourceArchive = new BasicPriceSourceArchiveService(storage);
  const reviewService = { createReviewWithinTransaction: jest.fn() } as any;

  /**
   * INT-CONNECT-01 — the machine-proposal seam, wired to REFUSE.
   *
   * Intake reads a source; it does not decide what the source means. The
   * canonical Unit and Resource Identity authorities are consulted on the
   * review READ path and nowhere else, so a `preview` that ever reached for
   * them would be a real defect — a slower import buying a screen it does not
   * serve. Following the harness's own law, that is ENFORCED here rather than
   * hoped for: this collaborator throws, so any such call fails the test that
   * made it instead of quietly succeeding against a stub.
   */
  const proposals: ThrowingProposalAuthority = {
    proposeForRows: () => {
      throw new Error(
        'INTAKE_MUST_NOT_CONSULT_RESOLUTION_AUTHORITIES: proposals belong to the review read path.',
      );
    },
  };

  return {
    prisma,
    storage,
    sourceArchive,
    reviewService,
    proposals,
    batches,
    rows,
    storedBytes,
    /** Temp files left behind. Must always be empty — see RI-04. */
    temporaryPaths,
  };
}
