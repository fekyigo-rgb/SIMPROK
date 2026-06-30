import {
  Controller,
  INestApplication,
  Post,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

/**
 * Auth Throttle Mechanism Tests
 *
 * Proves that ThrottlerGuard + APP_GUARD + @Throttle returns 429 after
 * the configured limit is exceeded. Uses a minimal mock controller with
 * a hardcoded limit=3 so no env-var timing issues arise.
 *
 * The production configuration applies the same mechanism to POST /auth/login
 * via AuthController, which is verified in auth.controller.ts by inspection:
 * - APP_GUARD: ThrottlerGuard is registered in AppModule providers
 * - @Throttle({ login: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL } }) is on login
 * - @SkipThrottle() is on profile (no throttle on authenticated routes)
 */

@Controller('_test-login')
class MockLoginController {
  @Post()
  @Throttle({ login: { limit: 3, ttl: 60_000 } })
  async testLogin() {
    return { ok: true };
  }
}

describe('Auth Throttle Mechanism', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'login', ttl: 60_000, limit: 100_000 }]),
      ],
      controllers: [MockLoginController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 201 before the throttle limit is reached', async () => {
    const res = await request(app.getHttpServer()).post('/_test-login');
    expect(res.status).toBe(201);
  });

  it('returns 429 after @Throttle limit=3 is exceeded in the same session', async () => {
    const server = app.getHttpServer();

    // Attempt 2 (attempt 1 was in the previous it())
    await request(server).post('/_test-login');
    // Attempt 3 — at limit
    await request(server).post('/_test-login');
    // Attempt 4 — over limit
    const res = await request(server).post('/_test-login');
    expect(res.status).toBe(429);
  });

  it('429 response body does not expose sensitive field names', async () => {
    // Still throttled within TTL
    const res = await request(app.getHttpServer()).post('/_test-login');
    expect(res.status).toBe(429);
    const body = JSON.stringify(res.body);
    expect(body.toLowerCase()).not.toContain('password');
    expect(body.toLowerCase()).not.toContain('hash');
    expect(body.toLowerCase()).not.toContain('token');
  });
});
