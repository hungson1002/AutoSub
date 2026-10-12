import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {puppetHandOpacity} from '../../shared/canvasVectorPuppet';
import {chat} from '../adapters/openaiCompatible';
import {workdir} from './ffmpeg';
import {prepareCanvasProjectAudio} from './canvasAudioProduction';
import {shortenCanvasScript} from './canvasDurationPlanning';
import {renderCanvasPreviewFrames} from './canvasFastRender';
import {resolveBrowserExecutable} from './animationBrowser';
import {animationRenderSourceSignature} from './animationRenderSource';
import {defaultVectorStyleReferences,vectorStyleReferenceContent} from './canvasVectorStyle';
import {expandVectorStageLibrary,vectorStageLibrarySignature} from './canvasVectorStageLibrary';
import {normalizeCanvasSoundCues} from '../../shared/canvasSoundDesign';
import type {CanvasAnimationGenerateInput} from './canvasAnimationDirector';
import type {CanvasStudioProject,CanvasStudioScene} from '../../shared/canvasAnimationStudio';
import {compileVectorProject,normalizeVectorAssets,normalizeVectorDrawing,normalizeVectorScene,evaluateVectorPart,vectorTrackTiming,vectorTargets,frameVectorScene,type VectorTrack,type CanvasVectorScene} from '../../shared/canvasVectorScene';
import {vectorEnsembleCoverage} from '../../shared/canvasVectorEnsemble';
import {vectorPropGrip,vectorLightActionTargets,vectorIsReleaseAction} from '../../shared/canvasVectorProps';
import {vectorWorldMatrix,vectorPoint} from '../../shared/canvasVectorTransform';
import {vectorSubjectCamera,vectorShotVisibility} from '../../shared/canvasVectorFraming';
import {VECTOR_STORY_CONTRACT,normalizeVectorStory,assertVectorStoryFilm,vectorDirectionIssues,type VectorStory} from './canvasVectorStory';

