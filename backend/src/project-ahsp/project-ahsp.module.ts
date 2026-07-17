import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BasicPriceModule } from '../basic-price/basic-price.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectAhspController } from './project-ahsp.controller';
import { ProjectAhspService } from './project-ahsp.service';
import { UnitKernelModule } from '../unit-kernel/unit-kernel.module';

@Module({
  imports: [PrismaModule, AuthModule, BasicPriceModule, UnitKernelModule],
  controllers: [ProjectAhspController],
  providers: [ProjectAhspService],
})
export class ProjectAhspModule {}
