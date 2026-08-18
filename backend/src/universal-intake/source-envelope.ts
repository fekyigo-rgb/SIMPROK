import { createHash, randomUUID } from 'crypto';
import { INTAKE_ERRORS, IntakeError } from './intake-errors';

/**
 * USI-01 §3 — THE SOURCE ENVELOPE.
 *
 * One durable application boundary describing WHAT ARRIVED, independently of
 * what it MEANS. Everything downstream of this type is reached the same way
 * whether the bytes came from a browser upload today or a supplier agent
 * tomorrow: a new connector changes how data ARRIVES, never how SIMPROK
 * decides what is TRUE (§0).
 *
 * It is deliberately an APPLICATION contract, not a table. The repository
 * already persists arrival facts in two places that must not be duplicated —
 * `SourceDocument` (Reality Intake) and `BasicPriceImportBatch`
 * (source file name / sha256 / byte length). The envelope is what both are
 * fed FROM.
 */

/**
 * LAW 3 — CHANNEL != SOURCE != ORIGIN != TRUST.
 *
 * This is TRANSPORT ONLY: how the bytes reached SIMPROK. It is NOT
 * `PriceSourceOrigin` (who the price came from in the world), NOT
 * `PriceSourceType` (what kind of statement it is), and it establishes NO
 * verification, publication or trust whatsoever.
 *
 * A government price list a human uploads from their laptop is
 * `USER_UPLOAD` + GOVERNMENT origin. A supplier XLSX arriving over the
 * Supplier Bridge is `SUPPLIER_BRIDGE` + SUPPLIER origin. The two axes are
 * independent, and intake never derives one from the other.
 */
export type IngestionChannel =
  | 'USER_UPLOAD'
  | 'SUPPLIER_BRIDGE'
  | 'EXTERNAL_API'
  | 'MOBILE'
  | 'GOVERNMENT_FEED';

export const INGESTION_CHANNELS: readonly IngestionChannel[] = [
  'USER_UPLOAD',
  'SUPPLIER_BRIDGE',
  'EXTERNAL_API',
  'MOBILE',
  'GOVERNMENT_FEED',
];

/**
 * The intake-wide payload ceiling (§14 bounded upload size). Deliberately the
 * SAME number the Basic Price import boundary already enforced
 * (`MAX_UPLOAD_BYTES`), so moving that boundary onto the envelope did not
 * quietly widen what SIMPROK accepts.
 */
export const MAX_ENVELOPE_BYTES = 10_485_760;

export interface SourceEnvelopeInput {
  /** Transport. Never a trust or origin claim. */
  ingestionChannel: IngestionChannel;
  /**
   * Identity of the connector that carried the bytes, when one exists. Null
   * for a human browser upload, where the actor account IS the identity.
   */
  connectorId?: string | null;
  /**
   * USI-01R §10 — DELIVERY / TRANSMISSION IDENTITY.
   *
   * One HTTP request, webhook delivery, retry or transfer. A DIFFERENT delivery
   * id DOES NOT mean a different price: re-sending yesterday's observation
   * because the first attempt timed out is a retry, and treating it as news
   * would invent a price change that never happened (LAW 2.6). It is therefore
   * recorded as evidence and deliberately excluded from intake identity.
   */
  deliveryId?: string | null;

  /**
   * USI-01R §10 — SOURCE OBSERVATION IDENTITY.
   *
   * Three independent facts, none of which is the price itself (LAW 2.4):
   *   externalSourceId  WHICH external system/catalog spoke.
   *   externalRecordId  WHICH logical item/offer/price stream it spoke about.
   *   externalVersion   WHICH version of that stream this is.
   *
   * Together they let a supplier send a NEW PRICE for a KNOWN PRODUCT without
   * that being mistaken for a duplicate identity (LAW 2.5), and let the same
   * version arrive twice without doubling (LAW 2.6).
   */
  externalSourceId?: string | null;
  externalRecordId?: string | null;
  externalVersion?: string | null;

