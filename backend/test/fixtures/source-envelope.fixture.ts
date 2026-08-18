import {
  IngestionChannel,
  SourceEnvelope,
  sealSourceEnvelope,
} from '../../src/universal-intake/source-envelope';

/**
 * Seals a `SourceEnvelope` for tests through the SAME constructor production
 * uses. Nothing in the suite may hand-build an envelope literal — if a test
 * could bypass `sealSourceEnvelope`, "every source arrives through one door"
 * would be an assertion the tests themselves disprove.
 */
export function testEnvelope(
  bytes: Buffer,
  fileName: string,
  overrides: Partial<{
    ingestionChannel: IngestionChannel;
    connectorId: string | null;
    deliveryId: string | null;
    externalSourceId: string | null;
    externalRecordId: string | null;
    externalVersion: string | null;
    sourceObservedAt: Date | null;
    mediaType: string | null;
    workspaceId: string;
    organizationId: string;
    actorAccountId: string;
  }> = {},
): SourceEnvelope {
  return sealSourceEnvelope({
    ingestionChannel: overrides.ingestionChannel ?? 'USER_UPLOAD',
    connectorId: overrides.connectorId ?? null,
    deliveryId: overrides.deliveryId ?? null,
    externalSourceId: overrides.externalSourceId ?? null,
    externalRecordId: overrides.externalRecordId ?? null,
    externalVersion: overrides.externalVersion ?? null,
    sourceObservedAt: overrides.sourceObservedAt ?? null,
    fileName,
    mediaType: overrides.mediaType ?? null,
    bytes,
    workspaceId: overrides.workspaceId ?? '11111111-1111-4111-8111-111111111111',
    organizationId: overrides.organizationId ?? '22222222-2222-4222-8222-222222222222',
    actorAccountId: overrides.actorAccountId ?? '33333333-3333-4333-8333-333333333333',
  });
}
