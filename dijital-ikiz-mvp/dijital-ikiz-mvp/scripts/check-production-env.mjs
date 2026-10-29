#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'HF_TOKEN',
  'HF_MODEL',
  'HF_EMBEDDING_MODEL',
  'RATE_LIMIT_KEY_SALT',
  'HEALTHCHECK_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
];

export function parseDotEnv(source) {
  const values = Object.create(null);

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();

    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        if (value.endsWith('"')) value = value.slice(1, -1);
        else value = '';
      }
    } else if (value.startsWith("'")) {
      value = value.endsWith("'") ? value.slice(1, -1) : '';
    } else {
      value = value.replace(/\s+#.*$/u, '').trim();
    }

    values[key] = typeof value === 'string' ? value.trim() : '';
  }

  return values;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
  } catch {
    return false;
  }
}

function isValidHuggingFaceChatEndpointUrl(value) {
  try {
    const url = new URL(value);
    const trustedHost = url.hostname === 'router.huggingface.co' ||
      url.hostname.endsWith('.endpoints.huggingface.cloud');
    return url.protocol === 'https:' &&
      trustedHost &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/v1/chat/completions';
  } catch {
    return false;
  }
}

function isValidUpstashUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname.endsWith('.upstash.io') &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '');
  } catch {
    return false;
  }
}

/**
 * Returns only variable names and static policy messages. It never returns
 * secret values, so callers can safely print the result in a CI log.
 */
export function validateProductionEnvironment(env) {
  const issues = [];

  for (const key of REQUIRED_KEYS) {
    if (typeof env[key] !== 'string' || env[key].trim().length === 0) {
      issues.push(key + ' is missing');
    }
  }

  if (env.NEXT_PUBLIC_SUPABASE_URL?.trim() && !isHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL.trim())) {
    issues.push('NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL');
  }

  if (
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() &&
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim().length < 8
  ) {
    issues.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is too short');
  }

  if (
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() &&
    env.SUPABASE_SERVICE_ROLE_KEY.trim().length < 32
  ) {
    issues.push('SUPABASE_SERVICE_ROLE_KEY is too short');
  }

  if (env.HF_TOKEN?.trim() && env.HF_TOKEN.trim().length < 20) {
    issues.push('HF_TOKEN is too short');
  }

  for (const key of ['HF_MODEL', 'HF_EMBEDDING_MODEL']) {
    const value = env[key]?.trim() || '';
    if (value && (value.length > 512 || /[\\r\\n]/u.test(value))) {
      issues.push(key + ' is invalid');
    }
  }

  const chatEndpointUrl = env.HF_CHAT_COMPLETIONS_URL?.trim() || '';
  if (chatEndpointUrl && !isValidHuggingFaceChatEndpointUrl(chatEndpointUrl)) {
    issues.push('HF_CHAT_COMPLETIONS_URL must be an HTTPS Hugging Face router or dedicated Inference Endpoint /v1/chat/completions URL');
  }

  if (env.RATE_LIMIT_KEY_SALT?.trim().length < 32) {
    issues.push('RATE_LIMIT_KEY_SALT must contain at least 32 characters');
  }

  if (env.HEALTHCHECK_TOKEN?.trim().length < 32) {
    issues.push('HEALTHCHECK_TOKEN must contain at least 32 characters');
  }

  const redisUrl = env.UPSTASH_REDIS_REST_URL?.trim() || '';
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN?.trim() || '';

  if (Boolean(redisUrl) !== Boolean(redisToken)) {
    issues.push('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set');
  }

  if (redisUrl && !isValidUpstashUrl(redisUrl)) {
    issues.push('UPSTASH_REDIS_REST_URL must be a valid HTTPS Upstash REST origin');
  }

  if (redisToken && redisToken.length < 10) {
    issues.push('UPSTASH_REDIS_REST_TOKEN is too short');
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  const filePath = process.argv[2] || '.vercel/.env.production.local';
  let contents;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch {
    console.error('PRODUCTION_ENV_GATE_FAILED: Production environment file could not be read.');
    process.exitCode = 1;
    return;
  }

  const result = validateProductionEnvironment(parseDotEnv(contents));
  if (!result.ok) {
    console.error('PRODUCTION_ENV_GATE_FAILED: Production build blocked.');
    for (const issue of result.issues) console.error('- ' + issue);
    process.exitCode = 1;
    return;
  }

  console.log('PRODUCTION_ENV_GATE_PASSED: Required Production variables are present and structurally valid.');
  console.log('Secret values were not printed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('PRODUCTION_ENV_GATE_FAILED: Unexpected validation failure; values were not printed.');
    process.exitCode = 1;
  });
}
