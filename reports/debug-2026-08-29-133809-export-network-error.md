# Export video: transient local API failure

## Classification

API/runtime failure before FFmpeg render starts.

## Evidence

- The UI toast is produced by `friendlyErrorMessage` for a failed fetch, timeout, connection error, or HTTP 5xx.
- `ExportModal.exportVideo` requests dubbing timeline metadata before it enters the render `try` block and before progress UI starts.
- The local backend is currently listening on `127.0.0.1:8787` (PID 13936).
- `GET http://127.0.0.1:8787/api/health` currently returns `200 {"ok":true}`.
- The Vite proxy is currently healthy: `GET http://localhost:5173/api/health` and `GET http://[::1]:5173/api/health` both return 200.

## Hypotheses checked

1. Backend is permanently stopped: falsified; health endpoint responds now.
2. Vite `/api` proxy is misconfigured: falsified; proxied health endpoint responds now.
3. A transient backend/proxy interruption occurred during the metadata preflight: consistent with the screenshot and current recovery; most likely.

## Root cause

The completed 117-minute dubbing job contains 2,086 cues. Its retimed audio/video filter graph exceeded the Windows process command-line limit, so Node failed to start FFmpeg with `spawn ENAMETOOLONG`. The generic error formatter incorrectly presented that HTTP 500 as an AI provider/network outage.

## Current verification

The long filter graph is now written to a temporary FFmpeg script and loaded with FFmpeg 9's `-/filter_complex` syntax. Replaying the exact failed audio-export request now starts FFmpeg and continues processing beyond five seconds instead of returning an immediate 500. The diagnostic FFmpeg process was then stopped, and the local health endpoint still returns 200. TypeScript and the six focused timing/audio tests pass.

## Remaining risk

Long-form retimed output is computationally expensive and may still take substantial time, but it no longer fails at process startup because of command length. The generic local-server error wording remains a separate UI improvement.
