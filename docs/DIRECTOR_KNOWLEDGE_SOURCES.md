# Director knowledge sources

AutoSub uses implementation-neutral filmmaking principles derived from the sources below. No source code is copied into the application.

| Source | Principle applied in AutoSub |
| --- | --- |
| [FilmAgent](https://github.com/HSwotch/FilmAgent) | Separate development, script/cinematography and verification; run a critique-correct pass before generation. |
| [FilmAgent paper](https://arxiv.org/abs/2501.12909) | Plan actor actions and camera setups as explicit production decisions, then use collaborative feedback to verify intermediate work. |
| [StoryMind](https://github.com/LinHao-city/StoryMind) | Plan shot scale, camera behavior, light and character anchors before generating video. |
| [visual-skills](https://github.com/smixs/visual-skills) | Apply dramaturgy, shot function, blocking, lens choice and editing grammar before writing a model prompt. |
| [MovieAgent](https://github.com/showlab/MovieAgent) | Separate story, directing, cinematography and location decisions so a short idea becomes an executable shot plan. |
| [VideoClaw](https://github.com/HITsz-TMG/VideoClaw) | Treat AI filmmaking as an orchestrated multi-stage pipeline instead of a single prompt-to-video call. |
| [Adobe shot-list guide](https://www.adobe.com/creativecloud/video/discover/shot-list.html) | Store shot type, camera angle, camera movement, scene description and audio notes as scannable production metadata. |
| [Adobe camera-shot guide](https://www.adobe.com/cis_en/creativecloud/video/discover/types-of-shots-in-films.html) | Select shot size and focal length for the information and emotion the image must communicate. |
| [Adobe 180-degree rule](https://www.adobe.com/creativecloud/video/discover/what-is-the-180-degree-rule.html) | Preserve spatial orientation and screen direction unless crossing the axis is an intentional story choice. |
| [BBC Five Essential Shots](https://downloads.bbc.co.uk/academy/collegeofproduction/docs/five_essential_shots_ts.pdf) | Make adjacent coverage differ meaningfully in size and angle, and avoid crossing the line. |
| [Character Continuity](https://github.com/Nagacash/character-continuity-skill) | Approve a canon character sheet, keep an immutable identity block, and track wardrobe, props, gaze and screen direction per shot. |
| [AI Video Pipeline](https://github.com/0xadvait/ai-video-pipeline) | Create reviewable storyboard frames first, condition video shots on approved images, and keep an auditable shot-to-output chain. |
| [AI Cinematic Pipeline](https://github.com/billpar/ai-cinematic-pipeline) | Keep immutable visual-bible fields separate from mutable shot action, and chain start/end frames instead of asking one prompt to solve the whole film. |
| [Soemind Forge](https://github.com/minkhant1996/soemind-forge) | Use a preflight/review/generate/QA gate, keyframe-first planning, and explicit FFmpeg assembly rather than blind one-click generation. |
| [AI Story To Movie](https://github.com/SDSmirnov/AI-Story-To-Movie) | Treat storyboard start/end frames as production controls and make each shot independently reviewable. |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor) | Treat motionless/dead sections as editorial defects instead of accepting every generated second. |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | Inspect black/frozen frames and normalize the final audio master during composition. |

## AutoSub quality contract

- The user may start from a short story idea; the director pass expands it into a causal story spine and shot contracts.
- Every recurring visible character receives a separate reviewable character bible entry and reference sheet.
- New productions are planned as individual editorial shots, normally about four seconds each. Every shot owns its storyboard frame and provider video clip; reactions, inserts and POVs are separate shots rather than internal cuts hidden inside one eight-second generation.
- Every generated shot specifies dramatic purpose, shot size, focal length, camera height/angle, one motivated camera behavior, visible character names, timed action, blocking, continuity in/out, keeper and editor handoff. The contract is provider-neutral; a video adapter translates it to the selected renderer.
- A pre-credit craft gate rejects missing camera contracts, unknown character names, contradictory continuation setups and accidental cuts between effectively identical compositions.
- The final scene must pay off or meaningfully transform the original objective.
- Generated clips must begin with live motion and must not contain black frames, long frozen holds, subtitles, logos or watermarks.
- Provider clips are not silently regenerated after a charged quality failure. The job stops on the failed shot, retains the last candidate for preview/download, and lets the user explicitly promote it before composition. Only transport failures that explicitly confirm no charge may be retried automatically.
- The master must contain picture and sound, meet the requested duration tolerance, pass visual defect checks, and receive loudness normalization plus peak limiting.

These rules reduce failure rates; they cannot guarantee frame-identical identity or perfect physics from a generative video model.

## Renderer boundary

The production bible, character routing, storyboard review, shot prompt and continuity chain now run through a provider-neutral `FilmVideoAdapter` boundary (`server/services/filmVideoAdapter.ts`). Google Flow/Veo is the built-in adapter and remains unchanged for existing jobs. Other renderers should register an adapter with their own authenticated generation/polling implementation and optional prompt compiler; they must accept the same shot contract, start/reference-frame set, aspect ratio and cancellation signal instead of adding provider-specific logic to the director.
