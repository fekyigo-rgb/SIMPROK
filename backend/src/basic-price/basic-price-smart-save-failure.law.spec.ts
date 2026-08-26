import {
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  SMART_SAVE_INTERRUPTED,
  buildSmartSaveFailure,
  classifySmartSavePersistence,
  type SmartSaveFailureBody,
} from './basic-price-smart-save-failure.law';

const bodyOf = (error: HttpException): SmartSaveFailureBody =>
  error.getResponse() as SmartSaveFailureBody;

/**
 * SMART-SAVE FAILURE TRUTH — the sentences this command is allowed to cause.
 *
 * `smart-save` is one product command over two independently durable steps, so
 * "nothing was saved" is not a safe default sentence: it is a CLAIM, and this
 * file is where the claim has to be earned. Every case below asks the same
 * question — what did the command actually measure — and refuses any answer
 * that goes beyond it in either direction.
 */
describe('SMART-SAVE PERSISTENCE — measured, never assumed', () => {
  it('two equal readings PROVE nothing was persisted', () => {
    expect(
      classifySmartSavePersistence(
        { boundRows: 4, keptPrices: 4 },
        { boundRows: 4, keptPrices: 4 },
      ),
    ).toEqual({ persistence: 'NONE' });
  });

  /**
   * THE CASE THE WHOLE CONTRACT EXISTS FOR. Step 1 commits in bounded chunks,
   * so a failure in step 2 leaves those bindings in the database. The counts
   * moved; the verdict must move with them.
   */
  it('bindings that survived a later failure read as PARTIAL, with the delta', () => {
    expect(
      classifySmartSavePersistence(
        { boundRows: 0, keptPrices: 0 },
        { boundRows: 13, keptPrices: 0 },
      ),
    ).toEqual({
      persistence: 'PARTIAL',
      boundRowsDelta: 13,
      keptPricesDelta: 0,
    });
  });

  /**
   * A BATCH IS NOT A BLANK SLATE. Rows a human finished by hand before pressing
   * are already bound, so "there are bindings" is not evidence that THIS press
   * made any — only the difference is.
   */
  it('pre-existing bindings are not credited to this press', () => {
    expect(
      classifySmartSavePersistence(
        { boundRows: 9, keptPrices: 0 },
        { boundRows: 9, keptPrices: 0 },
      ),
    ).toEqual({ persistence: 'NONE' });
    expect(
      classifySmartSavePersistence(
        { boundRows: 9, keptPrices: 0 },
        { boundRows: 12, keptPrices: 0 },
      ),
    ).toEqual({
      persistence: 'PARTIAL',
      boundRowsDelta: 3,
      keptPricesDelta: 0,
    });
  });

  it('an unreadable measurement is UNKNOWN, and carries no counts at all', () => {
    expect(
      classifySmartSavePersistence(null, { boundRows: 3, keptPrices: 0 }),
    ).toEqual({ persistence: 'UNKNOWN' });
    expect(
      classifySmartSavePersistence({ boundRows: 0, keptPrices: 0 }, null),
    ).toEqual({ persistence: 'UNKNOWN' });
    expect(classifySmartSavePersistence(null, null)).toEqual({
      persistence: 'UNKNOWN',
    });
  });

  /**
   * A COUNT THAT WENT BACKWARDS IS NOT A ZERO. Both facts are append-only in
   * this command, so a decrease means the measurement cannot be trusted — and
   * an untrustworthy measurement must never be reported as the certainty
   * `NONE`, which is the one verdict that licenses "nothing was saved".
   */
  it('an impossible decrease degrades to UNKNOWN rather than to a false certainty', () => {
    expect(
      classifySmartSavePersistence(
        { boundRows: 13, keptPrices: 13 },
        { boundRows: 13, keptPrices: 12 },
      ),
    ).toEqual({ persistence: 'UNKNOWN' });
  });
});

