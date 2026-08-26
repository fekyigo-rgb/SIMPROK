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
    $transaction: async (callback: any) =>
      callback({
        basicPriceImportBatch: batchModel,
        basicPriceImportRow: rowModel,
      }),
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
