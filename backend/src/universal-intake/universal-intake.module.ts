import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestionConnectorService } from './connectors/ingestion-connector.service';

/**
 * USI-01 — the Universal Smart Intake boundary.
 *
 * Note what is NOT here: no controller. Nothing in this module is reachable
 * over HTTP, because the only network surface USI-01 opens is the one the Basic
 * Price import boundary already had. Exposing a supplier-facing endpoint
 * requires real network, credential-issuance and rate-limit decisions that
 * belong to the Owner, not to an executor (§23).
 *
 * The readers, the structure detector and the source envelope are deliberately
 * plain classes and pure functions rather than providers: they hold no state,
 * touch no database, and are therefore testable and reusable without a Nest
 * container anywhere near them.
 */
@Module({
  imports: [PrismaModule],
  providers: [IngestionConnectorService],
  exports: [IngestionConnectorService],
})
export class UniversalIntakeModule {}