const PHYSICAL_ACTIONS=`NATIVE PHYSICAL ACTIONS (required for new ground-based locations): author your own setting, then use these exact JSON fields. Each example is a JSON object; merge its keys into the appropriate stage/scene. Never put multiple keys or numbers inside a quoted key. Never invent narrated actions.
LOCKED TURN PLAN: when a screenplay beat has turn:{actor,from,to}, the compiler performs that exact whole-body pose change at its cue in 300ms and retains the result. Do not reinterpret it as a head look, left/right mirror, or handwritten face-opacity patch. Preserve these planned poses through camera cuts and repairs. You still author the setting and other motivated actions.
COMPACT ASSET ENUMS: simple-puppet hair is short/side-part/bun/long/tied/none/braid/double-bun/cropped/wavy/bob; outfit is robe/tunic/ao-dai/vest/shawl; headwear is none/headscarf/conical/headwrap; facialHair is none/moustache/beard. design:village also supports glasses:true. Do not invent topknot or other enum values. Custom SVG artwork remains supported for a different design.
APPROVED VILLAGE CAST: NEW compact village/horror people use design:"village", finish:"handdrawn", age:"child"|"adult"|"elder" and gender:"male"|"female"|"neutral". Set age and gender explicitly from each screenplay role, never infer them from hairstyle. This native design supplies a rounded THREE-QUARTER face, small outlined white eyes with TINY centered black dot pupils, bold near-black outer contours, shaped two-tone hair and tailored adult clothing silhouettes. Native expression is neutral by default; expression may be neutral, soft, worried or surprised. Use soft for a relaxed friendly moment, worried for concern and surprised for discovery; never force a smile through horror. Native fear/startle opens the mouth and fear restores the selected resting expression. Native front/right faces RIGHT: face, visible ear, hair and clothing share that direction; native turns to left mirror the whole cutout. Face partners and action targets instead of making everyone stare at the viewer; never redraw a symmetric frontal face or shift pupils off-center to fake the three-quarter view. Adults have a clothed body about as tall as their head; children have shorter bodies and a smaller visible silhouette on the SAME ground anchor. Only adult/elder women have a modest outward upper-chest contour and inward waist; children always have straight child bodies. No visible arms, legs or idle hands. The same round dot hand appears only for an actual action/held prop. Use palette.skirt for a woman's lower garment. Distinguish cast through age, faceShape, hairstyle, headwear and clothing, not merely colors. Never replace this approved design with a squat baby body, oversized glossy pupils or elaborate ornamental hair. Existing expanded cast artwork is immutable during resume/refinement.
VILLAGE MOUTH PERFORMANCE: new native village people omit the mouth while idle or silently listening. The renderer shows it for their own timed dialogue, respects measured speech pauses, and retains intentional worried/surprised/fear expressions. Bind dialogue.characterKey to the actor instance ID, or set that instance's characterKey to the same stable key. Offscreen narration must not be assigned to on-screen listeners or crowds. Do not add perpetual mouth animation to everyone; choose an expression for the actual dramatic moment.
ELEVATED VILLAGE PRODUCTION: when the locked screenplay uses person in a village requested from above, prefer the complete illustrated-place village scaffold with view:"elevated", finish:"handdrawn" and the user's custom cast binding. Keep supporting people in extras with their screenplay IDs. Add only story-specific objects to that shared world. A sparse side-on house and flat brown floor cannot meet an elevated-village brief. Use a custom world when the user's actual setting requires one.
PUPPET REACTIONS: on a screenplay motion beat, root dx/dy keys starting at zero are reaction displacements relative to the held root position; the engine preserves that delta when joining poses. Absolute destination movement belongs to a travel beat. Do not turn a short recoil into a walk across another actor. NATIVE DOOR HARDWARE: folk-courtyard ring is a child of its moving door and stays on the leaf. Both native doors reveal a dark aperture when opened. folk-room latch starts retracted at dx=0; lock with dx=48, unlock with dx=0. Its guide brackets stay fixed to the door. Explicitly hold the retracted state in earlier interior cuts until the narrated lock event. Keep a newly entered room's door ajar until its closing event, and show actual threshold crossing before cutting inside. Do not replace an entrance with a fade in front of a closed door.
HAND GRIPS: put carried objects in the reusable stage with carries:[{"actor":"person","arm":"r","prop":"lamp","grip":{"x":30,"y":6},"hang":true}]. The prop is an existing instance; grip is the point IN ITS ASSET that the fingers hold. For the native 60x100 lantern use (30,6), on the top handle. For a knife use the middle of its HANDLE, never the blade or elbow. For a bucket use the handle grip. The compiler welds that exact point to hand-r/hand-l and clears obsolete independent travel. Never place a carried prop with world x/y, attach it to arm/forearm, or move it independently from its holding hand. Keep this attachment in every cut while held; changing location does not release it. Put down/drop/release must be a separate explicit action with support/contact. A hung lantern stays upright about its grip; rigid tools rotate about their grip. Use native reaches to raise the holding hand. Each hand holds at most one prop.
SCENERY SELECTION AND COMPOSITION: prefer the native illustrated-place scaffold for village, forest, waterside, street, corridor or rural-interior locations instead of hand-drawing a bare sky and ground. For a village establishing view use view:"elevated", finish:"handdrawn" and a stable seed. Choose eye-level only for a deliberate ground-level action view, never simply because a market has many people. Native handdrawn markets default to an elevated public square with rear buildings, side stalls and foreground framing. Declare extras with id and asset only to use the native spread across depths; optional x, footY and height override those defaults. Keep distant people smaller than foreground people, with paths and empty space between small groups, not one row or a wall of heads. A wide is normally people around 7-18 percent of frame height. The native market supplies market-square, market-stall, market-stall-right, market-thatch-stall and market-sign; animate these IDs instead of redrawing the same architecture. For an interactive house door/knocker use folk-courtyard, for its interior use folk-room; other locations still need their own matching original environment. Choose the smallest supported set that matches the actual action, never force a prefab into an unrelated setting. Add only needed story props or cast with stable IDs; let native scenery provide distant planes, recognizable architecture, near foliage and a coherent palette. Simple well-composed shapes are enough: avoid rows of tiny scratches or floating decorative symbols. Keep the walking/contact corridor free, and allow foreground vegetation to frame the sides instead of covering faces or clues. A wide has small people within the landscape; a close shot crops the SAME stable world. Never move scenery or enlarge individual actors to simulate a camera cut. Preserve explicit user-approved art and stage geometry when refining an existing project.
RAISED VILLAGE LAMP: a native village cutout holds a hanging lantern with the hand near shoulder height and the flame in front of the upper torso by default. Do not leave the lantern dangling at the hem while walking or reacting. A narrated downward inspection can temporarily lower it using reaches; it returns to the raised carry afterward. Only hold:true or an explicit withdraw:false should keep a deliberately lowered pose. Keep one occupied dot hand and the handle attached throughout; do not add an arm or a second hand.
JOINTS AND FLUIDITY: simple-human projected elbows allow -145..145; both knees 0..145. Use native reaches to choose the physically natural branch with the elbow below its shoulder, rather than hard-coding a left/right angle sign. Ordinary carrying uses at most 120 degrees of elbow flexion; never fold the elbow up into the neck to keep a lamp near the face. Lift at the shoulder/hip and bend at the existing elbow/knee; never mirror a joint just because the character backs away. Use native reaches/walks instead of guessed angles. Smooth interpolation continues through intermediate keys; do not put ease-in-out on every key, reset to zero between gestures, or use hold easing for a moving body. Explicit holds are for intentional pauses only. Fixed camera cuts may be immediate while hand/prop poses remain continuous. An empty inventory never releases existing props: preserve the same hand and stage geometry through a detail cut. Keep each holding arm on its own side of the torso with connected shoulder/elbow joints; only a deliberately narrated reach may cross the body. Never reset an unmentioned arm to a default angle at a cut.
PIG ANATOMY: vectorAssets:{"pig-body":{"rig":"simple-pig","toes":5,"facing":"right","palette":{"skin":"#9c8977"}}}. Reuse it as a scene instance pig; width 360, height 240, ground contact at local (180,214). It has profile, body, head-group, eyes, ear, snout, tail, leg/knee/hoof-fl/fr/hl/hr and toe-fl-1..toe-fl-5 (five digits on each hoof when toes:5). Keep black contours, a body fill visibly brighter than the night background, and simple black dot eyes like the human characters. Use open outer limb contours with no crossbars at elbows/knees. Keep the head-neck and ear outlines visible; leave out the decorative smiling mouth; do not use an unoutlined neck patch to cover the torso contour. Hoof tips need contrasting fill and separated digits, not dark sock-like bands; Keep its horizontal torso, short neck and recognisable snout; do not substitute an upright humanoid. facing may be left or right, fixed per reusable view. Native walks also support this rig: {"walks":[{"actor":"pig","to":"gate","gap":70,"start":0,"end":0.6,"cue":"exact walking phrase"}]}; both pig and destination need ground targets. It plants four hooves using joint IK and keeps head/ears/tail following the stride; do not write duplicate root/leg/knee/hoof channels. A short walk is at most 220 ASSET pixels; split longer travel into cuts. A detail shot of five toes must use a tight FIXED camera on the same physical hoof, with readable digit separation; do not draw another animal or invent extra paws. For a fixed part detail use shot:{"target":"pig/hoof-fl","bounds":{"x":-15,"y":-12,"width":30,"height":12}}. The engine finds this actual animated part and frames its local bounds without moving or replacing the animal. Keep the five toe fills contrasting with the support. Do not hide the actual fifth digit in a wide composition. Use sound preset pig-grunt only with a visible grunt/sniff action; describe it as stylised Foley, not a real animal recording.
ROWING: {"rows":[{"actor":"old","arm":"r","prop":"old/oar","cycles":2,"start":0,"end":0.9,"cue":"exact rowing phrase"}]}. Engine drives continuous shoulder/elbow strokes with torso effort and delayed head/cloth follow-through, keeping oar on its hand chain and feet planted. Do not duplicate controlled arm, forearm, upper-body, head-group or tunic-hem channels. Use only while narration calls for rowing; choose a shot that includes the oar blade and water. Omit cue for an action already in progress at shot opening, so narration cannot truncate its final stroke.
STRIKING: {"strikes":[{"actor":"old","arm":"l","target":"bell","start":0,"end":0.5,"cue":"exact striking phrase"}]}. Engine prepares the strike, solves actual hand-to-object contact, withdraws the hand and settles the struck object with delayed torso/head/cloth response. Optional point is LOCAL to the target asset. Actor and fixed prop must be within arm reach. Do not duplicate controlled arm/forearm, upper-body, head-group, tunic-hem or bell rotation tracks. The struck object and hand need to remain in frame. For boat interaction shots use shot:{target:"old",height:0.45,include:["lam","bell"]}; include now fits required partners and props too.
DECK RETREAT: on an existing boat, {"walks":[{"actor":"lam","to":"old","backstep":35,"start":0,"end":0.35,"cue":"exact retreat phrase"}]} supports a short planted retreat away from another human on the SAME deck parent. It reuses existing support geometry; do not add a land ground or erase the boat. A retreat includes defensive chest-level hand acting, backward torso lean and head/cloth follow-through; do not add walking arm swings or overwrite these channels. Declare carry:"l" or "r" for an occupied hand. In a later cut retain the COMPLETE end pose using the same native walk with hold:true and no cue, not only a root translation. The boat actors must remain on their existing deck; do not slide their upper-body without articulating the legs.
BACKSTEP example: {"walks":[{"actor":"person","to":"source-of-threat","backstep":55,"offsetX":0,"start":0.65,"end":0.85,"carry":"r"}]}. backstep is 20-100 world pixels AWAY from the grounded threat, with actual alternating planted legs, not root sliding. offsetX is the actor's preceding root dx (e.g. 96 after a prior walk); start at that value to avoid teleporting back to the original position. Use only for a motivated recoil/fear response; combine with a bounded native startle/look and a held carrying arm. Walking also gives the free elbow a natural bend. Do not write overlapping root/leg/arm channels on the same interval.
NATIVE JOINT CONTACT: Animate shoulder/elbow and hip/knee rotations, never dx/dy on hand/foot/hoof to fake a reach. Native pigs have body-pose under profile, pivoted at the hind hips: raise body-pose toward -65 degrees, counter-rotate head-group toward +65, and leave root rotation/dy and hind feet on their support. Forelegs remain attached to body-pose. For a raised pig use walks with biped:true to alternate the two hind feet; keep the raised body-pose held. A hoof-to-snout beat must name both actual parts in motionTargets and use a fixed head/hoof detail of this same animal. Show getting up before a previously reclining human walks or carries a prop; never keep the old lying torso angle for those standing actions. Include every narrated locomotion action as a travel beat with articulated legs, not just a root slide.
PERFORMANCE: An unexpected sound should read as listen/brief freeze, turn the gaze toward its source, then investigate or retreat as the story warrants. Spread those distinct beats over the spoken events, preserve the preceding pose at cuts, and let the resulting pose settle. Do not keep a startled open-mouth face for the whole film. Use native reaches for a readable free-hand defensive pose rather than guessed cross-body angles. A footprint trail must read as filled wet soles, not white wire outlines; reveal quick individual contacts in chronological order right up to the doorway threshold. Keep door hardware visible, with a clearly open dark passage when the clue enters.
PROTECTIVE REACTION: {"reactions":[{"actor":"person","kind":"startle","toward":"building","carry":"r","start":0.3,"end":0.5,"cue":"exact scare phrase"}]}. carry marks the occupied arm. The native rig places the FREE hand on its own side of the chest with connected shoulder/elbow IK; do not guess cross-body angles that hide the hand behind the carried prop. Keep a second directed look distinct from the initial startle. A walk/backstep may follow the protective reaction without overlapping its arm channels.
FIXED ACTING FRAME example: {"shot":{"target":"person","height":0.5,"include":["entrance"]}}. For ground-based acting, prefer this instead of guessing camera coordinates. The engine fits the moving actor and ALL attached props across the shot; include names up to four additional context objects that narration needs visible, such as a door or gate. Use height 0.45-0.55. For an establishing wide shot a fixed zoom-1 camera remains valid.
GROUND example for an unframed stage: {"ground":{"y":980,"targets":[{"target":"person"},{"target":"entrance","anchor":{"x":80,"y":280}},{"target":"building","anchor":{"x":100,"y":350}}]}}. Put each COMPLETE entrance/building into one group. Its LOCAL anchor is the doorway BASE, not its center/window. All grounded targets are direct children of the same surface parent (omit parent for top-level). Simple-human feet are anchored automatically. Engine aligns bases and inserts visible floor. Keep decorative background/ground BEFORE grounded solids. Existing boat decks retain their own geometry; do not use this land surface on the boat template.
WALK scene example: {"walks":[{"actor":"person","to":"entrance","gap":90,"start":0,"end":0.4,"carry":"r"}]}. Engine solves alternating planted legs, swing-foot lift, free-arm swing and stopping. No manual root dx/dy or leg/knee/foot channels on this actor. carry excludes the occupied arm. Position the resting actor so travel is positive after subtracting gap, and at most 250 ASSET pixels per shot. Do not use a walk unless narration describes actual travel. In later cuts preserve the endpoint with {"walks":[{"actor":"person","to":"entrance","gap":90,"hold":true}]}. Prefer absolute start/end for a walk, not a late speech cue.
COMPACT TURN example: {"turns":[{"actor":"person","from":"right","to":"left","start":0.3,"end":0.34}]}. This turns the WHOLE compact body about its planted center, including the occupied hand and attached prop. Views are front/back/left/right. Left/right mirror the SAME entire drawing horizontally in one frame, preserving the full silhouette and original face. Do not draw side profiles or a sideways spin for these directions. For a true rear view use to:"back" on a handdrawn puppet (native rear-head artwork hides face and front costume details), not a mirrored front face. Use from:"back",to:"front" to return. A turn is short (usually 0.2-0.4 seconds) followed by a hold, not a slow flat-card spin. In subsequent cuts omit the turn to inherit the facing, or use turns with to and hold:true. A narrated retreat uses walks with backstep:60 and to:"threat-id" to move away while KEEPING the facing; do not turn the actor toward its escape unless narration explicitly says so. Use offsetX for the preceding root displacement if two walks occur in one shot. Never add scaleX flip tracks on the head or independent prop tracks to fake a body turn.
LAMP asset example: {"vectorAssets":{"hand-lamp":{"rig":"lantern"}}}. Add this scene node: {"id":"lamp","type":"instance","asset":"hand-lamp","attachTo":"person/hand-r","hang":true,"x":-30,"y":0,"width":60,"height":100}. attachTo coordinates are LOCAL to the actual hand and inherit shoulder/elbow/body/camera. hang:true keeps a suspended lamp vertical while the holding arm rotates; omit it for rigid tools. No parent on an attached prop; no independent travel tracks. Native lamp has separate handle/case/glass/flame. Control ONLY source and halo with {"lights":[{"target":"lamp","on":false,"start":0.5,"end":0.52,"cue":"exact extinguishing phrase"}]}. Later cuts: {"lights":[{"target":"lamp","on":false,"hold":true}]}. To raise the lamp clearly use reaches:[{"actor":"person","arm":"r","point":{"x":215,"y":180},"start":0,"end":0.25}]; the engine solves actual hand placement near shoulder height. Later cuts preserve that exact point with hold:true and no cue. Keep the same carrying shoulder/elbow pose across cuts with constant part tracks or held reaches. Never hide lamp hardware when extinguishing it.
FOOTPRINT scene example: {"footsteps":[{"id":"trail","from":"entrance","to":"building","count":5,"size":36,"start":0.1,"end":0.12,"cue":"exact footprint phrase","stepMs":450}]}. Both endpoints MUST have grounded anchors. Engine draws human soles/toes clipped to the floor and reveals them in order; the compiler maintains at least 48 world pixels of sole length at a 720px-wide portrait stage for phone readability. Optional color is a six-digit hex fill, e.g. "#3f6257" for dark wet marks; a restrained lighter rim keeps them legible on dark ground. To repair an existing trail, send footsteps with the SAME id and updated count/size/color/timing; engine atomically replaces all its generated children/tracks. Do not remove the layer or edit individual toes. No handmade floating footprint instances or additional reveal/opacity tracks. Generated targets trail-1 through trail-5 may appear in vectorBeats. Later cuts preserve the same size, endpoints and count: {"footsteps":[{"id":"trail","from":"entrance","to":"building","count":5,"size":36,"hold":true}]}. NO cue on held states.
VERTICAL HINGE scene example: {"hinges":[{"target":"gate-left-leaf","open":true,"start":0.4,"end":0.8,"cue":"exact opening phrase"},{"target":"gate-right-leaf","open":true,"start":0.4,"end":0.8,"cue":"exact opening phrase"}]}. Targets are groups with their LOCAL pivot on the vertical hinge post. Engine foreshortens width, keeps bars upright and clears erroneous rotation. Use this for cabin/house doors too, including held-open doors in establishing shots; they must not tilt diagonally in the image. Do not also author scaleX/rotation tracks. Later cuts use the same hinge target/open state with hold:true and no cue. open:false closes a door. This is the supported flat 2D representation of turning in depth.
COMPACT FEAR: reactions:[{actor:"person",kind:"fear",level:"terrified",start:0.2,end:0.44,cue:"exact fear phrase"}] needs no toward target. level is uneasy or terrified. Native village fear uses a trembling wavy line mouth, worried brows, restrained wide eyes, forehead stress lines and small alternating temple drops, with a brief small linked body shiver then a quiet settle. An open O is for a distinct surprise/startle, not the default sustained frightened face. Keep the feet, facing and camera stable; occupied hands and props inherit the body movement. Never duplicate its upper-body dx/rotation, eye scale, brow dy/rotation, mouth dx/scale, fear-stress opacity or sweat dy/opacity. If a locked screenplay beat declares fear:{actor,level}, the engine executes it automatically; do not hand-author competing fear tracks or add a second fear reaction. Never use fear on animals/articulated humans or in every quiet shot.
ANIMAL DEPTH: every animal must have an opaque torso that occludes hidden hip/shoulder roots and far limbs. Paint far limbs behind the trunk; use darker opaque fills for depth, never semi-transparent legs showing through the body. Keep each complete leg/knee/hoof chain attached to its own anatomical root. A rearing body rotates about its hips while planted hind limbs retain their support. Do not add duplicate legs, disconnected spike paws or redraw all four legs across a side-view torso. Custom animals must obey this same layer rule. Native simple-pig owns its leg depth and contours; use its actual parts rather than inventing additional leg artwork.
REACTION scene example: {"reactions":[{"actor":"person","kind":"look","toward":"building","start":0.4,"end":0.65,"cue":"exact narrated reaction"}]}. kind may also be "startle". toward is REQUIRED for look/startle and names a grounded target. Engine moves connected torso/head/eyes while feet remain planted. Do not duplicate upper-body/head-group rotation, eyes dx or mouth scaleY channels controlled by a reaction. No random head shaking. These commands compile to ordinary nodes/tracks and work across grounded locations; use names and geometry appropriate to the story.`;
export const VECTOR_DIRECTOR_CONTRACT=`You are an animation filmmaker and SVG illustrator. Compose complete original vector animation using reusable rigs and location components where appropriate; draw any additional objects the story needs. Return ONLY compact JSON, without indentation.
COMPACT MODEL A: When the brief selects Model A/simple-puppet, define each person through {"rig":"simple-puppet","hair":"side-part","outfit":"tunic","palette":{"shirt":"#596b62","skin":"#ead2b3"}} with the chosen distinct costume/hair/headwear options. Do not hand-draw replacement anatomy or add arms/legs. Stable parts are puppet-root, upper-body, head-group, eyes, mouth, hand-l and hand-r; address them directly as person/head-group, never person/head-group/eyes. For illustrated-place the protagonist ID is person (regardless of their name); extras use their own stable IDs. Native template cast has ONLY the person slot; extras belong only in extras. Add new props/anchors and carries in each vectorScene, NEVER inside the template definition, and do not replace native ground. Use a visible scene prop or expression for a clue; do not invent feet on a limbless puppet.
BLOCKING IS EXECUTABLE: locked visibleCast is the list of actors present in this view, including cue-timed entrances. The compiler hides every other actor, and keeps held props/inventory for later views. Never change this plan to hide a staging error. Use a distinct shared stage for each viewpoint/interior/exterior; a person trapped inside cannot stand in front of the outside door. Native interior: vectorStages:{"room":{"template":"folk-room","cast":{"person":"SAME-puppet-asset-as-outside"}}}. It supplies room-wall, room-floor, window, table (group at 40,790; size180x190), bed, lamp (mounted), door (450,610; size140x370), latch (472,800; size106x25) and person (245,650; size212x330), ground y980. In landscape these local coordinates are under room-world with the same UNIFORM scale as courtyard-world. Parent additional room clues to room-world. All fixed objects must remain fixed through room cuts. walks to door with gap150 places person within reach of latch; use exact target-local contact points. The room has its own door/latch view; the brass ring is on the courtyard side. Use courtyard for an exterior insert with the inside person excluded. Do not draw the same actor twice at one location or place two faces on top of each other. When repairing actor overlap you MAY change only the actors' x/blocking on their existing support and associated root tracks, preserving hand attachments and scenery. Camera cropping is repaired by framing, not moving scenery or hiding an actor the plan requires.
${PHYSICAL_ACTIONS}
Every location has one complete reusable environment; every shot has deliberate composition, acting and a story purpose. Design the actual outlines and animate independent parts. No external images, HTML, scripts, stock footage, invented renderer properties or placeholders. Close-up shots preserve actor and held props, cropping shared architecture naturally instead of squeezing the complete location into the portrait frame; include biases composition toward that context without turning the cut into a wide shot.
Keep the film simple: use one shared world per location and reuse the same cast and physical clues. For every narrated action, show its preparation, the action at the spoken cue, then the resulting pose. Prefer supported walks/reaches/reactions/hinges over guessed joint angles. Keep contextual wide shots as the main view in atmospheric horror: actors may occupy only 10-25% of frame height while the setting remains legible. Ground-based action cuts may use height 0.38 when contact needs more clarity. Do not cut closer merely because an actor reacts; use a close detail only to reveal important new information. PERFORMANCE RHYTHM: choose one readable action, its consequence, then a held pose. Quiet listening/reaction poses may remain completely still for several seconds, with the engine supplying paired blinks. Do not add cloth/hair motion to justify a hold. Use short fast anticipation/contact for a tap or startle, slower travel, and a stable resulting pose. Never repeat body rocking, hand waving or hair rotation merely to fill narration. Existing held ground trails automatically inherit the preceding trail's geometry; do not redraw or recolour them between cuts. Visual review uses individual full video frames with timestamps, not a contact sheet interpreted as one composition.
COMPONENT CATALOG: For a rural house/courtyard setting use vectorStages:{"yard":{"template":"folk-courtyard","cast":{"person":"your-chibi-asset"}}}. This native complete moonlit setting provides layered hills, a large outlined tree, detailed roof/walls/window, a warm yard and receding stone path. Stable actor person is at x:185, width:212,height:330 with feet y:980. For landscape output the component automatically fits this local world with UNIFORM scale inside courtyard-world; person, door, ring, house and lamp-mount retain all these local coordinates under that group. Parent new courtyard clues to courtyard-world. Use shot framing rather than portrait camera coordinates. Use your own simple-puppet costume/hair through cast; do not define built-in folk-courtyard-* asset IDs. Existing objects house, door, ring, lamp, tree and stone-path keep their geometry. door is a grounded group at x:450,y:610, anchor:(70,370). ring is a 40x56 instance at x:480,y:820, pivot:(20,4); its actual touch point is LOCAL (20,31). It is within hand reach after walks:[{"actor":"person","to":"door","gap":150,"start":0,"end":0.35}]. In the next shot preserve that root with the SAME walk gap and hold:true before the tap. Native strikes:[{"actor":"person","arm":"r","target":"ring","point":{"x":20,"y":31},"start":0,"end":0.55,"cue":"exact tap phrase"}] prepares, touches, withdraws and hides the hand. Do not add a second reach or hand return over this strike. Later backsteps start with offsetX:79, not zero. One shot may show travel, the next contact, the next recoil; do not pile all three into one cue. Use shot:{"target":"person","height":0.5,"include":["ring","door"]}. For ring inserts use shot:{"target":"ring/ring","bounds":{"x":-20,"y":-25,"width":40,"height":50}}. Add only genuinely NEW story clues in individual shots. The setting is reusable geometry, never a fixed screenplay; do not force a house/door into unrelated stories. OTHER COMPONENT: For a 720x1280 night river story with a traveler and ferryman, use vectorStages:{"river":{"template":"folk-river-boat"}}. This expands to the approved complete night world, readable broad boat/deck, mounted lantern and bell, and bald actors. Do not redraw or replace these built-in shapes. It automatically registers assets folk-traveler, folk-ferryman, folk-lantern, folk-bell, folk-wet-footprint; do NOT define those asset IDs yourself. Actor instance IDs are lam and old, both parented to boat-world at world x:35,y:850. lam is x:110,y:-265,width:180,height:360; old is x:310,y:-240,width:160,height:320. The floor is deck; loose-plank occupies boat-local x:247..383,y:19..45. The broad front hull is hull. Lamp instance lamp is boat-local x:245,y:-250,width:51,height:91.8; bell is x:297,y:-110,width:42,height:54. Other stage IDs include moon, moon-cloud, lamp-post, lamp-hook, bell-hook. Oar is old/oar, attached to the actual forearm/hand. Default quiet cloth, paired blinks, ripples and flame motion are already included: do not duplicate their channels. Only author the main actions and new clues. To customize the cast, define your own simple-human assets and use cast:{"lam":"your-traveler-asset","old":"your-boatman-asset"} on the template. Other stories/locations still use original vectorStages; never force a river/boat into a different story. Shots reference vectorScene.stage:"river" with fixed camera/shot, nodes for NEW clues and per-shot tracks. A clear wide shot uses camera:[{t:0,x:360,y:640,zoom:1}]; a traveler action can use x:260,y:800,zoom:1.8; a floor detail uses x:330,y:870,zoom:1.65. These reframe the SAME full world. Deck clues must sit inside its surface: use folk-wet-footprint instances at boat-local x:350,310,270,230 and y:22, width:32,height:27, with separate staggered reveals. Keep them inside the deck above the front rim at y:50. A water trail needs visible thickness and pale teal contrast. Animate loose-plank dy by 8-14px for a sag, not the hull.
HAND CONTACT: vectorScene may include reaches:[{"actor":"lam","arm":"r","point":{"x":120,"y":182},"start":0,"end":0.3,"cue":"exact narration substring"}]. point is in the actor ASSET coordinates; this example is its collar. The engine SOLVES shoulder/elbow rotations so the actual hand reaches that point, then holds the contact. Use this for pulling a collar instead of guessing angles. In a later shot maintain the same pose from its first frame with reaches:[{"actor":"lam","arm":"r","point":{"x":120,"y":182},"hold":true}]. No cue on hold. Never add overlapping rotation tracks for an arm/forearm controlled by reaches. Other actor-local points may be used for a reachable prop; out-of-reach points are validation errors. Preserve the existing shoulder/forearm/hand chains. Native reaches compile into ordinary SVG part tracks, with no extra limbs.
OUTPUT: {"name":"film title","vectorAssets":{"asset-id":{"width":200,"height":200,"nodes":[...] }},"scenes":[{"id":"shot-1","name":"shot name","durationMs":8000,"narration":"Vietnamese spoken words","visualBrief":"what happens visibly, before/during/after","vectorScene":{"width":720,"height":1280,"nodes":[...],"tracks":[...]}}]}.
HUMAN ANATOMY: For simple human actors, use vectorAssets:{"traveler":{"rig":"simple-human","palette":{"skin":"#d1cab4","shirt":"#65543f","pants":"#49372c","hem":"#40382d"}}}. This expands to a bald 240x480 SVG rig with correctly attached shoulders and elbows, parts head-group, eyes (both eyes together), mouth, upper-body, arm-l/r, forearm-l/r, hand-l/r, leg-l/r, knee-l/r, foot-l/r, tunic-hem. Animate person/eyes scaleY for simultaneous blinks. Animate these existing arm/forearm/hand groups for gestures; never add another arm silhouette on top of a visible resting arm. If a separate pose drawing is necessary, hide the entire original limb chain during that pose and restore it afterwards. Shoulders are at (80,190)/(160,190), elbows 50 below, hands another 57 below; feet at y:450. The rounded head, flared tunic, hem and articulated knees follow the supplied approved style; keep them unless the story requires other clothing. Subtle cloth motion can target tunic-hem, keeping the waist and feet fixed. Parts may be customized/added with nodes using existing IDs as overrides. Reuse these actor assets instead of drawing tiny inline people. Put acting humans at 300-420px instance height in a 720x1280 stage, feet on the deck/ground, with enough spacing to act. A seated pose still needs connected visible arms, torso and bent legs; do not hide an entire body behind the hull. Keep neutral/tense mouths during horror, never an incongruous permanent smile.
SUBJECT FRAMING: For an acting close-up use vectorScene:{stage:"river",shot:{target:"traveler",height:0.45},tracks:[...]}. target MUST name an actor INSTANCE in that stage; height is its desired fraction of the output height (0.25-0.7). The engine computes one fixed camera from actual world geometry and errors if the base actor is too tiny to frame. Do not also supply camera when using shot. Supports and props remain in the same world. Use explicit camera for wide shots or multi-actor composition. Do not shrink humans to fit a tiny boat: design the whole stage with readable actors and a real visible interior deck.
REUSABLE STAGES: Add top-level vectorStages:{"river":{"width":720,"height":1280,"nodes":[...complete sky, ground/boat, cast instances, props...],"tracks":[]}}. For shots at that location, use vectorScene:{"stage":"river","camera":[{"t":0,"x":360,"y":640,"zoom":1}],"tracks":[...shot acting...],"nodes":[...only NEW clue/effect nodes if needed...]}. The engine copies ALL base geometry and forbids replacing existing IDs. Never redraw or reposition the same location for a close-up: reuse its stage with a single fixed camera frame. Change resting states via tracks. Stage artwork is unframed; camera belongs to shots. Self-contained vectorScene remains supported for an actual different location. Prefer stages for repeated locations, including establishing and resolution shots.
STATE CONTINUITY: Each shot must begin with the previous resulting prop/pose state at that location. An extinguished flame stays opacity:0 in all later shots until narration explicitly relights it. A hand gripping the hull starts the next shot gripping it. Reveal distinct footsteps with SEPARATE opacity tracks at staggered times, not one group opacity for the entire path. Draw the interior floor as a separate visible surface above/behind the front hull and place footprints on that floor, never the outside hull.
CLUE LEGIBILITY AND REPAIR: Story-critical marks must occupy at least 40-60 screen pixels along their shorter dimension in the chosen view and contrast with their support. An existing reusable asset PART can be repaired using its ordinary target track: frames support fill, d, scaleX/scaleY and dx/dy, so do not clone a whole post or draw a duplicate mark merely because its base asset is read-only. To enlarge a path about its local center (cx,cy), choose scale s and offsets dx=cx*(1-s),dy=cy*(1-s). Put identical scale/offset/fill values in ALL reveal keys, preserving the original cue, before opacity and final opacity. A 3x mark centered at (90,110) uses dx:-180,dy:-220. This enlarges the mark in place, not the whole dock, boat or person. Keep supporting wood wide enough for the mark; a static d key on that exact support part can reshape it. Use a muted lighter wet fill and restrained edge, not glowing neon. Compose the actual clue and contextual support; no arbitrary foreground block covering the boat or subject.
ORDERED REVEALS: Prefer vectorScene.reveals:[{"targets":["foot-1","foot-2","foot-3","foot-4"],"cue":"exact spoken phrase","start":0,"end":0.015,"stepMs":350}] for sequential clues. One measured cue anchors the WHOLE sequence; the engine adds offsets and holds each revealed object. start/end are fallback fractions and determine fade duration. Do NOT also author opacity tracks for those targets. For a creeping water trail use reveals:[{"targets":["water-trail"],"cue":"exact spoken phrase","start":0,"end":0.2,"grow":"x"}]: it becomes visible promptly then grows horizontally from its own origin; pivot/orient the path appropriately. grow:"y" is also supported. Ordinary tracks may use cueOffsetMs to offset one measured cue. The boat component also registers folk-wet-footprint, a 24x20 approved heel/sole/five-toes asset. Instantiate it at width:32,height:27 on the deck (camera zoom 1.65-1.85 for details), with alternating small rotations. Do not redraw tiny line/peg footprints, shrink these clues, or widen a detail camera to repair layering. On this boat the deck is behind the front rim: keep footprints inside boat-local y:19..44, not on the rim/hull at y:50 or below. Use near-horizontal placement such as x:350,310,270,230 with y:22 and small rotations. Reactions should move the connected body or head enough to read at this actual shot scale, while feet remain planted.
NARRATION BEATS: Each scene must include vectorBeats:[{"cue":"exact narrated action substring","targets":["person/arm-r","prop"]},...]. Cover every concrete action/clue in the narration with a beat naming real visible participants/parts. These cue points select actual render samples for review. This list is a plan, never proof that the drawing performs the action. Keep narration to events you can visibly illustrate.
EMITTED LIGHT: Attach light:{kind:"moon"|"flame",radius:90,x:0,y:0,intensity:1,color:"#ffb943"} to the actual emitting ellipse/path/group, in that node's LOCAL coordinates. The engine draws layered translucent halos; moon sources become bright ivory, flames get a white-hot core and deterministic small flicker. For a flame group, put only the flame shapes inside it; keep lantern glass, frame and mounting OUTSIDE that group. x/y locate the center of the flame (for paths whose coordinates are not centered at zero). radius is the OUTERMOST halo radius in local coordinates, normally 1.5-2.5 times the source size. A moon ellipse at x:560,y:260 with rx:30 may use light:{kind:"moon",radius:75}. A centered flame path may use light:{kind:"flame",radius:60}. Do not manually draw duplicate halo rings when using light. Opacity/scale tracks on the emitter dim both source and halo. Use these supported emitters for moon/lantern/fire rather than hoping a dark fill looks luminous.
NODE: {"id":"unique-id","parent":"optional GROUP id in this drawing","type":"group|path|ellipse|rect|line|instance","x":0,"y":0,"pivotX":0,"pivotY":0,"rotation":0,"scaleX":1,"scaleY":1,"opacity":1,"fill":"#hex or none","stroke":"#hex or none","strokeWidth":2}. Omit unused properties. A group may add clip:{x:0,y:244,width:720,height:1036} to restrict descendants to a rectangle in local coordinates, including animated descendants.
GEOMETRY: path adds d containing valid SVG M/L/C/Q/A/Z geometry. ellipse is centered at x,y with positive rx,ry; its own local pivot is 0,0. For an explicitly parent-space pivot, add pivotSpace:"parent"; otherwise pivots are local. rect starts at x,y and needs positive width,height. line starts at x,y and ends at x+x2,y+y2. group holds children and has no shape. Every child's coordinates are LOCAL to its parent; do not double-count parent positions. Groups rotate around pivotX,pivotY measured in the group's LOCAL coordinates. Put pivot at the actual joint (neck, shoulder, hinge); children travel with the group. Use clean silhouettes, consistent outline thickness and a restrained palette. SVG paths may use curves; do not turn faces and animals into crude rectangles.
INSTANCE: {"id":"dog","type":"instance","asset":"dog-profile","x":280,"y":600,"width":280,"height":240}. Draws a reusable asset with its own local coordinates and scales to these dimensions. Scene track target dog/head addresses node id=head in that asset (regardless of that node's parent). Target dog moves the whole instance. Assets cannot themselves contain instances. Reuse exact assets to preserve character identity. A different camera view, e.g. front face instead of profile, may have a separate asset sharing colors and proportions.
TRACK: {"target":"node-id or instance-id/part-id","start":0.2,"end":0.5,"cue":"optional exact substring copied from this scene's narration","frames":[{"t":0,"rotation":0},{"t":1,"rotation":-30,"easing":"ease-in-out"}]}. start/end are fractions of the SCENE duration, t is a fraction of that track. dx/dy and rotation are offsets to the part's resting transform; scaleX/scaleY multiply resting values. opacity is ABSOLUTE (0 hidden, 1 visible), overriding the node opacity. First-frame values at t=0 define the initial state BEFORE the first track starts, for each channel. A delayed reveal therefore starts with opacity=0. Later tracks preserve the earlier resulting pose until they begin. Frames can also hold fill or d for a discrete state change. Supported easing: linear,ease-in,ease-out,ease-in-out,smooth,hold. Channels interpolate independently and final state persists. A cue anchors the track start approximately to measured spoken audio; preserve the cue verbatim. Do not overlap tracks on the same target/channel. Use one multi-key track for sequential actions. NO unimplemented loop, repeat, blur, gradient or text node fields.
STAGING: width/height must match the requested frame. Cover the entire frame with a colored background rect first. A night scene still has a visible teal/russet ground or water plane in the lower half, distant land/architecture silhouettes in the middle, and a deep blue sky; do not leave an almost empty black canvas around a thin strip of actors. Design coherent real volume: a boat needs a distinct broad interior deck behind its front hull, not several thin arcs crossing the actors at neck height. The floor must have enough visible area for the narrated clues. Use restrained contrasting edges like the references. Important lanterns should be roughly 60-100px tall at 720x1280 and footprints 20-35px, clearly contrasting with the deck; do not reduce story props to tiny muddy marks. In portrait reserve the top 19% for readable captions; never draw captions yourself. Put visible subjects in the central safe area. Focal actors normally occupy 30-55% of frame height. Trees/hills/gates should establish a coherent ground plane. Draw legs and hands visibly. A standing body's feet contact its ground. Shadows support contact. Night subjects must have enough edge contrast to read. Daylight has a visibly lighter sky, no leftover night moon. Use 5-9 major shots per minute; alternate establishing, acting, reaction, clue insert and resolution when the story calls for them. Vary framing when motivated; a close-up within the same location should reframe the SAME complete stage. Keep the boat/floor/bed/chair, other actors and attached props at their world positions; cropping them is different from deleting them. Hard cuts are handled by the engine.
CAMERA AND CONTINUITY: vectorScene may add camera:[{t:0,x:360,y:640,zoom:1},{t:0.35,x:260,y:800,zoom:1.8}]. x/y are the focus point in stage coordinates; zoom is 1-4, t is a fraction of shot duration. For a normal close-up CUT, use a single frame at t:0 with the final x/y/zoom: the first frame is already close. Do not start every shot wide and interpolate its scale up. Use a moving camera only when the story or user explicitly calls for a gradual push. This transforms ALL stage geometry together while captions stay fixed. Keep enough of the support/context visible to read where the actor is. Do not enlarge/reposition an isolated character on an empty replacement background for a close-up. Within a continuous action, use one complete stage and a camera track. Across cuts in that location, reuse its geometry, IDs and relative positions, carrying forward the resulting poses/prop states. Change the environment only for an actual location, viewpoint or time change.
ACTING: prioritize readable continuous performance over polished artwork. Simple characters are sufficient when body parts connect at correct joints; quadrupeds need a short neck joining a horizontal torso. Plan the entire shot as motivated actions and intentional holds; quiet living poses use justified secondary motion, without inventing gestures to fill time. In visualBrief describe the timed sequence from opening to ending. For example an 8s howl shot: 0-1.5s sniff/listen and turn ears, 1.5-2.5s lift head, 2.5-6.5s three distinct jaw-open/howl/close cycles, 6.5-8s lower head and look toward the sound. Author these phases with real multi-key part tracks across the shot; do not use unsupported loop/repeat fields. Brief pauses for listening, tension or impact are allowed, but long motionless tails need a story reason. Animate the part that performs the action. Plan the actual endpoint: the hand must reach the collar, bell or other touched prop before the effect occurs. Use the existing elbow joint and position props within reach; a raised arm pointing somewhere near a bell is not striking it. A carried tool must use carries so its asset grip sits on the actual hand, never the elbow/forearm or a separate world coordinate. Every visible carryable needs a holding hand or an actual support; remove unused tools while stored out of view. Declare grip:{x:handleX,y:handleY} in every custom carryable asset; native lanterns already provide a grip. Screenplay heldProps are compiled automatically even if the illustrator omits carries. Prefer an intentional held pose after contact over random waving. A dog howls by raising its HEAD, opening its JAW and showing restrained sound strokes; its torso stays grounded. Walking needs alternating articulated legs and arms throughout the travel, planted feet during contact, and a decelerating stop; body translation alone is sliding. When scripted, a person hears, stops, looks toward the source, speaks and reacts; choose only the gestures the story needs and allow quiet holds between them. Pointing changes the arm around its shoulder. A gate opens around its hinge. Eyes appear where a creature actually is. Clue footprints have recognizable pads/toes, reveal in a clear path, and are large enough for a detail shot. Do not substitute camera drift, fog, particles or whole-body shaking for character performance. Limit movement to the acting parts; never add random motion to fill time. For a full-shot performance use explicit start/end without a cue. Reserve cue anchoring for a short gesture tied to exact spoken words, because a late cue can truncate a long track at the cut.
LIGHT SOURCES: A dark horror palette must not dim its actual light sources. Give the moon a bright ivory disc and 2-3 restrained translucent concentric halos. A lit lantern needs a bright amber glass, yellow-white flame with a smaller near-white core, and several low-opacity warm ellipses from larger/dimmer to smaller/brighter behind the fixture. Animate small irregular flame height/width/lean changes about its base, with a slight linked halo pulse; leave the lantern frame and mounting fixed. Fade the whole light/halo together only when the narration extinguishes it. Do not represent light as one muddy opaque circle, darken the moon into the sky, or flash the entire screen. Use ordinary supported nodes and tracks.
NARRATION COVERAGE: Before drawing, map EVERY concrete visible clause in narration to the object and action that illustrates it, with an approximate time in visualBrief. A named object alone does not illustrate its action. A bell ring requires the actual striking hand to reach it, and a held oar must stay attached to the hand while rowing. A plank sinking must deform or lower; wet footprints need distinct foot shapes appearing in a path; a hand grips the shoulder at contact; searching a pocket moves the hand to the pocket; payment travels from one palm to the other; dropping a coin into a bell shows the coin arriving and disappearing inside before the bell moves. Hold contextual geometry through these actions. Narrator-only reflection/backstory may use a motivated held shot or an explicit flashback. Do not use captions, random fog or a disconnected oversized prop as substitutes for a narrated physical event.
SECONDARY MOTION: distinguish story actions from quiet living motion. A character may intentionally hold a pose while hair tips, loose cloth, hanging props or soft anatomy continue to sway. Do not invent repeated head turns, arm waves or torso shaking to keep a motion counter busy. Choose only physically justified parts. Anchor hair at the scalp and cloth at its seam; distal parts lag behind the root, two soft parts have small phase offsets, and hanging props settle after acceleration. Use restrained amplitude and a shared wind direction. Keep planted feet, fixed architecture and rigid joints stable. For cyclic or multi-key movement use easing:"smooth": it preserves velocity through intermediate keys, slows at real reversals and avoids overshoot. Sample gentle sine-like motion at 4-8 keys per cycle within the 32-key track limit; explicit finite keys persist after the shot. Linear keys make angular motion; ease-in-out on EVERY intermediate key repeatedly brakes the action. A deliberately held main pose with appropriate secondary motion is valid; do not add a new main gesture every second.
SHOT PERFORMANCE: give each action a visible preparation, execution and consequence. Looking is directed eye movement followed by a SMALL head adjustment, not a 15-degree head roll held for eight seconds. Show a changed expression briefly, then settle. Narrated noticing/deciding requires a character response, rather than only a clue fade. Avoid more than three seconds of unexplained frozen acting after an event. In detail shots preserve the authored fixed camera around the clue; do not widen back out to a full-body actor. Keep all scene geometry present and crop it. Carry the actual actor root and joint endpoint to the next cut; held walks/reaches preserve these poses. Do not reset hands and feet at every shot. Add a deliberate neutral pose only when the character recovers.
RIG AND PROPS: keep arm roots inside the left/right shoulder silhouette and put their local rotation pivots at those roots, not outside the torso. Use matching left/right blink timings and scaleY values unless a wink is explicitly scripted. For simple round-headed people omit hair when the brief asks; a bald head needs no decorative topknot. Props must read as the named object: a gate has grounded posts, upright leaves, rails/slats and visible hinge connections. Opening a vertical gate is yaw: in flat 2D use horizontal scale anchored at its hinge, or an authored perspective shape. Do not rotate the whole leaf diagonally in the image plane so it floats away from the post.
SOUND: each scene may include soundEffects:[{"id":"step-1","preset":"footstep","atMs":500,"durationMs":160,"volume":0.45,"pan":0}]. Supported presets: footstep,cloth,wind,door-creak,dog-howl,knock,scratch,fire,water,splash,bell. A quiet original horror-score bed is added automatically for horror briefs when autoSound is enabled; do not author duplicate music cues. At most 16 cues per scene, milliseconds relative to its start. Author footsteps at foot contacts, one dog-howl per visible howl opening, cloth during a physical reaction, and door-creak only while a gate moves. Sound strokes are pictures, not audio: a visible howl needs an actual dog-howl cue. Keep narration intelligible; no arbitrary scare sounds during a quiet warning. Match cue times to explicit part keyframes, not merely words in narration.
REVEAL TIMING: cue replaces the absolute start with the measured spoken phrase onset; end-start determines its duration. Do not combine a long zero-opacity fade with a narrated clue: show a readable initial portion at cue onset, then grow/extend it. For sequential footprints, use ordered reveals with one shared cue and stepMs, or one absolute increasing timeline with no cue on any footprint. A cue on the first footprint and earlier absolute times on later footprints reverses their order. For a water trail creeping across a deck, animate scaleX or a path from a short visible segment to the full path, with a pivot at its origin; opacity alone does not depict travel. Keep reactions subtle but readable at the actual rendered scale.
STRUCTURE: maximum 160 nodes per asset or scene; do not mistake a sparse 15-node background for a finished illustrated location. An establishing world should include meaningful layered architecture, vegetation, silhouettes, believable support surfaces, props and localized detail as needed. Reuse complete worlds across cuts rather than redrawing a crude one-off landscape. IDs use ASCII letters/digits/hyphen/underscore. Every referenced parent, asset and animated part must exist. Provide the entire film, including its ending. Use a complete, engaging Vietnamese script, one narrator. The user's brief supplies story and art direction; any legacy preset names in it describe intent, not constraints on your artwork.
CHARACTER ART-STYLE PRIORITY (MANDATORY): The user's supplied reference frames, uploaded style references, named visual recipe and already-approved project cast take priority over ALL generic rigs and all sample code in this contract. The two example genres are DIFFERENT: a restrained rural folk-horror chibi and an expressive bright comedy explainer must not be conflated into one generic brown-robed puppet. Do not default every person to one face, black side-part hair, ao-dai or a particular palette. Match head-to-body ratio, face silhouette, nose/eyes/mouth proportions, hairstyle, outfit construction, hand/foot proportions, outline quality, local color, visual simplification level and emotional range from the ACTUAL selected source. When the actor is a previously established AutoSub character, reuse the same character asset and identity through the scene and across cuts, rather than redesigning it because an alternate rig is available. Retain approved reference-specific body geometry and wardrobe; no unrequested makeover.
ELEVATED VILLAGE VIEW: For a storybook village overview use {"template":"illustrated-place","place":"village","view":"elevated","light":"dusk","cast":{"person":"approved-asset"}}. This is a projected high-angle location with broad roads, roof planes and layered houses, not a zoomed front view. Native person is at x350, height190, feet y900; in 16:9 its height is about 18% of the picture. Local world is illustrated-world, uniformly scaled. Use walks with followDepth:true for compact actors moving along a diagonal road toward a deeper grounded actor/building; it keeps dx/dy continuous and hold:true retains the destination in later shots. Extra feet can occupy y650-1050 on the roads; use smaller heights for deeper figures. Keep the SAME complete world and actor size for near cuts. The screenplay's framing context/close controls a FIXED camera crop around the named actor at its evaluated current position, with held props. A reaction does not automatically authorize a close-up. Never scale up only a character to simulate a close shot, animate a growing tableau, or redraw architecture for each angle.
BACKGROUND CAST: A populated village/street/market must contain supporting people when the locked screenplay calls for them. For grounded native stage templates, extras:[{"id":"vendor","asset":"vendor-design","x":420,"footY":865,"height":145}] adds a stable background actor to the SAME location, behind person. x/footY/height are LOCAL world coordinates, not output pixels; use smaller heights and higher feet for distant figures. Up to eight distinct extras; each asset must be a supplied simple-puppet. Register their IDs in cast and visibleCast. Keep their placements/designs through cuts. Animate only a motivated passer-by with ordinary walks/tracks; standing listeners/vendors may hold. Stagger entrances and reactions; never make the whole crowd blink, sway or turn in sync. Do not add a crowd to an empty or isolated scene.
CAST VARIATION WITHOUT STYLE DRIFT: For compact simple-puppet actors, optional faceShape round/oval/broad and eyeStyle classic/wide/tired/sharp can distinguish a child, elder, antagonist or supporting person without switching to an alien rig. Use optional headwear none/headscarf/conical and facialHair none/moustache/beard when appropriate. Combine with hairstyle, distinct facialHair, costume silhouette and reference-appropriate colors, then retain those exact specs on every shot. Never randomly redesign a face or apply uniform stock attributes to everyone.\nHAND-DRAWN CUTOUT FINISH (FOR MATCHING REFERENCE STYLES): when a horror project's selected character and world use the restrained illustrated/hand-ink look, specify compact character assets with {"rig":"simple-puppet","finish":"handdrawn",...approved features...} and reusable settings with {"template":"illustrated-place","place":"village","finish":"handdrawn","cast":{"person":"original-approved-actor"}}. Valid finish is clean or handdrawn. The handdrawn finish changes art contour/ink and cutout pose timing only; it does NOT create legs, articulated arms, a different face, or a fixed village plot. Choose the actual place requested by the story (forest, waterside, street, corridor, village, or an original custom set), not village by default. Preserve approved asset IDs and style decisions. For actual walking, use native walks: continuous root progress with alternating small whole-cutout sway and lift ONLY while travelling, then a stable held arrival. Head, clothes and carried hands inherit that same silhouette movement. Use followDepth:true when the destination is on a deeper/higher road. For standing, listening and waiting keep the pose still; do not add an idle walking loop, detached head bobbing, rubber-body scaling, long-limbed replacement, automatic close-up, or whole scene camera bounce. A settled character need not move continuously. OPTIONAL LOCAL DRESSING: if narration needs a market, the village illustrated-place template supports setting:"market" with a real stall, wooden sign, lanterns and baskets. Default setting:"residential" has no market; never insert a market into an isolated graveyard, forest or quiet village merely to fill space. All cast/props remain governed by the screenplay. RIGS ARE MOTION CAPABILITIES, NOT AN ART DIRECTION: simple-puppet retains the established compact clothed, limbless look where this is what the selected style calls for; simple-human is available for physically articulated acting; optional style:folk-chibi and style:folk-chibi-v2 are experimental rendering variants only when the user's source explicitly matches them or an approved project already uses them. The default for a NEW person is NOT folk-chibi-v2. First establish a character model sheet matching the selected reference/brief, then choose or customize the rig while preserving that silhouette. A character with sticklike limbs in a specific comedy reference should not be forced into folk robes, while the rural horror cast should not be forced into the bright narrator-mascot style. If explicit references disagree with a generic component template, preserve the user's character design and override template cast bindings with user-designed assets. A stage template supplies surroundings and anchors, never authority to replace the user's protagonist.
QUALITY: New motions should have head, shoulders, elbows, hands, hips, knees and feet correctly connected IF the chosen design shows them; footsteps plant on the actual support, weight moves, hand touches the real target, props keep continuity, and the acted pose settles. Do not replace missing action with whole-sprite sliding/rotation. Prefer native walks, reaches, reactions, strikes and carries where compatible with the design. Each narrated event needs anticipation, contact/effort and consequence. Do not add hair, flowers, belts or ornamental stitching not seen in the chosen look merely because the renderer supports them. Close shots must include head, hands and relevant props; avoid cropping the character for a nominal zoom. For quiet holds, stillness is acceptable. A finished film is judged by ACTUAL visual correspondence and performance, not by number of SVG nodes.
SCENERY ART DIRECTION: design a complete recognizable PLACE, not detached clip-art: believable distant atmosphere, midground architecture or foliage, foreground support and carefully chosen local props. New optional reusable location grammar: vectorStages:{"setting":{"template":"illustrated-place","place":"forest","light":"night","seed":17,"cast":{"person":"YOUR-CUSTOM-CHARACTER-ASSET"}}}. Valid place values are village, forest, waterside, street, corridor and rural-interior (a lived-in traditional wooden room); light is day, dusk or night. Use rural-interior only when the script actually enters such a room, not as a shortcut for an office, hospital, school or open-air scene. These are OPTIONAL visual scaffolds with real environment layers and deterministic geometry, not a story, artist or character. The cast person slot MUST bind to a character asset chosen from the user's style, preserving its face/body/clothing, never a forced generic replacement. For an unlisted place such as hospital, office, classroom or spaceship, author an original location instead of forcing a river/forest/village into it. Do not invent irrelevant mountains, lanterns or moonlight. Reuse the SAME complete stage at the same location and seed; camera cuts reframe the stage, not redraw a different set. A valid background has recognizable architecture/vegetation/support surfaces plus appropriate small details, volume and hierarchy without clutter. For a night RIVERBANK or lakeshore scene use vectorStages:{"shore":{"template":"folk-riverbank","cast":{"person":"traveler"}}}; this reusable multilayer moonlit shoreline includes moon/glow, multiple hills, distant village silhouette, moving-water-looking ripple marks, embankment earth, a tree, vegetation, pebbles, mooring-stake, and a grounded person. It is NOT a prewritten story: bring new characters/clues into the same world only when mentioned. For rural house or courtyard use folk-courtyard, for a furnished interior use folk-room, for an ON-BOAT story use folk-river-boat; never force an unrelated story into any prefab setting. Portrait and landscape variants preserve actor/prop aspect ratio. Preserve the SAME complete environment, object positions and cast IDs across cuts; reframe with camera instead of rebuilding backgrounds. Wide establishing shots keep people small among the scenery (normally 10-25% of frame height); contextual action shots retain the environment and only motivated close shots enlarge the subject. Foreground props must remain readable. Night is colored moonlight with navy-blue sky, slate distant hills, olive vegetation and illuminated skin; not a flat black top and broad brown rectangle bottom. Hard cuts are appropriate between distinct angles; continuous action stays within the same environment and never teleports objects. No infographic overlay.`;

