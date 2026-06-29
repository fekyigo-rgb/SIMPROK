import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service'; // Pastikan path benar
import { getRequiredJwtSecret } from '../jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getRequiredJwtSecret(),
    });
  }

  // 1. Validasi dilakukan terhadap Account, bukan User
  async validate(payload: any) {
    // 2. payload.sub harus berisi account.id
    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: {
            workspace: true,
            membershipRoles: {
              include: {
                role: true
              }
            }
          }
        }
      }
    });

    if (!account) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    if (account.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account not found or inactive');
    }

    return {
      id: account.id,
      email: account.email,
      memberships: account.memberships.map(u => ({
        workspaceId: u.workspaceId,
        workspaceName: u.workspace.name,
        userId: u.id,
        roles: u.membershipRoles.map(r => r.role.name)
      }))
    };
  }
}