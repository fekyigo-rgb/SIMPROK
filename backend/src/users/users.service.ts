import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CreateUserData = {
  workspaceMembershipId: string;
  workspaceId: string;
  fullName: string;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  findByMembership(workspaceMembershipId: string) {
    return this.prisma.user.findUnique({
      where: { workspaceMembershipId },
    });
  }

  create(data: CreateUserData) {
    return this.prisma.user.create({
      data,
    });
  }
}
