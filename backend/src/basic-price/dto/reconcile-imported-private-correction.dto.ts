import { IsString, IsUUID, Matches, MinLength } from 'class-validator';

/** Link two existing imported private price facts only after an explicit correction decision. */
export class ReconcileImportedPrivateCorrectionDto {
  @IsUUID() correctedPriceId!: string;
  @IsString() @MinLength(1) @Matches(/\S/) expectedPreviousValue!: string;
  @IsString() @MinLength(1) @Matches(/\S/) expectedCorrectedValue!: string;
  @IsString() @MinLength(1) @Matches(/\S/) reason!: string;
}
