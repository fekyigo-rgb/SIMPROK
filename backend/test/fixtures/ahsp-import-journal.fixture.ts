import { ImportStatus } from '@prisma/client';
import type {
  AhspDocumentKnowledge,
  AhspWorkItemKnowledge,
} from '../../src/ahsp/document/ahsp-document-knowledge';
import { AhspImportLineAlreadySettledError } from '../../src/ahsp/services/ahsp-import.service';

/** What one settlement states — the real journal's parameters. */
interface SettleLineParams {
  workspaceId: string;
  lineId: string;
  status: ImportStatus;
  reasonCodes: readonly string[];
  ahspId?: string | null;
  ahspVersionId?: string | null;
  errorMessage?: string | null;
}

/** One intake line as the in-memory journal keeps it. */
export interface InMemoryImportLine {
  id: string;
  importJobId: string;
  lineNumber: number;
  status: ImportStatus;
  reasonCodes: string[];
  ahspId: string | null;
  ahspVersionId: string | null;
  errorMessage: string | null;
  /** The work item exactly as understood — serialized, as the database stores it. */
  knowledge: AhspWorkItemKnowledge;
}

/** A JSON round trip: what a Json column gives back is a copy, never the object that was written. */
const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * An in-memory stand-in for the AhspImportService journal methods, for unit
 * specs of the canonicalization service. It keeps the same contract the real
 * journal keeps — one line per understood work item, idempotent per document,
 * and a COMPLETED line is never downgraded — so a spec can assert what became
 * durable, not only which method was called.
 */
