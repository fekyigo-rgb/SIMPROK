import { IsOptional, IsUUID } from 'class-validator';

/**
 * BP-CORR-01 — the publication request body, and the ONLY thing a caller may
 * contribute to a correction: the id of the published price this one replaces.
 *
 * EVERYTHING ELSE IS SERVER-DERIVED. The workspace comes from the request
 * context, the publisher from the authenticated account, and the successor's
 * resource, region, organization and publication state from its own locked row.
 * A caller can therefore name a predecessor but can never name the context that
 * predecessor is judged in — which is what stops a client from asserting that a
 * price in some other tenant, resource or region was the thing it corrected.
 *
 * OPTIONAL, AND THE ABSENT CASE IS THE COMMON ONE. Omitting it means "this
 * publication states a new fact and replaces nothing", which is what an
 * ordinary publish has always meant and what a genuinely later observation
 * still means. Correction is an explicit act, never an inference.
 */
export class PublishBasicPriceDto {
  @IsOptional()
  @IsUUID()
  supersedesBasicPriceId?: string;
}
