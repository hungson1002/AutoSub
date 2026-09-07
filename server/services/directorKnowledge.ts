/**
 * Curated, implementation-neutral directing rules used by AutoSub's three video workflows.
 * Sources and licenses are documented in docs/DIRECTOR_KNOWLEDGE_SOURCES.md.
 */

export const filmCraftRules = `
DIRECTOR CRAFT GATE:
- Define desire, obstacle, spatial geometry, gaze and rhythm before choosing shots.
- Every shot must do at least one job: change emotion, advance action or increase pressure. Delete interchangeable coverage.
- Choose framing by information value: wide shots establish geography and relationships, medium shots stage interaction, and close/insert/POV shots reveal emotion or decisive detail. Do not make shot size decorative.
- Build editor-ready coverage rather than a checklist. Adjacent cuts need a meaningful change in size, angle, subject or story information; avoid accidental jump cuts from nearly identical setups.
- Give every shot a concrete environmental pressure, observable physical micro-action, and sound anchor or recurring visual motif.
- Use one dominant camera movement per shot. Name its motivation; otherwise keep the camera locked. Lock a plausible focal length and camera height/angle, and do not change them inside one generated shot.
- Preserve viewer orientation, eye trace, screen direction and the 180-degree line. Cut for emotion and story before cutting merely for speed.
- End every generated unit on an active, explicit visual state that can hand off to the next unit. For continued action, state pose, position, gaze, prop hand and velocity at both sides of the boundary.
- Repeat immutable character identity and reference roles in every independently generated clip; the generator has no memory.
- Write a shot contract before decorative detail: dramatic purpose, opening state, chronological action beats, one motivated camera behavior, environmental response, ending state and editor handoff.
- Maintain a continuity ledger for every recurring character, prop and location. Track entrance side, screen direction, eyeline, pose, prop ownership/hand, wardrobe state, light direction and emotional carry into and out of each unit.
- Treat each generated clip as one editorial shot with one coherent camera setup and no internal cut. Put an insert, reaction, POV or reveal in its own storyboard and clip; never ask a short clip to perform a whole montage.
- State the one keeper that a successful take cannot lose and a shot-specific avoid list. Generic quality adjectives are not keepers.
- Name the editorial motivation for leaving each shot: action, eyeline, sound, reveal, graphic relation, emotion or a deliberate scene change. Preserve room tone or a designed sound bridge across the boundary when it supports continuity.
- Before returning JSON, silently audit each scene against every rule above and repair failures.`;

export const productAdCraftRules = `
PRODUCT MOTION CRAFT GATE:
- Map each verified selling point to a distinct shot function: problem reveal, tactile macro, interaction demo, feature breakdown, lifestyle proof, objection answer or hero resolve.
- One primary visual idea per shot. Do not reuse the same animation, centered composition or zoom treatment as the hero of consecutive shots.
- Derive motion character from the selected brand mode: premium uses longer controlled easing and minimal overshoot; everyday/UGC uses quicker natural camera-height movement; direct response uses short readable beats and decisive cuts.
- Budget readable holds after key information. Movement must settle before the viewer is asked to read or act.
- If a reference image is supplied, product geometry, materials, color, controls and branding are immutable; motion reveals the product rather than redesigning it.
- Build an energy curve with contrast: hook, development, brief breathing beat, strongest proof/payoff, then CTA. Do not fill every second with equal intensity.
- Before returning JSON, silently reject any scene that only paraphrases a feature without a filmable product action.`;

export const animationCraftRules = `
ANIMATION CRAFT GATE:
- Stage one primary action at a time and use secondary motion only to support it.
- Use anticipation before important movement and follow-through after it; avoid mechanical start/stop motion.
- Entrances normally use ease-out for 0.3–0.5s, exits ease-in for 0.2–0.3s, and in-place changes ease-in-out for 0.3–0.8s.
- Use arcs for organic movement, straight paths for diagrams/data, and small staggered delays for grouped elements.
- Every segment needs a visual state change every 2–4 seconds: character action, cutaway, process step, diagram transformation, comparison, camera reveal or kinetic type—not another slow zoom of the same image.
- Preserve simple readable silhouettes, safe margins and sufficient holds for text. Clarity beats decorative complexity.
- Recurring characters, objects and locations keep the same design tokens and spatial relationships across scenes.
- Before returning JSON, silently audit for static slides, repeated zooms and competing actions and replace them.`;
