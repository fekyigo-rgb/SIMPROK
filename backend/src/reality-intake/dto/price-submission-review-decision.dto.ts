import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * RM-02D2A-1 Work Package B. `decidedByUserId` is deliberately NOT a field
 * here — the acting User is always server-resolved from the authenticated
 * Account + workspace context (see PriceSubmissionReviewService.
 * resolveActingUserId), never accepted from client input.
 */
export class AcceptPriceSubmissionReviewDto {
  @IsOptional() @IsBoolean() explicitGeneralRegion?: boolean;
  @IsOptional() @IsString() note?: string;
}

export class RejectPriceSubmissionReviewDto {
  // Required — a rejection without a human-readable reason is never valid.
  @IsString() @MinLength(1) note!: string;
}

export class RequestCorrectionPriceSubmissionReviewDto {
  // Required — same rule as reject: a correction request must say why.
  @IsString() @MinLength(1) note!: string;
}

export class ReassignPriceSubmissionReviewDto {
  @IsOptional() @IsUUID() assignedToUserId?: string;
  @IsOptional() @IsString() note?: string;
}
