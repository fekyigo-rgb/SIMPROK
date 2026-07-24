import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BOQ_PARSER_CONTRACT_VERSION, BoqImportKnowledgeObject, BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';
import { RabLifecyclePolicyService, WORKING_DRAFT_STRUCTURE_NAME } from './rab-lifecycle-policy.service';

export const MAX_UPLOAD_BYTES = 10_485_760;
export const MAX_PREVIEW_DISPLAY_ROWS = 500;
const WORKING_DRAFT_NAME = WORKING_DRAFT_STRUCTURE_NAME;
const STRUCTURAL_ROW_STORAGE = Object.freeze({ quantity: '0', unit: '' });
type UploadedXlsx = { buffer: Buffer; size: number; originalname: string; mimetype?: string };

@Injectable()
export class BoqImportService {
  private readonly adapter = new BoqXlsxIntakeAdapter();
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabLifecyclePolicy: RabLifecyclePolicyService,
  ) {}

  private validateFile(file: UploadedXlsx | undefined): asserts file is UploadedXlsx {
    if (!file?.buffer) throw new BadRequestException('XLSX file is required');
    if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('XLSX file exceeds 10 MiB');
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('Only XLSX files are accepted');
  }

  private async parse(file: UploadedXlsx, selectedSheet?: string): Promise<BoqImportKnowledgeObject> {
    try { return await this.adapter.parse(file.buffer, file.originalname, selectedSheet); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'INVALID_XLSX';
      if (message === 'SOURCE_ROW_LIMIT_EXCEEDED') throw new PayloadTooLargeException(message);
      throw new BadRequestException(message);
    }
  }

  private fingerprint(projectId: string, workspaceId: string, knowledge: BoqImportKnowledgeObject): string {
    return createHash('sha256').update([projectId, workspaceId, knowledge.sourceSha256, knowledge.sheetName, BOQ_PARSER_CONTRACT_VERSION].join('|')).digest('hex').toUpperCase();
  }

  // Lifecycle is enforced by RabEditableLifecycleGuard before this method is
  // ever invoked (pre-Multer — see project.controller.ts). No second check
  // here: one derivation source, read once, before file parsing.
  async preview(projectId: string, workspaceId: string, file?: UploadedXlsx, selectedSheet?: string) {
    this.validateFile(file);
    const knowledge = await this.parse(file, selectedSheet);
    const prioritized = [...knowledge.rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || Number(b.warnings.length > 0) - Number(a.warnings.length > 0) || a.sortOrder - b.sortOrder);
    const rejectedRows = knowledge.rows.filter((row) => row.errors.length > 0).length;
    const warningRows = knowledge.rows.filter((row) => row.warnings.length > 0).length;
    const displayedRows = prioritized.slice(0, MAX_PREVIEW_DISPLAY_ROWS);
    const accepted = knowledge.rows.filter((row) => row.errors.length === 0);
    const folderRows = accepted.filter((row) => row.itemType === 'FOLDER').length;
    const workItemRows = accepted.filter((row) => row.itemType === 'WORK_ITEM').length;
    const noteRows = accepted.filter((row) => row.itemType === 'NOTE').length;
    return {
      importFingerprint: this.fingerprint(projectId, workspaceId, knowledge), sourceSha256: knowledge.sourceSha256,
      fileName: knowledge.fileName, sheetName: knowledge.sheetName, totalSourceRows: knowledge.totalSourceRows,
      acceptedRows: folderRows + workItemRows + noteRows, folderRows, workItemRows, noteRows,
      warningRows, rejectedRows, displayedRows,
      displayedRowCount: displayedRows.length, previewTruncated: displayedRows.length < knowledge.rows.length,
      sourceQuantityMaxScale: knowledge.sourceQuantityEvidence.maxScale,
      sourceQuantityRowsExceedingScale2: knowledge.sourceQuantityEvidence.rowsExceedingScale2,
      canApprove: rejectedRows === 0 && knowledge.sourceQuantityEvidence.rowsExceedingScale2 === 0,
    };
  }

  // Replay semantics (RM-001 closure): a WRONG or mismatched fingerprint
  // always fails closed with zero mutation (checked twice: before and again
  // inside the locked transaction, see below). An EXACT replay of the same
  // fingerprint is deliberately NOT rejected — there is no server-side
  // preview session to consume, by design (see fingerprint() above). Two
  // exact-replay approvals are serialized by the Working Draft row lock and
  // each performs an idempotent full-replace, so the final item set is
  // deterministic with no duplicate rows. One-time preview consumption is
  // not implemented and is out of scope for this fix; it would require a
  // stateful session/schema addition this task explicitly does not make.
  async approve(projectId: string, workspaceId: string, fingerprint: string, file?: UploadedXlsx, selectedSheet?: string) {
    this.validateFile(file);
    const knowledge = await this.parse(file, selectedSheet);
    if (this.fingerprint(projectId, workspaceId, knowledge) !== fingerprint) throw new ConflictException('IMPORT_FINGERPRINT_MISMATCH');
    if (knowledge.rows.some((row) => row.errors.length > 0)) throw new BadRequestException('IMPORT_HAS_INVALID_ROWS');
    if (knowledge.sourceQuantityEvidence.rowsExceedingScale2 > 0) throw new BadRequestException('QUANTITY_SCALE_EXCEEDS_CURRENT_SCHEMA');

    return this.prisma.$transaction(async (tx) => {
      const lockedProject = await tx.$queryRaw<Array<{ id: string; status: string }>>(
        Prisma.sql`SELECT "id", "status" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      if (lockedProject.length === 0) throw new NotFoundException('Project not found');

      const capability = await this.rabLifecyclePolicy.evaluateInTransaction(tx, projectId, lockedProject[0].status as ProjectStatus);
      // MULTIPLE_WORKING_DRAFTS is left to the candidate lookup below, which already
      // locks the exact structure row and reports the identical reason code.
      if (!capability.canEnterEditableDraftWorkspace && capability.reasonCode !== 'MULTIPLE_WORKING_DRAFTS') {
        throw new ConflictException(capability.reasonCode);
      }

      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bs."id" FROM "boq_structures" bs
        INNER JOIN "projects" p ON p."id" = bs."projectId"
        WHERE bs."projectId" = ${projectId}::uuid AND p."workspaceId" = ${workspaceId}::uuid
          AND bs."status" = 'DRAFT' AND bs."name" = ${WORKING_DRAFT_NAME}
        ORDER BY bs."id" ASC
      `);
      if (candidates.length === 0) throw new NotFoundException('WORKING_DRAFT_NOT_FOUND');
      if (candidates.length > 1) throw new ConflictException('MULTIPLE_WORKING_DRAFTS');
      const locked = await tx.$queryRaw<Array<{ id: string; projectId: string; status: string; name: string }>>(Prisma.sql`
        SELECT "id", "projectId", "status", "name" FROM "boq_structures"
        WHERE "id" = ${candidates[0].id}::uuid FOR UPDATE
      `);
      const draft = locked[0];
      if (!draft || draft.projectId !== projectId || draft.status !== 'DRAFT' || draft.name !== WORKING_DRAFT_NAME) throw new NotFoundException('WORKING_DRAFT_NOT_FOUND');
      // Re-validated here, inside the same locked transaction: the fingerprint
      // is a pure function of (projectId, workspaceId, file, sheet, parser
      // version) already checked above before the lock was acquired, but the
      // actual mutation below must be bound to an explicit in-transaction
      // assertion rather than trusting a check made before the lock existed.
      if (this.fingerprint(projectId, workspaceId, knowledge) !== fingerprint) throw new ConflictException('IMPORT_FINGERPRINT_MISMATCH');

      // Safe full-replace: bounded to this exact Working Draft only. Never
      // scoped by projectId/workspaceId/status, which would reach other
      // structures.
      const replacedExistingItemCount = await tx.boqItem.count({ where: { boqStructureId: draft.id } });
      if (replacedExistingItemCount > 0) {
        await tx.boqItem.deleteMany({ where: { boqStructureId: draft.id } });
      }

      const ids = new Map<string, string>();
      const created: Array<{ id: string }> = [];
      for (const row of knowledge.rows) {
        const structural = row.itemType === 'FOLDER' || row.itemType === 'NOTE';
        if (!structural && !row.quantityDecimalString) throw new BadRequestException('WORK_ITEM_QUANTITY_REQUIRED');
        if (!structural && !row.unitRaw) throw new BadRequestException('WORK_ITEM_UNIT_REQUIRED');
        const parentId = row.parentSourceReference ? ids.get(row.parentSourceReference) ?? null : null;
        const item = await tx.boqItem.create({ data: {
          boqStructureId: draft.id, parentId, wbsCode: row.sourceCode ?? '', name: row.description,
          itemType: row.itemType,
          quantity: new Prisma.Decimal(structural ? STRUCTURAL_ROW_STORAGE.quantity : row.quantityDecimalString!),
          unit: structural ? STRUCTURAL_ROW_STORAGE.unit : row.unitRaw!,
          unitPrice: null, lineTotal: null, sortOrder: row.sortOrder,
        }});
        ids.set(`row:${row.sourceRowNumber}`, item.id); created.push(item);
      }

      const finalItemCount = await tx.boqItem.count({ where: { boqStructureId: draft.id } });
      if (finalItemCount !== created.length) throw new ConflictException('IMPORT_REPLACE_COUNT_MISMATCH');

      return {
        structureId: draft.id, workingDraftId: draft.id,
        importedRows: created.length, importedItemCount: created.length,
        replacedExistingItemCount, state: draft.status,
        importFingerprint: fingerprint, items: created,
      };
    });
  }
}
