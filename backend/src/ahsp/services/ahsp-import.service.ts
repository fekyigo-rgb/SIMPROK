import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { ImportStatus, Prisma } from '@prisma/client';
import {
  type AhspDocumentKnowledge,
  type AhspWorkItemKnowledge,
} from '../document/ahsp-document-knowledge';

/** The document-level half of the knowledge as READ — everything but the work items. */
export type AhspDocumentEnvelope = Omit<AhspDocumentKnowledge, 'workItems'>;

/** One durable intake line, aligned with the work item it was understood from. */
export interface AhspImportJournalLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly status: ImportStatus;
}

/** A settled evaluation of one line. */
export interface AhspImportLineOutcome {
  readonly status: ImportStatus;
  readonly reasonCodes: readonly string[];
  readonly ahspId?: string | null;
  readonly ahspVersionId?: string | null;
  readonly errorMessage?: string | null;
}

/** A line as a continuation needs it: the work item exactly as it was understood. */
export interface AhspImportHeldLine extends AhspImportJournalLine {
  readonly knowledge: AhspWorkItemKnowledge;
}

/**
 * IMPORT-SEAM-09 — one line as the settlement path must see it: read UNDER the
 * row lock, so it is what the journal holds now and not what a request loaded
 * before it started writing.
 */
export interface AhspImportLockedLine {
  readonly id: string;
  readonly status: ImportStatus;
  readonly ahspId: string | null;
  readonly ahspVersionId: string | null;
  readonly reasonCodes: readonly string[];
}

/**
 * A line that could not be settled because it is no longer eligible: another
 * evaluation already represented this item. Thrown INSIDE the caller's
 * transaction so the canonical write it belongs to rolls back with it — a
 * distinct type, never a duplicate-identity conflict, because the two say
 * different things about what happened.
 */
export class AhspImportLineAlreadySettledError extends Error {
  constructor(readonly lineId: string) {
    super('AHSP_IMPORT_LINE_ALREADY_SETTLED');
    this.name = 'AhspImportLineAlreadySettledError';
  }
}

type LineClient = Pick<Prisma.TransactionClient, 'aHSPImportLine'>;
type LockClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

const IMPORT_JOB_KEY_TAG = 'AHSP_IMPORT_JOB_V1';
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOURNAL_TRANSACTION = { timeout: 20_000, maxWait: 20_000 } as const;
const RECENT_JOBS = 20;
/** However large a page is asked for, one read stays one bounded read. */
const MAX_JOBS_PAGE = 100;

