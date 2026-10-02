const assert = require('node:assert/strict');
const test = require('node:test');
require('./flow-batch-compat.js');
const FlowBatchCompat = globalThis.FlowBatchCompat;

const projectId = '2760063b-7b9a-4fba-8644-38af228c527a';
const retiredProjectId = '0143adf4-5864-4cb4-abb5-fe4254ad0dc7';

function unwrapRequest(freq) {
  const [outer] = JSON.parse(freq);
  const [rpcid, innerText] = outer[0];
  return { rpcid, inner: JSON.parse(innerText) };
}

function batchResponse(rpcid, payload) {
  const entry = ['wrb.fr', rpcid, JSON.stringify(payload), null, null, null];
  const chunk = JSON.stringify([entry]);
  return `)]}'\n${chunk.length}\n${chunk}\n`;
}

test('legacy image upload becomes a current Flow upload RPC and keeps its project scope', () => {
  const request = FlowBatchCompat.legacyImageRequest(
    'https://aisandbox-pa.googleapis.com/v1/flow/uploadImage?key=test',
    {
      clientContext: { projectId },
      imageBytes: '/9j/4AAQSkZJRgABAQAAAQABAAD/',
    },
    'request-123',
  );

  assert.equal(request.kind, 'upload');
  assert.equal(request.rpcid, 'maseQ');
  assert.equal(request.captchaAction, 'IMAGE_GENERATION');
  const { rpcid, inner } = unwrapRequest(request.freq);
  assert.equal(rpcid, 'maseQ');
  assert.equal(inner[0][5], projectId);
  assert.equal(inner[1], '/9j/4AAQSkZJRgABAQAAAQABAAD/');
  assert.equal(inner[2], 'image/jpeg');
  assert.equal(inner[0][10][0], '__CAPTCHA__');
});

