import { IsArray, IsOptional, IsUUID } from 'class-validator';

/**
 * INTENT, NOT DECISIONS.
 *
 * The whole body is one optional list of rows to LEAVE ALONE. There is
 * deliberately no `resourceCatalogId`, no `unitDefinitionId` and no per-row
 * binding of any kind: the server re-derives what it can prove at execution
 * time, so a stale screen — or a crafted request — cannot bind an identity the
 * authorities did not just confirm.
 *
 * `excludeRowIds` exists for one honest case: a reviewer who is mid-thought on
 * a row SIMPROK happens to have proven. Saying "not that one" is intent about
 * scope, not an identity claim, so it is the one thing the client may state.
 */
export class AcceptMachineProvenRowsDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  excludeRowIds?: string[];
}
