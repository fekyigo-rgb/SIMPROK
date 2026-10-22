import { IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** A workspace member's own reviewed facts; never a catalog approval. */
export class ConfirmBasicPriceRowSpecificationsDto {
  @IsInt()
  version!: number;

  @IsIn(['CONFIRM_SOURCE', 'SUPPLEMENT', 'CORRECT'])
  decisionKind!: 'CONFIRM_SOURCE' | 'SUPPLEMENT' | 'CORRECT';

  @IsObject()
  confirmedSpecifications!: Record<string, string>;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}
