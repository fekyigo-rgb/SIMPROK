import { Prisma } from '@prisma/client';

/**
 * RM-02D2A2 — the ONE money-to-string projection used by every Basic Price
 * workflow API contract. Money is ALWAYS emitted as an exact decimal string
 * with exactly two fraction digits (e.g. "125000.00"), never a JS number.
 *
 * Prisma.Decimal is Decimal.js under the hood: constructing from a
 * Prisma.Decimal (the runtime type of a `@db.Decimal(18, 2)` column) or from
 * a decimal string (raw/test input) and calling `.toFixed(2)` is exact
 * decimal arithmetic. There is deliberately no Number(), parseFloat(), unary
 * plus, or floating-point math anywhere on this path — IEEE-754 rounding must
 * never touch a price. See P7C Cost Kernel law: prices are found and counted
 * exactly, never re-created through a lossy conversion.
 */
export function toDecimalString2(value: Prisma.Decimal | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}
