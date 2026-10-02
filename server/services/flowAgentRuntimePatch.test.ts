import assert from 'node:assert/strict';
import test from 'node:test';
import {
  patchFlowBridgeSource,
  patchFlowGenerationSource,
  patchFlowStateSource,
  patchFlowT2iSource,
} from './flowAgentRuntimePatch';

test('Flow Agent runtime patch leaves ambiguous image timeout processing instead of caching failure', () => {
  const source = `
async def openai_generate_image(req, x_client_id=None, idempotency_key=None):
    if not idempotency_key:
        return await _generate_image(req, x_client_id)
    key = idempotency_key
    claim = await store.claim(key, _request_payload(req, "image", x_client_id))
    try:
        response = await _generate_image(req, x_client_id)
    except HTTPException as exc:
        await store.fail(key, exc.status_code, str(exc.detail))
        raise
    return response

async def _generate_image(req: ImageGenerationRequest, x_client_id: Optional[str] = None):
    tasks.append(
        generate_image(
            active_bridge,
            prompt=req.prompt,
            aspect=aspect,
            project_id=project_id,
            count=chunk_size,
            ref_media_ids=ref_media_ids,
            model=req.model,
                    seed=(req.seed + seed_offset) % 4294967296 if req.seed is not None else None,
                )
    )
`;
  const patched = patchFlowGenerationSource(source);
  assert.match(patched, /already processing; retry with the same key/);
  assert.match(patched, /_generate_image\(req, x_client_id, key\)/);
  assert.match(patched, /idempotency_key=idempotency_key/);
  assert.match(patched, /created=int\(time\.time\(\)\)/);
  assert.equal(patchFlowGenerationSource(patched), patched);
});

test('Flow Agent t2i patch carries durable request identity into late-response metadata', () => {
  const source = `
async def generate_image(bridge, prompt: str, aspect: str, project_id: str,
                         count: int = 1, ref_media_ids: list[str] = None,
                         model: str = None, seed: int = None) -> list[dict] | None:
    result = await bridge.api_request(
        endpoint, body, captcha_action="IMAGE_GENERATION",
        meta={"prompt": prompt, "count": count},
    )
`;
  const patched = patchFlowT2iSource(source);
  assert.match(patched, /idempotency_key: str = None/);
  assert.match(patched, /"idempotency_key": idempotency_key/);
  assert.match(patched, /"response_format": response_format/);
});

test('Flow Agent orphan patch commits late remote-url results to idempotency storage', () => {
  const source = `
from flow_server.config import OUTPUT_DIR, public_url
        prompt = meta.get("prompt", "Recovered generation")
        timestamp = int(time.time())
        recovered = 0
`;
  const patched = patchFlowStateSource(source);
  assert.match(patched, /get_idempotency_store/);
  assert.match(patched, /\.succeed\(/);
  assert.match(patched, /meta\.get\("idempotency_key"\)/);
});

test('Flow Agent callback patch refuses unknown results and preserves only late-request metadata', () => {
  const source = `
    def _remember_request(self, req_id, meta, max_keep=64):
        self._req_meta[req_id] = meta

        if fut is not None:
            if not fut.done():
                self._mark_seen(req_id)
                fut.set_result(data)
            return

                    bridge.handle_http_callback(body)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
`;
  const patched = patchFlowBridgeSource(source);
  assert.match(patched, /accepted = bridge\.handle_http_callback/);
  assert.match(patched, /200 if accepted else 409/);
  assert.match(patched, /max_keep=512/);
  assert.match(patched, /self\._req_meta\.pop\(req_id, None\)/);
});
