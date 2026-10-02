import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const workerWorkdir = await mkdtemp(path.join(tmpdir(), 'autosub-flow-recaptcha-workers-'));
process.env.AUTOSUB_WORKDIR = workerWorkdir;
const workerIds = Array.from({ length: 9 }, (_, index) => `account-${index + 1}`);
await mkdir(path.join(workerWorkdir, 'flow-workers'), { recursive: true });
await writeFile(path.join(workerWorkdir, 'flow-workers', 'registry.json'), JSON.stringify(workerIds.map((clientId, index) => ({
  clientId,
  port: 8191 + index,
  createdAt: new Date().toISOString(),
}))));
const { generateGoogleFlowImage, getGoogleFlowImagePoolRuntimeStats } = await import('./googleFlow');
after(async () => rm(workerWorkdir, { recursive: true, force: true }));

test('Google unusual-activity CAPTCHA pauses the whole pool without account failover', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-recaptcha-block-'));
  const generationClients: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: workerIds.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })) });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: workerIds.map((client_id) => ({ client_id, ok: true, credits: 100 })) });
    if (url.endsWith('/v1/images/generations')) {
      generationClients.push(String((init?.headers as Record<string, string>)?.['X-Client-Id'] || ''));
      return new Response(JSON.stringify({ detail: 'reCAPTCHA evaluation failed (PUBLIC_ERROR_UNUSUAL_ACTIVITY)' }), { status: 400 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    await assert.rejects(
      generateGoogleFlowImage('A clear educational illustration', path.join(directory, 'first.png')),
      (error: unknown) => (error as { code?: string }).code === 'FLOW_IMAGE_RECAPTCHA_BLOCKED',
    );
    await assert.rejects(
      generateGoogleFlowImage('A second educational illustration', path.join(directory, 'second.png')),
      (error: unknown) => (error as { code?: string }).code === 'FLOW_IMAGE_RECAPTCHA_BLOCKED',
    );
    assert.equal(generationClients.length, 1, 'the second queued image must not be dispatched or failed over');
    assert.ok(getGoogleFlowImagePoolRuntimeStats().cap <= 5, 'generation must resume at the FlowKit-safe concurrency after CAPTCHA rejection');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