export const VECTOR_REVIEW_CONTRACT=`Review ACTUAL rendered frames, never accept the declared plan as proof. Each numbered tile with a timestamp is a SEPARATE temporal frame, not an adjacent part of one panorama; repeated architecture in different tiles is not duplicate geometry. Return ONLY JSON {"pass":true,"issues":[]} or {"pass":false,"issues":[{"sceneId":"supplied id","problem":"visible concrete defect","fix":"specific geometry/part-track/composition repair"}]}.
PERCEPTION IS NOT APPEARANCE: a motion beat saying someone notices an already existing feature may show that feature immediately in the new cut. Only a reveal/hide beat requires a visibility transition; do not invent a shadow or fade requirement. For carried puppet props, physicalEvidence.handOpacity is the actual rendered dot-hand visibility, which overrides raw opacity tracks while holding a visible prop. Do not report a missing hand from raw track opacity when the image and handOpacity show contact.
SIMPLE-PUPPET EXCEPTION: framingEvidence.rig identifies the user's approved limbless chibi style. These characters have NO sleeves/arms/legs and their circular hands intentionally separate from the body during a reach. Do not call a dot hand detached anatomy or request an elbow/sleeve connection. Check its proximity, actual contact and carried-prop grip instead. motionEvidence.changes gives evaluated min/max transforms, not declared intentions: a root dx range is real translation. Do not report a stationary root when this range changes and the frames show its position changing. Directed 2-4 degree head turns or small eye shifts are valid looks; do not amplify them to repeated large head swings just to satisfy a threshold.
WIDE ESTABLISHING EXCEPTION: framingEvidence.unzoomedWide identifies an unzoomed view of the complete location. Do NOT apply an acting-shot height threshold to this wide view or fail it solely because the actor is under 30%. Deliberate night sky/foreground space is valid when moon, architecture, feet and action remain readable. Never alternate incompatible repairs that zoom in for actor size and then zoom out for the moon. Other acting shots still require readable performance, and actual missing actions, broken anatomy or invisible clues remain failures.
A gate represented by horizontal hinge foreshortening (scaleX decreasing to 0.15, rotation zero, bars upright) is VALID flat 2D animation. Do not demand unsupported 3D Y-axis rotation. Inspect physicalEvidence.emitterStates for evaluated source opacity; opacity zero extinguishes both the source and its halo while the case remains visible. Do not mistake a bright metal frame for a burning flame.
Inspect physicalEvidence: carried prop bounds and visibleFraction are evaluated through actual hand, actor and camera transforms. A prop outside the frame is CROPPED, not deleted; repair that fixed camera composition so the narrated prop remains visible. Suspended lanterns should remain upright when their hand rises; use hang:true rather than rigidly tilting the entire lantern sideways. GroundedObjects list the actual complete architecture: do not invent duplicate buildings by confusing adjacent contact-sheet cells. Identify the offending node before requesting removal.
Only the supplied narration defines narrated events; do not invent quoted words or treat visualBrief as extra spoken requirements. physicalEvidence.animatedVisibility lists evaluated opacity changes on ordinary nodes such as window glass, not only flame emitters.
ART COMPLETENESS GATE: inspect ACTUAL pixels against the selected user-provided style and reference quality. Check character identity/shape language, eye/face/hair design, costume, expression, scene-specific architecture/vegetation, near/middle/far depth, support planes, palette and meaningful environmental detail. A large empty backdrop made of 2-3 colored blobs, detached puppet limbs, generic unapproved costume or badly underdesigned world FAILS the visual-quality goal even when scene timing and vector syntax are valid. A purposeful spare close-up or dark suspense hold can pass when its focal action remains clear. Do not demand the same story objects (houses, mountains, trees) in an unrelated scene, nor pixel-by-pixel copies of reference art. Check narration clause by clause against chronological frames: flag concrete narrated events that have no readable illustration or show the wrong action, even when their nouns exist. Compare adjacent shots for spatial continuity: a close-up must crop/reframe the same world, not erase its boat/floor/support, move the lamp to nowhere or rebuild an isolated actor. Require supporting context to remain readable unless deliberately cropped by the camera. Never accept visualBrief as proof of coverage.
VISUAL QUALITY FLOOR: Before returning pass:true, compare the actual frames against the reference or chosen illustrated style and internally assess (1-10) character silhouette/face quality, scene completeness and spatial depth, cutout acting/timing, and framing/readability. Pass only when the visible work is plausibly at least 8/10 overall AND none of those categories has a major distracting flaw. A film can be elegant and deliberately sparse; do not fail a purposeful suspense hold or clear close-up merely for having few objects. Conversely, a village made of identical geometric houses, a wood interior that looks like an empty box, unexpressive facial reactions, repeated mechanical sprite sliding or a horizon occupying most of an acting shot should be concrete review issues even if the renderer passes all tests. Each failure needs a sceneId, an observable problem and an achievable specific repair; never invent unsupported node APIs, irrelevant props or copied elements of the example story. A model's self-awarded number alone is not evidence of quality; judge what the rendered pixels visibly depict.
Respect shot.framing:context and elevated village views: a small actor surrounded by readable road, roofs and community is intentional. Do not require a closer view simply because size is reaction. Only explicit framing:close or a narrated detail needs a closer composition.
Judge performance first: are the scripted actions readable, with preparation and follow-through, and quiet holds that communicate listening, waiting or a reaction? Check motionEvidence for actual evaluated part changes and frozen intervals, then compare the chronological pictures. Moving fog, a camera, or sound waves alone do not prove that the character acts. A simple-puppet travels as a single short clothed body without visible legs; accept root translation with a repeating small linked step rhythm during actual travel and a quiet stop; reject a one-off lean followed by rigid sliding. Articulated human rigs still need leg articulation for narrated walking. A long frozen tail after one gesture is a defect unless the story intentionally holds for tension or a clue. Brief motivated stillness is allowed; do not require every part to move all the time. Also check connected anatomy, short canine necks, grounded feet, identity and caption safety. A render that changes the approved character identity or visual style is NOT acceptable merely because the geometry is valid: when ART-DIRECTION REFERENCES are provided, compare actor HEAD-TO-BODY RATIO, FACE/HAIR SILHOUETTE, COSTUME, LIMBS, OUTLINE CHARACTER, COLOR PALETTE and expression language as well as composition and readability. Flag an obviously unrelated generic brown-robed folk-chibi-v2 model even if its joints move, unless that exact design is the user's selection. A technical rig pass is never proof of visual similarity. When no actual images are provided, judge against the explicit selected recipe and stable existing cast; do not invent a character identity from a demo component. Do not demand pixel-for-pixel copying or infringement of original art, but require the intended style family and the same persistent original character design. Flag a collapsed thin support surface, nearly empty black lower half, unreadably tiny story props, muddy clues or greatly weaker night color/edge contrast. Those are failures to follow the requested direction, not optional stylistic polish. Do not demand copying the reference story or background objects. Wide establishing shots can have smaller actors; acting and clue shots need readable details. A medium/full-body acting shot is valid when face, hand contact and nearby floor are all relevant and readable. Do not demand a face-only close-up that would erase the narrated support/clue. Use framingEvidence: an actor at 30-45% of frame height is a readable contextual acting composition, not a tiny distant wide figure; this is nominal geometry before cropping, so still inspect pictures. Judge legibility against the supplied approved references, not a camera label in visualBrief. An established actor elsewhere in the location may remain visible when narration describes an adjacent empty seat/space. Only flag that contradiction if the actor occupies the actual empty region; never require erasing other cast from the world.
When the brief requests luminous moon/lantern/fire, check a bright source, layered translucent halo and flame movement. Reject a muddy disc posing as emitted light; the atmosphere may be dark while the source remains bright. Reject an unrequested gradual zoom when a fixed close-up cut is requested.
Fail black foreground subjects that merge with the dark background: require a restrained contrasting outline or lighter silhouette edge, not an unrelated spotlight blob. Dogs must read as the same canine across shots, with muzzle/ears and a coherent neck/body. A howl raises the head and opens the jaw; it must not replace a four-legged dog with an unrelated upright human-shaped black wedge. Clues and reactions must be large enough to identify on a phone.
Check chronological samples: eyes and clues should be hidden before a reveal, then visible and persistent. A latch/prop must not disappear or jump without a scripted action. Reject heads crossing posts, detached body parts and wrong layer ordering. Captions are a protected foreground layer: reject particles/eyes/props crossing the text region. Changes in character height, shirt color or head shape across consecutive shots require a real camera cut/view, not a replacement person.
Check actual hand-to-handle contact across arm poses: an object at the elbow, hovering beside the hand or independently sliding is a defect. Check elbow/knee bending direction and transitions for pose resets. Check shoulder attachment across arm poses and synchronized two-eye blinks; an unrequested one-eye wink is a rig defect. A gate must have grounded posts, recognizable upright leaves/slats and attached hinges. Reject gate leaves floating diagonally away from their posts; a gate opens about a vertical hinge, not by tilting sideways in the image.
An intentional held pose is valid acting, including complete stillness while listening or reacting. Secondary motion is optional, never a requirement for passing review. Evaluate whether hair/cloth/hanging props/soft anatomy sway with small amplitude and lag, while feet and anchors stay fixed. Do not demand repeated main gestures merely to avoid stillness. Reject meaningless repeated head turns, waving or whole-body shaking. Motion counts are timing evidence, not proof of intent or smoothness; chronological pictures alone cannot establish frame-to-frame fluidity.
Repair must address only visible defects. Do not add random particles, floating eyes, flashing, silhouettes or motions that the story does not need. Do not invent missing audio problems from stills. Cite exact sceneId and evidence in the images; optional stylistic preferences are not blockers.`;

