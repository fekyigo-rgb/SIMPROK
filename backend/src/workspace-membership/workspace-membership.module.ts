import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

import { WorkspaceMembershipController } from './workspace-membership.controller';
import { WorkspaceMembershipService } from './workspace-membership.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspaceMembershipController],
  providers: [WorkspaceMembershipService],
})
export class WorkspaceMembershipModule {}