import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { IngestionChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * USI-01 §9/§10 — THE CONNECTOR AUTHORIZATION BOUNDARY.
 *
 * Everything here FAILS CLOSED. An unknown connector, a revoked connector, a
 * connector reaching for another workspace, a wrong secret, or a connector
 * claiming the human-upload channel are all refused identically, before a
 * single byte is read.
 *
 * What this boundary deliberately does NOT do:
 *   - It grants no trust. A connector that passes every check here has earned
 *     the right to be READ, not to be BELIEVED (LAW 1).
 *   - It grants no write. There is no path from a connector to a BasicPrice, a
 *     verification or a publication — the connector's data lands as candidates
 *     in the existing review lifecycle, exactly like a human upload.
 *   - It does not issue credentials. How a secret is minted, delivered and
 *     rotated is an Owner decision USI-01 deliberately left open.
 */

/** Uniform refusal reasons — never leak WHICH check failed to the sender. */
export const CONNECTOR_REFUSALS = {
  UNKNOWN: 'INGESTION_CONNECTOR_UNKNOWN',
  REVOKED: 'INGESTION_CONNECTOR_REVOKED',
  WORKSPACE_MISMATCH: 'INGESTION_CONNECTOR_WORKSPACE_MISMATCH',
  AUTHENTICATION_FAILED: 'INGESTION_CONNECTOR_AUTHENTICATION_FAILED',
  CHANNEL_NOT_PERMITTED: 'INGESTION_CONNECTOR_CHANNEL_NOT_PERMITTED',
} as const;

export interface AuthorizedConnector {
  id: string;
  workspaceId: string;
  organizationId: string;
  channel: IngestionChannel;
  displayName: string;
  actsOnBehalfOfAccountId: string;
}

export interface ConnectorCredentials {
  connectorId: string;
  secret: string;
  /** The workspace the sender CLAIMS to be sending into. Verified, never trusted. */
  workspaceId: string;
}

/** SHA-256 hex of a high-entropy machine secret. See the schema note on why not bcrypt. */
export function hashConnectorSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Generates a connector secret. Issuance POLICY remains an Owner decision. */
export function generateConnectorSecret(): string {
  return randomBytes(32).toString('base64url');
}

function secretsMatch(presented: string, storedHash: string): boolean {
  const presentedHash = Buffer.from(hashConnectorSecret(presented), 'hex');
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  // Length is compared first because timingSafeEqual throws on a mismatch, and
  // a thrown exception is itself an observable timing difference.
  if (stored.length !== presentedHash.length) return false;
  return timingSafeEqual(presentedHash, stored);
}

@Injectable()
export class IngestionConnectorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves credentials to an authorized connector, or refuses.
   *
   * TENANT ISOLATION (test S7): the connector's OWN `workspaceId` is the
   * authority, and the caller's claimed workspace must equal it. A supplier
   * cannot reach a second tenant by asking nicely, because the ask is compared
   * against a row it does not control.
   */
  async authorize(credentials: ConnectorCredentials): Promise<AuthorizedConnector> {
    const connector = await this.prisma.ingestionConnector.findUnique({
      where: { id: credentials.connectorId },
    });

    if (!connector) throw new ForbiddenException(CONNECTOR_REFUSALS.UNKNOWN);
    if (connector.status === 'REVOKED')
      throw new ForbiddenException(CONNECTOR_REFUSALS.REVOKED);
    if (connector.workspaceId !== credentials.workspaceId)
      throw new ForbiddenException(CONNECTOR_REFUSALS.WORKSPACE_MISMATCH);
    if (connector.channel === 'USER_UPLOAD')
      throw new ForbiddenException(CONNECTOR_REFUSALS.CHANNEL_NOT_PERMITTED);
    if (!secretsMatch(credentials.secret, connector.secretHash))
      throw new ForbiddenException(CONNECTOR_REFUSALS.AUTHENTICATION_FAILED);

    return {
      id: connector.id,
      workspaceId: connector.workspaceId,
      organizationId: connector.organizationId,
      channel: connector.channel,
      displayName: connector.displayName,
      actsOnBehalfOfAccountId: connector.actsOnBehalfOfAccountId,
    };
  }
}