function json(raw:string){
  // Recover the exact numeric SVG-attribute typo seen in provider output:
  // "y2="70" -> "y2":70. Never infer prose, paths or arbitrary malformed JSON.
  raw=raw.replace(/"(x|y|x2|y2|width|height|rx|ry|opacity|strokeWidth)="(-?\d+(?:\.\d+)?)"(?=\s*[,}])/g,'"$1":$2');
  // Exact provider typo observed in occupied-hand plans: "hang:false}.
  // Only an object-key boundary and a literal boolean qualify; never prose.
  raw=raw.replace(/([{,]\s*)"hang:(true|false)(?=\s*[,}])/g,'$1"hang":$2');
  const start=raw.indexOf('{');let end=-1,depth=0,quoted=false,escaped=false;
  if(start<0)throw new Error('Vector Director did not return JSON');
  for(let i=start;i<raw.length;i++){
    const c=raw[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0){end=i;break;}
  }
  if(end<start)throw new Error('Vector Director did not return complete JSON');
  const parsed=JSON.parse(raw.slice(start,end+1)) as Record<string,unknown>;
  // Observed provider typo: {"newAssets":{...}},"scenes":[...]}.
  // Remove only the premature root brace when the COMPLETE result is valid
  // JSON. No missing artwork, prose or truncated arrays are inferred.
  const suffix=raw.slice(end+1).trim();
  if(Object.keys(parsed).length===1&&parsed.newAssets&&/^,\s*"scenes"\s*:/.test(suffix)){
    try{
      const recovered=JSON.parse(raw.slice(start,end)+suffix) as Record<string,unknown>;
      if(Array.isArray(recovered.scenes))return recovered;
    }catch{/* The ordinary patch validator reports incomplete output. */}
  }
  return parsed;
}
type VectorPreview={sceneId:string;imageUrl:string;times:number[];frames?:Array<{atMs:number;imageUrl:string}>};
function previewImages(frame:VectorPreview){
  if(frame.frames?.length)return frame.frames.flatMap(sample=>[
    {type:'text',text:`ACTUAL SVG RENDERED FRAME, sceneId=${frame.sceneId}, time=${sample.atMs}ms. This image is one complete video frame.`},
    {type:'image_url',image_url:{url:sample.imageUrl,detail:'high'}},
  ]);
  return [{type:'text',text:`ACTUAL SVG RENDERED FRAMES, sceneId=${frame.sceneId}; left to right, top to bottom.`},{type:'image_url',image_url:{url:frame.imageUrl,detail:'high'}}];
}
/** Keep the before/after and the actual action moments, not just the middle
 * image of a sheet (which may miss the narrated contact entirely). */
export function vectorReviewFrameIndices(times:number[],scene:CanvasStudioScene){
  if(!times.length)return [];
  const selected=new Set([0,times.length-1]);
  for(const beat of scene.vectorDirection?.beats||[]){
    const track=scene.vectorScene?.tracks.find(t=>t.cue===beat.cue&&beat.motionTargets.some(id=>t.target===id));
    const timing=vectorTrackTiming(track||{target:'',start:0,end:.2,cue:beat.cue,frames:[]},scene);
    const action=timing.start+(timing.end-timing.start)*(beat.kind==='strike'?.38:.5);
    selected.add(times.reduce((best,t,i)=>Math.abs(t-action)<Math.abs(times[best]!-action)?i:best,0));
    if(selected.size>=5)break;
  }
  if(selected.size<5)selected.add(Math.floor((times.length-1)/2));
  return [...selected].sort((a,b)=>a-b).slice(0,5);
}
export function buildVectorRepairContent(project:CanvasStudioProject,issues:VectorReviewIssue[],frames:VectorPreview[]){
  const allowed=new Set(issues.map(issue=>issue.sceneId));
  const content:Array<Record<string,unknown>>=[{type:'text',text:JSON.stringify({brief:project.sourcePrompt,issues,vectorAssets:project.vectorAssets,
    scenes:project.scenes.filter(s=>allowed.has(s.id)).map(s=>{const {id,name,durationMs,narration,visualBrief,vectorScene,vectorBeats,vectorDirection,dialogue}=s;const scene={id,name,durationMs,narration,visualBrief,vectorScene,vectorBeats,vectorDirection};return {...scene,physicalEvidence:vectorPhysicalEvidence(s,project.vectorAssets||{}),
      dialogue:dialogue?.map(({text,atMs,durationMs,speechWindows})=>({text,atMs,durationMs,speechWindows})),
      continuityEvidence:vectorContinuityEvidence(s,project),
      resolvedTracks:scene.vectorScene?.tracks.map(track=>({target:track.target,...vectorTrackTiming(track,s)})),
    };})})}];
  content.push(...vectorStyleReferenceContent(project.vectorStyleReferences));
  for(const frame of frames.filter(f=>allowed.has(f.sceneId))){
    content.push({type:'text',text:`Actual failing scene ${frame.sceneId}, chronological sample times ${frame.times.join(', ')}ms. Inspect these pictures when repairing geometry and tracks.`});
    content.push(...previewImages(frame));
  }
  return content;
}
export function selectVectorRepairScenes(raw:string,allowed:Set<string>):string{
  const patch=json(raw);
  if(!Array.isArray(patch.scenes))return raw;
  return JSON.stringify({...patch,scenes:patch.scenes.filter(s=>s&&typeof s==='object'&&allowed.has(String(s.id)))});
}
export function normalizeVectorReferenceImages(raw:unknown):string[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>4||raw.some(image=>typeof image!=='string'||image.length>1500000||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image)))throw new Error('Use up to four local PNG/JPEG/WebP reference images, at most 1 MB each.');
  return raw;
}
function preserveApprovedCastParts(project:CanvasStudioProject,raw:unknown){
  const assets={...(raw as Record<string,unknown>)};
  for(const [id,approved] of Object.entries(project.vectorAssets||{})){
    if(!approved.nodes.some(n=>n.id==='puppet-root'))continue;
    // Scene refinement owns staging, not the previously approved cast artwork.
    // Reuse it even when the provider omits or explicitly simplifies the model.
    assets[id]=approved;
  }
  return assets;
}
export function applyVectorRedesign(project:CanvasStudioProject,raw:string){
  const draft=json(raw);
  // Native extra slots validate their cast during expansion. Resolve retained
  // approved actors before that check, not only during later normalization.
  const retained=preserveApprovedCastParts(project,draft.vectorAssets);
  for(const stage of Object.values((draft.vectorStages||{}) as Record<string,Record<string,unknown>>)){
    if(stage?.template!=='illustrated-place'||!Array.isArray(stage.extras))continue;
    for(const extra of stage.extras){
      if(typeof extra?.asset==='string'&&project.vectorAssets?.[extra.asset]?.nodes.some(n=>n.id==='puppet-root'))
        draft.vectorAssets={...(draft.vectorAssets||{}) as Record<string,unknown>,[extra.asset]:retained[extra.asset]};
    }
  }
  const data=expandVectorStageLibrary(draft,project),assets=normalizeVectorAssets(preserveApprovedCastParts(project,data.vectorAssets));
  const vectorStages=normalizeStages(data.vectorStages,assets,project);
  if(!Array.isArray(data.scenes)||data.scenes.length!==project.scenes.length)throw new Error('Redesign must preserve every shot.');
  const edits=new Map<string,Record<string,unknown>>();
  for(const value of data.scenes){
    if(!value||typeof value!=='object')throw new Error('Invalid redesigned shot.');
    const edit=value as Record<string,unknown>;
    if(typeof edit.id!=='string'||!project.scenes.some(s=>s.id===edit.id)||edits.has(edit.id))throw new Error('Redesign changed shot identities.');
    edits.set(edit.id,edit);
  }
  return compileVectorProject({...project,vectorAssets:assets,vectorStages,vectorReview:undefined,scenes:project.scenes.map(scene=>{
    const edit=edits.get(scene.id)!;
    if(edit.narration!==undefined&&edit.narration!==scene.narration)throw new Error('Redesign changed narration.');
    const drawing=resolveStage(edit.vectorScene,vectorStages,assets);
    // A visual-only redesign cannot invent spoken words. Invalid optional cues
    // fall back to the explicit authored start/end; retained audio stays intact.
    const vectorScene=Array.isArray(drawing?.tracks)?{...drawing,tracks:drawing.tracks.map(track=>{
      if(!track||typeof track!=='object')return track;
      const {cue,...timing}=track as Record<string,unknown>;
      return typeof cue==='string'&&scene.narration&&!scene.narration.includes(cue)?timing:track;
    })}:drawing;
    const normalized=normalizeVectorScene(vectorScene,assets,scene.narration);
    return {...scene,vectorFramingVersion:undefined,vectorScene:normalized,vectorStageId:typeof drawing.stage==='string'?drawing.stage:undefined,
      vectorBeats:narrationBeats(edit.vectorBeats,normalized,assets,scene.narration||''),...(typeof edit.visualBrief==='string'?{visualBrief:edit.visualBrief.slice(0,1500)}:{})};
  })});
}
export function buildVectorReviewContent(project:CanvasStudioProject,frames:VectorPreview[],brief:string,only?:Set<string>){
  const scenes=project.scenes.filter(scene=>!only||only.has(scene.id));
  const ids=new Set(scenes.map(scene=>scene.id));
  const content:Array<Record<string,unknown>>=[{type:'text',text:JSON.stringify({brief,scenes:scenes.map(scene=>({id:scene.id,name:scene.name,narration:scene.narration,visualBrief:scene.visualBrief,vectorStageId:scene.vectorStageId,vectorBeats:scene.vectorBeats,vectorDirection:scene.vectorDirection,sampleTimes:frames.find(f=>f.sceneId===scene.id)?.times,physicalEvidence:vectorPhysicalEvidence(scene,project.vectorAssets||{}),framingEvidence:vectorFramingEvidence(scene,project.vectorAssets||{}),motionEvidence:vectorMotionEvidence(scene),ensembleEvidence:vectorEnsembleCoverage(scene,project.vectorAssets||{})}))})}];
  content.push({type:'text',text:'AUTHORITATIVE ACTOR CONTINUITY: the following coordinates are local to each unchanged stage parent, not screen pixels. Compare previousEnd with currentStart only on the same stage/parent. A camera cut changes screen position without changing actor placement. facingScaleX < 0 is LEFT, > 0 is RIGHT for a front-view native village cutout. Do not claim a facing reset or a root teleport contradicted by these evaluated values. Native fear uses a deliberately small shiver; do not amplify it solely to exceed a generic motion threshold.'});
  content.push({type:'text',text:JSON.stringify({shotSubjects:scenes.map(scene=>({sceneId:scene.id,subjects:scene.vectorDirection?[...new Set([scene.vectorDirection.shot.focus,...scene.vectorDirection.shot.include])].map(id=>({id,samples:[.3,.65,.95].map(t=>vectorShotVisibility(scene,project.vectorAssets||{},id,t*scene.durationMs))})):[]}))})});
  content.push({type:'text',text:JSON.stringify({actorContinuity:scenes.map(scene=>({sceneId:scene.id,...vectorContinuityEvidence(scene,project)}))})});
  content.push(...vectorStyleReferenceContent(project.vectorStyleReferences));
  for(const frame of frames.filter(frame=>ids.has(frame.sceneId)))content.push(...previewImages(frame));
  return {scenes,content};
}
export function vectorPhysicalEvidence(scene:CanvasStudioScene,assets:NonNullable<CanvasStudioProject['vectorAssets']>){
  const drawing=scene.vectorScene!;
  const sampleTimes=[0,scene.durationMs*.15,scene.durationMs*.3,scene.durationMs*.6,scene.durationMs];
  const emitters=drawing.nodes.flatMap(n=>n.type==='instance'?assets[n.asset!]!.nodes.filter(p=>p.light).map(p=>({target:n.id+'/'+p.id,opacity:p.opacity??1})):n.light?[{target:n.id,opacity:n.opacity??1}]:[]);
  return {ground:drawing.ground,groundedObjects:drawing.nodes.filter(n=>n.groundAnchor).map(n=>({id:n.id,anchor:n.groundAnchor})),
    animatedVisibility:[...new Set(drawing.tracks.filter(t=>t.frames.some(f=>f.opacity!==undefined)).map(t=>t.target))].map(target=>({target,
      frames:sampleTimes.map(atMs=>({atMs,opacity:evaluateVectorPart(target,scene,atMs).opacity}))})),
    emitterStates:emitters.map(e=>({target:e.target,frames:sampleTimes.map(atMs=>({atMs,opacity:evaluateVectorPart(e.target,scene,atMs,e.opacity).opacity}))})),
    carriedProps:drawing.nodes.filter(n=>n.attachTo&&n.type==='instance').map(n=>({id:n.id,attachTo:n.attachTo,hang:n.hang===true,
      frames:[0,.5,1].map(t=>{
        const atMs=Math.round(t*scene.durationMs),matrix=vectorWorldMatrix(n.id,scene,atMs,assets),asset=assets[n.asset!]!;
        const points=[[0,0],[asset.width,0],[0,asset.height],[asset.width,asset.height]].map(([x,y])=>vectorPoint(matrix,x!,y!));
        const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
        const area=(right-left)*(bottom-top),visible=Math.max(0,Math.min(right,drawing.width)-Math.max(left,0))*Math.max(0,Math.min(bottom,drawing.height)-Math.max(top,0));
        return {atMs,bounds:{left,right,top,bottom},visibleFraction:area?visible/area:0,
          ...(assets[drawing.nodes.find(actor=>n.attachTo!.startsWith(actor.id+'/'))?.asset||'']?.nodes.some(p=>p.id==='puppet-root')?{handOpacity:puppetHandOpacity(n.attachTo!,scene,atMs)}:{})};
      }),
    }))};
}

/** Nominal actor height including the evaluated whole-world camera, before
 * cropping. This disambiguates medium acting shots from tiny wide figures. */
function vectorFramingEvidence(scene:CanvasStudioScene,assets:NonNullable<CanvasStudioProject['vectorAssets']>){
  const nodes=scene.vectorScene?.nodes||[];
  const actors=nodes.filter(n=>n.type==='instance'&&assets[n.asset!]?.nodes.some(p=>p.id==='head-group')).map(actor=>{
    let scale=1,current:typeof actor|undefined=actor;
    while(current){
      scale*=Math.abs((current.scaleY??1)*evaluateVectorPart(current.id,scene,0).scaleY);
      if(current!==actor&&current.type==='instance')scale*=(current.height??assets[current.asset!]!.height)/assets[current.asset!]!.height;
      current=current.parent?nodes.find(n=>n.id===current!.parent):undefined;
    }
    const parts=assets[actor.asset!]!.nodes;
    return {actor:actor.id,rig:parts.some(n=>n.id==='puppet-root')?'simple-puppet':'articulated',wholeWorldScale:scale,unzoomedWide:scale<=1.05,firstFrameNominalHeightFraction:(actor.height??assets[actor.asset!]!.height)*scale/(scene.vectorScene?.height||1),
      hands:parts.filter(n=>/^hand-[lr]$/.test(n.id)).map(n=>({id:n.id,parent:n.parent})),
      heldProps:parts.filter(n=>n.type==='group'&&/^(forearm|hand)-[lr]$/.test(n.parent||'')).map(n=>({id:n.id,parent:n.parent}))};
  });
  return actors;
}
/** Evaluated transforms, including cue timing and holds; this is not a visual-quality score. */
export function vectorContinuityEvidence(scene:CanvasStudioScene,project:CanvasStudioProject){
  const previous=project.scenes[project.scenes.findIndex(s=>s.id===scene.id)-1];
  const pose=(s:CanvasStudioScene,id:string,at:number)=>{
    const node=s.vectorScene?.nodes.find(n=>n.id===id&&n.type==='instance');
    if(!node)return undefined;
    const root=evaluateVectorPart(id,s,at);
    return {parent:node.parent,x:(node.x??0)+root.dx,y:(node.y??0)+root.dy,
      facingScaleX:evaluateVectorPart(id+'/upper-body',s,at).scaleX};
  };
  const sameStage=Boolean(previous&&scene.vectorStageId&&scene.vectorStageId===previous.vectorStageId&&scene.vectorDirection?.continuity!=='reset');
  return {sameStage,actors:scene.vectorScene?.nodes.filter(n=>n.type==='instance'&&project.vectorAssets?.[n.asset!]?.nodes.some(p=>p.id==='puppet-root')).map(n=>({actor:n.id,
    ...(sameStage?{previousEnd:pose(previous!,n.id,previous!.durationMs)}:{}),currentStart:pose(scene,n.id,0),currentEnd:pose(scene,n.id,scene.durationMs)}))};
}

export function vectorScreenplayCorrection(error:unknown){
  return `Repair the saved screenplay, preserving its story and all user events. Validation: ${String(error)}. Return complete JSON, not commentary. Check ALL shots now, not only the first reported beat. Every compact whole-body turn needs turn:{actor,from:"right",to:"left"} or the reverse (back for a rear view), with actor/upper-body in motionTargets. Keep the chosen facing through later shots; front and right are equivalent. Every compact travel needs travel:{actor,to,gap:80,followDepth:true}, its actor root in motionTargets and destination in targets; cue it at the spoken walking phrase, not the stop. Fear uses fear:{actor,level:"terrified"} with the actual face/body/sweat parts. An actor disappearing needs its own hide beat at a spoken phrase, not merely another person trembling. Every background visit needs a registered partner. Keep heldProps/propEvents/visibleCast on every shot. Narration must be natural Vietnamese WITH diacritics, never technical drawing instructions.`;
}
export function vectorMotionEvidence(scene:CanvasStudioScene){
  const tracks=scene.vectorScene?.tracks||[];
  const targets=[...new Set(tracks.map(track=>track.target))];
  const step=100; // Approximate motion intervals to 100ms; pictures still own visibility/anatomy.
  const evaluated=targets.map(target=>{
    const intervals:Array<[number,number]>=[];
    let previous=evaluateVectorPart(target,scene,0);
    const ranges=new Map<string,[number,number]>();
    for(const key of ['dx','dy','rotation','scaleX','scaleY','opacity'] as const)ranges.set(key,[previous[key],previous[key]]);
    for(let start=0;start<scene.durationMs;start+=step){
      const end=Math.min(scene.durationMs,start+step),next=evaluateVectorPart(target,scene,end);
      for(const key of ['dx','dy','rotation','scaleX','scaleY','opacity'] as const){const range=ranges.get(key)!;range[0]=Math.min(range[0],next[key]);range[1]=Math.max(range[1],next[key]);}
      if(Object.keys(next).some(key=>next[key as keyof typeof next]!==previous[key as keyof typeof previous])){
        const last=intervals.at(-1);
        if(last?.[1]===start)last[1]=end;else intervals.push([start,end]);
      }
      previous=next;
    }
    return {target,changes:Object.fromEntries([...ranges].filter(([,range])=>range[1]-range[0]>1e-6)),changedIntervalsMs:intervals,trackTimingMs:tracks.filter(t=>t.target===target).map(t=>vectorTrackTiming(t,scene))};
  });
  const cameraTargets=new Set(scene.vectorScene?.nodes.filter(n=>n.type==='group'&&/^camera-world(?:-\d+)?$/.test(n.id)).map(n=>n.id));
  const parts=evaluated.filter(part=>!cameraTargets.has(part.target));
  const camera=evaluated.filter(part=>cameraTargets.has(part.target));
  const intervals=parts.flatMap(part=>part.changedIntervalsMs).sort((a,b)=>a[0]-b[0]);
  let end=0,longestUnchangedMs=0;
  for(const interval of intervals){longestUnchangedMs=Math.max(longestUnchangedMs,interval[0]-end);end=Math.max(end,interval[1]);}
  longestUnchangedMs=Math.max(longestUnchangedMs,scene.durationMs-end);
  return {durationMs:scene.durationMs,resolutionMs:step,longestUnchangedMs,parts,...(camera.length?{camera}:{})};
}
function normalizeStages(rawStages:unknown,assets:CanvasStudioProject['vectorAssets'],size:{width:number;height:number}){
  const stages:Record<string,ReturnType<typeof normalizeVectorScene>>={};
  if(rawStages!==undefined){
    if(!rawStages||typeof rawStages!=='object'||Array.isArray(rawStages)||Object.keys(rawStages).length>40)throw new Error('Vector: invalid stage collection');
    for(const [key,raw] of Object.entries(rawStages)){
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(key)||!raw||typeof raw!=='object')throw new Error('Vector: invalid stage identity');
      if((raw as Record<string,unknown>).camera!==undefined)throw new Error('Vector: reusable stage must remain unframed');
      stages[key]=normalizeVectorScene({width:size.width,height:size.height,...raw},assets||{});
    }
  }
  return stages;
}
function stageAdditions(raw:unknown,stage:CanvasVectorScene){
  if(raw!==undefined&&!Array.isArray(raw))throw new Error('Vector: invalid stage additions');
  const additions=(raw||[]) as Array<{id?:string}>;
  const collisions=additions.filter(n=>!n||stage.nodes.some(b=>b.id===n.id));
  if(collisions.length)throw new Error(`Vector: stage additions may not replace existing geometry: ${collisions.map(n=>n?.id||'invalid node').join(', ')}. Reuse existing stage objects with tracks; remove the duplicate and its redrawn descendants. Available objects: ${stage.nodes.filter(n=>n.type==='group'||n.type==='instance').map(n=>n.id).slice(0,24).join(', ')}`);
  return additions;
}
function resolveStage(raw:unknown,stages:CanvasStudioProject['vectorStages'],assets:NonNullable<CanvasStudioProject['vectorAssets']>){
  if(!raw||typeof raw!=='object')throw new Error('Vector: missing drawing');
  const d=raw as Record<string,unknown>;
  if(d.stage===undefined)return d;
  if(typeof d.stage!=='string'||!stages?.[d.stage])throw new Error('Vector: missing reusable stage');
  const base=stages[d.stage]!;
  const additions=stageAdditions(d.nodes,base);
  if(d.tracks!==undefined&&!Array.isArray(d.tracks))throw new Error('Vector: invalid animation tracks');
  const authored=(d.tracks as Array<{target?:unknown;frames?:Array<Record<string,unknown>>}>||[]);
  // Compile physical commands before merging stage channels. Otherwise a native
  // walk/light/reaction can conflict with the stage's quiet resting animation.
  const compiled=normalizeVectorScene({...base,...d,camera:undefined,shot:undefined,nodes:[...base.nodes,...additions],tracks:authored},assets);
  return {...compiled,stage:d.stage,...(d.camera!==undefined?{camera:d.camera}:{}),...(d.shot!==undefined?{shot:d.shot}:{}),tracks:mergeRepairTracks(base.tracks,compiled.tracks)};
}
function mergeRepairTracks(base:VectorTrack[],updates:VectorTrack[]):VectorTrack[]{
  const inherited=base.flatMap(track=>{
    const channels=new Set(updates.filter(t=>t.target===track.target&&
      (t.cue&&t.cue===track.cue||track.start<t.end&&t.start<track.end))
      .flatMap(t=>t.frames.flatMap(f=>Object.keys(f).filter(k=>!['t','easing'].includes(k)))));
    const frames=track.frames.map(f=>Object.fromEntries(Object.entries(f).filter(([key])=>!channels.has(key)))) as VectorTrack['frames'];
    return frames.some(f=>Object.keys(f).some(k=>!['t','easing'].includes(k)))?[{...track,frames}]:[];
  });
  return [...inherited,...updates];
}
/** The screenplay chooses supported actions; the engine owns their mechanics.
 * Omitting rows/strikes in artwork cannot leave these declared beats static. */
