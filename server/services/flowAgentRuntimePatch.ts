import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PATCH_MARKER = 'AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V3';
let runtimePatchInFlight: Promise<FlowAgentRuntimePatchReport> | undefined;

export type FlowAgentRuntimePatchReport = {
  root?: string;
  available: boolean;
  patched: string[];
  alreadyPatched: string[];
  skipped: Array<{ file: string; reason: string }>;
};

function replaceRequired(source: string, before: string, after: string, label: string) {
  if (!source.includes(before)) throw new Error(`Không tìm thấy đoạn runtime cần vá: ${label}`);
  return source.replace(before, after);
}

export function patchFlowGenerationSource(input: string) {
  if (input.includes(`# ${PATCH_MARKER}:generation`)) return input;
  let source = input.replace(/\r\n/g, '\n');
  if (source.includes('# AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:generation')) {
    source = source.replace(
      '    claim = await store.claim(key, _request_payload(req, "image", x_client_id))',
      '    claim = await store.claim(key, _request_payload(req, "image", x_client_id), created=int(time.time()))',
    );
    return source.replaceAll('AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:generation', `${PATCH_MARKER}:generation`);
  }
  source = replaceRequired(
    source,
    '        return await _generate_image(req, x_client_id)',
    '        return await _generate_image(req, x_client_id, None)',
    'image endpoint without idempotency key',
  );
  source = replaceRequired(
    source,
    '        response = await _generate_image(req, x_client_id)',
    '        response = await _generate_image(req, x_client_id, key)',
    'image endpoint idempotent execution',
  );
  source = source.replace(
    '    claim = await store.claim(key, _request_payload(req, "image", x_client_id))',
    '    claim = await store.claim(key, _request_payload(req, "image", x_client_id), created=int(time.time()))',
  );
  source = replaceRequired(
    source,
    'async def _generate_image(req: ImageGenerationRequest, x_client_id: Optional[str] = None):',
    'async def _generate_image(req: ImageGenerationRequest, x_client_id: Optional[str] = None, idempotency_key: Optional[str] = None):',
    'image generator signature',
  );
  source = replaceRequired(
    source,
    `    except HTTPException as exc:
        await store.fail(key, exc.status_code, str(exc.detail))
        raise`,
    `    except HTTPException as exc:
        detail = str(exc.detail)
        # ${PATCH_MARKER}:generation
        # A browser timeout is an UNKNOWN outcome, not a failed generation.
        # Keep the durable key in "processing" so the late extension callback
        # can commit success and a same-key replay can retrieve it.
        if exc.status_code == 400 and "timed out waiting for Google Flow to respond" in detail:
            raise HTTPException(
                status_code=409,
                detail="This idempotent image generation is already processing; retry with the same key.",
            )
        await store.fail(key, exc.status_code, detail)
        raise`,
    'ambiguous timeout idempotency handling',
  );
  source = replaceRequired(
    source,
    `                    seed=(req.seed + seed_offset) % 4294967296 if req.seed is not None else None,
                )`,
    `                    seed=(req.seed + seed_offset) % 4294967296 if req.seed is not None else None,
                    idempotency_key=idempotency_key,
                    response_format=req.response_format,
                )`,
    'generation metadata propagation',
  );
  return source;
}

export function patchFlowT2iSource(input: string) {
  if (input.includes(`# ${PATCH_MARKER}:t2i`)) return input;
  let source = input.replace(/\r\n/g, '\n');
  if (source.includes('# AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:t2i')) {
    return source.replaceAll('AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:t2i', `${PATCH_MARKER}:t2i`);
  }
  source = replaceRequired(
    source,
    `async def generate_image(bridge, prompt: str, aspect: str, project_id: str,
                         count: int = 1, ref_media_ids: list[str] = None,
                         model: str = None, seed: int = None) -> list[dict] | None:`,
    `async def generate_image(bridge, prompt: str, aspect: str, project_id: str,
                         count: int = 1, ref_media_ids: list[str] = None,
                         model: str = None, seed: int = None,
                         idempotency_key: str = None,
                         response_format: str = "b64_json") -> list[dict] | None:`,
    't2i signature',
  );
  source = replaceRequired(
    source,
    `    result = await bridge.api_request(
        endpoint, body, captcha_action="IMAGE_GENERATION",
        meta={"prompt": prompt, "count": count},
    )`,
    `    # ${PATCH_MARKER}:t2i
    result = await bridge.api_request(
        endpoint, body, captcha_action="IMAGE_GENERATION",
        meta={
            "prompt": prompt,
            "count": count,
            "project_id": project_id,
            "idempotency_key": idempotency_key,
            "response_format": response_format,
        },
    )`,
    't2i late-response metadata',
  );
  return source;
}

