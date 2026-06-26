import { Module } from '@nestjs/common';
import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DeviationService } from './deviation.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectController],
  providers: [ProjectService, DeviationService],
})
export class ProjectModule {}