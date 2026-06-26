import {
  Body,
  Controller,
  Post,
  Get,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    // Memastikan pendaftaran membuat Account, bukan User
    return this.authService.register(registerDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    // Memastikan login memvalidasi terhadap Account
    return this.authService.login(loginDto);
  }

  @Get('profile')
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
      memberships: account.memberships 
    };
  }
}