export function inMemoryImportJournal() {
  // Workspace-strict, as the real journal is: a job is only ever read back in the
  // workspace that recorded it.
  const jobs = new Map<
    string,
    { workspaceId: string; envelope: Omit<AhspDocumentKnowledge, 'workItems'> }
  >();
  const inWorkspace = (workspaceId: string, importJobId: string) =>
    jobs.get(importJobId)?.workspaceId === workspaceId;
  const lines = new Map<string, InMemoryImportLine>();
  const jobKey = (knowledge: AhspDocumentKnowledge, workspaceId: string) =>
    `${workspaceId}|${knowledge.source.contentDigestSha256}|${knowledge.source.readerContractVersion}|${knowledge.contractVersion}`;
  const keyToJob = new Map<string, string>();
  const linesOf = (importJobId: string): InMemoryImportLine[] =>
    [...lines.values()]
      .filter((line) => line.importJobId === importJobId)
      .sort((a, b) => a.lineNumber - b.lineNumber);
  /** The real settlement, and its count: a COMPLETED line changes nothing. */
  const settle = (params: SettleLineParams): number => {
    const line = lines.get(params.lineId);
    if (!line || line.status === ImportStatus.COMPLETED) return 0;
    line.status = params.status;
    line.reasonCodes = [...params.reasonCodes];
    line.ahspId = params.ahspId ?? null;
    line.ahspVersionId = params.ahspVersionId ?? null;
    line.errorMessage = params.errorMessage ?? null;
    return 1;
  };

  return {
    lines,
    linesOf,
    recordDocument: jest.fn(
      (params: {
        workspaceId: string;
        userId: string;
        knowledge: AhspDocumentKnowledge;
      }) => {
        const { workItems, ...envelope } = params.knowledge;
        const key = jobKey(params.knowledge, params.workspaceId);
        const known = keyToJob.get(key);
        const importJobId = known ?? `job-${keyToJob.size + 1}`;
        if (!known) {
          keyToJob.set(key, importJobId);
          jobs.set(importJobId, {
            workspaceId: params.workspaceId,
            envelope: stored(envelope),
          });
        }
        workItems.forEach((item, index) => {
          const id = `${importJobId}-line-${index + 1}`;
          if (lines.has(id)) return;
          lines.set(id, {
            id,
            importJobId,
            lineNumber: index + 1,
            status: ImportStatus.PENDING,
            reasonCodes: [...item.reasonCodes],
            ahspId: null,
            ahspVersionId: null,
            errorMessage: null,
            knowledge: stored(item),
          });
        });
        return Promise.resolve({
          importJobId,
          lines: linesOf(importJobId).map(({ id, lineNumber, status }) => ({
            id,
            lineNumber,
            status,
          })),
        });
      },
    ),
    // The real journal's guard, and its ANSWER: how many lines actually changed.
    // A COMPLETED line is never downgraded, so settling one changes nothing — and
    // the caller is the one that must act on that zero.
    settleLine: jest.fn((_client: unknown, params: SettleLineParams) =>
      Promise.resolve(settle(params)),
    ),
    settleOrThrow: jest.fn((_client: unknown, params: SettleLineParams) =>
      settle(params) === 1
        ? Promise.resolve()
        : Promise.reject(new AhspImportLineAlreadySettledError(params.lineId)),
    ),
    // IMPORT-SEAM-09 — the line as the settlement path sees it: only in its own
    // workspace, and read the moment it is asked for.
    lockLine: jest.fn(
      (_client: unknown, params: { workspaceId: string; lineId: string }) => {
        const line = lines.get(params.lineId);
        if (!line || !inWorkspace(params.workspaceId, line.importJobId)) {
          return Promise.resolve(null);
        }
        const { id, status, ahspId, ahspVersionId, reasonCodes } = line;
        return Promise.resolve({
          id,
          status,
          ahspId,
          ahspVersionId,
          reasonCodes: [...reasonCodes],
        });
      },
    ),
    refreshJobStatus: jest.fn(() => Promise.resolve(ImportStatus.PENDING)),
    loadHeld: jest.fn((workspaceId: string, importJobId: string) => {
      const job = jobs.get(importJobId);
      if (!job || job.workspaceId !== workspaceId) {
        return Promise.reject(new Error('AHSP_IMPORT_JOB_NOT_FOUND'));
      }
      return Promise.resolve({
        envelope: job.envelope,
        knowledgeContractVersion: job.envelope.contractVersion,
        lines: linesOf(importJobId)
          .filter((line) => line.status !== ImportStatus.COMPLETED)
          .map(({ id, lineNumber, status, knowledge }) => ({
            id,
            lineNumber,
            status,
            knowledge: stored(knowledge),
          })),
      });
    }),
    // The same shape the real journal lists: one page of jobs, each line still
    // waiting named as the source names it, and the way on to older pages. These
    // specs hold a handful of documents, so one page holds them all.
    listDocuments: jest.fn((workspaceId: string) =>
      Promise.resolve({
        hasMore: false,
        nextCursor: null,
        jobs: [...jobs.entries()]
          .filter(([, job]) => job.workspaceId === workspaceId)
          .map(([importJobId, job]) => {
            const all = linesOf(importJobId);
            const waiting = all
              .filter((line) => line.status !== ImportStatus.COMPLETED)
              .map((line) => ({
                lineNumber: line.lineNumber,
                status: line.status,
                reasonCodes: [...line.reasonCodes],
                workType: line.knowledge.workType?.raw ?? null,
                methodName: line.knowledge.methodName?.raw ?? null,
              }));
            return {
              importJobId,
              sourceFileName: job.envelope.source.fileName,
              sourceSha256: job.envelope.source.contentDigestSha256,
              status: ImportStatus.PENDING,
              createdAt: new Date('2026-09-15T00:00:00.000Z'),
              updatedAt: new Date('2026-09-15T00:00:00.000Z'),
              counts: {
                received: all.length,
                represented: all.length - waiting.length,
                waiting: waiting.length,
              },
              waiting,
            };
          }),
      }),
    ),
    // The lines the completion view reads: every line of the listed imports, with
    // the AHSP and version a saved line points to.
    loadCompletionLines: jest.fn(
      (workspaceId: string, importJobIds: readonly string[]) =>
        Promise.resolve(
          importJobIds
            .filter((importJobId) => inWorkspace(workspaceId, importJobId))
            .flatMap((importJobId) =>
              linesOf(importJobId).map(
                ({
                  id,
                  lineNumber,
                  status,
                  reasonCodes,
                  ahspId,
                  ahspVersionId,
                  knowledge,
                }) => ({
                  id,
                  importJobId,
                  lineNumber,
                  status,
                  reasonCodes: [...reasonCodes],
                  ahspId,
                  ahspVersionId,
                  knowledge: stored(knowledge),
                }),
              ),
            ),
        ),
    ),
  };
}

/** A Prisma stand-in whose `$transaction` runs the callback on a marker client. */
export function transactionalPrisma<T extends Record<string, unknown>>(
  delegates: T,
) {
  const tx = { __transaction: true } as const;
  return {
    tx,
    prisma: {
      ...delegates,
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    },
  };
}
