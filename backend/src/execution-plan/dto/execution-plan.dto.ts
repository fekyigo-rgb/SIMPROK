import { Type } from 'class-transformer';
import {
  IsArray,
  IsDecimal,
  IsInt,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const PROJECT_BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ExecutionPlanDistributionInputDto {
  @IsUUID()
  boqItemId: string;

  @Matches(PROJECT_BUSINESS_DATE, {
    message: 'periodStartDate must be a Project Business Date in YYYY-MM-DD format',
  })
  periodStartDate: string;

  @Matches(PROJECT_BUSINESS_DATE, {
    message: 'periodEndDate must be a Project Business Date in YYYY-MM-DD format',
  })
  periodEndDate: string;

  @IsDecimal({ decimal_digits: '0,6', force_decimal: false })
  plannedIncrementalQuantity: string;
}

export class SaveExecutionPlanDraftDto {
  @IsInt()
  @Min(0)
  expectedRevision: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExecutionPlanDistributionInputDto)
  distributions: ExecutionPlanDistributionInputDto[];
}

export class LockExecutionPlanDto {
  @IsUUID()
  executionPlanVersionId: string;

  @IsInt()
  @Min(1)
  expectedRevision: number;
}
