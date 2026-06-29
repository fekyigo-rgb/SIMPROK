import { getRequiredJwtSecret } from './jwt-secret';

describe('getRequiredJwtSecret', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws if JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => getRequiredJwtSecret()).toThrow('JWT_SECRET is required and must not be empty.');
  });

  it('throws if JWT_SECRET is empty string', () => {
    process.env.JWT_SECRET = '';
    expect(() => getRequiredJwtSecret()).toThrow('JWT_SECRET is required and must not be empty.');
  });

  it('throws if JWT_SECRET is whitespace-only', () => {
    process.env.JWT_SECRET = '   ';
    expect(() => getRequiredJwtSecret()).toThrow('JWT_SECRET is required and must not be empty.');
  });

  it('returns value if JWT_SECRET is valid', () => {
    process.env.JWT_SECRET = 'valid-dummy-secret';
    expect(getRequiredJwtSecret()).toBe('valid-dummy-secret');
  });

  it('error message does not expose provided secret value', () => {
    process.env.JWT_SECRET = '   ';
    try {
      getRequiredJwtSecret();
    } catch (e: any) {
      expect(e.message).not.toContain('   ');
    }
  });
});
