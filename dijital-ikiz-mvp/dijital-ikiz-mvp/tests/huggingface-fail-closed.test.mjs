import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatProviderError, qwenChat } from '../lib/huggingface.ts';

const messages = [
  { role: 'system', content: 'Test only.' },
  { role: 'user', content: 'Ping' },
];

test('Hugging Face HTTP errors are mapped to safe public errors', async (t) => {
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.HF_TOKEN;
  const oldModel = process.env.HF_MODEL;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = oldToken;
    if (oldModel === undefined) delete process.env.HF_MODEL;
    else process.env.HF_MODEL = oldModel;
  });

  process.env.HF_TOKEN = 'hf_test_token_not_a_real_credential_123456';
  process.env.HF_MODEL = 'Qwen/Qwen3-4B-Instruct-2507';

  for (const status of [401, 403, 408, 429, 503]) {
    globalThis.fetch = async () => new Response(
      'private-provider-body-secret-' + status,
      { status }
    );

    await assert.rejects(qwenChat(messages, 250), (error) => {
      assert.ok(error instanceof ChatProviderError);
      assert.ok([502, 503].includes(error.status));
      assert.ok(!error.message.includes('private-provider-body-secret'));
      assert.ok(!error.publicMessage.includes('private-provider-body-secret'));
      assert.ok(['AI_PROVIDER_AUTH_FAILED', 'AI_TIMEOUT', 'AI_PROVIDER_BUSY', 'AI_PROVIDER_UNAVAILABLE'].includes(error.code));
      return true;
    });
  }
});

test('Hugging Face network errors are masked and become retryable 503', async (t) => {
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.HF_TOKEN;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = oldToken;
  });

  process.env.HF_TOKEN = 'hf_test_token_not_a_real_credential_123456';
  globalThis.fetch = async () => {
    throw new Error('raw network details must not escape');
  };

  await assert.rejects(qwenChat(messages, 250), (error) => {
    assert.ok(error instanceof ChatProviderError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
    assert.ok(!error.message.includes('raw network details'));
    return true;
  });
});

test('missing Hugging Face token fails closed without network access', async (t) => {
  const oldFetch = globalThis.fetch;
  const oldToken = process.env.HF_TOKEN;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = oldToken;
  });

  delete process.env.HF_TOKEN;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };

  await assert.rejects(qwenChat(messages), (error) => {
    assert.ok(error instanceof ChatProviderError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'AI_NOT_CONFIGURED');
    return true;
  });
  assert.equal(called, false);
});
