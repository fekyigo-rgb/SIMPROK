import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AuthorityController } from './authority.controller';
import { AuthorityService } from './authority.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthorityController],
  providers: [AuthorityService],
})
export class AuthorityModule {}