function stagePlannedPerformance(raw:unknown,stage:CanvasVectorScene,assets:NonNullable<CanvasStudioProject['vectorAssets']>,direction:VectorStory['shots'][number]){
  const input=raw as Record<string,unknown>;
  stageAdditions(input.nodes,stage);
  const carries=[...(input.carries||[]) as Array<Record<string,unknown>>];
  const present=new Set([...stage.nodes,...(input.nodes||[]) as Array<{id:string}>].map(n=>n.id));
  // Inherited inventory may be omitted in a close-up. The sequential compiler
  // restores it from the preceding shot after all raw scenes are normalized.
  for(const held of direction.heldProps||[])if(present.has(held.actor)&&present.has(held.prop)&&!carries.some(c=>c.prop===held.prop))carries.push({...held});
  const d:Record<string,unknown>={...input,...(carries.length?{carries}:{})};
  // A supplied walk without a speech anchor ran early after TTS shortened the
  // scene. Bind only an unambiguous screenplay travel beat, keeping its route,
  // duration and artist-authored destination. Never invent a route or re-cue a hold.
  if(Array.isArray(input.walks))d.walks=input.walks.map((walk:Record<string,unknown>)=>{
    if(walk.cue!==undefined||walk.hold)return walk;
    const matches=direction.beats.filter(b=>b.kind==='travel'&&b.motionTargets.includes(String(walk.actor)));
    return matches.length===1?{...walk,cue:matches[0]!.cue}:walk;
  });
  const planned=direction.beats.filter(b=>b.travel);
  if(planned.length){
    const actors=new Set(planned.map(b=>b.travel!.actor));
    const retained=((d.walks||[]) as Array<Record<string,unknown>>).filter(w=>!actors.has(String(w.actor)));
    d.walks=[...retained,...planned.map(beat=>{
      const start=Math.min(.75,Math.max(0,direction.narration.indexOf(beat.cue))/Math.max(1,direction.narration.length));
      const next=direction.beats.map(b=>direction.narration.indexOf(b.cue)/direction.narration.length).filter(t=>t>start+.03).sort((a,b)=>a-b)[0]??1;
      return {...beat.travel,start,end:Math.min(1,next,start+.55),cue:beat.cue};
    })];
    const authoredActors=new Set(planned.map(b=>b.travel!.actor));
    d.tracks=((d.tracks||[]) as VectorTrack[]).filter(t=>!authoredActors.has(t.target)||t.cue!==undefined&& !planned.some(b=>b.cue===t.cue));
  }
  const world=normalizeVectorDrawing({...stage,nodes:[...stage.nodes,...(d.nodes||[]) as unknown[]]});
  const rows:Array<Record<string,unknown>>=[],strikes:Array<Record<string,unknown>>=[];
  for(const beat of direction.beats){
    if(!['row','strike'].includes(beat.kind))continue;
    const arm=beat.motionTargets.find(t=>/\/(?:arm|hand)-[lr]$/.test(t));
    if(!arm)continue;
    const [actor,part]=arm.split('/'),node=world.nodes.find(n=>n.id===actor&&n.type==='instance'),asset=assets[node?.asset||''];
    if(!asset)continue;
    const supplied=((d[beat.kind==='row'?'rows':'strikes']||[]) as Array<Record<string,unknown>>).find(r=>r.actor===actor&&r.cue===beat.cue);
    if(beat.kind==='row'){
      if(asset.nodes.some(n=>n.id==='oar'))rows.push({actor,arm:part!.slice(-1),prop:actor+'/oar',cycles:2,start:0,end:.65,...supplied,cue:beat.cue});
    }else{
      // A released implement hitting the ground is not a bare-hand tap. Keep
      // the illustrator's implement trajectory instead of solving the hand
      // to the implement's resting position (often outside arm reach).
      const movingImplement=!supplied&&beat.motionTargets.some(id=>{
        const prop=world.nodes.find(n=>n.id===id&&n.type==='instance');
        return prop&&vectorPropGrip(assets[prop.asset||''])&&((d.tracks||[]) as VectorTrack[]).some(t=>t.target===id&&t.frames.length>1);
      });
      if(movingImplement)continue;
      const target=beat.targets.find(id=>id!==actor&&world.nodes.some(n=>n.id===id));
      if(target)strikes.push({actor,arm:part!.slice(-1),target,start:0,end:.45,...supplied,cue:beat.cue});
    }
  }
  if(!rows.length&&!strikes.length)return d;
  // Keep commands until normalizeVectorScene has compiled preceding travel.
  // Solving here used the actor's old resting location and missed the prop.
  return {...d,...(rows.length?{rows}:{}),...(strikes.length?{strikes}:{})};
}
/** Visual review repairs only named nodes/channels. Unmentioned camera,
 * anatomy, acting and context survive instead of being regenerated. */
