import {
  ConflictException,
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

  async createPosition(createPositionDto: CreatePositionDto) {
    return this.prisma.position.create({
      data: {
        name: createPositionDto.name,
        code: createPositionDto.code,
        // Gunakan pola .connect untuk relasi
        workspace: { connect: { id: createPositionDto.workspaceId } },
        ...(createPositionDto.parentPositionId && {
          parentPosition: { connect: { id: createPositionDto.parentPositionId } },
        }),
      },
    });
  }

  findAllPositions() {
    return this.prisma.position.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPosition(id: string) {
    const position = await this.prisma.position.findUnique({
      where: { id },
    });
    if (!position) throw new NotFoundException('Position not found');
    return position;
  }

  // =====================================================
  // POSITION ASSIGNMENT
  // =====================================================

  async assignPosition(assignPositionDto: AssignPositionDto) {
    const { userId, positionId } = assignPositionDto;

    // Pastikan relasi benar-benar ada di DB
    const activeHolder = await this.prisma.positionAssignment.findFirst({
      where: { positionId, isActive: true },
    });

    if (activeHolder) {
      throw new ConflictException('Position already has active holder');
    }

    return this.prisma.positionAssignment.create({
      data: {
        isActive: true,
        // Hubungkan via relasi
        user: { connect: { id: userId } },
        position: { connect: { id: positionId } },
      },
    });
  }

  // =====================================================
  // AUTHORITY (Pending Prisma Schema Restoration)
  // =====================================================

  async createAuthority(createAuthorityDto: CreateAuthorityDto) {
    // Berdasarkan CHEK ANTIGRATIVY.pdf, Authority dan PositionAuthority adalah "UNCHANGED MODELS"
    // Namun saat ini hilang dari schema.prisma. Metode ini disiapkan agar build tidak error.
    throw new ConflictException('Authority model is missing from Prisma Schema.');
  }

  findAllAuthorities() {
    throw new ConflictException('Authority model is missing from Prisma Schema.');
  }

  async assignAuthority(assignAuthorityDto: AssignAuthorityDto) {
    throw new ConflictException('PositionAuthority model is missing from Prisma Schema.');
  }

  findAuthoritiesByPosition(id: string) {
    throw new ConflictException('PositionAuthority model is missing from Prisma Schema.');
  }

  // =====================================================
  // APPROVAL MATRIX
  // =====================================================

  async createApprovalMatrix(createApprovalMatrixDto: CreateApprovalMatrixDto) {
    return this.prisma.approvalMatrix.create({
      data: {
        objectType: createApprovalMatrixDto.objectType,
        minValue: createApprovalMatrixDto.minValue ?? null,
        maxValue: createApprovalMatrixDto.maxValue ?? null,
        priority: createApprovalMatrixDto.priority ?? 0,
        // Relasi wajib dihubungkan
        workspace: { connect: { id: createApprovalMatrixDto.workspaceId } },
        authority: { connect: { id: createApprovalMatrixDto.authorityId } },
        requiredPosition: { connect: { id: createApprovalMatrixDto.requiredPositionId } },
      },
    });
  }

  findAllApprovalMatrices() {
    return this.prisma.approvalMatrix.findMany({
      include: { requiredPosition: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findApprovalMatrix(id: string) {
    const matrix = await this.prisma.approvalMatrix.findUnique({
      where: { id },
      include: { requiredPosition: true },
    });
    if (!matrix) throw new NotFoundException('Approval matrix not found');
    return matrix;
  }

  healthCheck() {
    return { module: 'authority', status: 'ok' };
  }
}