test('legacy image generation preserves prompts, references, model, aspect, and seed', () => {
  const request = FlowBatchCompat.legacyImageRequest(
    `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages?key=test`,
    {
      clientContext: { projectId },
      requests: [{
        seed: 24001,
        structuredPrompt: { parts: [{ text: 'Cinematic forest' }] },
        imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
        imageModelName: 'NARWHAL',
        imageInputs: [{ name: 'reference-1', imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE' }],
      }],
    },
    'request-456',
  );

  const { rpcid, inner } = unwrapRequest(request.freq);
  assert.equal(rpcid, 'ogiZ0b');
  assert.equal(inner[1].length, 1);
  assert.deepEqual(inner[1][0][2][0], ['reference-1', null, null, null, 1]);
  assert.equal(inner[1][0][3], 24001);
  assert.equal(inner[1][0][4], 3);
  assert.equal(inner[1][0][5], 'NARWHAL');
  assert.equal(inner[1][0][8][0][0][0], 'Cinematic forest');
  assert.equal(inner[1][0][7][10][0], '__CAPTCHA__');
});

test('multi-image legacy requests become single-image RPCs that can use separate one-time captchas', () => {
  const request = FlowBatchCompat.legacyImageRequest(
    `https://aisandbox-pa.googleapis.com/v1/projects/${projectId}/flowMedia:batchGenerateImages?key=test`,
    {
      clientContext: { projectId },
      requests: [
        { seed: 24001, structuredPrompt: { parts: [{ text: 'First image' }] } },
        { seed: 24002, structuredPrompt: { parts: [{ text: 'Second image' }] } },
      ],
    },
    'request-multiple-images',
  );

  assert.equal(request.kind, 'generate-batch');
  assert.equal(request.requests.length, 2);
  for (const [index, singleRequest] of request.requests.entries()) {
    const { rpcid, inner } = unwrapRequest(singleRequest.freq);
    assert.equal(rpcid, 'ogiZ0b');
    assert.equal(inner[1].length, 1, 'each Flow RPC must generate exactly one image');
    assert.equal(inner[1][0][3], 24001 + index);
    assert.equal(inner[1][0][7][10][0], '__CAPTCHA__', 'each subrequest needs its own freshly solved captcha');
  }
});

test('linked Flow tab project overrides the retired Flow-Agent default project', () => {
  const activeProject = '2a9f6b13-11e3-47bb-9a08-27cb00a44201';
  const request = FlowBatchCompat.legacyImageRequest(
    `https://aisandbox-pa.googleapis.com/v1/projects/${retiredProjectId}/flowMedia:batchGenerateImages?key=test`,
    {
      clientContext: { projectId: retiredProjectId },
      requests: [{
        seed: 24001,
        structuredPrompt: { parts: [{ text: 'Cinematic forest' }] },
        imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE',
        imageModelName: 'NARWHAL',
      }],
    },
    'request-linked-project',
    activeProject,
  );

  const { inner } = unwrapRequest(request.freq);
  assert.equal(inner[1][0][7][5], activeProject);
  assert.equal(inner[3][5], activeProject);

  const currentProject = '2760063b-7b9a-4fba-8644-38af228c527a';
  const currentRequest = FlowBatchCompat.legacyImageRequest(
    `https://aisandbox-pa.googleapis.com/v1/projects/${currentProject}/flowMedia:batchGenerateImages?key=test`,
    {
      clientContext: { projectId: currentProject },
      requests: [{ structuredPrompt: { parts: [{ text: 'Request uses its active project' }] } }],
    },
    'request-current-project',
    activeProject,
  );
  const { inner: currentInner } = unwrapRequest(currentRequest.freq);
  assert.equal(currentInner[1][0][7][5], currentProject);
  assert.equal(currentInner[3][5], currentProject);
});

test('Flow project id is discovered from a Flow project URL', () => {
  const activeProject = '2a9f6b13-11e3-47bb-9a08-27cb00a44201';
  assert.equal(
    FlowBatchCompat.flowProjectIdFromUrl(`https://flow.google.com/project/${activeProject}?authuser=2`),
    activeProject,
  );
  assert.equal(FlowBatchCompat.flowProjectIdFromUrl('https://example.com/project/not-flow'), null);
});

test('legacy generation falls back to the Flow Agent default when no project context was captured', () => {
  const request = FlowBatchCompat.legacyImageRequest(
    `https://aisandbox-pa.googleapis.com/v1/projects/${retiredProjectId}/flowMedia:batchGenerateImages?key=test`,
    {
      clientContext: { projectId: retiredProjectId },
      requests: [{ structuredPrompt: { parts: [{ text: 'Cinematic forest' }] } }],
    },
    'request-no-project',
  );
  const { inner } = unwrapRequest(request.freq);
  assert.equal(inner[1][0][7][5], retiredProjectId);
  assert.equal(inner[3][5], retiredProjectId);
});

test('legacy reference uploads use the Flow Agent default when no linked project was captured', () => {
  const request = FlowBatchCompat.legacyImageRequest(
    'https://aisandbox-pa.googleapis.com/v1/flow/uploadImage?key=test',
    { imageBytes: '/9j/4AAQSkZJRgABAQAAAQABAAD/' },
    'request-upload-no-project',
  );
  const { inner } = unwrapRequest(request.freq);
  assert.equal(inner[0][5], retiredProjectId);
});

test('Flow project state distinguishes a linked Flow home from a ready project and reuses a saved project', () => {
  const activeProject = '2a9f6b13-11e3-47bb-9a08-27cb00a44201';
  assert.deepEqual(
    FlowBatchCompat.flowProjectStateFromUrl('https://flow.google.com/', ''),
    { ready: false, projectId: null },
  );
  assert.deepEqual(
    FlowBatchCompat.flowProjectStateFromUrl('https://flow.google.com/', activeProject),
    { ready: true, projectId: activeProject },
  );
  assert.deepEqual(
    FlowBatchCompat.flowProjectStateFromUrl(`https://labs.google/fx/tools/flow/project/${activeProject}`, ''),
    { ready: true, projectId: activeProject },
  );
  assert.equal(FlowBatchCompat.flowProjectStateFromUrl('https://accounts.google.com/', ''), null);
});

test('Flow project readiness rejects the retired placeholder and malformed values', () => {
  assert.equal(FlowBatchCompat.isUsableFlowProjectId(retiredProjectId), false);
  assert.equal(FlowBatchCompat.isUsableFlowProjectId('not-a-project'), false);
  assert.equal(FlowBatchCompat.isUsableFlowProjectId(projectId), true);
});

test('image-ready status requires a connected session and token, not a preselected project', () => {
  assert.equal(FlowBatchCompat.isImageReadyAccount({ connected: true, tokenReady: true, flowProjectReady: true }), true);
  assert.equal(FlowBatchCompat.isImageReadyAccount({ primary: true, connected: true, tokenReady: true, flowProjectReady: false }), true);
  assert.equal(FlowBatchCompat.isImageReadyAccount({ connected: true, tokenReady: true }), true);
  assert.equal(FlowBatchCompat.isImageReadyAccount({ connected: true, tokenReady: false, flowProjectReady: true }), false);
});

test('current Flow batchexecute responses are shaped for the existing runtime parsers', () => {
  const uploadRequest = { kind: 'upload', rpcid: 'maseQ' };
  const uploaded = FlowBatchCompat.legacyResponse(
    uploadRequest,
    batchResponse('maseQ', [['uploaded-media-id', projectId, 'operation-id', 'CAE']]),
  );
  assert.equal(uploaded.mediaId, 'uploaded-media-id');

  const imageRequest = { kind: 'generate', rpcid: 'ogiZ0b' };
  const imageUrl = 'https://flow-content.google/image/generated-media-id?sig=abc';
  const generated = FlowBatchCompat.legacyResponse(
    imageRequest,
    batchResponse('ogiZ0b', ['metadata', [imageUrl, imageUrl]]),
  );
  assert.equal(generated.media.length, 1);
  assert.equal(generated.media[0].name, 'generated-media-id');
  assert.equal(generated.media[0].image.generatedImage.fifeUrl, imageUrl);
});

test('non-image legacy endpoints are left to the existing proxy path', () => {
  assert.equal(
    FlowBatchCompat.legacyImageRequest('https://aisandbox-pa.googleapis.com/v1/credits?key=test', {}),
    null,
  );
});
