# AGENTS.md — AutoSub

## Primary coding-agent rule

For debugging, fixing, optimizing, or validating AutoSub, read and follow:

`skills/autosub-debugger/SKILL.md`

This project values **root-cause fixes, checkpoint safety, idempotency, live verification, and minimal changes** over broad refactors.

## Animation Studio visual and motion changes

Before changing Animation Studio generation, characters, movement, cameras, or scene composition, also read:

`skills/autosub-debugger/references/animation-quality.md`

Preserve the latest user-accepted appearance and behavior. Validate changes through the actual tool generation path and inspect rendered motion; passing tests or a successful export alone cannot establish visual quality. This also applies when reviewing user edits or creating a test video.

## Non-negotiable workflow

1. Inspect the current workspace and runtime before editing.
2. Search the exact error or failing path.
3. Patch the smallest owning layer.
4. Preserve existing assets/checkpoints and unrelated user changes.
5. Add a regression test for the exact failure shape when practical.
6. Run focused tests, then the relevant subsystem suite, then build.
7. For Flow/runtime bugs, verify live worker/job state before declaring success.
8. Never claim a bug is fixed only because code compiles.

## AutoSub reliability invariants

- Resume progress must never move backward.
- Resume must reuse already-generated assets and only schedule missing work.
- Unknown Flow generation outcomes must preserve idempotency and avoid duplicate generation.
- One bad Flow worker must not stop healthy workers when safe failover exists.
- Never restart AutoSub, `npm run dev`, the backend, or the UI from inside an active job. Isolated Flow worker subprocesses may be started/self-healed on their registered ports because that must not reset the current job.
- Traffic throttling, bridge disconnect, and unknown outcome are different failure classes and must not share blind retry behavior.
- Do not introduce extra browser profiles/tabs unless the user explicitly requests an architecture change.