/** Where a page of imports ended: the position of its last row, and nothing else. */
export interface AhspImportJobCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export const encodeAhspImportJobCursor = (
  cursor: AhspImportJobCursor,
): string =>
  Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.id}`,
    'utf8',
  ).toString('base64url');

/**
 * A cursor is request input, so it is PROVED before it is used: the exact shape
 * this listing writes, or nothing. A cursor never carries a workspace and never
 * widens a read — the workspace filter is the caller's, so a cursor from another
 * tenant can only name a position, never reach that tenant's rows.
 */
export const decodeAhspImportJobCursor = (
  raw: string,
): AhspImportJobCursor | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) {
    return null;
  }
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator < 0) return null;
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !UUID_SHAPE.test(id)) return null;
  return { createdAt, id };
};

/**
 * The identity of one read of one document in one workspace: the same bytes,
 * read under the same parser and knowledge contracts, are ONE job — so importing
 * a document again can never open a second, uncontrolled intake.
 */
export function ahspImportJobKey(input: {
  workspaceId: string;
  sourceSha256: string;
  parserContractVersion: string;
  knowledgeContractVersion: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        IMPORT_JOB_KEY_TAG,
        input.workspaceId,
        input.sourceSha256,
        input.parserContractVersion,
        input.knowledgeContractVersion,
      ]),
      'utf8',
    )
    .digest('hex');
}


/**
 * GAP C2 — the answer to "which work item quoted this source row?".
 *
 * Three outcomes, kept apart on purpose. ABSENT means no journal line of this
 * workspace quotes that locator — which is the honest answer for every row
 * imported before the journal existed, and must never be dressed as a result.
 * AMBIGUOUS means more than one work item quotes it, which is lawful and is not
 * this read's to resolve.
 */
export type AhspSourceRowWorkContext =
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'AMBIGUOUS'; readonly quotedByLines: number }
  | {
      readonly kind: 'FOUND';
      readonly importJobId: string;
      readonly lineNumber: number;
      /** The source's own words for the work, never SIMPROK's paraphrase. */
      readonly workType: string | null;
      readonly methodName: string | null;
      readonly sheetName: string;
    };

/**
 * The locator BOTH sides already carry, as one comparable key — the contract the
 * `AHSPResource` schema comment states: workspace is the query's scope, and the
 * key itself is document digest + parser contract + sheet + row + raw name +
 * class. Case is folded only where case cannot carry meaning: a hex digest. The
 * raw name and the class are compared exactly, because a near-miss there is a
 * different fact, not a spelling.
 */
export function ahspSourceRowKey(row: {
  sourceSha256: string | null;
  parserContractVersion: string | null;
  sheetName: string | null;
  sourceRowNumber: number | null;
  rawName: string;
  resourceType: string;
}): string {
  return JSON.stringify([
    (row.sourceSha256 ?? '').toLowerCase(),
    row.parserContractVersion ?? '',
    row.sheetName ?? '',
    row.sourceRowNumber ?? -1,
    row.rawName,
    row.resourceType,
  ]);
}

@Injectable()
export class AhspImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  async createImportJob(idempotencyKey: string, ahspId?: string, userId?: string) {
    const job = await this.prisma.aHSPImportJob.create({
      data: {
        idempotencyKey,
        ahspId,
        status: ImportStatus.PENDING,
      }
    });

    if (ahspId && userId) {
      await this.audit.logAction({ ahspId, action: 'AHSPImportJobCreated', who: userId, after: job });
    }
    return job;
  }

  async updateJobStatus(jobId: string, status: ImportStatus) {
    return this.prisma.aHSPImportJob.update({
      where: { id: jobId },
      data: { status }
    });
  }

  /**
   * WHICH DOCUMENT AN IMPORT IS ABOUT — the journal's own answer.
   *
   * The import job already records the document's digest, so the source of a
   * saved import is knowable from the job alone. This says so explicitly
   * instead of leaving each caller to reach into the row, and it is scoped to
   * the workspace: a job id from elsewhere is not found, rather than answering
   * about another tenant's document.
   *
   * It answers the IDENTITY, never the bytes. Whoever keeps the bytes is a
   * different authority, and this deliberately does not speak for it — a job
   * can perfectly well name a document whose bytes were never retained, and
   * that difference has to stay visible.
   */
  async documentIdentityOfJob(params: {
    workspaceId: string;
    importJobId: string;
  }): Promise<{
    importJobId: string;
    sourceSha256: string | null;
    sourceFileName: string | null;
  } | null> {
    const job = await this.prisma.aHSPImportJob.findFirst({
      where: { id: params.importJobId, workspaceId: params.workspaceId },
      select: { id: true, sourceSha256: true, sourceFileName: true },
    });
    if (!job) return null;
    return {
      importJobId: job.id,
      sourceSha256: job.sourceSha256 ?? null,
      sourceFileName: job.sourceFileName ?? null,
    };
  }

  // ===========================================================================
  // IMPORT-SEAM-02 — THE DURABLE INTAKE JOURNAL.
  //
  // What a document was read into is kept BEFORE anything is decided about it:
  // the job holds the document as read, and every work item becomes one line
  // exactly as it was understood. Nothing here is canonical and nothing here
  // resolves; the AHSP writers stay the only way a recipe becomes an AHSP.
  // ===========================================================================

  /**
   * Record a read document and one PENDING line per understood work item, in one
   * transaction. Idempotent: the same workspace, bytes and contracts return the
   * same job and the same lines, and an existing line is never rewritten.
   *
   * `knowledge` MUST be the understanding-layer output, before any resolution: a
   * later evaluation re-asks today's authorities from source facts, never from an
   * earlier answer. Lines are returned in document order (lineNumber = index + 1).
   */
  async recordDocument(params: {
    workspaceId: string;
    userId: string;
    knowledge: AhspDocumentKnowledge;
  }): Promise<{ importJobId: string; lines: AhspImportJournalLine[] }> {
    const { workItems, ...envelope } = params.knowledge;
    const identity = {
      workspaceId: params.workspaceId,
      sourceSha256: envelope.source.contentDigestSha256,
      parserContractVersion: envelope.source.readerContractVersion,
      knowledgeContractVersion: envelope.contractVersion,
    };
    const idempotencyKey = ahspImportJobKey(identity);

    return this.prisma.$transaction(async (txc) => {
      const tx = txc as Prisma.TransactionClient;
      const job = await tx.aHSPImportJob.upsert({
        where: { idempotencyKey },
        create: {
          idempotencyKey,
          status: ImportStatus.PENDING,
          ...identity,
          sourceFileName: envelope.source.fileName,
          documentKnowledge: envelope as unknown as Prisma.InputJsonValue,
          createdByUserId: params.userId,
        },
        update: {},
        select: { id: true, workspaceId: true },
      });
      // The key already contains the workspace, so another tenant cannot reach
      // this job; the scope is still asserted rather than assumed.
      if (job.workspaceId !== params.workspaceId) {
        throw new ConflictException('AHSP_IMPORT_JOB_SCOPE_MISMATCH');
      }
      if (workItems.length > 0) {
        await tx.aHSPImportLine.createMany({
          data: workItems.map((item, index) => ({
            importJobId: job.id,
            workspaceId: params.workspaceId,
            lineNumber: index + 1,
            rawData: item as unknown as Prisma.InputJsonValue,
            status: ImportStatus.PENDING,
            reasonCodes: [...item.reasonCodes],
          })),
          skipDuplicates: true,
        });
      }
      const lines = await tx.aHSPImportLine.findMany({
        where: { importJobId: job.id, workspaceId: params.workspaceId },
        orderBy: { lineNumber: 'asc' },
        select: { id: true, lineNumber: true, status: true },
      });
      return { importJobId: job.id, lines };
    }, JOURNAL_TRANSACTION);
  }

  /**
   * IMPORT-SEAM-09 — SERIALIZE ONE INTAKE LINE. Lock the exact line on the
   * caller's transaction and read its CURRENT settlement under that lock, so two
   * requests cannot both see an open line and both act on it: the second waits
   * here and then reads what the first actually recorded.
   *
   * ONE ROW ONLY — never the job, the workspace or the subsystem — and the lock
   * lives exactly as long as the caller's transaction. A line of another
   * workspace, or an id that is not a line id, is simply not found: it is not
   * lockable and nothing about it is disclosed.
   */
  async lockLine(
    client: LockClient,
    params: { workspaceId: string; lineId: string },
  ): Promise<AhspImportLockedLine | null> {
    if (
      !UUID_SHAPE.test(params.lineId) ||
      !UUID_SHAPE.test(params.workspaceId)
    ) {
      return null;
    }
    const locked = await client.$queryRaw<
      Array<{
        id: string;
        status: ImportStatus;
        ahspId: string | null;
        ahspVersionId: string | null;
        reasonCodes: string[];
      }>
    >(
      Prisma.sql`SELECT "id", "status", "ahspId", "ahspVersionId", "reasonCodes"
                   FROM "ahsp_import_lines"
                  WHERE "id" = ${params.lineId}::uuid
                    AND "workspaceId" = ${params.workspaceId}::uuid
                  FOR UPDATE`,
    );
    return locked[0] ?? null;
  }

  /**
   * Settle one line's latest evaluation — on the caller's transaction when the
   * outcome must commit or roll back with a canonical write. A line already
   * COMPLETED is never downgraded or re-pointed: once an item is represented in
   * the AHSP tables, a later evaluation cannot un-represent it.
   *
   * RETURNS HOW MANY LINES IT ACTUALLY CHANGED, and the caller MUST act on it.
   * Zero is not success: it means this line was already represented, so an
   * outcome that claims to complete it is not true and must not commit
   * (`settleOrThrow`). The guard used to be silent, and a write could report a
   * success the journal never recorded.
   */
  async settleLine(
    client: LineClient,
    params: { workspaceId: string; lineId: string } & AhspImportLineOutcome,
  ): Promise<number> {
    const { count } = await client.aHSPImportLine.updateMany({
      where: {
        id: params.lineId,
        workspaceId: params.workspaceId,
        status: { not: ImportStatus.COMPLETED },
      },
      data: {
        status: params.status,
        reasonCodes: [...params.reasonCodes],
        ahspId: params.ahspId ?? null,
        ahspVersionId: params.ahspVersionId ?? null,
        errorMessage: params.errorMessage ?? null,
      },
    });
    return count;
  }

  /**
   * Settle one line and PROVE it: exactly one line changed, or the write this
   * settlement belongs to is not lawful and the caller's transaction rolls back
   * with everything it wrote.
   */
  async settleOrThrow(
    client: LineClient,
    params: { workspaceId: string; lineId: string } & AhspImportLineOutcome,
  ): Promise<void> {
    const settled = await this.settleLine(client, params);
    if (settled !== 1) {
      throw new AhspImportLineAlreadySettledError(params.lineId);
    }
  }

  /** The job's status from its lines: all represented, some, or none yet. */
  async refreshJobStatus(
    workspaceId: string,
    importJobId: string,
  ): Promise<ImportStatus> {
    const lines = await this.prisma.aHSPImportLine.findMany({
      where: { importJobId, workspaceId },
      select: { status: true },
    });
    const completed = lines.filter(
      (line) => line.status === ImportStatus.COMPLETED,
    ).length;
    const status =
      completed === lines.length
        ? ImportStatus.COMPLETED
        : completed > 0
          ? ImportStatus.PARTIAL_SUCCESS
          : ImportStatus.PENDING;
    await this.prisma.aHSPImportJob.updateMany({
      where: { id: importJobId, workspaceId },
      data: { status },
    });
    return status;
  }

  /**
   * What a continuation needs, read back from the journal: the document as read
   * and every line not yet represented, each with its work item as understood.
   * A job of another workspace — or an id that is not a job id — is not found.
   */
  async loadHeld(
    workspaceId: string,
    importJobId: string,
  ): Promise<{
    envelope: AhspDocumentEnvelope;
    knowledgeContractVersion: string;
    lines: AhspImportHeldLine[];
  }> {
    if (!UUID_SHAPE.test(importJobId)) {
      throw new NotFoundException('AHSP_IMPORT_JOB_NOT_FOUND');
    }
    const job = await this.prisma.aHSPImportJob.findFirst({
      where: { id: importJobId, workspaceId },
      select: { documentKnowledge: true, knowledgeContractVersion: true },
    });
    if (
      !job ||
      job.documentKnowledge === null ||
      job.knowledgeContractVersion === null
    ) {
      throw new NotFoundException('AHSP_IMPORT_JOB_NOT_FOUND');
    }
    const lines = await this.prisma.aHSPImportLine.findMany({
      where: {
        importJobId,
        workspaceId,
        status: { in: [ImportStatus.PENDING, ImportStatus.FAILED] },
      },
      orderBy: { lineNumber: 'asc' },
      select: { id: true, lineNumber: true, status: true, rawData: true },
    });
    return {
      envelope: job.documentKnowledge as unknown as AhspDocumentEnvelope,
      knowledgeContractVersion: job.knowledgeContractVersion,
      lines: lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        status: line.status,
        knowledge: line.rawData as unknown as AhspWorkItemKnowledge,
      })),
    };
  }

  /**
   * IMPORT-SEAM-05 — ONE PAGE OF IMPORTS, AND THE WAY BACK TO THE OLDER ONES.
   *
   * A page stays small so the door opens fast, and the cursor is what makes the
   * rest REACHABLE: an unfinished import older than twenty newer ones used to
   * fall off the end of this read with no way back to it but the file itself.
   * The order is total — newest first, the id breaking a tie between rows
   * created in the same instant — so a cursor names exactly one position and a
   * row is never skipped or repeated between pages.
   *
   * A read: nothing here resolves or writes.
   */
  async listDocuments(
    workspaceId: string,
    options: { cursor?: string | null; limit?: number } = {},
  ) {
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? RECENT_JOBS), 1),
      MAX_JOBS_PAGE,
    );
    const from = options.cursor
      ? decodeAhspImportJobCursor(options.cursor)
      : null;
    if (options.cursor && !from) {
      throw new BadRequestException('AHSP_IMPORT_JOBS_CURSOR_INVALID');
    }
    const page = await this.prisma.aHSPImportJob.findMany({
      where: {
        workspaceId,
        // Keyset, never OFFSET: a job created while the reader pages does not
        // shift the window and hide the row after it.
        ...(from
          ? {
              OR: [
                { createdAt: { lt: from.createdAt } },
                { createdAt: from.createdAt, id: { lt: from.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        sourceFileName: true,
        sourceSha256: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        lines: {
          where: { workspaceId },
          orderBy: { lineNumber: 'asc' },
          select: { lineNumber: true, status: true, reasonCodes: true },
        },
      },
    });
    const hasMore = page.length > limit;
    const jobs = hasMore ? page.slice(0, limit) : page;
    const last = jobs[jobs.length - 1];
    const waiting = await this.prisma.aHSPImportLine.findMany({
      where: {
        workspaceId,
        importJobId: { in: jobs.map((job) => job.id) },
        status: { in: [ImportStatus.PENDING, ImportStatus.FAILED] },
      },
      orderBy: [{ importJobId: 'asc' }, { lineNumber: 'asc' }],
      select: {
        importJobId: true,
        lineNumber: true,
        status: true,
        reasonCodes: true,
        rawData: true,
      },
    });
    const documents = jobs.map((job) => {
      const held = waiting
        .filter((line) => line.importJobId === job.id)
        .map((line) => {
          const item = line.rawData as unknown as AhspWorkItemKnowledge;
          return {
            lineNumber: line.lineNumber,
            status: line.status,
            reasonCodes: line.reasonCodes,
            workType: item.workType?.raw ?? null,
            methodName: item.methodName?.raw ?? null,
          };
        });
      return {
        importJobId: job.id,
        sourceFileName: job.sourceFileName,
        /** The document's digest — how its observations are found. Not for display. */
        sourceSha256: job.sourceSha256,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        // Only facts that stay true: a line's reasons are those of the evaluation
        // that settled it, so "identity still pending" would go stale the moment a
        // person curates — it is asked of the identity authority where it matters.
        counts: {
          received: job.lines.length,
          represented: job.lines.filter(
            (line) => line.status === ImportStatus.COMPLETED,
          ).length,
          waiting: held.length,
        },
        waiting: held,
      };
    });
    return {
      jobs: documents,
      hasMore,
      // Only when there IS a next page: a cursor is a way on, never a claim that
      // something waits there.
      nextCursor:
        hasMore && last
          ? encodeAhspImportJobCursor({
              createdAt: last.createdAt,
              id: last.id,
            })
          : null,
    };
  }

  /**
   * The lines whose understood facts the completion view reads — every line of
   * the listed imports, with the AHSP and version a saved line points to. A read
   * of what was understood: the facts are asked again of today's authorities by
   * the caller, never taken from the evaluation that settled them.
   */
  async loadCompletionLines(
    workspaceId: string,
    importJobIds: readonly string[],
  ): Promise<
    Array<{
      id: string;
      importJobId: string;
      lineNumber: number;
      status: ImportStatus;
      reasonCodes: string[];
      ahspId: string | null;
      ahspVersionId: string | null;
      knowledge: AhspWorkItemKnowledge;
    }>
  > {
    if (importJobIds.length === 0) return [];
    const lines = await this.prisma.aHSPImportLine.findMany({
      where: {
        workspaceId,
        importJobId: { in: [...importJobIds] },
      },
      orderBy: [{ importJobId: 'asc' }, { lineNumber: 'asc' }],
      select: {
        id: true,
        importJobId: true,
        lineNumber: true,
        status: true,
        reasonCodes: true,
        ahspId: true,
        ahspVersionId: true,
        rawData: true,
      },
    });
    return lines.map(({ rawData, ...line }) => ({
      ...line,
      knowledge: rawData as unknown as AhspWorkItemKnowledge,
    }));
  }

  /**
   * GAP C2 — WHICH WORK ITEM QUOTED THIS SOURCE ROW.
   *
   * An `ObservedResource` records a component a document mentioned but could not
   * prove, with full provenance and NO pointer to the work item that quoted it.
   * The `AHSPResource` schema comment states the contract that makes the pointer
   * unnecessary — both sides carry the same locator: workspace, source digest,
   * sheet, row, raw name and class — but nothing in the repository performed the
   * read. So the parent context existed, in this service's own journal, and
   * never reached anyone.
   *
   * This is that read, and it lives HERE because the journal is this service's
   * to answer for. The domain-neutral observation lifecycle is deliberately not
   * taught about AHSP: `origin` there is a provenance tag, never a branch.
   *
   * WHAT IT VALIDATES, and it validates all of it:
   *   - the workspace, on the job AND on the line;
   *   - the document digest, exactly;
   *   - the parser contract version, so two readings of the same bytes by
   *     different reader contracts are not silently treated as one;
   *   - the locator: sheet AND row, from the component's own `nameEvidence`;
   *   - the raw name and the class, byte for byte.
   *
   * WHAT IT REFUSES. A pairing is never chosen by name alone, and ambiguity is
   * never resolved by picking the first: when two lines of one document quote
   * the same source row for the same component — a lawful shape, since two work
   * items may quote one row — the answer is AMBIGUOUS and carries no work item.
   * An absent pairing answers ABSENT. Neither is dressed up as a result: the
   * 826 rows already in Permanent have no journal to join to, and that is
   * reported as absent rather than reconstructed.
   *
   * It asserts nothing about identity or unit. In particular the work item's
   * OUTPUT unit is never offered as a component's unit.
   */
  async workContextForSourceRows(
    workspaceId: string,
    rows: readonly {
      sourceSha256: string | null;
      parserContractVersion: string | null;
      sheetName: string | null;
      sourceRowNumber: number | null;
      rawName: string;
      resourceType: string;
    }[],
  ): Promise<Map<string, AhspSourceRowWorkContext>> {
    const answer = new Map<string, AhspSourceRowWorkContext>();
    if (rows.length === 0) return answer;

    // Only a row whose provenance can name its document AND its place in it can
    // be joined at all. Everything else is ABSENT, said once, here.
    const joinable = rows.filter(
      (row) =>
        typeof row.sourceSha256 === 'string' &&
        row.sourceSha256.length > 0 &&
        typeof row.sheetName === 'string' &&
        row.sheetName.length > 0 &&
        typeof row.sourceRowNumber === 'number',
    );
    for (const row of rows) {
      answer.set(ahspSourceRowKey(row), { kind: 'ABSENT' });
    }
    if (joinable.length === 0) return answer;

    const digests = [
      ...new Set(joinable.map((row) => (row.sourceSha256 as string).toLowerCase())),
    ];
    /**
     * ASK ABOUT THE DOCUMENTS IN HAND, NOT ABOUT EVERY IMPORT EVER MADE.
     *
     * This used to load every job in the workspace and sift them in memory, so
     * the cost of explaining one row grew with the workspace's whole history.
     *
     * The narrowing is spelled in BOTH hex cases deliberately. A digest is a
     * number written in letters: `CA64…` and `ca64…` are one identity, but SQL
     * equality does not know that, and `in` has no case-insensitive form. A
     * query narrowed to one spelling would silently return NOTHING for rows
     * stored in the other — an empty answer that reads exactly like "no such
     * document". So the filter offers both spellings, and the case-folded
     * comparison below stays the authority on what actually matches.
     */
    const jobs = await this.prisma.aHSPImportJob.findMany({
      where: {
        workspaceId,
        sourceSha256: {
          in: [...digests, ...digests.map((digest) => digest.toUpperCase())],
        },
      },
      select: {
        id: true,
        sourceSha256: true,
        parserContractVersion: true,
      },
    });
    const jobById = new Map(
      jobs
        .filter(
          (job) =>
            typeof job.sourceSha256 === 'string' &&
            digests.includes(job.sourceSha256.toLowerCase()),
        )
        .map((job) => [job.id, job]),
    );
    if (jobById.size === 0) return answer;

    const lines = await this.prisma.aHSPImportLine.findMany({
      where: { workspaceId, importJobId: { in: [...jobById.keys()] } },
      orderBy: [{ importJobId: 'asc' }, { lineNumber: 'asc' }],
      select: { importJobId: true, lineNumber: true, rawData: true },
    });

    /** locator key → the work items that quote it, in journal order. */
    const quotedBy = new Map<string, AhspSourceRowWorkContext[]>();
    for (const line of lines) {
      const job = jobById.get(line.importJobId);
      if (!job) continue;
      const knowledge = line.rawData as unknown as AhspWorkItemKnowledge | null;
      if (!knowledge || !Array.isArray(knowledge.resources)) continue;
      for (const resource of knowledge.resources) {
        const locator = resource.nameEvidence;
        if (!locator || !resource.rawName || !resource.group) continue;
        const key = ahspSourceRowKey({
          sourceSha256: job.sourceSha256,
          parserContractVersion: job.parserContractVersion,
          sheetName: locator.sheetName,
          sourceRowNumber: locator.rowNumber,
          rawName: resource.rawName,
          resourceType: resource.group,
        });
        const found: AhspSourceRowWorkContext = {
          kind: 'FOUND',
          importJobId: line.importJobId,
          lineNumber: line.lineNumber,
          // The source's own words for the work, never SIMPROK's paraphrase.
          workType: knowledge.workType?.raw ?? null,
          methodName: knowledge.methodName?.raw ?? null,
          sheetName: knowledge.sheetName,
        };
        quotedBy.set(key, [...(quotedBy.get(key) ?? []), found]);
      }
    }

    for (const row of joinable) {
      const key = ahspSourceRowKey(row);
      const matches = quotedBy.get(key) ?? [];
      /**
       * AMBIGUOUS MEANS TWO WORK ITEMS — NOT TWO MENTIONS.
       *
       * This counted REFERENCES. One work item that quotes the same source row
       * twice — a component listed twice in one recipe, which real documents do
       * — produced two matches, and the row was reported AMBIGUOUS "quoted by 2
       * lines" when exactly one line quoted it. The person was told SIMPROK
       * could not tell which work item this was, about a row with only one.
       *
       * The context of a row is the WORK ITEM, so distinct journal lines are
       * what can disagree. Two mentions inside one line are one context, and it
       * is shown.
       */
      const byLine = new Map<string, AhspSourceRowWorkContext>();
      for (const match of matches) {
        if (match.kind !== 'FOUND') continue;
        byLine.set(`${match.importJobId}#${match.lineNumber}`, match);
      }
      if (byLine.size === 1) answer.set(key, [...byLine.values()][0]);
      else if (byLine.size > 1) {
        // Two work items quoting one source row is lawful. Choosing between them
        // is not this read's to do, and picking the first would attach one work
        // item's context to another's line.
        answer.set(key, { kind: 'AMBIGUOUS', quotedByLines: byLine.size });
      }
    }
    return answer;
  }
}

