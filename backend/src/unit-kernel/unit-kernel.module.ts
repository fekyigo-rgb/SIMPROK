import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BoqUnitCompatibilityService } from './boq-unit-compatibility.service';
import { UnitKernelService } from './unit-kernel.service';

@Module({ imports: [PrismaModule], providers: [UnitKernelService, BoqUnitCompatibilityService], exports: [UnitKernelService, BoqUnitCompatibilityService] })
export class UnitKernelModule {}
