// AUTHORITY GOVERNANCE — DELIBERATELY NOT WIRED INTO AppModule.
//
// There is no controller here, and this module is imported by nothing. Granting
// an Authority to a Position is a governed ceremony, not a request: exposing it
// as a route would put the act behind an HTTP call that no Owner law authorizes
// and that nothing in the product needs. The same stance platform governance
// already takes, for the same reason.
//
// The module exists so the one writer is injectable by a future Owner-authorized
// ceremony entry point, and so that a test can construct it exactly as Nest
// would — never so that it can be reached by accident.

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthorityGovernanceService } from './authority-governance.service';

@Module({
  imports: [PrismaModule],
  providers: [AuthorityGovernanceService],
  exports: [AuthorityGovernanceService],
})
export class AuthorityGovernanceModule {}
