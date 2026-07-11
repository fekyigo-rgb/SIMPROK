import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

/** Client may only select BOQ item refs that belong to the project's own draft/baseline BOQ (verified server-side). */
export class CreateRabIntelligenceProposalDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  boqItemRefs?: string[];
}
