# Animation Studio: preserve accepted results and prove visual changes

Use this reference for Animation Studio code changes, reviews, and tool-generated test videos. It addresses repeated regressions where exports and tests passed but the accepted character design, movement, or framing became worse.

## Establish the current target before editing

- Read the latest user request and corrections together. A new request changes the requested feature; it does not discard previously accepted behavior.
- Identify the most recent actually accepted image/video and its corresponding code/checkpoint when available. Do not label a recent or successfully rendered artifact as user-accepted without evidence.
- If the user supplies a reference video, inspect relevant segments and their motion before claiming to understand or match them. Record useful timestamps and observable behavior, such as facing direction, travel speed, holds, turns, camera cuts, and crowd actions. A contact sheet proves appearance, not motion. If the reference is unavailable, state that limitation rather than inventing an analysis.
- Briefly state the concrete defect, the one behavior to change, and the existing features to preserve. Use these as acceptance criteria; do not replace the user's visual target with whichever output is easiest to generate.
- If the task is only a review, explanation, or instruction update, do not edit application code. A prior request to stop remains in force for that work until the user authorizes resuming it.

## Make the change reversible and narrow

- Inspect `git status` and the current diff. Treat existing uncommitted changes as user-owned unless their origin is known.
- Before touching application files, save exact current contents of the files to be edited and the current diff in an ignored, uniquely named local checkpoint. Record which later hunks are yours. A diff against HEAD alone is insufficient when user edits already exist.
- Fix one observed defect at its owning layer. Do not redesign characters, change the style, replace the renderer, or change model/provider configuration while fixing motion unless evidence establishes that dependency. Explain a necessary scope change before proceeding.
- Preserve approved assets and checkpoints. Do not regenerate unrelated work to obtain a convenient clean starting point.
- If a change regresses the baseline, repair or undo only your own hunks before extending the work. Never use a blanket reset/checkout to undo files containing mixed ownership. If concurrent edits prevent an exact safe reversal, preserve both versions and report the conflict.

## Preserve this project's accepted visual direction

These are continuity requirements from prior user feedback, not a mandate to redesign every scene. Later explicit user instructions take precedence.

| Area | Preserve and check when affected |
| --- | --- |
| People | The accepted clothed cutout silhouette, proportions, hair, costumes, strong outer outlines, small pupil dots, and established facing. Do not silently revert everyone to a symmetrical front-facing pose. |
| Hands | Large round dot hands appear only when an action requires them; show one when only one is needed. Props attach to the actual grip point. Maintain correct occlusion for front/back views and horizontal mirroring. Do not reintroduce arm/leg rigs or side-on body rotation that the user removed. |
| Movement | Travel, turning, reactions, fear/trembling, and idle actions must follow intent. Match reference pacing rather than imposing one slow speed everywhere. Continuous activity does not mean random jitter or constant drifting. |
| Continuity | Across cues in the same scene, retain props, character identity, facing, world positions, and the previous action's end pose unless an explicit action changes them. A close shot uses the same scene state. |
| Composition | Keep wide frontal, eye-level 2D staging with small people where appropriate. Furniture, counters, steps and stones show their front silhouettes and narrow edges, not broad top planes. Depth comes from overlap and near/far size; do not reintroduce an overhead or isometric view. Use purposeful closer shots when needed; do not enlarge every character or default to continuous camera zoom. |
| Crowds | Give visible background people varied purposeful travel or actions. Do not move all extras in sync or leave every extra frozen throughout the shot. |
| Animals | Correct species silhouette, visible eyes/hooves where relevant, sensible joint direction, and far limbs behind the body. Shared animal changes must not fix one species while breaking another. |
| Lighting/audio | Dark atmosphere must retain readable people, props, and scenery. Lamps must remain visibly held and light their surroundings. Narration, background sound, and effects need listening checks; track existence alone does not prove audibility. |

## Prove the tool produces the result

- Exercise the normal UI/connector generation path. The same production backend endpoints are acceptable when the connector is unavailable, but disclose the fallback. Trace generated plans through assembly to rendering when locating a defect; a good prompt alone does not prove later layers preserve it.
- Do not substitute a manually authored screenplay, injected scene JSON, edited output video, or a separate demo renderer for proof of automatic generation. Deterministic fixtures can isolate a bug, but label them as fixtures and validate the production path separately.
- Save enough evidence to identify the run: request, route, project/job ID, generated project/checkpoint, and exact output path. Never relabel an older file as the new test or link to a deleted/nonexistent file.
- Run only one generation/export at a time. Inspect any existing job before launching another. Do not edit watched application source or restart the backend during an active job; finish or cancel and confirm its state first.
- If generation fails, inspect the exact stage/error and saved output before retrying. Preserve completed assets and reconcile outcome-unknown requests. Do not repeatedly switch models or restart the pipeline without evidence; report a blocker when the next attempt would simply repeat the same failure.

## Visual acceptance before a long export

1. Use the smallest useful preview, usually 5-10 seconds, that contains the reported failure. Include a cue boundary for continuity bugs and the full action for motion bugs. Reuse the current generated project where it can demonstrate the change; do not rerun AI/TTS unnecessarily.
2. Compare baseline and candidate at matching scene times and framing. Play the entire short clip, inspect critical frames, and listen when timing/audio is affected. Check the defect plus the relevant preserved features above. Static screenshots cannot establish smooth motion.
3. Run a focused regression test where practical, then the required relevant suite/build for application changes. Structural tests should assert meaningful invariants, such as prop retention or facing across cues, rather than merely matching prompt text.
4. Once the short result passes, complete the user's requested longer tool-generated video without asking again for permission already granted. Inspect its scene transitions and representative actions before delivery. Do not keep rendering longer versions of a visibly failed short result.

If rendered playback cannot be inspected, report the visual result as unverified. Automated tests, renderer completion, decode checks, and model self-review are separate evidence; none alone establishes reference likeness or good animation.

## Report evidence without overstating it

State what changed, which actual tool run was inspected, what passed visually, and what remains wrong or unverified. A failed visual check remains a failed acceptance check even if all tests pass. Do not claim parity with a reference unless the inspected behavior supports it. Do not keep widening the patch to hide an unresolved failure.
