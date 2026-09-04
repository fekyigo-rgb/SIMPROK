// PLATFORM GOVERNANCE — module wiring, and nothing else.
//
// DELIBERATELY NO CONTROLLER. A platform authority grant is an Owner-authorized
// ceremony performed out of band, in the shape SIMPROK already uses for its one
// existing governed act (`rm01b-production-permission-activation.ts`). Exposing
// an HTTP route would create an in-product grant surface that no Owner law
// authorizes.
//
// The service is exported so a future ceremony entry point can call it. Nothing
// imports this module yet, and that is the correct current state: the capability
// exists and is provable, and no runtime path reaches it.

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformGovernanceService } from './platform-governance.service';

@Module({
  imports: [PrismaModule],
  providers: [PlatformGovernanceService],
  exports: [PlatformGovernanceService],
})
export class PlatformGovernanceModule {}
