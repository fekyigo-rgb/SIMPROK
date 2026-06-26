import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly saltRounds = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async register(registerDto: RegisterDto) {
    const existingAccount = await this.prisma.account.findUnique({
      where: { email: registerDto.email },
    });

    if (existingAccount) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await this.hashPassword(registerDto.password);

    const account = await this.prisma.account.create({
      data: {
        email: registerDto.email,
        passwordHash,
        displayName: registerDto.displayName ?? registerDto.email,
      },
    });

    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
    };
  }

  async login(loginDto: LoginDto) {
    const account = await this.prisma.account.findUnique({
      where: { email: loginDto.email },
    });

    if (!account) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValidPassword = await this.comparePassword(
      loginDto.password,
      account.passwordHash,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: account.id,
      email: account.email,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      access_token: accessToken,
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
      },
    };
  }
}
