import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVideoCdns } from './videoCdn';

test('ranks responsive alternate CDN ahead of failed primary without losing fallbacks', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-2097151');
    if (String(url).endsWith('primary')) return new Response('error', { status: 503 });
    return new Response(new Uint8Array(2097152), { status: 206 });
  };
  try {
    assert.deepEqual(await rankVideoCdns(['https://example.com/primary', 'https://example.com/backup', 'https://example.com/backup'], {}, new AbortController().signal), ['https://example.com/backup', 'https://example.com/primary']);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

test('does not download full responses when ranges are unsupported', async () => {
  const original = globalThis.fetch;
  let cancelled = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 200 });
  try {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    assert.deepEqual(await rankVideoCdns(urls, {}, new AbortController().signal), urls);
    assert.equal(cancelled, 2);
  } finally { globalThis.fetch = original; }
});

test('prefers a complete sample over an immediately truncated sample', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(new Uint8Array(String(url).endsWith('/a') ? 1024 : 2097152), { status: 206 });
  try {
    assert.deepEqual(await rankVideoCdns(['https://example.com/a', 'https://example.com/b'], {}, new AbortController().signal), ['https://example.com/b', 'https://example.com/a']);
  } finally { globalThis.fetch = original; }
});
