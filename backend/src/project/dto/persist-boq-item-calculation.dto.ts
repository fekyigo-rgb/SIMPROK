import { IsString, Matches } from 'class-validator';

/**
 * Gate-2A locked contract: this request may carry calculationAsOfDate and
 * nothing else. No unitPrice, no lineTotal, no price field of any kind —
 * the server-authoritative price can only ever come from the Cost Kernel
 * running inside RabKernelPersistenceService's own transaction. The
 * controller route applies a route-local whitelist:true/
 * forbidNonWhitelisted:true ValidationPipe, so any field beyond this one is
 * rejected with 400 before the request ever reaches the service.
 */
export class PersistBoqItemCalculationDto {
  /**
   * Exact YYYY-MM-DD shape only — rejects "2026-7-1", timestamps, empty
   * strings, arrays, objects. Real-calendar-date validity (e.g. rejecting
   * "2026-02-30") is a second, independent check via parseDateOnlyUtc in
   * the service, before the transaction opens.
   */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'calculationAsOfDate must be an exact calendar date in YYYY-MM-DD format',
  })
  calculationAsOfDate: string;
}
