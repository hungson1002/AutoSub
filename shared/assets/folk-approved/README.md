# Approved folk character

`character.svg` is the user-accepted round-head SVG from 2026-10-13.
`character-neutral.svg` is its accepted idle expression. Keep both originals.

`character.json` imports that drawing onto the existing 180 × 280 cutout rig.
Rebuild deterministically from the checked-in source with:

```powershell
node scripts/import-approved-folk-character.cjs
```

Runtime factory: `shared/canvasVectorApprovedArt.ts`. New folk-horror characters
use this model sheet through `lockFolkInkAsset` and `vectorPuppetRig`; AI selects
bounded appearance descriptors and actions. It does not draw replacement people.
Saved expanded artwork is retained. The source bucket is a reference accessory,
not baked into every actor: runtime story props use the existing grip contacts.

The filled paths already contain variable-width ink. Do not run the generic ink
bender or night-paint lift over them. Source likeness, head position, grip contact,
turns and eye stability are checked in `src/remotion/VectorSceneFrame.approved.test.tsx`.

`woman/` is the separate adult woman SVG study from the reference frame at 04:06.
It supplies its own rounded face, lashed eyes, top bun, blouse and dark skirt;
female characters do not reuse the man's jaw or costume. The source and the
production renderer are compared at the same scale in the same test file.
Rebuild this source and its native import with:

```powershell
node scripts/build-reference-folk-woman.cjs tmp/character-svg-study/woman
node scripts/import-approved-folk-character.cjs tmp/character-svg-study/woman/character.svg shared/assets/folk-approved/woman
```

Both previews and new tool characters consume the same SVG source. Existing
expanded characters retain their saved artwork; neither original male SVG is
overwritten by this study.
