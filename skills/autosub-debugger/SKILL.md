---
name: autosub-debugger
description: Use for debugging, fixing, optimizing, or validating AutoSub, including Animation Studio visual and motion regressions. Inspect current code and runtime, preserve accepted behavior and checkpoints, fix the owning layer, and verify the actual failing path rather than relying on compilation or export success.
metadata:
  version: "1.1"
---

# AutoSub Debugger

## Purpose

Make AutoSub debugging focused, evidence-driven, and production-safe. Do not wander into adjacent refactors when the user reports one concrete failure. Do not claim a fix is complete until the failing path has been reproduced or modeled and verified.

## Core operating rule

**Observe -> isolate root cause -> patch the narrowest layer -> regression test -> live verify -> report exact result.**

Never reverse this order.

For Animation Studio generation, character appearance, movement, camera, scene composition, or test-video requests, first read [Animation quality and regression rules](references/animation-quality.md). Apply these rules alongside this workflow; do not replace visual verification with automated test results.

## 1. Start from the user's symptom

Translate the report into one concrete failure statement before touching code.

Examples:

- "9 workers are ready but only 4-6 jobs run" -> scheduler/capacity problem.
- "Flow Agent timed out after Google may have generated the image" -> uncertain-outcome/idempotency problem.
- "Worker lost browser connection" -> transport/bridge problem.
- "Resume went from 48% back to 15%" -> checkpoint/progress monotonicity problem.
- "AI returned malformed JSON" -> provider-output parsing/retry problem.

Do not broaden the task until the direct failure is understood.

## 2. Inspect before editing

For every bug fix:

1. Read current workspace status.
2. Search the exact error string, status code, stage label, or function named in the failure.
3. Read the smallest relevant code ranges.
4. Inspect current runtime state if the failure is live.
5. Check existing tests around that path.
6. Only then edit.

Never guess a function's behavior from its name.

## 3. Distinguish failure classes

### Flow traffic throttling

Examples:
- TOO_MUCH_TRAFFIC
- reCAPTCHA unusual activity
- temporary per-account rate pressure

Rules:
- Treat as account/worker pressure first, not transport failure.
- Cool down only the affected account when isolation is known.
- Keep healthy workers running.
- Reintroduce the cooled worker automatically after cooldown.
- Escalate to pool-wide pause only when evidence shows pool-wide pressure.

### Flow bridge/extension disconnect

Examples:
- extension is not connected
- browser bridge missing
- worker lost browser connection

Rules:
- This is known-not-dispatched unless evidence says otherwise.
- Do **not** restart AutoSub, `npm run dev`, the backend, or the UI from inside an active job.
- A missing isolated Flow worker subprocess may be started/self-healed on its registered port because that does not reset the AutoSub job/UI.
- Mark the affected worker unavailable and fail over to other healthy isolated workers while it recovers.
- Let browser/extension transport reconnect in place; do not kill a healthy worker merely because its browser bridge flapped.
- Never stop the whole video because one worker lost its bridge if alternates exist.

### Unknown generation outcome

Examples:
- timeout after request was sent
- Failed to fetch after dispatch
- "image may still have been generated"

Rules:
- Never blindly submit the same image to another account.
- Reuse the same idempotency key.
- Replay/reconcile on the same worker first.
- Preserve checkpoint while resolving ambiguity.
- Avoid duplicate credit spend and duplicate assets.

### AI JSON/output failure

Rules:
- Treat malformed/truncated provider JSON as recoverable when safe.
- Retry with a smaller/stricter JSON request.
- Keep prior storyboard, TTS, generated assets, and checkpoint.
- Do not restart the whole production pipeline for one malformed reply.

## 4. AutoSub checkpoint/resume invariants

These are non-negotiable:

1. Progress must be monotonic. Resume must never lower displayed progress.
2. Generated assets already persisted in checkpoint must be reused.
3. Resume must schedule only missing work.
4. Existing TTS/audio must be reused when the narration identity is unchanged.
5. A provider/worker retry must not erase the sceneAssets map.
6. A failed job must preserve checkpoint metadata and completed-asset counts.
7. A transient Flow error should auto-recover where safe instead of requiring a manual resume.
8. Never regenerate the whole storyboard merely because image generation failed later.

When touching resume logic, explicitly test at least one checkpoint with partial image completion.

## 5. Flow worker scheduling invariants

- One isolated worker may use at most the configured per-worker lane count.
- Prefer filling lane 1 across all healthy workers before opening lane 2.
- With N healthy workers and 2 lanes each:
  - baseline target: N concurrent jobs,
  - maximum target: 2N concurrent jobs.
- Select least-active healthy workers first.
- Do not let a single throttled/disconnected worker freeze healthy workers.
- Do not claim theoretical capacity is achieved; measure peak active workers/jobs in a live or deterministic test.

## 6. Patch discipline

Prefer the smallest change that fixes the root cause.

Avoid:
- unrelated cleanup,
- renaming broad APIs during a bug fix,
- replacing subsystems because one branch is wrong,
- changing both frontend and backend when only one layer owns the defect,
- adding retries without classifying whether retry is safe.

If a patch changes retry semantics, state whether the operation is:
- known-not-dispatched,
- definitely failed,
- or outcome-unknown.

That classification determines whether failover/retry is safe.

## 7. Test discipline

For instruction-only changes, validate the skill structure, referenced paths, and diff; do not start generation, render videos, or run application suites merely to validate documentation. The steps below apply to application fixes.

For every fix:

1. Add or update a regression test containing the exact failure shape where practical.
2. Run the narrowest relevant tests first.
3. Run the broader subsystem suite.
4. Build the app.
5. If the bug depends on live Flow/runtime state, perform a live smoke/load check.
6. Clean temporary scripts/reports after reading results unless they are intentionally useful tooling.

A fix is not "done" because TypeScript compiles.

## 8. Live verification rules

When AutoSub is running, verify with actual backend endpoints or runtime state instead of inferring from UI screenshots alone.

For Flow-related fixes, check:
- total workers,
- ready workers,
- tokenReady,
- extensionConnected,
- state,
- actual peak concurrency when relevant,
- failed worker identity,
- whether it automatically rejoins.

For production jobs, check:
- job status,
- stage,
- progressPercent,
- progressCurrent/progressTotal,
- updatedAt,
- exact error,
- checkpoint reuse after resume.

## 9. Reporting style

Report only what was actually verified.

Good:
- "9/9 workers are ready; peak active was 9; 18/18 images succeeded."
- "The timeout path now reuses the same idempotency key on the same worker; regression test passed."

Bad:
- "This should probably fix it."
- "The worker is likely connected."
- "18 lanes are available, so 18 must be running."

If something remains unverified, say exactly what remains unverified.

## 10. User constraints for this project

- Respect the existing AutoSub architecture and current user workflow.
- Do not silently introduce extra browser profiles/tabs/workers.
- Preserve user work and unrelated uncommitted changes.
- Never revert unrelated files.
- Prefer direct workspace inspection/edit/test over asking the user to paste code that is already accessible.
- When the user is frustrated by repeated failures, prioritize end-to-end completion and automatic recovery over cosmetic refactoring.

## Definition of done

A bug fix is complete only when:

- the root cause is identified,
- the patch is scoped to that root cause,
- the exact regression path is covered,
- relevant subsystem tests pass,
- build passes,
- live state is healthy when live verification is applicable,
- checkpoint/idempotency safety is preserved,
- and the final report distinguishes verified facts from remaining uncertainty.