function patchVectorScene(base:CanvasVectorScene,raw:unknown,assets:NonNullable<CanvasStudioProject['vectorAssets']>,spoken:string,context?:CanvasStudioScene):CanvasVectorScene{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid scene patch');
  const patch=raw as Record<string,unknown>;
  if(Object.keys(patch).some(k=>!['nodes','tracks','removeNodes','removeTracks','reaches','reveals','walks','turns','reactions','lights','hinges','footsteps','ground','shot','rows','strikes','carries'].includes(k)))throw new Error('Vector: unknown scene patch field');
  for(const key of ['nodes','tracks','removeNodes','removeTracks'] as const)if(patch[key]!==undefined&&!Array.isArray(patch[key]))throw new Error(`Vector: invalid patch ${key}`);
  const removals=[...(patch.removeNodes||[]) as unknown[]],trackRemovals=(patch.removeTracks||[]) as unknown[];
  if(removals.some(id=>typeof id!=='string'||!base.nodes.some(n=>n.id===id))||trackRemovals.some(id=>typeof id!=='string'||!base.tracks.some(t=>t.target===id)))throw new Error('Vector: patch removal must name an existing node or track target');
  // A native trail is one generated object. Replacing it must remove its owned
  // layer, marks, toes and reveal tracks together, not leave orphan children.
  if(Array.isArray(patch.footsteps))for(const raw of patch.footsteps){
    const id=(raw as Record<string,unknown>)?.id,root=typeof id==='string'?id+'-floor':'';
    if(!base.nodes.some(n=>n.id===root))continue;
    const owned=new Set([root]);let size=0;
    while(size!==owned.size){size=owned.size;for(const n of base.nodes)if(n.parent&&owned.has(n.parent))owned.add(n.id);}
    for(const id of owned)if(!removals.includes(id))removals.push(id);
  }
  const nodes=base.nodes.filter(n=>!removals.includes(n.id)).map(n=>({...n})),updated=new Set<string>(),reattached=new Set<string>();
  const camera=base.nodes.find(n=>!n.parent&&/^camera-world(?:-\d+)?$/.test(n.id));
  const cameraUpdates=(patch.tracks as VectorTrack[]||[]).filter(t=>t.target===camera?.id);
  const fixedDetail=context?.vectorDirection?.shot.size==='detail'&&cameraUpdates.every(t=>t.frames.length===1&&t.frames[0]!.t===0);
  if(base.ground&&camera&&cameraUpdates.length&&!fixedDetail)throw new Error('Vector: use shot:{target:"actor-id",height:0.5,include:["needed-object-id"]} to reframe a grounded scene; do not guess camera-world tracks');
  for(const raw of (patch.nodes||[]) as unknown[]){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid patched node');
    const node=raw as CanvasVectorScene['nodes'][number];
    if(typeof node.id!=='string'||updated.has(node.id)||removals.includes(node.id))throw new Error('Vector: invalid or duplicate patched node identity');
    updated.add(node.id);
    const index=nodes.findIndex(n=>n.id===node.id);
    // A model may copy an unchanged native support under a new context ID.
    // Repainting that opaque path at the end covers the actors. Keep the ID
    // as a non-painted alias only when geometry/style/parent match EXACTLY
    // and the copy owns no motion, children or attachments.
    const shapeKey=(n:CanvasVectorScene['nodes'][number])=>JSON.stringify(Object.entries(n).filter(([k])=>k!=='id').sort(([a],[b])=>a.localeCompare(b)));
    const frozenCopy=node.type==='path'&&node.fill?.startsWith('#')&&(node.opacity??1)===1
      &&!base.tracks.some(t=>t.target===node.id)&&!(patch.tracks as VectorTrack[]||[]).some(t=>t.target===node.id)
      &&!nodes.some(n=>n.parent===node.id||n.attachTo===node.id)
      &&nodes.some(n=>n.id!==node.id&&n.type==='path'&&shapeKey(n)===shapeKey(node));
    if(frozenCopy){
      const alias:CanvasVectorScene['nodes'][number]={id:node.id,type:'group',...(node.parent?{parent:node.parent}:{})};
      if(index>=0)nodes[index]=alias;else nodes.push(alias);
      continue;
    }
    if(index>=0){
      nodes[index]={...nodes[index]!,...node};
      if(node.attachTo!==undefined&&node.parent===undefined){delete nodes[index]!.parent;reattached.add(node.id);}
      if(node.parent!==undefined&&node.attachTo===undefined)delete nodes[index]!.attachTo;
    }
    else nodes.push({...node,...(!node.parent&&!node.attachTo&&camera?{parent:camera.id}:{})});
  }
  // Reattachment changes the coordinate frame, not a narrated light/reveal.
  // Discard obsolete world travel while retaining its original opacity event.
  if(Array.isArray(patch.carries))for(const carry of patch.carries){
    const prop=(carry as Record<string,unknown>)?.prop;
    if(typeof prop==='string')reattached.add(prop);
  }
  const events=base.tracks.filter(t=>reattached.has(t.target)&&t.cue&&new Set(t.frames.map(f=>f.opacity).filter(v=>v!==undefined)).size>1
    &&!(patch.tracks as VectorTrack[]||[]).some(update=>update.target===t.target&&update.frames?.some(f=>f.opacity!==undefined)))
    .map(t=>({...t,frames:t.frames.filter(f=>f.opacity!==undefined).map(f=>({t:f.t,opacity:f.opacity,easing:f.easing}))}));
  const authored=(patch.tracks as VectorTrack[]||[]).map(t=>events.some(e=>e.target===t.target)?{...t,frames:t.frames.map(({opacity,...f})=>f)}:t);
  const inherited=base.tracks.map(t=>reattached.has(t.target)?{...t,frames:t.frames.map(({dx,dy,rotation,scaleX,scaleY,...f})=>f)}:t);
  let updates=normalizeVectorScene({...base,nodes,tracks:[...authored,...events],reaches:patch.reaches,reveals:patch.reveals,
    walks:patch.walks,turns:patch.turns,reactions:patch.reactions,lights:patch.lights,hinges:patch.hinges,footsteps:patch.footsteps,rows:patch.rows,strikes:patch.strikes,carries:patch.carries,ground:patch.ground??base.ground},assets,spoken);
  if(patch.shot!==undefined){
    const acting={...updates,tracks:mergeRepairTracks(inherited.filter(t=>!trackRemovals.includes(t.target)),updates.tracks)};
    const frames=vectorSubjectCamera(acting,assets,patch.shot,context);
    const framed=frameVectorScene({...updates,tracks:[]},frames);
    updates=camera?{...updates,tracks:[...updates.tracks,{...framed.tracks.at(-1)!,target:camera.id}]}:{...framed,tracks:[...updates.tracks,...framed.tracks]};
  }
  return normalizeVectorScene({...updates,tracks:mergeRepairTracks(inherited.filter(t=>!trackRemovals.includes(t.target)&&!removals.includes(t.target)),updates.tracks)},assets,spoken);
}
function narrationBeats(raw:unknown,scene:ReturnType<typeof normalizeVectorScene>,assets:NonNullable<CanvasStudioProject['vectorAssets']>,spoken:string){
  if(raw===undefined)return undefined;
  const targets=vectorTargets(scene,assets);
  if(!Array.isArray(raw)||raw.length>16)throw new Error('Vector: invalid narration beats');
  return raw.map(value=>{
    const b=value as Record<string,unknown>;
    // A directed beat combines up to eight participants and sixteen moving parts.
    if(!b||typeof b.cue!=='string'||!b.cue.trim()||!spoken.includes(b.cue)||!Array.isArray(b.targets)||!b.targets.length||b.targets.length>24||b.targets.some(t=>typeof t!=='string'||!targets.has(t)))throw new Error(`Vector: narration beat must name spoken words and existing targets; cue=${String(b?.cue)}, missing=${Array.isArray(b?.targets)?b.targets.filter(t=>typeof t!=='string'||!targets.has(t)).join(', '):'targets'}`);
    return {cue:b.cue,targets:b.targets as string[]};
  });
}

