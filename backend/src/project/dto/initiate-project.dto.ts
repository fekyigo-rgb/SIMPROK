import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class BoqItemDto {
  @IsString()
  @IsNotEmpty()
  wbsCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  plannedCost: number;
}

export class InitiateProjectDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqItemDto)
  items: BoqItemDto[];
}
