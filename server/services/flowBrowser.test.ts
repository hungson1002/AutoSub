import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveFlowBrowserUrl } from './flowBrowser';

test('opening Flow follows the selected browser account instead of a pinned env slot', async (t) => {
  const original = process.env.FLOW_GOOGLE_URL;
  process.env.FLOW_GOOGLE_URL = 'https://flow.google.com/u/2/';
  t.after(() => { if (original === undefined) delete process.env.FLOW_GOOGLE_URL; else process.env.FLOW_GOOGLE_URL = original; });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    sessions: [{ selected_flow_url: 'https://flow.google.com/u/3/project/example' }],
  })));
  assert.equal(await resolveFlowBrowserUrl(), 'https://flow.google.com/u/3/project/example');
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({
    sessions: [{ selected_flow_url: 'https://example.com/' }],
  })));
  assert.equal(await resolveFlowBrowserUrl(), 'https://flow.google.com/u/2/');
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ sessions: [
    { selected_flow_url: 'https://flow.google.com/u/0/' }, { selected_flow_url: 'https://flow.google.com/u/1/' },
  ] })));
  assert.equal(await resolveFlowBrowserUrl(), 'https://flow.google.com/u/2/');
});
