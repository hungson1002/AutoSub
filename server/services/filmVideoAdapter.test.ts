import assert from 'node:assert/strict';
import test from 'node:test';
import { generateFilmVideoClip, listFilmVideoAdapters, registerFilmVideoAdapter, resolveFilmVideoAdapter } from './filmVideoAdapter';

test('built-in renderer is exposed through the provider-neutral adapter registry', () => {
  const flow = resolveFilmVideoAdapter('Flow Agent Auto');
  assert.equal(flow?.id, 'flow-agent');
  assert.ok(listFilmVideoAdapters().some((adapter) => adapter.models.includes('Flow Agent Auto')));
});

test('a non-Flow renderer can be plugged in without changing the film workflow', async () => {
  let receivedModel = '';
  let receivedPrompt = '';
  registerFilmVideoAdapter({
    id: 'test-renderer',
    label: 'Test renderer',
    models: ['Test Cinematic'],
    canHandle: (model) => model === 'Test Cinematic',
    compilePrompt: ({ prompt }) => `TEST PROVIDER FORMAT\n${prompt}`,
    generate: async ({ model, prompt }) => { receivedModel = model; receivedPrompt = prompt; },
  });
  await generateFilmVideoClip({ model: 'Test Cinematic', prompt: 'one shot', outputFile: 'test.mp4', aspectRatio: '16:9' });
  assert.equal(receivedModel, 'Test Cinematic');
  assert.equal(receivedPrompt, 'TEST PROVIDER FORMAT\none shot');
});