  /**
   * WHEN THE SOURCE SAYS IT OBSERVED THE PRICE — never when SIMPROK received
   * it. A price observed on the 18th and delivered on the 25th is an 18th fact,
   * and `receivedAt` must never be back-filled into this.
   */
  sourceObservedAt?: Date | null;

  /** Audit/correlation id. Generated when the caller has none. */
  correlationId?: string;
  fileName: string;
  /** Declared media type. EVIDENCE, never authority — see readers (§14). */
  mediaType?: string | null;
  bytes: Buffer;
  receivedAt?: Date;
  workspaceId: string;
  organizationId: string;
  /**
   * The account SIMPROK holds responsible for this arrival. For a browser
   * upload it is the uploading human; for a connector it is the account the
   * connector acts on behalf of. Never the connector id itself.
   */
  actorAccountId: string;
}

export interface SourceEnvelope {
  readonly ingestionChannel: IngestionChannel;
  readonly connectorId: string | null;
  /** Transmission evidence only — never an intake identity input. */
  readonly deliveryId: string | null;
  readonly externalSourceId: string | null;
  readonly externalRecordId: string | null;
  readonly externalVersion: string | null;
  /** The source's own observation time. Distinct from `receivedAt`. */
  readonly sourceObservedAt: Date | null;
  readonly correlationId: string;
  readonly fileName: string;
  readonly mediaType: string | null;
  readonly byteSize: number;
  readonly bytes: Buffer;
  /** LAW 2 — content digest of exactly the bytes that arrived. */
  readonly contentDigestSha256: string;
  readonly receivedAt: Date;
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly actorAccountId: string;
}

/**
 * Seals an arrival into an envelope: bounds it, digests it, and stamps the
 * transport facts. This is the ONLY constructor — nothing downstream may
 * assemble a `SourceEnvelope` literal, which is what makes "prove file upload
 * uses the same seam as the Supplier Bridge" (§10) checkable rather than
 * aspirational.
 */
export function sealSourceEnvelope(input: SourceEnvelopeInput): SourceEnvelope {
  if (!input.bytes || !Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new IntakeError(INTAKE_ERRORS.SOURCE_BYTES_REQUIRED);
  }
  if (input.bytes.length > MAX_ENVELOPE_BYTES) {
    throw new IntakeError(INTAKE_ERRORS.SOURCE_EXCEEDS_MAX_BYTES, {
      byteSize: input.bytes.length,
      maxBytes: MAX_ENVELOPE_BYTES,
    });
  }

  return Object.freeze({
    ingestionChannel: input.ingestionChannel,
    connectorId: input.connectorId ?? null,
    deliveryId: input.deliveryId ?? null,
    externalSourceId: input.externalSourceId ?? null,
    externalRecordId: input.externalRecordId ?? null,
    externalVersion: input.externalVersion ?? null,
    sourceObservedAt: input.sourceObservedAt ?? null,
    correlationId: input.correlationId ?? randomUUID(),
    fileName: input.fileName,
    mediaType: input.mediaType ?? null,
    byteSize: input.bytes.length,
    bytes: input.bytes,
    contentDigestSha256: createHash('sha256')
      .update(input.bytes)
      .digest('hex')
      .toUpperCase(),
    receivedAt: input.receivedAt ?? new Date(),
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    actorAccountId: input.actorAccountId,
  });
}

/**
 * The transport facts that must survive into persistence so SIMPROK never
 * has to infer how something arrived. Channel is always known; the other two
 * are null for a human upload and that null is itself honest.
 */
export interface IngestionProvenance {
  ingestionChannel: IngestionChannel;
  ingestionConnectorId: string | null;
  ingestionDeliveryId: string | null;
  ingestionExternalSourceId: string | null;
  ingestionExternalRecordId: string | null;
  ingestionExternalVersion: string | null;
  sourceObservedAt: Date | null;
}

