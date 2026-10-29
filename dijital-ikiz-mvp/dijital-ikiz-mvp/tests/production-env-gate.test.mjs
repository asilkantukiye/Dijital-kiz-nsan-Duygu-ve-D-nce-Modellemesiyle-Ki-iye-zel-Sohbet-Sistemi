import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDotEnv, validateProductionEnvironment } from '../scripts/check-production-env.mjs';

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(32),
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-' + 'x'.repeat(48),
  HF_TOKEN: 'hf_' + 'x'.repeat(40),
  RATE_LIMIT_KEY_SALT: 's'.repeat(40),
  HEALTHCHECK_TOKEN: 'h'.repeat(40),
  UPSTASH_REDIS_REST_URL: 'https://region-12345.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'redis-' + 'x'.repeat(32),
};

test('Production gate accepts all required Production variables including both Upstash credentials', () => {
  const result = validateProductionEnvironment({ ...validEnv });
  assert.deepEqual(result, { ok: true, issues: [] });
});

test('Production gate rejects each absent required variable', () => {
  for (const key of Object.keys(validEnv)) {
    const env = { ...validEnv };
    delete env[key];
    const result = validateProductionEnvironment(env);
    assert.equal(result.ok, false, key + ' should block the build');
    assert.ok(result.issues.some(issue => issue.includes(key)), key + ' should be named');
  }
});

test('Production gate rejects an incomplete Upstash pair', () => {
  const result = validateProductionEnvironment({
    ...validEnv,
    UPSTASH_REDIS_REST_URL: 'https://example-upstash.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: '',
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes('must both be set')));
});

test('Production gate rejects invalid Upstash URLs', () => {
  const result = validateProductionEnvironment({
    ...validEnv,
    UPSTASH_REDIS_REST_URL: 'http://example-upstash.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'token-' + 'x'.repeat(20),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes('valid HTTPS Upstash REST origin')));
});

test('Production gate rejects short salts and health tokens', () => {
  const result = validateProductionEnvironment({
    ...validEnv,
    RATE_LIMIT_KEY_SALT: 'short',
    HEALTHCHECK_TOKEN: 'short',
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.includes('RATE_LIMIT_KEY_SALT')));
  assert.ok(result.issues.some(issue => issue.includes('HEALTHCHECK_TOKEN')));
});

test('Dotenv parser handles quotes, exports, comments and blank lines', () => {
  const parsed = parseDotEnv([
    '# comment',
    'export HF_TOKEN="hf_abc123"',
    "HEALTHCHECK_TOKEN='health secret'",
    'RATE_LIMIT_KEY_SALT=salt-value # trailing comment',
    '',
  ].join('\n'));

  assert.equal(parsed.HF_TOKEN, 'hf_abc123');
  assert.equal(parsed.HEALTHCHECK_TOKEN, 'health secret');
  assert.equal(parsed.RATE_LIMIT_KEY_SALT, 'salt-value');
});
