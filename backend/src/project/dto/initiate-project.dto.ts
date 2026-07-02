import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BoqItemDto {
  @IsString()
  @IsNotEmpty()
  wbsCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  @Min(0)
  plannedCost: number;
}

export class InitiateProjectDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqItemDto)
  items: BoqItemDto[];
}
