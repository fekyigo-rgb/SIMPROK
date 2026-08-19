import { Injectable } from '@nestjs/common';
import {
  ConnectorCredentials,
  IngestionConnectorService,
} from '../universal-intake/connectors/ingestion-connector.service';
import { sealSourceEnvelope } from '../universal-intake/source-envelope';
import { BasicPriceImportService } from './basic-price-import.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';

/**
 * USI-01 §9/§10 — THE SUPPLIER BRIDGE, PHASE 0.
 *
 * A supplier's computer or application hands SIMPROK an artifact it has
 * explicitly chosen to send. SIMPROK never reaches back: no disk browsing, no
 * remote desktop, no shared-folder crawling, no credentials in either
 * direction. This service is the whole of the receiving side.
 *
 * WHAT MAKES IT A CONNECTOR AND NOT A SECOND PIPELINE: it authorizes, seals an
 * envelope, and calls `BasicPriceImportService.intake` — the SAME method the
 * browser upload calls. It cannot create a BasicPrice, cannot verify one,
 * cannot publish one, and cannot skip review, because it has no method that
 * does any of those things. Supplier data lands as NEEDS_REVIEW candidates
 * exactly like a human's upload (tests S1-S3).
 *
 * WHAT IS DELIBERATELY ABSENT: an HTTP endpoint. Transport, credential
 * issuance, rate limiting and network topology are real Owner decisions
 * (§23), and inventing them would be worse than leaving a clean seam.
 */
export interface SupplierBridgeSubmission {
  credentials: ConnectorCredentials;

  /**
   * USI-01R §10 — TRANSMISSION, NOT MEANING. One request/retry/transfer. A new
   * delivery id never makes a new price.
   */
  deliveryId?: string | null;

  /**
   * USI-01R §10 — WHAT THE SUPPLIER IS TALKING ABOUT, and which version of it.
   * These three are what let the same product legitimately receive many price
   * observations over time without any of them being read as a duplicate
   * identity (LAW 2.4/2.5).
   */
  externalSourceId?: string | null;
  externalRecordId?: string | null;
  externalVersion?: string | null;

  /** When the SUPPLIER says the price was observed. Never SIMPROK's clock. */
  sourceObservedAt?: Date | null;

  fileName: string;
  mediaType?: string | null;
  bytes: Buffer;
  metadata: PreviewBasicPriceImportDto;
}

@Injectable()
export class BasicPriceSupplierBridgeService {
  constructor(
    private readonly connectors: IngestionConnectorService,
    private readonly imports: BasicPriceImportService,
  ) {}

  /**
   * Receives one supplier artifact.
   *
   * ORDER IS THE SECURITY PROPERTY: authorization runs BEFORE a single byte is
   * parsed. An unknown, revoked or cross-tenant connector never reaches a
   * reader at all, so an untrusted payload cannot be used to attack the parsing
   * layer of a workspace its sender was never entitled to touch.
   */
  async submit(submission: SupplierBridgeSubmission) {
    const connector = await this.connectors.authorize(submission.credentials);

    const envelope = sealSourceEnvelope({
      // TRANSPORT, NOT ORIGIN (LAW 3). That this arrived over the Supplier
      // Bridge is not evidence that the price is a supplier's — a supplier may
      // forward a government price list, and `sourceOrigin` stays the separate,
      // human-stated batch fact it already is.
      ingestionChannel: connector.channel,
      connectorId: connector.id,
      deliveryId: submission.deliveryId ?? null,
      externalSourceId: submission.externalSourceId ?? null,
      externalRecordId: submission.externalRecordId ?? null,
      externalVersion: submission.externalVersion ?? null,
      sourceObservedAt: submission.sourceObservedAt ?? null,
      fileName: submission.fileName,
      mediaType: submission.mediaType ?? null,
      bytes: submission.bytes,
      // The connector's OWN workspace, never a workspace the payload asked for.
      workspaceId: connector.workspaceId,
      organizationId: connector.organizationId,
      // Execution belongs to a User: the connector transports, but a named
      // account is answerable for what it sent.
      actorAccountId: connector.actsOnBehalfOfAccountId,
    });

    // The one door. An identical replay produces an identical fingerprint and
    // therefore returns the existing batch instead of a duplicate (S5/OBS-01),
    // while a genuinely newer source version produces a new observation (OBS-02).
    return this.imports.intake(envelope, submission.metadata);
  }
}