describe('SMART-SAVE FAILURE BODY — the reason survives, the progress is added', () => {
  /**
   * A REVIEWER WHO CAN FIX SOMETHING MUST STILL BE TOLD WHAT. Wrapping every
   * failure as an anonymous fault would bury an actionable refusal behind a
   * 500 nobody can act on, so the named code and the status both pass through.
   */
  it('a named domain refusal keeps its own name and its own status', () => {
    const failure = buildSmartSaveFailure(
      new ConflictException('EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE'),
      { persistence: 'PARTIAL', boundRowsDelta: 13, keptPricesDelta: 0 },
    );
    expect(failure.getStatus()).toBe(409);
    // toMatchObject, not toEqual: the original exception body travels through
    // intact, so Nest own statusCode/error fields ride along exactly as they
    // would have without the envelope. What is pinned is that the NAME and the
    // progress are both present and both correct.
    expect(bodyOf(failure)).toMatchObject({
      message: 'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE',
      smartSave: {
        persistence: 'PARTIAL',
        boundRowsDelta: 13,
        keptPricesDelta: 0,
      },
    });
  });

  it('an object-bodied refusal is read from the same field the browser reads', () => {
    const failure = buildSmartSaveFailure(
      new ConflictException({
        message: 'SOURCE_CLASSIFICATION_INCOHERENT',
        impliedSourceType: 'GOVERNMENT_PUBLICATION',
      }),
      { persistence: 'NONE' },
    );
    expect(bodyOf(failure).message).toBe('SOURCE_CLASSIFICATION_INCOHERENT');
  });

  it('an unnamed fault becomes SMART_SAVE_INTERRUPTED at 500', () => {
    const failure = buildSmartSaveFailure(new Error('connection terminated'), {
      persistence: 'UNKNOWN',
    });
    expect(failure.getStatus()).toBe(500);
    expect(bodyOf(failure)).toEqual({
      message: SMART_SAVE_INTERRUPTED,
      smartSave: { persistence: 'UNKNOWN' },
    });
  });

  it('a framework 500 is still reported with what was measured', () => {
    const failure = buildSmartSaveFailure(new InternalServerErrorException(), {
      persistence: 'PARTIAL',
      boundRowsDelta: 5,
      keptPricesDelta: 0,
    });
    expect(failure.getStatus()).toBe(500);
    expect(bodyOf(failure).smartSave).toEqual({
      persistence: 'PARTIAL',
      boundRowsDelta: 5,
      keptPricesDelta: 0,
    });
  });

  /**
   * THE ENVELOPE IS ALWAYS PRESENT. A browser that has to guess whether the
   * field exists will guess wrong exactly once, and the wrong guess is the
   * false sentence this whole contract was written to stop.
   */
  it('every failure carries a persistence verdict, whatever it is', () => {
    for (const error of [
      new ConflictException('BATCH_NOT_MUTABLE'),
      new Error('boom'),
      'not an error at all',
    ]) {
      const failure = buildSmartSaveFailure(error, { persistence: 'NONE' });
      expect(bodyOf(failure).smartSave.persistence).toBe('NONE');
    }
  });
});

/**
 * THE DETAIL A PERSON CAN ACT ON MUST NOT BE THROWN AWAY.
 *
 * `keepBatchPrivate` raises an incoherent source classification as an object
 * that also names the ONE type the stated origin implies — the fact that
 * actually lets a reviewer fix it. Rebuilding the body from the code alone
 * silently discarded it, and since `smart-save` is now the only route the
 * review room presses, it discarded it on the whole product path.
 */
describe('SMART-SAVE FAILURE BODY — the richer refusal survives the envelope', () => {
  it('carries every field the original refusal stated', () => {
    const failure = buildSmartSaveFailure(
      new ConflictException({
        message: 'SOURCE_CLASSIFICATION_INCOHERENT',
        statedOrigin: 'GOVERNMENT',
        impliedSourceType: 'REGULATION',
      }),
      { persistence: 'NONE' },
    );
    expect(bodyOf(failure)).toMatchObject({
      message: 'SOURCE_CLASSIFICATION_INCOHERENT',
      statedOrigin: 'GOVERNMENT',
      impliedSourceType: 'REGULATION',
      smartSave: { persistence: 'NONE' },
    });
  });

  /**
   * AND THE COMMAND'S OWN TWO FACTS ALWAYS WIN. A refusal body that happened to
   * carry a field called `smartSave` must not be able to overwrite the measured
   * persistence verdict with anything of its own.
   */
  it('never lets a carried field overwrite the measured verdict', () => {
    const failure = buildSmartSaveFailure(
      new ConflictException({
        message: 'BATCH_NOT_MUTABLE',
        smartSave: { persistence: 'PARTIAL', boundRowsDelta: 999 },
      }),
      { persistence: 'NONE' },
    );
    expect(bodyOf(failure).smartSave).toEqual({ persistence: 'NONE' });
  });

  /**
   * A GENUINELY STRING-BODIED EXCEPTION HAS NOTHING TO CARRY, and the body is
   * then exactly the two facts this command owns. (Nest own
   * `ConflictException(code)` is NOT this case — it already builds an object
   * body of `{statusCode, message, error}`, which now travels through
   * unchanged, which is what it would have done without the envelope.)
   */
  it('a genuinely string-bodied refusal contributes nothing extra', () => {
    const failure = buildSmartSaveFailure(
      new HttpException('RAW_REFUSAL', HttpStatus.CONFLICT),
      { persistence: 'NONE' },
    );
    expect(bodyOf(failure)).toEqual({
      message: 'RAW_REFUSAL',
      smartSave: { persistence: 'NONE' },
    });
  });

  it("Nest's own object body rides along, exactly as it would have anyway", () => {
    const failure = buildSmartSaveFailure(
      new ConflictException('BATCH_NOT_MUTABLE'),
      { persistence: 'NONE' },
    );
    expect(bodyOf(failure)).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'BATCH_NOT_MUTABLE',
      smartSave: { persistence: 'NONE' },
    });
  });
});
