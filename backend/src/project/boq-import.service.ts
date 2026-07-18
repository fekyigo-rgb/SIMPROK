import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BOQ_PARSER_CONTRACT_VERSION, BoqImportKnowledgeObject, BoqXlsxIntakeAdapter } from './boq-xlsx-intake.adapter';

export const MAX_UPLOAD_BYTES = 10_485_760;
export const MAX_PREVIEW_DISPLAY_ROWS = 500;
const TARGET_DRAFT_ID = 'dec139d9-a978-4cbd-8e29-9fa88ec23b93';
type UploadedXlsx = { buffer: Buffer; size: number; originalname: string; mimetype?: string };

@Injectable()
export class BoqImportService {
  private readonly adapter = new BoqXlsxIntakeAdapter();
  constructor(private readonly prisma: PrismaService) {}

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

  async preview(projectId: string, workspaceId: string, file?: UploadedXlsx, selectedSheet?: string) {
    this.validateFile(file);
    const knowledge = await this.parse(file, selectedSheet);
    const prioritized = [...knowledge.rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || Number(b.warnings.length > 0) - Number(a.warnings.length > 0) || a.sortOrder - b.sortOrder);
    const rejectedRows = knowledge.rows.filter((row) => row.errors.length > 0).length;
    const warningRows = knowledge.rows.filter((row) => row.warnings.length > 0).length;
    const displayedRows = prioritized.slice(0, MAX_PREVIEW_DISPLAY_ROWS);
    return {
      importFingerprint: this.fingerprint(projectId, workspaceId, knowledge), sourceSha256: knowledge.sourceSha256,
      fileName: knowledge.fileName, sheetName: knowledge.sheetName, totalSourceRows: knowledge.totalSourceRows,
      acceptedRows: knowledge.rows.length - rejectedRows, warningRows, rejectedRows, displayedRows,
      displayedRowCount: displayedRows.length, previewTruncated: displayedRows.length < knowledge.rows.length,
      sourceQuantityMaxScale: knowledge.sourceQuantityEvidence.maxScale,
      sourceQuantityRowsExceedingScale2: knowledge.sourceQuantityEvidence.rowsExceedingScale2,
      canApprove: rejectedRows === 0 && knowledge.sourceQuantityEvidence.rowsExceedingScale2 === 0,
    };
  }

  async approve(projectId: string, workspaceId: string, fingerprint: string, file?: UploadedXlsx, selectedSheet?: string) {
    this.validateFile(file);
    const knowledge = await this.parse(file, selectedSheet);
    if (this.fingerprint(projectId, workspaceId, knowledge) !== fingerprint) throw new ConflictException('IMPORT_FINGERPRINT_MISMATCH');
    if (knowledge.rows.some((row) => row.errors.length > 0)) throw new BadRequestException('IMPORT_HAS_INVALID_ROWS');
    if (knowledge.sourceQuantityEvidence.rowsExceedingScale2 > 0) throw new BadRequestException('QUANTITY_SCALE_EXCEEDS_CURRENT_SCHEMA');

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; projectId: string; status: string }>>(Prisma.sql`
        SELECT "id", "projectId", "status" FROM "boq_structures" WHERE "id" = ${TARGET_DRAFT_ID}::uuid FOR UPDATE
      `);
      const draft = locked[0];
      if (!draft || draft.projectId !== projectId) throw new NotFoundException('WORKING_DRAFT_NOT_FOUND');
      const project = await tx.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
      if (!project || draft.status !== 'DRAFT') throw new NotFoundException('WORKING_DRAFT_NOT_FOUND');
      if (await tx.boqItem.count({ where: { boqStructureId: draft.id } })) throw new ConflictException('WORKING_DRAFT_NOT_EMPTY');

      const ids = new Map<string, string>();
      const created: Array<{ id: string }> = [];
      for (const row of knowledge.rows) {
        const parentId = row.parentSourceReference ? ids.get(row.parentSourceReference) ?? null : null;
        const item = await tx.boqItem.create({ data: {
          boqStructureId: draft.id, parentId, wbsCode: row.sourceCode ?? '', name: row.description,
          itemType: row.itemType, quantity: new Prisma.Decimal(row.quantityDecimalString ?? '0'),
          unit: row.unitRaw ?? '', unitPrice: null, lineTotal: null, sortOrder: row.sortOrder,
        }});
        ids.set(`row:${row.sourceRowNumber}`, item.id); created.push(item);
      }
      return { structureId: draft.id, importedRows: created.length, items: created };
    });
  }
}
