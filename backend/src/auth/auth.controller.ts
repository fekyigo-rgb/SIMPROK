import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Get,
  Headers,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { WorkspacePermissionResolverService } from './workspace-permission-resolver.service';

// Default values evaluated at class-definition time.
// Other e2e suites run with NODE_ENV=test so these resolve to 10000 (no false throttle).
// The auth-rate-limit.e2e-spec sets LOGIN_RATE_LIMIT_MAX_ATTEMPTS=3 and
// NODE_ENV=production before importing AppModule, so those specs resolve to 3.
const LOGIN_LIMIT = Number(
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS ??
    (process.env.NODE_ENV === 'test' ? 10000 : 5),
);
const LOGIN_TTL = Number(process.env.LOGIN_RATE_LIMIT_TTL_SECONDS ?? 60) * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionResolver: WorkspacePermissionResolverService,
  ) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    // Memastikan pendaftaran membuat Account, bukan User
    return this.authService.register(registerDto);
  }

  @Post('login')
  @Throttle({ login: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL } })
  async login(@Body() loginDto: LoginDto) {
    // Memastikan login memvalidasi terhadap Account
    return this.authService.login(loginDto);
  }

  @Get('profile')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async profile(@CurrentUser() account: any) {
    // Sesuai REG-001:
    // Mengembalikan data 'Account' (Platform Identity)
    // Jika perlu data 'User', Anda harus mengambilnya via
    // WorkspaceMembership service dengan accountId
    if (!account) {
      throw new UnauthorizedException('Account not found in session');
    }

    return {
      id: account.id,
      email: account.email,
      memberships: account.memberships,
    };
  }

  /**
   * Canonical effective-permission read for the caller's own membership in
   * one workspace. Deliberately holds no @Permissions requirement of its
   * own — an account must always be able to learn its own capability
   * without first needing a capability to ask. Backend guards on every
   * other route remain the real security decision; this endpoint only
   * lets the frontend render fail-closed instead of guessing from role
   * labels or localStorage.
   */
  @Get('capabilities')
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  async capabilities(
    @CurrentUser() account: any,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    if (!account) {
      throw new UnauthorizedException('Account not found in session');
    }

    if (!workspaceId) {
      throw new BadRequestException(
        'Missing active Workspace Context (x-workspace-id header is required)',
      );
    }

    const effective = await this.permissionResolver.resolve(
      account.id,
      workspaceId,
    );

    if (!effective) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    return {
      workspaceId,
      permissions: effective.permissions,
    };
  }
}
