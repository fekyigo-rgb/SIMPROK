import { IsString, MinLength } from 'class-validator';

/**
 * RM-03D1 — re-apply this batch's corrected provenance to the private prices it
 * already materialized.
 *
 * There is deliberately NO field here for a value, a date, a source type or a
 * status. The facts come from the batch, which `updateBatchMetadata` already
 * governs (ownership, optimistic version, mutable-window). Letting a client post
 * provenance directly at the price would create a second, ungoverned writer of
 * the same facts — the exact drift this slice exists to close.
 *
 * `reason` is REQUIRED. Restating what a persisted money-adjacent fact claims is
 * never self-evident, and the append-only correction record must carry why.
 */
export class CorrectPrivateProvenanceDto {
  @IsString() @MinLength(1) reason!: string;
}