export function parseVectorPlan(raw:string,brief:string,size:{width:number;height:number},targetSeconds?:number,story?:VectorStory):CanvasStudioProject{
  const authored=json(raw);if(story)assertVectorStoryFilm(authored,story);
  const data=expandVectorStageLibrary(authored,size),assets=normalizeVectorAssets(data.vectorAssets);
  if(!Array.isArray(data.scenes)||!data.scenes.length||data.scenes.length>100)throw new Error('Vector film needs 1-100 complete shots');
  const stages=normalizeStages(data.vectorStages,assets,size);
  const now=new Date().toISOString();
  let previousDrawing:CanvasVectorScene|undefined;
  const scenes=data.scenes.map((raw,index):CanvasStudioScene=>{
    if(!raw||typeof raw!=='object')throw new Error('Vector film has an invalid shot');
    const s=raw as Record<string,unknown>;
    const direction=story?.shots[index];
    const narration=typeof s.narration==='string'?s.narration.trim():'';
    if(!narration||narration.length>3000)throw new Error('Vector shot needs complete narration');
    const durationMs=Number(s.durationMs);
    if(!Number.isFinite(durationMs)||durationMs<1000||durationMs>30000)throw new Error('Vector shot duration must be 1-30 seconds');
    const vectorStageId=(s.vectorScene as Record<string,unknown>)?.stage as string|undefined;
    if(direction&&vectorStageId!==direction.location)throw new Error(`Drawing must reuse screenplay location ${direction.location}`);
    let sceneInput=s.vectorScene;
    // A continued carried prop can be omitted from later shot geometry. Restore
    // its established instance BEFORE validating carries/native actions; the
    // sequential compiler then preserves the actual pose and hand ownership.
    if(previousDrawing&&direction?.continuity!=='reset'&&sceneInput&&typeof sceneInput==='object'){
      const input=sceneInput as Record<string,unknown>,base=stages[vectorStageId!];
      const additions=Array.isArray(input.nodes)?[...input.nodes] as Array<{id?:string}>:[];
      const present=new Set([...(base?.nodes||[]),...(additions||[])].map(n=>n.id));
      const carries=[...(Array.isArray(input.carries)?input.carries:[]),...(direction?.heldProps||[])];
      const restored=[];
      for(const c of carries){
        if(!c||typeof c!=='object')continue;
        if(present.has(c.prop))continue;
        const old=previousDrawing.nodes.find(n=>n.id===c.prop&&n.type==='instance'&&n.attachTo===`${c.actor}/hand-${c.arm}`);
        if(old){restored.push({...old});present.add(old.id);}
      }
      if(restored.length&&(input.nodes===undefined||Array.isArray(input.nodes)))sceneInput={...input,nodes:[...additions,...restored]};
    }
    if(direction)sceneInput=stagePlannedPerformance(sceneInput,stages[vectorStageId!]!,assets,direction);
    // Locked screenplay framing owns the camera. Illustrator shot fields may
    // repeat the screenplay schema; native framing is compiled after parsing.
    if(direction){
      const {shot:ignoredShot,camera:ignoredCamera,...drawing}=sceneInput as Record<string,unknown>;
      sceneInput={...drawing,camera:[{t:0,x:size.width/2,y:size.height/2,zoom:1}]};
    }
    const vectorScene=normalizeVectorScene(resolveStage(sceneInput,stages,assets),assets,narration);
    previousDrawing=vectorScene;
    if(direction?.visibleCast?.some(actor=>!vectorScene.nodes.some(n=>n.id===actor&&n.type==='instance')))throw new Error('Drawing must include every visibleCast actor in the locked location');
    // A named clue may be drawn as a reusable asset part (mud-hand becomes
    // dock/mud-hand). Resolve only an EXACT, UNIQUE part ID, never fuzzy nouns
    // or made-up geometry. The same story and requirement then use its real ID.
    const available=vectorTargets(vectorScene,assets),address=(id:string)=>{
      if(available.has(id))return id;
      const parts=[...available].filter(t=>t.endsWith('/'+id));return parts.length===1?parts[0]!:id;
    };
    const resolved=direction?{...direction,shot:{...direction.shot,focus:address(direction.shot.focus),include:direction.shot.include.map(address)},
      beats:direction.beats.map(b=>({...b,targets:b.targets.map(address),motionTargets:b.motionTargets.map(address)}))}:undefined;
    const vectorBeats=narrationBeats(resolved?resolved.beats.map(b=>({cue:b.cue,targets:[...new Set([...b.targets,...b.motionTargets])]})):s.vectorBeats,vectorScene,assets,narration);
    if(vectorScene.width!==size.width||vectorScene.height!==size.height)throw new Error('Vector drawing orientation does not match the requested frame');
    const id=randomUUID();
    return {id,name:typeof s.name==='string'?s.name.slice(0,120):`Cảnh ${index+1}`,durationMs,
      narration,dialogue:[{id:randomUUID(),speaker:'Người kể',text:narration,delivery:'natural',emotion:'storytelling'}],
      visualBrief:typeof s.visualBrief==='string'?s.visualBrief.slice(0,1500):'',
      background:'night',template:'wide-establishing',objects:[],vectorScene,...(vectorStageId?{vectorStageId}:{}),...(vectorBeats?{vectorBeats}:{}),...(resolved?{vectorDirection:{purpose:resolved.purpose,location:resolved.location,shot:resolved.shot,beats:resolved.beats,...(resolved.visibleCast!==undefined?{visibleCast:resolved.visibleCast}:{}),...(resolved.backgroundActions!==undefined?{backgroundActions:resolved.backgroundActions}:{}),...(resolved.heldProps!==undefined?{heldProps:resolved.heldProps}:{}),...(resolved.propEvents?{propEvents:resolved.propEvents}:{}),...(resolved.continuity?{continuity:resolved.continuity}:{})}}:{}),
      ...(s.soundEffects!==undefined?{soundEffects:normalizeCanvasSoundCues(s.soundEffects,durationMs)}:{})};
  });
  if(targetSeconds){
    const total=scenes.reduce((sum,s)=>sum+s.durationMs,0),frame=1000/30;let allocated=0;
    for(const scene of scenes){
      const before=scene.durationMs;
      scene.durationMs=Math.max(frame,Math.round(scene.durationMs*targetSeconds*1000/total/frame)*frame);allocated+=scene.durationMs;
      if(scene.soundEffects)scene.soundEffects=normalizeCanvasSoundCues(scene.soundEffects.map(cue=>({...cue,atMs:Math.round(cue.atMs*scene.durationMs/before),durationMs:Math.round(cue.durationMs*scene.durationMs/before)})),scene.durationMs);
    }
    scenes.at(-1)!.durationMs+=targetSeconds*1000-allocated;
  }
  return compileVectorProject({version:1,id:randomUUID(),name:typeof data.name==='string'?data.name.slice(0,120):'Vector Animation',
    width:size.width,height:size.height,fps:30,createdAt:now,updatedAt:now,sourcePrompt:brief,vectorAssets:assets,...(story?{vectorStory:{premise:story.premise,stakes:story.stakes,turn:story.turn,ending:story.ending}}:{}),...(Object.keys(stages).length?{vectorStages:stages}:{}),scenes});
}
export type VectorReviewIssue={sceneId:string;problem:string;fix:string};
export function parseVectorReview(raw:string,project:CanvasStudioProject){
  const report=json(raw);
  if(typeof report.pass!=='boolean'||!Array.isArray(report.issues))throw new Error('Visual reviewer returned an invalid report');
  const issues=report.issues.map((raw):VectorReviewIssue=>{
    if(!raw||typeof raw!=='object')throw new Error('Visual reviewer returned an invalid issue');
    const item=raw as Record<string,unknown>;
    if(typeof item.sceneId!=='string'||!project.scenes.some(s=>s.id===item.sceneId)||typeof item.problem!=='string'||!item.problem.trim()||typeof item.fix!=='string'||!item.fix.trim())throw new Error('Visual issue must name an existing scene and an actionable repair');
    return {sceneId:item.sceneId,problem:item.problem,fix:item.fix};
  });
  if(report.pass===true&&issues.length||report.pass===false&&!issues.length)throw new Error('Visual review pass disagrees with its issues');
  return {pass:report.pass,issues};
}
export function applyVectorRepairs(project:CanvasStudioProject,raw:string,allowed:Set<string>):CanvasStudioProject{
  const data=json(raw);
  if(!Array.isArray(data.scenes)||!data.scenes.length)throw new Error('Visual repair omitted the failed scenes');
  const additions=normalizeVectorAssets(data.newAssets);
  for(const key of Object.keys(additions))if(project.vectorAssets?.[key]){
    // Checkpoints omit undefined optional fields; compare persisted geometry.
    if(!isDeepStrictEqual(JSON.parse(JSON.stringify(project.vectorAssets[key])),JSON.parse(JSON.stringify(additions[key]))))throw new Error('Visual repair may not replace a shared cast asset; add a new view instead');
    delete additions[key]; // Exact cached replay reuses the existing asset.
  }
  const assets={...project.vectorAssets,...additions},edits=new Map<string,Record<string,unknown>>();
  for(const raw of data.scenes){
    if(!raw||typeof raw!=='object')throw new Error('Invalid visual repair');
    const scene=raw as Record<string,unknown>;
    if(typeof scene.id!=='string'||!allowed.has(scene.id)||edits.has(scene.id))throw new Error('Visual repair attempted to change an unrelated shot');
    edits.set(scene.id,scene);
  }
  if(edits.size!==allowed.size)throw new Error('Visual repair must include every failed shot');
  const scenes=project.scenes.map(scene=>{
    const edit=edits.get(scene.id);if(!edit)return scene;
    if(edit.narration!==undefined&&edit.narration!==scene.narration)throw new Error('Visual repair changed spoken content');
    if(edit.vectorScenePatch!==undefined&&edit.vectorScene!==undefined)throw new Error('Vector: choose a scene patch or full replacement');
    const nested=edit.vectorScenePatch as Record<string,unknown>|undefined;
    const {vectorBeats:nestedBeats,...geometryPatch}=nested||{};
    const drawing=edit.vectorScenePatch!==undefined?
      patchVectorScene(scene.vectorScene!,geometryPatch,assets,scene.narration||'',scene):
      normalizeVectorScene(resolveStage(edit.vectorScene,project.vectorStages,assets),assets,scene.narration||'');
    if(drawing.width!==project.width||drawing.height!==project.height)throw new Error('Visual repair changed frame orientation');
    // Preserve narrated visibility/light events. A holding-arm pose is free to
    // become steady while the lamp itself still visibly extinguishes.
    const changingOpacity=(track:VectorTrack)=>new Set(track.frames.map(f=>f.opacity).filter(v=>v!==undefined)).size>1;
    for(const action of scene.vectorScene!.tracks.filter(t=>t.cue&&changingOpacity(t))){
      // Correcting an accidentally invisible limb is not erasing a clue.
      const owner=scene.vectorScene!.nodes.find(n=>n.id===action.target.split('/')[0]&&n.type==='instance'),rig=assets[owner?.asset||''];
      const intended=scene.vectorDirection?.beats.find(beat=>beat.cue===action.cue);
      if(intended&&!intended.motionTargets.includes(action.target))continue;
      // A narrated jaw opening or hand movement does not require the part to
      // fade into existence. Preserve visibility only when the screenplay
      // actually asks for an appearance/disappearance or a lighting event.
      if(intended&&!['reveal','hide'].includes(intended.kind)&&!vectorLightActionTargets(rig,action.target,action.cue!).length)continue;
      if(vectorIsReleaseAction(action.cue!)&&drawing.tracks.some(t=>t.target===action.target&&['dx','dy','rotation','d'].some(key=>new Set(t.frames.map(f=>f[key as keyof typeof f]).filter(v=>v!==undefined)).size>1)))continue;
      const articulated=rig&&(['arm-l','arm-r','knee-r','head-group'].every(id=>rig.nodes.some(n=>n.id===id))||['hoof-fl','leg-hr','head-group'].every(id=>rig.nodes.some(n=>n.id===id)));
      if(articulated&&/\/(?:arm|forearm|hand|leg|knee|foot|hoof)-[a-z]+$/.test(action.target))continue;
      if(!vectorTargets(drawing,assets).has(action.target))continue;
      const emitters=vectorLightActionTargets(rig,action.target,action.cue!);
      const replacement=drawing.tracks.find(t=>changingOpacity(t)&&(t.target===action.target||emitters.includes(t.target)&&t.cue===action.cue));
      if(!replacement)
        throw new Error(`Vector: visual repair erased narrated action "${action.cue}" on ${action.target}; preserve its visible before/after change`);
      const before=evaluateVectorPart(action.target,scene,scene.durationMs).opacity;
      const after=evaluateVectorPart(replacement.target,{...scene,vectorScene:drawing},scene.durationMs).opacity;
      if(Math.abs(before-after)>.01)throw new Error(`Vector: visual repair reversed narrated visibility on ${action.target}; preserve the final visible/light state`);
    }
    return {...scene,vectorScene:drawing,vectorBeats:narrationBeats(edit.vectorBeats??nestedBeats??scene.vectorBeats,drawing,assets,scene.narration||''),...(typeof edit.visualBrief==='string'?{visualBrief:edit.visualBrief.slice(0,1500)}:{})};
  });
  return compileVectorProject({...project,vectorReview:undefined,vectorAssets:assets,scenes});
}

/** A selected recipe is a capability contract, not only a prose suggestion.
 * In particular, folk-horror chooses a compact cutout from the screenplay
 * onward, unless the brief explicitly asks for an articulated human rig. */
export function vectorStoryCapabilities(brief:string){
  const explicitHuman=/\bsimple-human\b|\barticulated\b|người có khớp|nhân vật có khớp/iu.test(brief);
  const compact=/\bmodel\s*a\b|\bsimple-puppet\b|\[folk-horror\]|\[ma-xo\]/iu.test(brief);
  const words=brief.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const elevatedVillage=compact&&!explicitHuman&&/\b(?:village|ngo lang|lang que|ngoi lang|canh lang)\b/.test(words)
    &&/\b(?:tu tren xuong|tren cao|elevated|high.angle)\b/.test(words);
  return {compactCast:compact&&!explicitHuman,nativePerson:/\billustrated-place\b/iu.test(brief)||elevatedVillage};
}
/** Selected horror recipes must affect NEW generated artwork even when a
 * provider omits the optional finish. Explicit finish=clean, custom SVG assets,
 * and already-saved projects remain untouched. Never add anatomy here. */