export function patchFlowStateSource(input: string) {
  if (input.includes(`# ${PATCH_MARKER}:orphan`)) return input;
  let source = input.replace(/\r\n/g, '\n');
  if (source.includes('# AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:orphan')) {
    return source.replaceAll('AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:orphan', `${PATCH_MARKER}:orphan`);
  }
  source = replaceRequired(
    source,
    'from flow_server.config import OUTPUT_DIR, public_url',
    'from flow_server.config import OUTPUT_DIR, public_url\nfrom flow_server.idempotency import get_idempotency_store',
    'state idempotency import',
  );
  source = replaceRequired(
    source,
    `        prompt = meta.get("prompt", "Recovered generation")
        timestamp = int(time.time())
        recovered = 0`,
    `        prompt = meta.get("prompt", "Recovered generation")
        timestamp = int(time.time())

        # ${PATCH_MARKER}:orphan
        # If the HTTP caller timed out but Google later returned the image,
        # commit that late success to the SAME durable idempotency key before
        # doing any optional local download/history work. A retry can then
        # return the original signed URLs immediately instead of regenerating.
        idempotency_key = meta.get("idempotency_key")
        if idempotency_key and meta.get("response_format") == "remote_url":
            client_id = meta.get("client_id", "")
            replay_data = [
                {
                    "url": item["image_url"],
                    "media_id": item.get("media_id"),
                    "client_id": client_id,
                }
                for item in results
            ]
            await get_idempotency_store(OUTPUT_DIR).succeed(
                idempotency_key,
                {"created": timestamp, "data": replay_data},
            )
            log.info(
                "Committed late image response %s to idempotency key",
                data.get("id"),
            )

        recovered = 0`,
    'late orphan idempotency success',
  );
  return source;
}

export function patchFlowBridgeSource(input: string) {
  if (input.includes(`# ${PATCH_MARKER}:callback-ack`)) return input;
  let source = input.replace(/\r\n/g, '\n');

  // Successful on-time responses no longer need orphan metadata. Keeping every
  // completed request in _req_meta caused the bounded map to evict the one slow
  // request that actually needed late-result recovery.
  source = source.replace(
    '    def _remember_request(self, req_id, meta, max_keep=64):',
    '    def _remember_request(self, req_id, meta, max_keep=512):',
  );
  source = source.replace(
    `        if fut is not None:
            if not fut.done():
                self._mark_seen(req_id)
                fut.set_result(data)
            return`,
    `        if fut is not None:
            if not fut.done():
                self._mark_seen(req_id)
                self._req_meta.pop(req_id, None)
                fut.set_result(data)
            return`,
  );

  if (source.includes('# AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:callback-ack')) {
    return source.replaceAll('AUTOSUB_DURABLE_IMAGE_IDEMPOTENCY_V2:callback-ack', `${PATCH_MARKER}:callback-ack`);
  }

  return replaceRequired(
    source,
    `                    bridge.handle_http_callback(body)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')`,
    `                    # ${PATCH_MARKER}:callback-ack
                    # Do not acknowledge an unknown generation result. A 2xx
                    # tells the extension to delete its durable outbox entry.
                    # Returning 409 keeps that result queued until this worker
                    # can reconcile the request id (or acknowledges a duplicate).
                    accepted = bridge.handle_http_callback(body)
                    self.send_response(200 if accepted else 409)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}' if accepted else b'{"ok":false}')`,
    'HTTP callback acknowledgement',
  );
}

function runtimeRoot() {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return localAppData ? path.join(localAppData, 'AutoSub', 'flow-agent-runtime', 'flow-agent') : undefined;
}

async function exists(file: string) {
  try { await access(file); return true; } catch { return false; }
}

export async function ensureFlowAgentRuntimePatched(): Promise<FlowAgentRuntimePatchReport> {
  if (runtimePatchInFlight) return runtimePatchInFlight;
  runtimePatchInFlight = (async () => {
    const root = runtimeRoot();
    const report: FlowAgentRuntimePatchReport = { root, available: false, patched: [], alreadyPatched: [], skipped: [] };
    if (!root || !(await exists(root))) return report;
    report.available = true;

    const variants = ['', path.join('build', 'lib')];
    const specs: Array<{ relative: string; patch: (source: string) => string; marker: string }> = [
      { relative: path.join('flow_server', 'routes', 'generation.py'), patch: patchFlowGenerationSource, marker: `# ${PATCH_MARKER}:generation` },
      { relative: path.join('flow_engine', 'generators', 't2i.py'), patch: patchFlowT2iSource, marker: `# ${PATCH_MARKER}:t2i` },
      { relative: path.join('flow_server', 'state.py'), patch: patchFlowStateSource, marker: `# ${PATCH_MARKER}:orphan` },
      { relative: path.join('flow_engine', 'bridge.py'), patch: patchFlowBridgeSource, marker: `# ${PATCH_MARKER}:callback-ack` },
    ];

    for (const prefix of variants) {
      for (const spec of specs) {
        const file = path.join(root, prefix, spec.relative);
        if (!(await exists(file))) continue;
        try {
          const before = await readFile(file, 'utf8');
          if (before.includes(spec.marker)) {
            report.alreadyPatched.push(file);
            continue;
          }
          const after = spec.patch(before);
          if (after === before) {
            report.alreadyPatched.push(file);
            continue;
          }
          await writeFile(file, after, 'utf8');
          report.patched.push(file);
        } catch (error) {
          report.skipped.push({ file, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    if (report.skipped.length) {
      console.warn('[Flow Agent runtime patch] Một số file không vá được:', report.skipped);
    }
    if (report.patched.length) {
      console.info(`[Flow Agent runtime patch] Đã vá ${report.patched.length} file runtime để giữ late result/idempotency.`);
    }
    return report;
  })().finally(() => { runtimePatchInFlight = undefined; });
  return runtimePatchInFlight;
}
