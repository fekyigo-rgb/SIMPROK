import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createOrganizationDto: CreateOrganizationDto) {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: createOrganizationDto.name,
          type: createOrganizationDto.type,
        },
      });

      await tx.workspace.create({
        data: {
          name: 'Default Workspace',
          organizationId: organization.id,
        },
      });

      return organization;
    });
  }

  findAllForAccount(accountId: string) {
    return this.prisma.organization.findMany({
      where: {
        workspaces: {
          some: {
            memberships: {
              some: {
                accountId,
                status: 'ACTIVE',
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async findOneForWorkspace(id: string, workspaceId: string) {
    if (!workspaceId) {
      throw new NotFoundException('Organization not found');
    }

    const organization = await this.prisma.organization.findFirst({
      where: {
        id,
        workspaces: {
          some: { id: workspaceId },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async update(id: string, updateOrganizationDto: UpdateOrganizationDto) {
    await this.findOne(id);

    return this.prisma.organization.update({
      where: { id },
      data: updateOrganizationDto,
    });
  }

  async updateForWorkspace(
    id: string,
    workspaceId: string,
    updateOrganizationDto: UpdateOrganizationDto,
  ) {
    await this.findOneForWorkspace(id, workspaceId);

    return this.prisma.organization.update({
      where: { id },
      data: updateOrganizationDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.organization.delete({
      where: { id },
    });
  }
}
