import { normalizeUnitAlias } from '../unit-kernel/unit-normalization';
import { COST_CALCULATION_REASON } from './cost-kernel.contracts';

/**
 * THE monetary unit identity fact — one implementation, two callers.
 *
 * This is the existing Cost Kernel guard MOVED, not rewritten. The calculation
 * chain refuses money whenever the AHSP output unit is missing/blank, or when
 * it does not carry the same normalized string as the BOQ unit, and that pair
 * of refusals is the whole of what "these two units are monetarily identical"
 * means in SIMPROK today. Nothing about the law changes by living here; only
 * its address does, so that the BOQ/AHSP bind boundary can ask the SAME
 * question the calculation will later ask instead of asking a similar one.
 *
 * It sits in the Cost Kernel's own domain because the fact is MONETARY. Unit
 * Kernel canonical alias equivalence is a different, broader fact: "m" and "m1"
 * are ONE canonical unit definition there, and the seeded dictionary holds 26
 * such alias pairs — every one of which this function refuses. Seating this
 * predicate beside the alias table would place monetary authority inside the
 * unit dictionary and invite exactly the conflation the Owner has ruled out.
 *
 * A VERDICT, not a boolean, and deliberately. The blank-output-unit case and
 * the mismatch case are different refusals carrying different existing reason
 * codes, and a caller must be able to tell them apart and keep their order. A
 * bare boolean would also be unsafe rather than merely lossy: the comparison on
 * its own does not type-check against a nullable output unit, so a caller that
 * reduced this to `a === b` would admit two blank units as "identical" and bind
 * a relationship the calculation chain then refuses forever.
 *
 * The admissible branch carries the output unit back, verbatim and unnormalized.
 * That is not a convenience: the blank check IS what proves an output unit
 * exists, and the Cost Kernel needs that proof to put the unit on a calculated
 * result. Handing the proven value back with the verdict keeps the proof and
 * its consequence together instead of leaving a caller to assert it. No new
 * vocabulary is minted here — both refusals are reason codes the Cost Kernel
 * already ships.
 */

/**
 * Identity comparison only (BOQ unit vs AHSP output unit), via the existing
 * canonical unit-kernel string primitive. M1/m1/M¹ normalize equal; "M" and
 * "M1" stay distinct because unit-kernel treats them as separate canonical
 * dimensional codes — this must never widen into alias/conversion lookup.
 */
const exactUnit = (value: string) => normalizeUnitAlias(value);

export type MonetaryUnitIdentityRefusal =
  | typeof COST_CALCULATION_REASON.MISSING_AHSP_OUTPUT_UNIT
  | typeof COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH;

export type MonetaryUnitIdentityVerdict =
  | { admissible: true; outputUnit: string }
  | { admissible: false; refusal: MonetaryUnitIdentityRefusal };

export function monetaryUnitIdentity(
  boqUnit: string,
  outputUnit: string | null,
): MonetaryUnitIdentityVerdict {
  if (!outputUnit?.trim()) {
    return {
      admissible: false,
      refusal: COST_CALCULATION_REASON.MISSING_AHSP_OUTPUT_UNIT,
    };
  }
  if (exactUnit(boqUnit) !== exactUnit(outputUnit)) {
    return {
      admissible: false,
      refusal: COST_CALCULATION_REASON.BOQ_AHSP_UNIT_MISMATCH,
    };
  }
  return { admissible: true, outputUnit };
}
