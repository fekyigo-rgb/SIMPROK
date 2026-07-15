import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BasicPriceModule } from '../basic-price/basic-price.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectAhspController } from './project-ahsp.controller';
import { ProjectAhspService } from './project-ahsp.service';

@Module({
  imports: [PrismaModule, AuthModule, BasicPriceModule],
  controllers: [ProjectAhspController],
  providers: [ProjectAhspService],
})
export class ProjectAhspModule {}