export function ingestionProvenanceOf(envelope: SourceEnvelope): IngestionProvenance {
  return {
    ingestionChannel: envelope.ingestionChannel,
    ingestionConnectorId: envelope.connectorId,
    ingestionDeliveryId: envelope.deliveryId,
    ingestionExternalSourceId: envelope.externalSourceId,
    ingestionExternalRecordId: envelope.externalRecordId,
    ingestionExternalVersion: envelope.externalVersion,
    sourceObservedAt: envelope.sourceObservedAt,
  };
}

/**
 * USI-01R3 §7 — THE COLLISION-SAFE SOURCE OBSERVATION KEY.
 *
 * WHY A HASH AND NOT A JOINED STRING.
 *
 * USI-01R2 joined the identity fields with "|". External identifiers are
 * attacker- and vendor-controlled strings, and nothing anywhere forbids a "|"
 * inside one. Under a raw join these two DIFFERENT observations collapse into
 * the same key:
 *
 *   externalSourceId "ABC|DEF"  externalRecordId "123"
 *   externalSourceId "ABC"      externalRecordId "DEF|123"
 *
 * Both render "ABC|DEF|123|…". Two unrelated supplier streams would then share
 * one database-unique observation identity, and the second would be reported
 * as a CONFLICT with the first — or, worse, silently accepted as its retry.
 *
 * So the fields are serialized UNAMBIGUOUSLY first and hashed second:
 *
 *   - a canonical JSON ARRAY fixes field order by position, so no JavaScript
 *     object-property-order accident can reorder it;
 *   - JSON distinguishes null from "" natively, so "absent" and "empty" are
 *     different identities rather than the same one;
 *   - a versioned domain tag heads the array, so a future change of rule can
 *     never silently reinterpret a key already stored;
 *   - JSON string escaping makes every delimiter inert: a "|", a quote or a
 *     newline inside a value cannot reach across a field boundary;
 *   - the digest is fixed-length, so a hostile 4 KB identifier cannot grow an
 *     index entry, and the stored value is safe as a database key with no path
 *     or SQL meaning of its own.
 *
 * The DELIVERY id is deliberately absent from the material: a retry must land
 * on the same key (LAW D).
 */
export const SOURCE_OBSERVATION_KEY_DOMAIN = 'SIMPROK_SOURCE_OBSERVATION_V1';

/** Which axis the source used to separate one observation from the next. */
export type SourceObservationAxis = 'EXTERNAL_VERSION' | 'SOURCE_OBSERVED_AT' | 'NONE';

export interface SourceObservationIdentity {
  key: string;
  axis: SourceObservationAxis;
  /**
   * False when the source named a record but gave neither a version nor an
   * observation time — a future changed price for it could not be told apart
   * from this one by identity alone.
   */
  complete: boolean;
}

export function sourceObservationIdentityOf(
  envelope: SourceEnvelope,
): SourceObservationIdentity | null {
  // No record identity at all — a human's file upload. Nothing is invented for
  // it, and it keeps its existing bytes-and-context replay law.
  if (!envelope.externalRecordId) return null;

  const axis: SourceObservationAxis = envelope.externalVersion
    ? 'EXTERNAL_VERSION'
    : envelope.sourceObservedAt
      ? 'SOURCE_OBSERVED_AT'
      : 'NONE';

  // SIMPROK's own receivedAt is NEVER an axis: letting the moment of
  // transmission stand in for the moment of observation would make every retry
  // look like a new price.
  const axisValue =
    axis === 'EXTERNAL_VERSION'
      ? envelope.externalVersion
      : axis === 'SOURCE_OBSERVED_AT'
        ? envelope.sourceObservedAt!.toISOString()
        : null;

  const material = JSON.stringify([
    SOURCE_OBSERVATION_KEY_DOMAIN,
    envelope.connectorId,
    envelope.externalSourceId,
    envelope.externalRecordId,
    axis,
    axisValue,
  ]);

  return {
    key: createHash('sha256').update(material, 'utf8').digest('hex').toUpperCase(),
    axis,
    complete: axis !== 'NONE',
  };
}

/** Convenience for callers that only need the key. */
export function sourceObservationKeyOf(envelope: SourceEnvelope): string | null {
  return sourceObservationIdentityOf(envelope)?.key ?? null;
}
