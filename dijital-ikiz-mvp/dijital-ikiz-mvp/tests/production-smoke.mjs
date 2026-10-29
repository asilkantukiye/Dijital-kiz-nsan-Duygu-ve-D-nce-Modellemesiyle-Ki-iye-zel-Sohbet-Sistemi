#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function fail(message) {
  console.error('PRODUCTION_SMOKE_FAILED: ' + message);
  process.exitCode = 1;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseEnvFile(source) {
  const result = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value); }
      catch { throw new Error('Malformed quoted value for ' + match[1] + ' in Vercel env file.'); }
    } else if (value.startsWith("'")) {
      requireCondition(value.endsWith("'"), 'Malformed quoted value for ' + match[1] + ' in Vercel env file.');
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/u, '').trim();
    }
    result[match[1]] = value;
  }
  return result;
}

async function jsonResponse(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(label + ' returned non-JSON content (HTTP ' + response.status + ').');
  }
}

async function main() {
  const baseUrl = (process.env.BASE_URL || '').trim().replace(/\/+$/u, '');
  const healthToken = (process.env.HEALTHCHECK_TOKEN || '').trim();
  const testEmail = (process.env.PRODUCTION_SMOKE_TEST_EMAIL || '').trim();
  const testPassword = process.env.PRODUCTION_SMOKE_TEST_PASSWORD || '';
  const envFile = process.env.VERCEL_ENV_FILE || '.vercel/.env.production.local';

  requireCondition(/^https:\/\/[A-Za-z0-9.-]+$/u.test(baseUrl), 'BASE_URL must be an HTTPS origin.');
  requireCondition(healthToken.length >= 32, 'HEALTHCHECK_TOKEN must contain at least 32 characters.');
  requireCondition(testEmail.includes('@') && testPassword.length > 0,
    'A dedicated confirmed Supabase smoke-test account is required.');

  const envText = await readFile(envFile, 'utf8');
  const vercelEnv = parseEnvFile(envText);
  const supabaseUrl = (vercelEnv.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/u, '');
  const publishableKey = (vercelEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
  requireCondition(/^https:\/\/[A-Za-z0-9.-]+$/u.test(supabaseUrl),
    'Production Supabase URL is absent or invalid in the pulled Vercel env file.');
  requireCondition(publishableKey.length > 10,
    'Production Supabase publishable key is absent in the pulled Vercel env file.');

  const healthResponse = await fetch(baseUrl + '/api/health', {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const health = await jsonResponse(healthResponse, '/api/health');
  requireCondition(healthResponse.status === 200 && health.ok === true && health.ready === true,
    '/api/health is not ready (HTTP ' + healthResponse.status + '); inspect configured readiness flags.');
  requireCondition(health.configured?.supabase === true &&
    health.configured?.huggingface === true &&
    health.configured?.rateLimit === true &&
    health.configured?.serverWriteBoundary === true,
    '/api/health readiness flags are incomplete.');
  console.log('PASS /api/health: HTTP 200, ok=true, ready=true.');

  const deepResponse = await fetch(baseUrl + '/api/health/deep', {
    headers: { accept: 'application/json', 'x-healthcheck-token': healthToken },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const deep = await jsonResponse(deepResponse, '/api/health/deep');
  requireCondition(deepResponse.status === 200 && deep.ok === true &&
    deep.providers?.supabase === true &&
    deep.providers?.huggingface === true &&
    deep.providers?.rateLimit === true,
    '/api/health/deep failed its provider checks (HTTP ' + deepResponse.status + ').');
  console.log('PASS /api/health/deep: HTTP 200; Supabase, Hugging Face auth, and rate limiter passed.');

  const message = 'Canlı üretim duman testi ' + randomUUID() + ': yalnızca OK yanıtı ver.';
  const chatUrl = baseUrl + '/api/chat';
  const anonymousChat = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: baseUrl,
    },
    body: JSON.stringify({ message, variant: 'baseline' }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  requireCondition(anonymousChat.status === 401,
    'Unauthenticated /api/chat must be rejected with HTTP 401, got ' + anonymousChat.status + '.');
  console.log('PASS /api/chat security boundary: unauthenticated request correctly returned HTTP 401.');

  const authResponse = await fetch(supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  requireCondition(authResponse.ok,
    'Supabase smoke-test sign-in failed (HTTP ' + authResponse.status + ').');
  const auth = await jsonResponse(authResponse, 'Supabase password sign-in');
  requireCondition(typeof auth.access_token === 'string' &&
    typeof auth.refresh_token === 'string' &&
    typeof auth.expires_in === 'number' &&
    auth.user && typeof auth.user.id === 'string',
    'Supabase sign-in response did not contain a valid session.');

  const projectHost = new URL(supabaseUrl).hostname;
  const projectRef = projectHost.split('.')[0];
  requireCondition(projectRef && projectHost.endsWith('.supabase.co'),
    'Could not determine the Supabase project reference for the SSR cookie.');
  const session = {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    token_type: auth.token_type || 'bearer',
    expires_in: auth.expires_in,
    expires_at: auth.expires_at || Math.floor(Date.now() / 1000) + auth.expires_in,
    user: auth.user,
  };
  const cookieName = 'sb-' + projectRef + '-auth-token';
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  requireCondition(cookieValue.length < 3000,
    'SSR session cookie exceeds the single-cookie safety limit; use browser-based smoke testing.');

  const chatResponse = await fetch(chatUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: baseUrl,
      cookie: cookieName + '=' + cookieValue,
    },
    body: JSON.stringify({ message, variant: 'baseline' }),
    signal: AbortSignal.timeout(90_000),
    cache: 'no-store',
  });
  const chatPayload = await jsonResponse(chatResponse, 'Authenticated /api/chat');
  requireCondition(chatResponse.status === 200 &&
    typeof chatPayload.reply === 'string' &&
    chatPayload.reply.trim().length > 0,
    'Authenticated /api/chat did not return a non-empty reply (HTTP ' + chatResponse.status +
      ', code=' + String(chatPayload.code || 'none') + ').');
  console.log('PASS /api/chat: authenticated production request returned HTTP 200 with a non-empty reply.');
  console.log('All production smoke tests passed. No credentials or access tokens were printed.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'unexpected failure');
});
