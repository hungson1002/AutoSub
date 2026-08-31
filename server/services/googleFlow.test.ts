import { strict as assert } from 'node:assert';
import test from 'node:test';
import { validateGoogleFlowSession } from './googleFlow';

test('Flow preflight sends the client key and session only to Google credits', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  let calledHeaders: Headers | undefined;
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledHeaders = new Headers(init?.headers);
    return new Response('{"credits":935}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await validateGoogleFlowSession({ nanoApiKey: 'flow-client-key', veoToken: 'Bearer session-token', veoCookie: 'SESSION=cookie' });
    assert.equal(calledUrl, 'https://aisandbox-pa.googleapis.com/v1/credits?key=flow-client-key');
    assert.equal(calledHeaders?.get('authorization'), 'Bearer session-token');
    assert.equal(calledHeaders?.get('cookie'), 'SESSION=cookie');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Flow preflight accepts a copied full credits URL', async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = '';
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response('{}', { status: 200 });
  };
  try {
    await validateGoogleFlowSession({ nanoApiKey: 'https://aisandbox-pa.googleapis.com/v1/credits?key=AIza-test_key', veoToken: 'token' });
    assert.equal(calledUrl, 'https://aisandbox-pa.googleapis.com/v1/credits?key=AIza-test_key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Flow preflight classifies expired sessions without creating media', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"error":{"message":"expired"}}', { status: 401, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(
      validateGoogleFlowSession({ nanoApiKey: 'flow-client-key', veoToken: 'expired-token' }),
      /expired or unauthorized \(HTTP 401\)/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
