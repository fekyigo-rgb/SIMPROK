import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { AssignPositionDto } from './dto/assign-position.dto';
import { CreateApprovalMatrixDto } from './dto/create-approval-matrix.dto';
import { CreateAuthorityDto } from './dto/create-authority.dto';
import { AssignAuthorityDto } from './dto/assign-authority.dto';

@Injectable()
export class AuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  // =====================================================
  // POSITION
  // =====================================================

  async createPosition(workspaceId: string, createPositionDto: CreatePositionDto) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');

    if (createPositionDto.parentPositionId) {
      const parentPosition = await this.prisma.position.findUnique({ where: { id: createPositionDto.parentPositionId } });
      if (!parentPosition || parentPosition.workspaceId !== workspaceId) {
        throw new NotFoundException('Parent position not found or does not belong to workspace');
      }
    }

    return this.prisma.position.create({
      data: {
        name: createPositionDto.name,
        code: createPositionDto.code,
        workspace: { connect: { id: workspaceId } },
        ...(createPositionDto.parentPositionId && {
          parentPosition: { connect: { id: createPositionDto.parentPositionId } },
        }),
      },
    });
  }

  findAllPositions(workspaceId: string) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    return this.prisma.position.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPosition(id: string, workspaceId: string) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    const position = await this.prisma.position.findUnique({
      where: { id },
    });
    if (!position || position.workspaceId !== workspaceId) {
      throw new NotFoundException('Position not found');
    }
    return position;
  }

  // =====================================================
  // POSITION ASSIGNMENT
  // =====================================================

  async assignPosition(workspaceId: string, assignPositionDto: AssignPositionDto) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    const { userId, positionId } = assignPositionDto;

    // Pastikan posisi berada di workspace yang sama dengan context
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position || position.workspaceId !== workspaceId) {
      throw new NotFoundException('Position not found or does not belong to workspace');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.workspaceId !== workspaceId) {
      throw new NotFoundException('User not found or does not belong to workspace');
    }

    const activeHolder = await this.prisma.positionAssignment.findFirst({
      where: { positionId, isActive: true },
    });

    if (activeHolder) {
      throw new ConflictException('Position already has active holder');
    }

    return this.prisma.positionAssignment.create({
      data: {
        isActive: true,
        user: { connect: { id: userId } },
        position: { connect: { id: positionId } },
      },
    });
  }

  // =====================================================
  // AUTHORITY (Pending Prisma Schema Restoration)
  // =====================================================

  async createAuthority(workspaceId: string, createAuthorityDto: CreateAuthorityDto) {
    throw new ConflictException('Authority model is missing from Prisma Schema.');
  }

  findAllAuthorities(workspaceId: string) {
    throw new ConflictException('Authority model is missing from Prisma Schema.');
  }

  async assignAuthority(workspaceId: string, assignAuthorityDto: AssignAuthorityDto) {
    throw new ConflictException('PositionAuthority model is missing from Prisma Schema.');
  }

  findAuthoritiesByPosition(id: string, workspaceId: string) {
    throw new ConflictException('PositionAuthority model is missing from Prisma Schema.');
  }

  // =====================================================
  // APPROVAL MATRIX
  // =====================================================

  async createApprovalMatrix(workspaceId: string, createApprovalMatrixDto: CreateApprovalMatrixDto) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    
    // Pastikan posisi yang dibutuhkan ada dan berada di workspace yang sama
    const requiredPosition = await this.prisma.position.findUnique({ where: { id: createApprovalMatrixDto.requiredPositionId } });
    if (!requiredPosition || requiredPosition.workspaceId !== workspaceId) {
      throw new NotFoundException('Required position not found or does not belong to workspace');
    }

    return this.prisma.approvalMatrix.create({
      data: {
        objectType: createApprovalMatrixDto.objectType,
        minValue: createApprovalMatrixDto.minValue ?? null,
        maxValue: createApprovalMatrixDto.maxValue ?? null,
        priority: createApprovalMatrixDto.priority ?? 0,
        workspace: { connect: { id: workspaceId } },
        authority: { connect: { id: createApprovalMatrixDto.authorityId } },
        requiredPosition: { connect: { id: createApprovalMatrixDto.requiredPositionId } },
      },
    });
  }

  findAllApprovalMatrices(workspaceId: string) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    return this.prisma.approvalMatrix.findMany({
      where: { workspaceId },
      include: { requiredPosition: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findApprovalMatrix(id: string, workspaceId: string) {
    if (!workspaceId) throw new ForbiddenException('Workspace context is required');
    const matrix = await this.prisma.approvalMatrix.findUnique({
      where: { id },
      include: { requiredPosition: true },
    });
    if (!matrix || matrix.workspaceId !== workspaceId) {
      throw new NotFoundException('Approval matrix not found');
    }
    return matrix;
  }

  healthCheck() {
    return { module: 'authority', status: 'ok' };
  }
}
