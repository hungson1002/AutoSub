/*
 * Compatibility adapter for the retired Flow REST image endpoints.
 * It only builds/parses payloads; network requests run inside the linked Flow
 * tab so the current page cookie, CSRF token and captcha are used.
 */
(function attachFlowBatchCompat(root) {
  'use strict';

  const CAPTCHA_SLOT = '__CAPTCHA__';
  // The installed Flow Agent runtime still uses this legacy default when no
  // project has been captured from a Flow tab. Keep it as a request-only
  // fallback for the old generation path; never treat it as a real project or
  // use it to mark a worker image-ready.
  const RETIRED_DEFAULT_PROJECT_ID = '0143adf4-5864-4cb4-abb5-fe4254ad0dc7';
  const FLOW_PROJECT_UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const RPC_UPLOAD_IMAGE = 'maseQ';
  const RPC_GENERATE_IMAGE = 'ogiZ0b';
  const IMAGE_ASPECT = Object.freeze({
    IMAGE_ASPECT_RATIO_SQUARE: 1,
    IMAGE_ASPECT_RATIO_PORTRAIT: 2,
    IMAGE_ASPECT_RATIO_LANDSCAPE: 3,
    IMAGE_ASPECT_RATIO_3_4: 4,
    IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: 4,
    IMAGE_ASPECT_RATIO_PORTRAIT_FOUR_THREE: 4,
    IMAGE_ASPECT_RATIO_4_3: 5,
    IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: 5,
    '1:1': 1,
    '9:16': 2,
    '16:9': 3,
    '3:4': 4,
    '4:3': 5,
  });

  function clientUuid() {
    const value = root.crypto?.randomUUID?.()
      || 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    return value.toUpperCase();
  }

  function buildEnvelope(rpcid, inner) {
    return JSON.stringify([[[rpcid, JSON.stringify(inner), null, 'generic']]]);
  }

  function context(projectId) {
    return [null, 22, null, null, null, projectId, null, null, null, null, [CAPTCHA_SLOT, 1]];
  }

  function sniffImageMime(imageBase64, declaredMime) {
    const declared = String(declaredMime || '').split(';', 1)[0].trim().toLowerCase();
    if (/^image\/(jpeg|png|webp|gif)$/.test(declared)) return declared;
    const value = String(imageBase64 || '').replace(/\s/g, '');
    if (value.startsWith('/9j/')) return 'image/jpeg';
    if (value.startsWith('iVBORw0KGgo')) return 'image/png';
    if (value.startsWith('UklGR')) return 'image/webp';
    if (value.startsWith('R0lGOD')) return 'image/gif';
    throw new Error('Unsupported image bytes for the current Flow upload API.');
  }

  function flowProjectIdFromUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'https:' || !['flow.google.com', 'labs.google'].includes(parsed.hostname)) return null;
    const pageState = `${parsed.pathname} ${parsed.search} ${parsed.hash}`;
    return pageState.match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] || null;
  }

  function flowProjectStateFromUrl(url, knownProjectId = '') {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    const isFlowHost = parsed.protocol === 'https:' && (
      parsed.hostname === 'flow.google.com'
      || (parsed.hostname === 'labs.google' && /^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(parsed.pathname))
    );
    if (!isFlowHost) return null;
    const fromUrl = flowProjectIdFromUrl(url);
    const projectId = isUsableFlowProjectId(fromUrl)
      ? fromUrl
      : (isUsableFlowProjectId(knownProjectId) ? String(knownProjectId).trim() : null);
    return { ready: Boolean(projectId), projectId };
  }

  function isUsableFlowProjectId(value) {
    const projectId = String(value || '').trim();
    return FLOW_PROJECT_UUID.test(projectId) && projectId.toLowerCase() !== RETIRED_DEFAULT_PROJECT_ID;
  }

  function isImageReadyAccount(account) {
    return account?.connected === true
      && account?.tokenReady === true;
  }

  function projectIdFrom(url, body, linkedProjectId) {
    const fromBody = body?.clientContext?.projectId;
    const fromPath = String(url || '').match(/\/v1\/projects\/([^/]+)\//)?.[1];
    const projectId = [fromBody, fromPath, linkedProjectId]
      .map((value) => String(value || '').trim())
      .find(isUsableFlowProjectId)
      || RETIRED_DEFAULT_PROJECT_ID;
    return projectId;
  }

  function legacyImageRequest(url, body, requestId = '', linkedProjectId = '') {
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.hostname !== 'aisandbox-pa.googleapis.com') return null;

    if (parsed.pathname === '/v1/flow/uploadImage') {
      const encodedInput = String(body?.imageBytes || '');
      const dataMatch = encodedInput.match(/^data:([^;,]+);base64,(.*)$/s);
      const imageBase64 = (dataMatch?.[2] || encodedInput).replace(/\s/g, '');
      if (!imageBase64) throw new Error('Flow image upload has no image bytes.');
      const mimeType = sniffImageMime(imageBase64, dataMatch?.[1]);
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
      const fileName = `autosub-reference-${String(requestId || clientUuid()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}.${extension}`;
      const projectId = projectIdFrom(url, body, linkedProjectId);
      const inner = [
        context(projectId), imageBase64, mimeType, 1, null, null, null, null,
        fileName, null, clientUuid(), clientUuid(),
      ];
      return { kind: 'upload', rpcid: RPC_UPLOAD_IMAGE, freq: buildEnvelope(RPC_UPLOAD_IMAGE, inner), captchaAction: 'IMAGE_GENERATION' };
    }

    if (!/\/v1\/projects\/[^/]+\/flowMedia:batchGenerateImages$/.test(parsed.pathname)) return null;
    const projectId = projectIdFrom(url, body, linkedProjectId);
    const requests = Array.isArray(body?.requests) ? body.requests : [];
    if (!requests.length || requests.length > 4) throw new Error('Flow image generation request must contain 1 to 4 images.');

    const items = requests.map((item) => {
      const prompt = (Array.isArray(item?.structuredPrompt?.parts) ? item.structuredPrompt.parts : [])
        .map((part) => typeof part?.text === 'string' ? part.text : '')
        .join('');
      if (!prompt.trim()) throw new Error('Flow image generation request has no prompt.');
      const inputAspect = String(item?.imageAspectRatio || 'IMAGE_ASPECT_RATIO_SQUARE');
      const aspect = IMAGE_ASPECT[inputAspect];
      if (!aspect) throw new Error(`Unsupported Flow image aspect ratio: ${inputAspect}`);
      const model = String(item?.imageModelName || 'GEM_PIX_2').trim().toUpperCase().replace(/-/g, '_');
      if (!/^[A-Z][A-Z0-9_]{1,95}$/.test(model)) throw new Error('Invalid Flow image model.');
      const imageInputs = Array.isArray(item?.imageInputs)
        ? item.imageInputs.map((input) => String(input?.name || input?.mediaId || '').trim()).filter(Boolean)
          .map((mediaId) => [mediaId, null, null, null, 1])
        : [];
      const seed = Number.isFinite(Number(item?.seed)) ? Number(item.seed) : Math.floor(Date.now() % 1000000);
      return [
        null, null, imageInputs.length ? imageInputs : null, seed, aspect, model,
        null, context(projectId), [[[prompt]]], null, null, null, clientUuid(), clientUuid(),
      ];
    });

    // Flow consumes image CAPTCHA tokens once. Submit each requested image as
    // its own RPC so the caller can obtain a fresh token for every variant.
    const imageRequests = items.map((item) => {
      const inner = [null, [item], 1, context(projectId), [clientUuid()]];
      return {
        kind: 'generate',
        rpcid: RPC_GENERATE_IMAGE,
        freq: buildEnvelope(RPC_GENERATE_IMAGE, inner),
        captchaAction: 'IMAGE_GENERATION',
      };
    });
    if (imageRequests.length === 1) return imageRequests[0];
    return { kind: 'generate-batch', rpcid: RPC_GENERATE_IMAGE, requests: imageRequests, captchaAction: 'IMAGE_GENERATION' };
  }

  function jsonArrayAt(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '[' || char === '{') depth += 1;
      else if (char === ']' || char === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return null;
  }

  function firstPayload(text, expectedRpcId) {
    const source = String(text || '');
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf('[', cursor);
      if (start < 0) break;
      const json = jsonArrayAt(source, start);
      if (!json) break;
      cursor = start + json.length;
      let chunk;
      try { chunk = JSON.parse(json); } catch { continue; }
      for (const entry of Array.isArray(chunk) ? chunk : []) {
        if (!Array.isArray(entry) || entry[0] !== 'wrb.fr' || entry[1] !== expectedRpcId) continue;
        if (entry[2] == null) throw new Error(`Flow RPC ${expectedRpcId} failed: ${JSON.stringify(entry[5] ?? 'unknown error')}`);
        return typeof entry[2] === 'string' ? JSON.parse(entry[2]) : entry[2];
      }
    }
    throw new Error(`Flow response did not contain RPC ${expectedRpcId}.`);
  }

  function walkStrings(node, output = []) {
    if (typeof node === 'string') output.push(node);
    else if (Array.isArray(node)) node.forEach((item) => walkStrings(item, output));
    else if (node && typeof node === 'object') Object.values(node).forEach((item) => walkStrings(item, output));
    return output;
  }

  function legacyResponse(request, rawText) {
    const payload = firstPayload(rawText, request.rpcid);
    if (request.kind === 'upload') {
      const record = Array.isArray(payload) ? payload[0] : null;
      const mediaId = Array.isArray(record) ? record[0] : null;
      if (typeof mediaId !== 'string' || !mediaId) throw new Error('Flow upload response did not contain a media id.');
      return { mediaId, name: mediaId, media: { name: mediaId } };
    }

    const images = [];
    const seen = new Set();
    for (const value of walkStrings(payload)) {
      const matches = value.match(/https?:\/\/flow-content\.google\/image\/[^\s"'\\]+/g) || [];
      for (const imageUrl of matches) {
        const mediaId = imageUrl.split('/image/', 2)[1]?.split(/[?&#]/, 1)[0];
        if (!mediaId || seen.has(mediaId)) continue;
        seen.add(mediaId);
        images.push({ name: mediaId, image: { generatedImage: { mediaId, fifeUrl: imageUrl } } });
      }
    }
    if (!images.length) throw new Error('Flow image response did not contain a generated image URL.');
    return { media: images };
  }

  const api = Object.freeze({ flowProjectIdFromUrl, flowProjectStateFromUrl, isUsableFlowProjectId, isImageReadyAccount, legacyImageRequest, firstPayload, legacyResponse });
  root.FlowBatchCompat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
