import test from 'node:test';
import assert from 'node:assert/strict';
import { rankVideoCdns } from './videoCdn';

test('ranks responsive alternate CDN ahead of failed primary without losing fallbacks', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-1048575');
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

test('checks the middle of long files and rejects a CDN that only serves the opening reliably', async () => {
  const original = globalThis.fetch;
  const ranges: string[] = [];
  globalThis.fetch = async (url, init) => {
    const range = new Headers(init?.headers).get('range')!;
    ranges.push(range);
    const brokenMiddle = String(url).endsWith('/a') && !range.startsWith('bytes=0-');
    return new Response(new Uint8Array(brokenMiddle ? 700 * 1024 : 1024 * 1024), { status: 206 });
  };
  try {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    assert.deepEqual(await rankVideoCdns(urls, {}, new AbortController().signal, 100 * 1024 * 1024), [urls[1], urls[0]]);
    assert.equal(ranges.filter((range) => range === 'bytes=52428800-53477375').length, 2);
  } finally { globalThis.fetch = original; }
});
