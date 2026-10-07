import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AhspClassificationAssignmentProvenance,
  OwnershipType,
  Prisma,
} from '@prisma/client';
import { buildEligibleAhspVersionWhere } from '../../project-ahsp/ahsp-eligibility.policy';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';

export type ProposalSnapshotFreeze = {
  code: string | null;
  keterangan: string | null;
  regulationReference: string | null;
  issuerInstitution: string | null;
  ownershipType: OwnershipType;
};

export type ProposalAssignmentFreeze = {
  id: string;
  leafNodeId: string;
  provenance: AhspClassificationAssignmentProvenance;
};

export type CreateSnapshotOptions = {
  /** When set, every write of this snapshot joins the caller's transaction. */
  client?: Prisma.TransactionClient;
  /** Present only for a proposal. BOQ snapshots leave these null. */
  frozen?: ProposalSnapshotFreeze;
  /** Present only for a proposal, including an empty active set. */
  activeAssignments?: readonly ProposalAssignmentFreeze[];
};

type PathNode = {
  name: string;
  level: string;
  workspaceId: string | null;
  parent?: PathNode | null;
};

@Injectable()
export class AhspSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  async createSnapshot(
    ahspVersionId: string,
    workspaceId: string | null,
    userId: string,
    options?: CreateSnapshotOptions,
  ) {
    const db = options?.client ?? this.prisma;
    if (!workspaceId) {
      throw new NotFoundException('AHSP Version not found');
    }

    const version = await db.aHSPVersion.findFirst({
      where: {
        id: ahspVersionId,
        ...buildEligibleAhspVersionWhere(workspaceId, new Date()),
      },
      include: { ahsp: true, resources: true },
    });

    if (!version) throw new NotFoundException('AHSP Version not found');
    if (!version.outputUnit || !version.outputUnitDefinitionId)
      throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');

    const frozen = options?.frozen;
    const snapshot = await db.aHSPSnapshot.create({
      data: {
        workspaceId,
        sourceAhspId: version.ahsp.id,
        sourceVersionId: version.id,
        workType: version.ahsp.workType,
        methodType: version.ahsp.methodType,
        locationType: version.ahsp.locationType,
        methodName: version.ahsp.methodName,
        versionNumber: version.versionNumber,
        outputUnit: version.outputUnit,
        outputUnitDefinitionId: version.outputUnitDefinitionId,
        ...(frozen
          ? {
              code: frozen.code,
              keterangan: frozen.keterangan,
              regulationReference: frozen.regulationReference,
              issuerInstitution: frozen.issuerInstitution,
              ownershipType: frozen.ownershipType,
            }
          : {}),
        resources: {
          create: version.resources.map(r => ({
            resourceId: r.resourceId,
            resourceType: r.resourceType,
            coefficient: r.coefficient,
            baseUnit: r.baseUnit,
            conversionFactor: r.conversionFactor,
          })),
        },
      },
      include: { resources: true },
    });

    if (options?.activeAssignments && options.activeAssignments.length > 0) {
      await db.ahspSnapshotClassificationAssignment.createMany({
        data: options.activeAssignments.map((row) => ({
          snapshotId: snapshot.id,
          assignmentId: row.id,
          leafNodeId: row.leafNodeId,
          provenance: row.provenance,
        })),
      });
    }

    const auditParams = {
      ahspId: version.ahspId,
      ahspVersionId: version.id,
      action: 'AHSPSnapshotCreated',
      who: userId,
      after: snapshot,
    };
    if (options?.client) {
      await this.audit.logAction(auditParams, options.client);
    } else {
      await this.audit.logAction(auditParams);
    }
    return snapshot;
  }

  /**
   * The bound proposal subject, or a refusal. Never substitutes the live AHSP.
   * Node names are read from the canonical nodes; those nodes have no rename,
   * reparent, or scope writer.
   */
  async readProposalSubject(
    snapshotId: string | null | undefined,
    ahspId: string,
    client?: Prisma.TransactionClient,
  ) {
    if (!snapshotId) {
      throw new BadRequestException('AHSP_PROPOSAL_SUBJECT_REQUIRED');
    }
    const db = client ?? this.prisma;
    const snapshot = await db.aHSPSnapshot.findFirst({
      where: { id: snapshotId, sourceAhspId: ahspId },
      include: {
        resources: true,
        classificationAssignments: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            leafNode: {
              select: {
                id: true,
                name: true,
                level: true,
                workspaceId: true,
                parent: {
                  select: {
                    name: true,
                    level: true,
                    workspaceId: true,
                    parent: {
                      select: {
                        name: true,
                        level: true,
                        workspaceId: true,
                        parent: {
                          select: {
                            name: true,
                            level: true,
                            workspaceId: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!snapshot || snapshot.sourceAhspId !== ahspId) {
      throw new BadRequestException('AHSP_PROPOSAL_SUBJECT_REQUIRED');
    }
    return {
      snapshotId: snapshot.id,
      sourceAhspId: snapshot.sourceAhspId,
      sourceVersionId: snapshot.sourceVersionId,
      versionNumber: snapshot.versionNumber,
      workType: snapshot.workType,
      methodName: snapshot.methodName,
      code: snapshot.code,
      keterangan: snapshot.keterangan,
      regulationReference: snapshot.regulationReference,
      issuerInstitution: snapshot.issuerInstitution,
      ownershipType: snapshot.ownershipType,
      outputUnit: snapshot.outputUnit,
      outputUnitDefinitionId: snapshot.outputUnitDefinitionId,
      resources: snapshot.resources.map((row) => ({
        resourceId: row.resourceId,
        resourceType: row.resourceType,
        coefficient: row.coefficient,
        baseUnit: row.baseUnit,
      })),
      classificationAssignments: snapshot.classificationAssignments.map((row) => ({
        assignmentId: row.assignmentId,
        leafNodeId: row.leafNodeId,
        provenance: row.provenance,
        path: pathOf(row.leafNode),
      })),
    };
  }
}

function pathOf(leaf: PathNode | null): {
  jenisPengadaan: string;
  kategori: string;
  subkategori: string;
  jenisPekerjaan: string;
  nodeScopes: string[];
} {
  const byLevel: Record<string, string> = {};
  const scopes: string[] = [];
  let cursor: PathNode | null | undefined = leaf;
  while (cursor) {
    byLevel[cursor.level] = cursor.name;
    scopes.push(cursor.workspaceId ?? 'GLOBAL');
    cursor = cursor.parent ?? null;
  }
  return {
    jenisPengadaan: byLevel.JENIS_PENGADAAN ?? '',
    kategori: byLevel.KATEGORI ?? '',
    subkategori: byLevel.SUBKATEGORI ?? '',
    jenisPekerjaan: byLevel.JENIS_PEKERJAAN ?? '',
    nodeScopes: scopes,
  };
}
