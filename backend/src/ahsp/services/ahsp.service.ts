import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AhspAuditService } from './ahsp-audit.service';
import { MethodType, LocationType, OwnershipType, ReviewStatus } from '@prisma/client';
import { AhspOwnershipPolicy, OwnershipViolationError, AhspEntity } from '../domain/ahsp-ownership.policy';

export interface CreateAhspDto {
  workspaceId?: string;
  workType: string;
  methodType: MethodType;
  locationType: LocationType;
  methodName: string;
  userId: string;
}

export interface UpdateAhspDto {
  workType?: string;
  methodType?: MethodType;
  locationType?: LocationType;
  methodName?: string;
}

@Injectable()
export class AhspService {
  private readonly policy = new AhspOwnershipPolicy();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AhspAuditService,
  ) {}

  private runPolicy(action: (policy: AhspOwnershipPolicy) => void) {
    try {
      action(this.policy);
    } catch (error) {
      if (error instanceof OwnershipViolationError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }

  private async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: {
          include: {
            account: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
    return user;
  }

  async create(data: CreateAhspDto) {
    if (!data.workspaceId) {
      const duplicate = await this.prisma.aHSP.findFirst({
        where: {
          workspaceId: null,
          workType: data.workType,
          methodType: data.methodType,
          locationType: data.locationType,
          methodName: data.methodName,
          deletedAt: null,
        }
      });
      if (duplicate) throw new ConflictException('AHSP Official already exists.');
    }

    const ahsp = await this.prisma.aHSP.create({
      data: {
        workspaceId: data.workspaceId,
        workType: data.workType,
        methodType: data.methodType,
        locationType: data.locationType,
        methodName: data.methodName,
        createdByUserId: data.userId,
        ownershipType: 'USER_ASSET',
        reviewStatus: 'PENDING',
      },
    });

    await this.audit.logAction({ ahspId: ahsp.id, action: 'AHSPCreated', who: data.userId, after: ahsp });
    return ahsp;
  }

  async getById(id: string, workspaceId?: string) {
    const ahsp = await this.prisma.aHSP.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: { versions: true }
    });
    if (!ahsp || (ahsp.workspaceId !== null && ahsp.workspaceId !== workspaceId)) {
      throw new NotFoundException('AHSP not found');
    }
    return ahsp;
  }

  async update(id: string, updateData: UpdateAhspDto, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canUpdate(ahsp as AhspEntity, reason));

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          ...updateData,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPUpdated',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return updated;
  }

  async delete(id: string, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canRequestDeletion(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const deleted = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedByUserId: userId,
          deletedByName: user.fullName,
          deletedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPDeleted',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return deleted;
  }

  async archive(id: string, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canArchive(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const archived = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          archivedAt: new Date(),
          archivedByUserId: userId,
          archivedByName: user.fullName,
          archivedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPArchived',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return archived;
  }

  async approve(id: string, userId: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canApprove(ahsp as AhspEntity));

    const user = await this.getUserDetails(userId);

    const approved = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          reviewStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedByUserId: userId,
          approvedByName: user.fullName,
          approvedByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPApproved',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
      });

      return updatedAhsp;
    });

    return approved;
  }

  async transfer(id: string, targetOwnershipType: OwnershipType, userId: string, reason: string, workspaceId?: string) {
    const ahsp = await this.getById(id, workspaceId);

    // Run policy validation
    this.runPolicy(p => p.canTransfer(ahsp as AhspEntity, reason));

    const user = await this.getUserDetails(userId);

    const transferred = await this.prisma.$transaction(async (tx) => {
      const updatedAhsp = await tx.aHSP.update({
        where: { id },
        data: {
          ownershipType: targetOwnershipType,
          ownershipTransferredAt: new Date(),
          ownershipTransferredByUserId: userId,
          ownershipTransferredByName: user.fullName,
          ownershipTransferredByEmail: user.membership?.account?.email || null,
        },
      });

      await this.audit.logAction({
        ahspId: id,
        action: 'AHSPOwnershipTransferred',
        who: userId,
        before: ahsp,
        after: updatedAhsp,
        reason,
      });

      return updatedAhsp;
    });

    return transferred;
  }
}