export function applySelectedHorrorFinish(raw:string,brief:string):string{
  if(!/\[(?:folk-horror|ma-xo)\]/iu.test(brief))return raw;
  const draft=json(raw);
  const assets=draft.vectorAssets;
  if(assets&&typeof assets==='object'&&!Array.isArray(assets))
    for(const asset of Object.values(assets as Record<string,unknown>)){
      if(asset&&typeof asset==='object'&&!Array.isArray(asset)){
        const a=asset as Record<string,unknown>;
        if(a.rig==='simple-puppet'){
          if(a.finish===undefined)a.finish='handdrawn';
          if(a.finish==='handdrawn'&&a.design===undefined)a.design='village';
        }
      }
    }
  const stages=draft.vectorStages;
  if(stages&&typeof stages==='object'&&!Array.isArray(stages))
    for(const stage of Object.values(stages as Record<string,unknown>)){
      if(stage&&typeof stage==='object'&&!Array.isArray(stage)){
        const s=stage as Record<string,unknown>;
        if(s.template==='illustrated-place'&&s.finish===undefined)s.finish='handdrawn';
        if(s.template==='illustrated-place'&&s.finish==='handdrawn'&&s.place==='village'&&s.view===undefined)s.view='elevated';
      }
    }
  return JSON.stringify(draft);
}
const pending=new Map<string,Promise<CanvasStudioProject>>();
const MAX_VISUAL_REPAIRS=1;
export async function generateCodeVectorVideo(input:CanvasAnimationGenerateInput){
  input={...input,referenceImages:normalizeVectorReferenceImages(input.referenceImages??input.project?.vectorStyleReferences)};
  if(!input.referenceImages?.length)input={...input,referenceImages:await defaultVectorStyleReferences(input.brief)};
  if(input.refineVisuals&&!input.project)throw new Error('Visual redesign needs the retained project.');
  const key=createHash('sha256').update(VECTOR_DIRECTOR_CONTRACT).update(VECTOR_REVIEW_CONTRACT).update(VECTOR_STORY_CONTRACT).update(vectorStageLibrarySignature).update(JSON.stringify({engine:'remotion-svg-v5-screenplay-direction',maxRepairs:MAX_VISUAL_REPAIRS,references:input.referenceImages,refineVisuals:input.refineVisuals,brief:input.brief,model:input.model,provider:input.provider.id,
    retained:input.project?{id:input.project.id,assets:input.project.vectorAssets,scenes:input.project.scenes.map(s=>({id:s.id,narration:s.narration,vectorScene:s.vectorScene}))}:undefined,
    width:input.width,height:input.height,target:input.targetDurationSeconds,narration:{provider:input.narration.provider.id,model:input.narration.model,voice:input.narration.voice,speed:input.narration.speed}})).digest('hex');
  const existing=pending.get(key);if(existing)return existing;
  const task=generate(input,key).finally(()=>pending.delete(key));pending.set(key,task);return task;
}
async function generate(input:CanvasAnimationGenerateInput,key:string):Promise<CanvasStudioProject>{
  const width=Math.max(320,Math.min(2160,Math.round(Number(input.width)||1280))),height=Math.max(320,Math.min(2160,Math.round(Number(input.height)||720)));
  const normalized=input.brief.toLowerCase().replace(',', '.');
  const minutes=normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:phút|phut|minutes?|mins?)(?:\s|$)/iu);
  const seconds=normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:giây|giay|seconds?|secs?)(?:\s|$)/iu);
  const target=Math.max(10,Math.min(900,Math.round(Number(input.targetDurationSeconds)||(minutes?Number(minutes[1])*60:Number(seconds?.[1]))||60)));
  const storyStyle=vectorStoryCapabilities(input.brief);
  const directory=path.join(workdir,'canvas-vector-plans',key),checkpoint=path.join(directory,'checkpoint.json');
  await mkdir(directory,{recursive:true});
  let project:CanvasStudioProject|undefined,story:VectorStory|undefined,stage='planning',redesigned=false,restoredCast=false;
  if(input.project){
    if(input.project.sourcePrompt!==input.brief||input.project.width!==width||input.project.height!==height)throw new Error('Vector resume must preserve the brief and frame orientation.');
    project=compileVectorProject({...input.project,vectorReview:undefined});
  }
  const sourceSignature=await animationRenderSourceSignature(fileURLToPath(new URL('../..',import.meta.url)));
  try{
    const saved=JSON.parse(await readFile(checkpoint,'utf8'));
    redesigned=saved.redesigned===true;
    // Stricter writing capabilities apply before drawing, never invalidate a
    // retained illustrated/voiced project from an earlier engine version.
    if(saved.story)story=normalizeVectorStory(saved.story,target,saved.project?{}:storyStyle);
    if(saved.project){
      const vectorAssets=input.refineVisuals&&input.project?preserveApprovedCastParts(input.project,saved.project.vectorAssets):saved.project.vectorAssets;
      restoredCast=JSON.stringify(vectorAssets)!==JSON.stringify(saved.project.vectorAssets);
      project=compileVectorProject({...saved.project,vectorAssets});stage=saved.stage;
    }
    // A rejected repair may become recoverable after a parser fix. Its stored
    // error must not pin the project to the same unfinished draft forever.
    if((stage==='complete'||stage==='review-needed'&&!saved.error)&&saved.sourceSignature===sourceSignature&&!restoredCast)return project!;
  }catch{/* The raw response and audio assets remain available after interruption. */}
  const save=async(next:string,error?:string)=>{
    stage=next;
    await writeFile(checkpoint+'.tmp',JSON.stringify({stage,project,story,redesigned,sourceSignature,error,updatedAt:new Date().toISOString()},null,2));
    await rename(checkpoint+'.tmp',checkpoint);
  };
  const budget=Math.min(64000,Math.max(12000,target*340));
  const messages:Array<{role:'system'|'user';content:string|Array<Record<string,unknown>>}>=[
    {role:'system',content:VECTOR_DIRECTOR_CONTRACT+`\nREQUESTED FRAME ${width}x${height}. Total planned runtime ${target} seconds. Write about ${Math.round(target*3.6)}-${Math.round(target*4.1)} Vietnamese words; allocate speech to each shot, with no long silent tails. A ${target}s story usually needs ${Math.max(3,Math.round(target/8))} purposeful shots.`},
    {role:'user',content:[{type:'text',text:input.brief},...(input.referenceImages||[]).map(url=>({type:'image_url',image_url:{url,detail:'high'}}))]},
  ];
  try{
    if(!project){
      if(!story){
        let retainedScreenplay:string|undefined,screenplayError:unknown;
        try{retainedScreenplay=await readFile(path.join(directory,'screenplay.txt'),'utf8');story=normalizeVectorStory(json(retainedScreenplay),target,{requireHandPlan:true,requireVisibleCast:true,requireTurnPlan:true,requireFearPlan:true,requireTravelPlan:true,...storyStyle});}catch(error){screenplayError=error;}
        const storyMessages:Parameters<typeof chat>[2]=[{role:'system',content:VECTOR_STORY_CONTRACT+`\nFrame ${width}x${height}. Runtime ${target}s; aim for ${Math.round(target*3.6)}-${Math.round(target*4.1)} Vietnamese whitespace-separated syllables. Actual cuts follow the voice; never pad the scene with silence to meet duration. Total durationMs must be ${target*1000}. Usually ${Math.max(3,Math.round(target/7))} shots. Do not use image attachments in this writing step.`},{role:'user',content:input.brief}];
        if(storyStyle.compactCast)storyMessages[0]!.content+='\nSELECTED COMPACT MODEL A CAPABILITIES: all people use the limbless simple-puppet. Valid parts are upper-body, head-group, eyes, mouth, hand-l/r and the actor root. Hands appear only when used. NO arm/forearm/leg/knee/foot-l/r targets or invented feet clues. Choose a supported physical clue (face/expression, a carried prop or a visible scene object) when writing an original event. Do not change the selected art style to serve your invented action. Animals keep their own anatomy.';
        if(storyStyle.nativePerson)storyMessages[0]!.content+='\nNATIVE ILLUSTRATED-PLACE ID: primary actor MUST be person in cast, visibleCast, heldProps, shot.focus and beat targets. Their human name stays in narration/design. Supporting people keep distinct IDs. Use the location matching the request; for an elevated village use location village, whose shared scenery supplies house-mid and roads. Do not invent an unmentioned shop or specific tree as the action target without registering a new object.';
        if(typeof storyMessages[0]!.content==='string')storyMessages[0]!.content+='\\nPreserve the exact character art style that the user chose or already established. Uploaded pictures and the selected story recipe outrank all stock chibi/human examples: do not redesign the actor into a brown-robed big-headed figure by default. In a rural folk-horror story, follow the supplied folk-cartoon character proportions and costume language; in an expressive comedy, follow the cartoon narrator/cast silhouette and gestures. This screenplay pass defines the SAME named cast across all shots with persistent physical traits, expressions and clothes; it never picks a new universal model. Write visibly meaningful BEFORE / contact / consequence beats for every walk, grab, pull, retreat, fight and reaction. Describe physical motion in motionTargets using part IDs that will actually exist on the rig that the illustrator chooses. Use native walks/reaches/strikes/reactions where physically appropriate; do not substitute head shaking or sliding. If using a reusable location stage, substitute the actor asset via cast binding without replacing the character style. Do not invent a rural robe or night river merely because a demo prefab exists. Keep shared world geometry and visual continuity. End with a visibly staged resolution.';
        if(!story&&retainedScreenplay)storyMessages.push({role:'assistant',content:retainedScreenplay},{role:'user',content:vectorScreenplayCorrection(screenplayError)});
        for(let attempt=0;!story&&attempt<3;attempt++){
          // The full shot/hand/action schema exceeded 4k tokens even for a
          // one-minute story, truncating narration midway through shot seven.
          const raw=await chat(input.provider,input.model,storyMessages,AbortSignal.timeout(300000),Math.min(24000,Math.max(8000,target*90)));
          await writeFile(path.join(directory,'screenplay.txt'),raw);
          try{story=normalizeVectorStory(json(raw),target,{requireHandPlan:true,requireVisibleCast:true,requireTurnPlan:true,requireFearPlan:true,requireTravelPlan:true,...storyStyle});}catch(error){
            await writeFile(path.join(directory,`screenplay-invalid-${Date.now()}.json`),JSON.stringify({error:String(error),raw},null,2));
            storyMessages.push({role:'assistant',content:raw},{role:'user',content:vectorScreenplayCorrection(error)});
          }
        }
        if(!story)throw new Error('AI chưa tạo được kịch bản hợp lệ; bản viết đã lưu để tiếp tục.');
        await save('screenplay');
      }
      messages.push({role:'user',content:`LOCKED SCREENPLAY: ${JSON.stringify(story)}\nIllustrate this approved writing plan, not a new story. Return every shot in this exact order, with its exact id, narration and durationMs. Each vectorScene.stage must equal its location ID; define that shared world once in vectorStages. Keep all named participants and motionTargets with these exact IDs. Implement EVERY beat with real cue-linked tracks or native commands. Do not use blinks or head turns to stand in for rowing, boarding, striking, payment or arrival. Preserve the ending's required setting and objects. For row and strike use the native rows/strikes commands. No duplicate rotation tracks on their controlled parts. Use dark wet sole silhouettes, not glowing mint dots. Neutral mouths by default, brief fear when justified. The engine frames actor action shots from this screenplay's focus and included partners/props. For a physical startle use a native reaction with a connected defensive arm and visible mouth/brow changes; articulated walking must follow planted steps; compact puppets use native walks with continuous whole-cutout progress, repeating small linked sway/lift during travel and a stable stop; head and occupied hands follow the body, with no articulated legs or mandatory idle cloth/hair wobble. Draw complete actors with grounded feet in supported middle-depth sets.`});
      let response:string|undefined,planError:string|undefined;
      try{response=await readFile(path.join(directory,'response.txt'),'utf8');project=parseVectorPlan(applySelectedHorrorFinish(response,input.brief),input.brief,{width,height},target,story);}catch(error){if(response)planError=String(error);}
      for(let attempt=0;!project&&attempt<3;attempt++){
        if(response)messages.push({role:'user',content:`The prior JSON could not be rendered. ${planError?`Validation error: ${planError}. `:''}Correct the complete film, using ONLY the documented geometry and fields. Prior response: ${response}`});
        response=await chat(input.provider,input.model,messages,AbortSignal.timeout(600000),budget);
        await writeFile(path.join(directory,'response.txt'),response);
        try{project=parseVectorPlan(applySelectedHorrorFinish(response,input.brief),input.brief,{width,height},target,story);}catch(error){planError=String(error);messages.push({role:'user',content:`Validation error: ${planError}. Fix this exact failure without dropping the story or its ending.`});}
      }
      if(!project)throw new Error('AI chưa tạo được bản vẽ vector hợp lệ; phản hồi đã được lưu để tiếp tục.');
      await save('planned');
    }
    if(input.refineVisuals&&!redesigned){
      const approvedCastModels=Object.entries(project.vectorAssets||{}).filter(([,asset])=>asset.nodes.some(n=>['head-group','face','puppet-root'].includes(n.id))).slice(0,12).map(([assetId,asset])=>({
        assetId,width:asset.width,height:asset.height,styleFeatures:asset.nodes.map(n=>({...n})),
      }));
      const content:Array<Record<string,unknown>>=[{type:'text',text:JSON.stringify({brief:input.brief,frame:{width,height},approvedCastModels,
        scenes:project.scenes.map(({id,name,durationMs,narration,visualBrief})=>({id,name,durationMs,narration,visualBrief}))})}];
      for(const url of input.referenceImages||[])content.push({type:'image_url',image_url:{url,detail:'high'}});
      let response:string|undefined;
      try{response=await readFile(path.join(directory,'redesign.txt'),'utf8');project=applyVectorRedesign(project,response);}catch{response=undefined;}
      const redesignMessages:Parameters<typeof chat>[2]=[{role:'system',content:VECTOR_DIRECTOR_CONTRACT+'\nIMPROVE ARTWORK WITHOUT CHANGING THE APPROVED CHARACTER STYLE. User-uploaded images, the existing cast asset and selected recipe have priority. If the story takes place on an existing night boat, reuse the documented folk-river-boat geometry and native contacts; otherwise use the actual location in the story. Do not force a generic brown robe, a replacement head/body ratio, another hairstyle, or a river/boat prop into an unrelated film. Return {"vectorAssets":{...reuse existing approved simple-puppet assets unchanged; other non-character assets may improve...},"vectorStages":{...complete unframed worlds...},"scenes":[{"id":"existing UUID","vectorBeats":[...updated narration cues and targets...],"visualBrief":"updated acting","vectorScene":{"stage":"world-id","shot":{"target":"actor-instance","height":0.45},"tracks":[...]}}]}. Keep ALL shot IDs, narration, durations and audio unchanged. Match the supplied visual references and previously approved cast identity: preserve head/body ratio, clothing construction, hair silhouette, facial anatomy, stylization, expressive language, and outline weight while improving workmanship. Never interpret this as permission to redesign the cast. Make the drawings at least as clear and well-composed as the reference style. Use rounded, curved anatomy, not spiky geometric wedges. Reuse the SAME approved original character asset across establishing and acting shots. Animate supported pose parts, concealed pivots and small hands rather than swapping to an exposed long-limbed doll or drawing an unrelated body. For quadrupeds, use a horizontal torso, short neck, readable muzzle and four grounded legs. Do not stretch a neck into a giraffe. Keep action shots contextual: full puppets around 30-40% of frame height, with partner, hands, prop and setting visible. A reaction defaults to a contextual view; only explicit shot.framing close requests a closer full-body composition. Reserve tight detail inserts for a specific narrated clue. Existing approved simple-puppet assets are immutable during scene refinement: return them unchanged; improve staging and scenery instead. Night silhouettes need readable filled shapes and edge contrast, no spotlight blobs. Fill the stage with meaningful landscape/architecture instead of leaving half the picture empty. Show preparation, action and the resulting pose. Follow the actual story, including a clear ending.'},{role:'user',content}];
      // Redesign has the same bounded validation recovery as initial planning.
      // A malformed provider reply must not discard retained narration/audio.
      let validationError:unknown;
      if(!response)for(let attempt=0;attempt<3;attempt++){
        response=await chat(input.provider,input.model,redesignMessages,AbortSignal.timeout(600000),budget);
        await writeFile(path.join(directory,'redesign.txt'),response);
        try{applyVectorRedesign(project,response);validationError=undefined;break;}
        catch(error){validationError=error;redesignMessages.push({role:'user',content:`Validation error: ${String(error)}. Correct the COMPLETE JSON film below. Use valid quoted JSON keys, exact narrated cue substrings and grounded destinations. Do not invent extra spoken actions. Preserve all shot IDs and narration. Prior response: ${response}`});}
      }
      if(validationError)throw validationError;
      if(!response)throw new Error('Vector redesign returned no artwork');
      await writeFile(path.join(directory,'redesign.txt'),response);
      project=applyVectorRedesign(project,response);redesigned=true;await save('redesigned');
    }
    // A redesigned model/world needs a fresh frame review; old complaints
    // describe different pixels and must not trigger another blind repair.
    const priorReview=input.refineVisuals||restoredCast?undefined:project.vectorReview?.pass===false?project.vectorReview:input.project?.vectorReview;
    const currentDirection=vectorDirectionIssues(project);
    const retainedIssues=priorReview?.pass===false?priorReview.issues?.filter(issue=>!issue.problem.startsWith('No evaluated ')
      ||currentDirection.some(current=>current.sceneId===issue.sceneId&&current.problem===issue.problem)):undefined;
    project.vectorStyleReferences=input.referenceImages;
    // Existing TTS caching owns reuse. Review failures never discard the audio.
    // Saved projects/redesigns may contain an already mixed authoritative audio
    // track without per-line TTS metadata (e.g. older saved projects).
    // Re-synthesizing those lines changes both the voice timing and the cut.
    const retainAudio=Boolean(input.project)&&project.scenes.every(scene=>Boolean(scene.audioUrl))
      &&(input.refineVisuals||project.scenes.every(scene=>!scene.dialogue?.some(line=>line.audioUrl)));
    const retainedWithoutVoice=retainAudio&&project.scenes.every(scene=>!scene.dialogue?.some(line=>line.audioUrl));
    project=compileVectorProject(retainedWithoutVoice?project:await prepareCanvasProjectAudio({project,narration:input.narration,autoSound:input.audioProduction?.autoSound,reuseNarration:retainAudio}));
    await save('voiced');
    for(let attempt=0;!retainAudio&&project.scenes.reduce((sum,s)=>sum+s.durationMs,0)>target*1100&&attempt<2;attempt++){
      // Use the existing duration editor on measured speech, preserving artwork
      // and exact vector action cues instead of abandoning a complete film.
      await writeFile(path.join(directory,`voiced-before-duration-${attempt}.json`),JSON.stringify(project));
      project=compileVectorProject(await shortenCanvasScript(input.provider,input.model,project,target*1000));
      if(story)story={...story,shots:story.shots.map((shot,i)=>({...shot,narration:project!.scenes[i]!.narration??shot.narration,durationMs:project!.scenes[i]!.durationMs}))};
      await save('duration-revised');
      project=compileVectorProject(await prepareCanvasProjectAudio({project,narration:input.narration,autoSound:input.audioProduction?.autoSound}));
      await save('voiced');
    }
    const total=project.scenes.reduce((sum,s)=>sum+s.durationMs,0);
    if(total>target*1100)throw new Error(`Lời kể dài ${Math.round(total/1000)} giây, vượt mục tiêu ${target} giây; checkpoint và giọng đọc đã được giữ lại.`);
    if(total>=target*1000/1.2&&total<=target*1000/.8)project.exportDurationMs=target*1000;
    const executable=resolveBrowserExecutable();
    if(!executable)throw new Error('Không tìm thấy trình render để kiểm tra ảnh vector.');
    let reviewOnly:Set<string>|undefined;
    // One focused correction, then keep a usable draft with pending issues.
    // Repeated subjective reviews must not trap a complete film in a long loop.
    const maxRepairs=MAX_VISUAL_REPAIRS;
    for(let round=0;round<=maxRepairs;round++){
      const previewDirectory=path.join(directory,`preview-${round}`);
      const sheets=await renderCanvasPreviewFrames(project,previewDirectory,{signature:sourceSignature,executable,assetOrigin:`http://127.0.0.1:${Number(process.env.AUTOSUB_PORT||8787)}`,labelFrames:true,saveFrames:true});
      const previewScenes=project.scenes;
      const frames=await Promise.all(sheets.map(async sheet=>({sceneId:sheet.sceneId,times:sheet.times,imageUrl:'data:image/png;base64,'+(await readFile(sheet.file)).toString('base64'),
        // Full frames avoid mistaking contact-sheet gutters for empty scenery,
        // or confusing separate tiles with duplicated/cropped actors.
        frames:await Promise.all(vectorReviewFrameIndices(sheet.times,previewScenes.find(s=>s.id===sheet.sceneId)!).map(async i=>({atMs:sheet.times[i]!,imageUrl:'data:image/png;base64,'+(await readFile(sheet.frameFiles![i]!)).toString('base64')}))),
      })));
      const {scenes:reviewedScenes,content}=buildVectorReviewContent(project,frames,input.brief,reviewOnly);
      const response=round===0&&retainedIssues?.length?JSON.stringify({pass:false,issues:retainedIssues}):await chat(input.provider,input.model,[
        {role:'system',content:VECTOR_REVIEW_CONTRACT},
        {role:'user',content},
      ],AbortSignal.timeout(300000),5000);
      await writeFile(path.join(previewDirectory,'review.txt'),response);
      let review=parseVectorReview(response,{...project,scenes:reviewedScenes});
      // A focused repair can leave another cut with an incompatible prop state.
      // Before approval, inspect the complete film once more for continuity.
      if(review.pass&&reviewOnly){
        const all=buildVectorReviewContent(project,frames,input.brief);
        const finalReview=await chat(input.provider,input.model,[{role:'system',content:VECTOR_REVIEW_CONTRACT},{role:'user',content:all.content}],AbortSignal.timeout(300000),5000);
        await writeFile(path.join(previewDirectory,'review-all.txt'),finalReview);
        review=parseVectorReview(finalReview,project);reviewOnly=undefined;
      }
      const directionIssues=vectorDirectionIssues(project);
      if(directionIssues.length)review={pass:false,issues:[...review.issues,...directionIssues]};
      if(review.pass){project.vectorReview={pass:true,rounds:round+1,previewDirectory};await save('complete');return project;}
      await save('review-failed',JSON.stringify(review.issues));
      if(round===maxRepairs){
        project.vectorReview={pass:false,rounds:round+1,previewDirectory,issues:review.issues};
        await save('review-needed');return project;
      }
      const allowed=new Set(review.issues.map(issue=>issue.sceneId));
      reviewOnly=allowed;
      const repairMessages:Parameters<typeof chat>[2]=[
        {role:'system',content:VECTOR_DIRECTOR_CONTRACT+'\nREPAIR ONLY the listed failed shots. Return {"newAssets":{},"scenes":[{"id":"same UUID","vectorScenePatch":{"nodes":[{"id":"existing-node","y":22}],"tracks":[],"removeNodes":[],"removeTracks":[],"reveals":[],"reaches":[]}}]}. Return ONLY the fields/parts that need changing. nodes are partial updates by id or complete NEW nodes; all unmentioned geometry is preserved. tracks replace only the animated channels on the named target, preserving its other channels. removeTracks is a list of existing target IDs whose entire animation should be removed; removeNodes removes named geometry (also remove its tracks and descendants explicitly). Native carries/reaches/walks/turns/reactions/lights/footsteps/hinges/rows/strikes are supported patch fields. Fix a floating prop with carries:[{actor:"actor-id",arm:"r",prop:"lamp",grip:{x:30,y:6},hang:true}], preserving the real grip through every cut. Use rows for missing rowing strokes and strikes for a hand that merely reaches and holds a bell. Preserve the locked vectorDirection beats, especially the ending; no unrelated motion can satisfy their motionTargets. To repair a vertical gate use hinges, not handwritten scaleX-only tracks: hinges clears the old erroneous rotation channel as well. Use hold:true hinges in subsequent cuts to keep the same open state. To raise a carried lamp clearly use reaches with actor-local point {x:215,y:180}, preserving it in later cuts with hold:true. Do not also patch rotation of that solved arm/forearm. An attached lantern may add hang:true to remain vertical. For any ground-based composition/cropping problem, patch shot:{target:"actor-id",height:0.38,include:["needed-door-or-gate-id"]}. The engine computes the actual fixed camera from movement and attached props. For a detail shot, prefer shot:{"target":"instance/actual-part","bounds":{"x":localLeft,"y":localTop,"width":localWidth,"height":localHeight}} to frame the actual evaluated clue; pig/hoof-fl bounds are x:-15,y:-12,width:30,height:12. Ordinary acting shots use the full actor shot. Do not hand-author moving camera-world tracks on grounded stages. Do not move architecture to repair composition. Fix camera cropping with shot framing. For measured face overlap only, adjust actor blocking/root placement on the same support, preserving prop attachments and intended contact. Opacity cannot repair cropping. Ground marks and their clip layer must stay on the floor. reveals/reaches compile into replacement tracks for only their controlled channels. All original camera tracks, supports and previous actions remain unless you explicitly patch their nodes/tracks. Do not reset the camera, unrelated acting or supporting context to fix a clue. Keep narration, shot duration, audio and unaffected shots unchanged. Existing vectorStages and assets are read-only. Use the supplied measured dialogue/resolvedTracks to check onset/order; prefer ordered reveals for clues. Do not repeat the complete world or return vectorScene. If targets change, return updated vectorBeats. Existing shared assets are read-only; newAssets may add a distinct view with a NEW id. Do not redefine existing asset ids. For caption collisions, REMOVE unnecessary decorative particles. If an effect is essential, place it under a stationary root group with a clip rectangle that excludes the top 19% of the frame; keep that group unanimated. Changing only initial y does not constrain later keyframes. Do not introduce any new decorative effect while fixing another problem. Include every failed scene exactly once.'},
        {role:'user',content:buildVectorRepairContent(project,review.issues,frames)},
      ];
      let repaired:CanvasStudioProject|undefined,repairError:unknown;
      // Parser fixes can recover a complete cached patch; never ask the model
      // to redraw it solely because an earlier validation layer rejected it.
      for(const file of ['repair.txt','repair-invalid-0.txt','repair-invalid-1.txt']){
        if(repaired)break;
        try{repaired=applyVectorRepairs(project,selectVectorRepairScenes(await readFile(path.join(previewDirectory,file),'utf8'),allowed),allowed);}catch{/* A different failure set or incomplete response needs a new patch. */}
      }
      for(let attempt=0;!repaired&&attempt<2;attempt++){
        const repair=await chat(input.provider,input.model,repairMessages,AbortSignal.timeout(600000),Math.min(budget,6000));
        await writeFile(path.join(previewDirectory,'repair.txt'),repair);
        try{repaired=applyVectorRepairs(project,repair,allowed);}
        catch(error){repairError=error;await writeFile(path.join(previewDirectory,`repair-invalid-${attempt}.txt`),repair);
          repairMessages.push({role:'user',content:`The repair was rejected: ${String(error)}. Correct this exact validation error. Return only valid patches for the listed failed shots, preserving floor support and unrelated actions. Prior patch: ${repair}`});}
      }
      if(!repaired){
        // A rejected AI patch must not destroy a complete, structurally valid
        // film. Keep the last renderable version and expose the pending review.
        project.vectorReview={pass:false,rounds:round+1,previewDirectory,issues:review.issues};
        await save('review-needed',String(repairError));return project;
      }
      project=repaired;await save('repaired');
    }
    throw new Error('Vector review did not finish');
  }catch(error){await save(stage,String(error));throw error;}
}
