import type {CanvasStudioProject,CanvasStudioScene,CanvasVectorDirection} from '../../shared/canvasAnimationStudio';
import {evaluateVectorPart,vectorTargets,vectorTrackTiming,type VectorTrack} from '../../shared/canvasVectorScene';
import {continueVectorHandPlan} from '../../shared/canvasVectorContinuity';
import {vectorLightActionTargets,vectorIsReleaseAction} from '../../shared/canvasVectorProps';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {puppetHandOpacity} from '../../shared/canvasVectorPuppet';
import {vectorBackgroundActions,vectorEnsembleCoverage} from '../../shared/canvasVectorEnsemble';
import {vectorShotVisibility} from '../../shared/canvasVectorFraming';
import {REFERENCE_SETTING_CONTRACT} from './canvasSceneryReference';

/** A small text-only task before asking a model to draw hundreds of SVG parts. */
export const VECTOR_STORY_CONTRACT=`VISIBLE ACTION COVERAGE: front and right are the SAME native view. A visible facing reversal uses right/front -> left or left -> right/front; a rear view uses back ONLY when explicitly requested by the user. Default turns use left/right horizontal mirroring, never a rear pose. Never declare front -> right as an action. A cue describing a named person's action must animate that person, not substitute nearby villagers looking at them. In a busy market wide shot with 4+ visible people, plan at least TWO distinct secondary actors doing purposeful actions and at least one passing shopper while the narration describes people moving. Start these during the busy passage, not only on its final word. Stagger their timing, preserve their resulting positions through cuts, and let vendors hold while shoppers pass. No synchronized idle shaking. A quiet/tension shot can hold still; do not call a motionless tableau a busy passing crowd.
NATIVE WILDERNESS: New natural settings MUST use nature-landscape, a composable hand-painted terrain/water/vegetation grammar. Choose terrain rolling/gorge/cliffs, water none/river/stream/waterfall, optional bridge, vegetation mixed/pine/bamboo, light and a distinct seed/composition. Story objects available: waterfall/pool/cliff for a cascade; bridge with a real stream when bridge:true; cliff/pine-tree/river-water for an elevated valley; tree/terrain/forest-backdrop and thin valley-mist in all worlds; clearing for rolling + water:none. Name only present objects. Empty environments use visibleCast:[] with held scenery; an observable ending may reveal/drift valley-mist on the same world, not require a person or replacement landscape. Do not add unrelated houses, jetties, poles or lamps to wilderness. A cliff overlook actor stands on the native ledge depth; do not reset its feet to the distant valley floor.
NATIVE BUILT SETTINGS: NEW market/village/street/room/corridor use folk-setting, not illustrated-place or raw scenery. A market supplies terrain,trees,village,market,stall-left,stall-right,stall-back and their baskets/goods. A room supplies walls,terrain,window,door,mat,table,kettle,cups,lamp,lamp-flame,shelf. Plan beats on these exact native objects; do not invent a second table, lamp or roof. Extinguishing a lamp animates lamp-flame while the lamp body stays. New story props must be small separate assets placed on named floor/table/counter supports by the tool. Native construction owns their contact and local coordinates. Keep empty proofs empty. A wide view stays full-frame; actual actors reuse the accepted cast.
ENSEMBLE TASKS: In populated scenes assign backgroundActions:[{actor:"shopper",activity:"pass"},{actor:"seller",activity:"attend",partner:"shopper"},{actor:"neighbor",activity:"converse",partner:"friend"}]. The engine executes these on a continuous stage clock through cuts, with staggered walking, stops, looks and free-hand gestures. They are secondary activity, not replacements for narrated beats. Use the SAME tasks/partners across cuts; hold disables an individual's background activity, [] deliberately keeps the ensemble still. Native crowded markets also supply defaults when omitted. Do not use background tasks to claim a narrated contact/payment/object interaction; those need explicit beats and real geometry. Omit a partner rather than inventing someone. For a deliberate frozen crowd or deserted set use backgroundActions:[] and explain the hold.
PURPOSEFUL ENSEMBLE SEQUENCES: use backgroundActions:[{actor:"customer",activity:"visit",partner:"seller"},{actor:"seller",activity:"attend"}] for a customer approaching a seller, stopping to look/gesture, receiving the seller's answering gesture, then leaving. visit REQUIRES a real cast partner on the same floor; it executes once on the continuous stage clock and survives camera cuts. Keep these actors close enough for a short unobstructed route, with distinct ground positions next to the relevant stall. Reserve pass for pedestrians crossing a clear lane, converse for an established nearby pair, and hold for someone deliberately waiting. A seller stays by their own counter, not alone in the middle of the square. Never narrate an exchange of money or an item unless explicit hand ownership/contact beats implement it. Story beats on an actor override background tasks; do not name background customers in compulsory hold beats that suppress their errands.
VISUAL STORY ANCHORS: every narrated discovery names the actual object in shot.focus or shot.include and beats.targets. If a stall is deserted, SHOW that particular stall and its empty counter clearly, with the observer when useful. If a torn mat is mentioned, draw it and frame it readably. Do not end on unrelated occupied stalls and call that illustration. Use contextual action/reaction framing with the required object included; use detail when the discovery would be tiny in a wide. Only add a cut when it reveals new information or a visible consequence. Prefer fewer well-staged actions over a catalogue of motions. A person's reason to approach and their reaction to the discovery must form a causal chain.
EXECUTABLE DESTINATIONS: for a compact person's narrated travel declare travel:{actor:"person",to:"seller",gap:80,followDepth:true} on the travel beat, with targets:["person","seller"] and motionTargets:["person"]. A destination can also be a real grounded scene object such as house-mid. The engine generates cue-linked whole-cutout walking from that destination even if illustration omits the walk. Use at most one travel destination per actor per shot; later action is a separate beat or shot. Include the destination in the frame when the arrival matters. Do not use travel for a stationary look, a whole-body turn or a boat moving on water. A retreat needs an explicit native backstep, not this forward-arrival command.
NARRATION LANGUAGE: tell the events naturally. Rendering/style instructions are for the illustrator, never spoken prose: describe the hand and gesture, never mention dot hands, chibi, puppet, SVG, rig or animation.
COMPACT WHOLE-BODY TURNS: a motion beat that turns a compact person declares turn:{actor:"person",from:"right",to:"left"} alongside motionTargets:["person/upper-body"]. Views are front/back/left/right. Left/right flip the SAME entire drawing horizontally, like an image mirror, keeping its full width and original face. Never draw a side profile or sideways rotation for these directions. Seeing their BACK requires to:"back", never left/right. A later return uses from:"back",to:"front"; keep the same facing until that spoken event. This is executable staging, not prose for the illustrator to reinterpret. Use a short turn then a held pose. A retreat keeps its current facing and is travel, not a turn. A head-only look does not declare turn. Never use turn on animals or articulated human rigs.
COMPACT FEAR PERFORMANCE: when a compact person visibly trembles or sweats from fear, declare fear:{actor:"person",level:"terrified"} on a motion beat with targets:["person"] and motionTargets:["person/upper-body","person/eyes","person/mouth","person/sweat-l","person/sweat-r"]. Use level:"uneasy" for a smaller nervous shiver. Engine stages a short fast small shiver, wide frightened eyes, worried brows, trembling mouth and staggered sweat drops, then settles. The whole cutout and held prop move together; no random waving hands, sliding feet or camera shake. Fear must have an actual threatening event and an exact spoken cue, not every listening shot. One fear beat per actor per shot; never add fear to animals or articulated humans. Ordinary "look" and brief "startle" remain distinct reactions. This is executable staging, not an instruction to hand-draw the animation.
BACKGROUND CAST CONTINUITY: a return to the same wide view retains the established villagers in visibleCast unless they visibly left or the view truly excludes their positions. A character-focused crop can exclude them, but a wider return does not erase them from the location. Declare only the parts that must actually act: whispered speech needs the mouth, not an unrelated compulsory head shake.
NATIVE EMPTY ENVIRONMENTS: no visible cast means scenic objects only. For an illustrated-place village use existing targets house-mid, door and tree; for folk-riverbank use river-water, tree, mooring-stake, jetty and moon. Choose those IDs in shot focus/include instead of inventing near-duplicate scenery. An object not supplied by a native world must be explicitly registered and drawn on its correct support. Do not describe extra oil lamps or furniture merely to embellish the prose when the scene is meant to preserve existing artwork.
REUSABLE COURTYARD CAPABILITY: for a scene at a wooden rural house with one main person, prefer the native folk-courtyard setting. Stable actor ID is person (any name/costume); scene objects are house, door, ring (a brass door knocker), lamp (mounted light), tree and stone-path. Use these exact IDs in cast, objects, shot.include and motionTargets. Plan a near-door travel then a tap on ring using person/hand-r; do not invent a different knocker ID. The setting has no well; unrelated stories and extra locations still need their own setting.
APPROVED COURTYARD ART: the native folk-ink courtyard now owns the user-approved hand-painted house, thatched roof, flowering tree/planter, bamboo fence, broom and water-jar. Choose day/dusk/night to match the story; night is the default. Do not narrate absent furnishings or ask the illustrator to redraw its architecture. An empty environment uses visibleCast:[] and backgroundActions:[], reusing the complete native setting. Other places keep their own native settings; do not turn every location into this courtyard.
EXECUTABLE BLOCKING: every shot MUST declare visibleCast:["person",...] for the actors present in this VIEW, including an actor entering at a spoken cue. [] means no actors; use it for an empty yard. A character still exists and owns held props while absent from a view. Do not include a person inside the house in a shot looking at its exterior. Use distinct stable location IDs for interior and exterior (e.g. yard and room). folk-room is the supported interior set with person, door, latch, table, bed, window and lamp. Use the SAME actor ID/design in yard and room. Once the character enters, subsequent interior actions use room; a cut back to the exterior excludes the character trapped inside. A noise heard through a closed door is illustrated by the door/latch moving, not by putting its hidden source outside. Explicitly stage the threshold crossing before the cut inside; do not replace it with a look. Keep two visible faces apart unless a brief crossing is motivated. Do not clone someone at the original person's coordinates. The final picture must execute the stated cast visibility, location and changed object state.
PUPPET ROOT MOTION: a motion beat may use a root dx/dy track starting at zero for a reaction displacement relative to its held position. The compiler preserves that displacement through cuts and preceding gestures. Use a travel beat for movement to an absolute destination. Do not classify a walk to a door as a reaction.
NATIVE DOOR STATES: the courtyard ring follows its hinged door. folk-room starts with its bolt retracted (latch dx=0); locking moves latch to dx=48 and unlocking returns to zero. Declare the bolt/door state in each interior cut, keeping the bolt retracted until the narrated locking event. Door openings reveal a dark interior, not exterior wall planks.
You are a screenwriter and animation director. Return ONLY compact JSON. First write a short, specific film that can actually be staged, not a general explanation of its topic. Use natural Vietnamese narration, concrete sensory details, a character with a reason to act, a cause-and-effect escalation, an earned reversal and a visible ending. For horror, build anticipation around one recurring physical clue; let the character notice, decide and act. Avoid permanent surprise, generic scary adjectives, repeated warnings and a paragraph of folklore exposition during the climax. Respect the user's supplied events, duration and genre. Do not invent factual folklore claims as verified history.
Plan only narration and shots in this step, no SVG, geometry, track angles or audio URLs. Reuse stable location, cast and prop IDs. Every physical clause must have an observable beat at an EXACT substring of its narration; a noun being present does not perform a verb. Each beat says BEFORE and AFTER so the illustrator can stage preparation, contact/action and consequence. MotionTargets name the parts that must actually change, e.g. person/arm-r for reaching and coin for payment, not eyes/fog for rowing. Supported beat kinds: motion, travel, row, strike, reveal, hide, hold. Travel needs visible root travel; articulated humans also need a leg cycle, but simple-puppet characters have no visible limbs and travel as a single clothed body; row needs the arm operating an attached oar; strike needs contact followed by withdrawal and movement of the struck object. Reveal/hide lists ALL affected objects in motionTargets. Hold is only for deliberate listening, atmosphere or narrator reflection, with a reason in purpose, not to evade a physical event.
STAGING AND WRITING CHECK: every shot declares heldProps:[{actor:"person",arm:"r",prop:"lamp",hang:true}] for its ending hand inventory. Ownership persists through cuts, close-ups and location changes: an empty or omitted array NEVER makes an already-held object disappear. Repeat ownership for clarity. To free a hand, stage a visible release/put-down in a beat and declare propEvents:[{prop:"lamp",action:"release",cue:"exact spoken release phrase"}]. Show the object following the hand before that phrase and remaining on its support afterward. A newly taken prop declares its hand in heldProps. Do not switch hands or give one hand two props without a visible release first. Use continuity:"reset" only for an explicit time jump or new independent sequence, never for a close-up. A free-hand action must use the other hand or follow a visible put-down. Keep a shot to one main action plus its reaction, not a chain of pouring, closing, lighting and sitting in seven seconds. Name the actual action object in shot.include. Before finalizing, remove adjacent shots that repeat the same clue without changing its meaning. Establish the character's concrete reason to stay or investigate early. The climax must SHOW a new fact and an immediate decision with a visible consequence. Do not explain a supernatural origin as fact without evidence, lecture about folklore, or end with unearned relief. Leave a specific final image that pays off the recurring clue, while respecting the requested story and ending. The viewer should understand the central event even with the narration muted; exact prose, atmosphere and suspense still need editorial judgment.
NATIVE STRIKE CAPABILITY: strike means the FREE HAND touches the nearby bell/prop and withdraws. It does not drive a tool tip. Do not narrate striking WITH an oar, stick or hammer for a strike beat. The ferryman's right hand holds his oar and his left hand can strike the bell; never claim that his left hand holds that same oar. Do not invent a mast, cabin wall, bench or striking tool absent from your named scene objects. A retreat is travel, not just motion of the torso; name the root and threatening direction, with leg targets only on an articulated rig. A stationary frightened pose may instead be motion, with no narrated steps.
CAST AND COMMUNITY: The FIRST cast entry is the principal story character, followed by supporting roles. Describe a recognizable lead hairstyle, garment cut and one signature costume detail that extras do not copy; extras need varied hair and occupation-appropriate clothing silhouettes. Keep the same body/head/eye proportions for leads and extras. When the story takes place in a populated village, street, market or gathering, register supporting people in cast and visibleCast alongside the leads. Give each visible role a distinct silhouette through hair/headwear, costume cut, age/face or facial hair; a shirt-color swap alone is not sufficient. State each person's child/adult/elder age group and male/female identity in design so the illustrator chooses the right native body. Children stay child-proportioned; adult women have a modest fully clothed chest-and-waist silhouette. Choose concrete background roles (vendor, passer-by, listener), varied depths and independent timing. A few people may hold while one passes; avoid synchronized crowd movement. Respect explicit empty/isolated locations. Compact figures travel as a single cutout with a small lean then settle; do not prescribe a full skeleton or perpetual hair/cloth oscillation.
SHOT PURPOSE AND DISTANCE: Establish villages and populated markets from an elevated wide view with people small among roads, stalls and buildings. Spread background roles across near, middle and far ground rather than one horizontal row. Frame the edges with a foreground stall or tree while keeping the action corridor open. Typical establishing people occupy about 7-18 percent of frame height; do not turn a crowd into a lineup of close portraits. Set shot.framing:"context" by default, including reactions that can be read in the wide view. Choose framing:"close" only when a named person's expression or hand action reveals something important; state that reason in purpose. Return to the same wide view to show the consequence. Do not alternate distances for every sentence or enlarge an entire tableau just to fill the frame. A fixed cut to the actor at their evaluated current position is enough; no slow zoom throughout the line.
Use 4-10 second shots, usually 1-3 beats per shot. A wide establishes a location, action shows the actual interaction, detail makes a clue readable, reaction shows who noticed it. Keep partner, support surface and action object in shot.include when necessary. Cut immediately between fixed views of the SAME world; do not plan a drifting zoom. Use variety only when the next shot reveals new information. Prefer contextual wide and full-body action views; keep reactions in the same setting with the relevant partner and prop. Do not turn every reaction into a face close-up or alternate close-ups mechanically. Use a tight detail only for a specific narrated clue. If the ending says a boat reaches shore, include a visible shore/dock and an actual arrival; if someone boards, stage the boarding. Do not remove important user events merely because they need new geometry. Keep states consistent between cuts: wet marks, opened doors, held props and extinguished lights persist until an explicit change.
PERFORMANCE CHAIN: the viewer should see perception, decision, action and consequence across shots. When the clue changes, write the character noticing or responding as an observable beat, with its own exact narration cue; a wide shot that only fades a small clue is insufficient. Give a quiet hold a concrete listening/waiting/reaction purpose and bounded duration. A stable pose for several seconds is valid; no mandatory hair, cloth or body motion. Build the rhythm from a readable action, consequence, then a held pose, rather than adding small arbitrary gestures throughout narration. End on a clear visible discovery and its human reaction; no tiny final clue stranded in a distant wide shot. Simple characters are enough; use eyes, head, shoulder, hand and feet for readable acting without random movement.
ANIMAL CAPABILITY: barnyard stories may use simple-pig, simple-chicken or simple-snake anatomy rigs. Stable actor id pig has head-group, eyes, ear, snout, tail, leg-fl/fr/hl/hr, knee-fl/fr/hl/hr, hoof-fl/fr/hl/hr. Five-toed hooves can use toes:5 on this rig. A chicken has head-group, head, comb, beak, wattle, eyes, wing, tail and two leg/knee/foot chains with three toes each; a snake has seg-0..seg-4 coils with belly marks, tail-tip, head-group, head, snout, tongue and dot eyes. Travel names the animal AND its actual leg/knee (or segment) targets; do not use human arm or leg-l/r names on animals. Each walking shot covers a short real distance between nearby grounded objects, not a whole village in a single slide. Stage crucial anatomy as a tight detail on the SAME animal and include a reaction showing who noticed it. Native human reactions can look/startle toward any nearby grounded animal or prop. Do not force a boat into unrelated stories.
For a night river story with traveler and ferryman at 720x1280, the existing folk-river-boat stage can be reused: actors lam (traveler), old (ferryman), lamp, bell, deck, loose-plank, boat-world, moon. old/oar is attached to old/forearm-r; arm/forearm/hand-l/r, upper-body, head-group, eyes, mouth, leg/knee/foot-l/r exist on both actors. Prefer row on old/arm-r and old/forearm-r; strike on old/arm-l, old/forearm-l and bell. New clues use plain scene IDs, e.g. wet-footprints, foot-1..foot-4, mud-hand, dock. NEVER use deck/wet-footprints or boat-world/root: slash addresses an ASSET PART, not a child of a scene group. Boat travel targets boat-world itself. You may add a dock or other required geometry. Keep the user's requested bald cast bald; no extra hats, hair or new striking tool unless the story specifically calls for it. Do not force this stage into unrelated stories.
${REFERENCE_SETTING_CONTRACT}
RIVERSIDE VILLAGE CAPABILITY: a village river landing with a wooden cottage, earth lane, plank pier and tied boat has its own native folk-setting place:riverside. Use one short stable location ID across views. Existing visible object IDs are house-left, house-left-door, lane, river-bank, river-water, dock and boat. Keep action on the dry bank unless an explicit crossing is staged; never invent a second cottage, pier or river overlay.
EMPTY SET STUDY: for a brief explicitly requesting only a static scenery image, cast:[] is valid. Use at least two wide context shots with visibleCast:[] and hold beats at the SAME location and fixed framing. Use distinct short narration metadata fitting the requested runtime. The ending may retain the same empty setting; do not invent an actor, close-up, disappearance or event.

Schema: {"name":"title","premise":"specific setup","stakes":"what the character risks","turn":"cause of the reversal","ending":"visible resolution and final implication","cast":[{"id":"person","role":"story role","design":"simple distinct clothing"}],"shots":[{"id":"shot-1","name":"shot title","durationMs":6000,"narration":"spoken Vietnamese words","purpose":"new story information and dramatic intent","location":"stable-stage-id","visibleCast":["person"],"heldProps":[],"propEvents":[],"continuity":"continue","shot":{"size":"wide|action|detail|reaction","framing":"context|close","focus":"visible actor or clue ID","include":["partner-or-action-object"]},"beats":[{"cue":"exact narrated phrase","kind":"motion|travel|row|strike|reveal|hide|hold","targets":["visible participants"],"motionTargets":["exact parts that must change"],"before":"visible preparation/state","after":"visible result/state"}]}]}. Keep IDs consistent with the later drawing. At most 8 beats per shot and 4 included objects.`;

export type VectorStory = {
  name:string;premise:string;stakes:string;turn:string;ending:string;
  cast:Array<{id:string;role:string;design:string}>;
  shots:Array<CanvasVectorDirection&{id:string;name:string;durationMs:number;narration:string}>;
};
const record=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Screenplay needs JSON objects');
  return v as Record<string,unknown>;
};
const text=(v:unknown,label:string,max=1200)=>{
  if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`Screenplay needs ${label}`);
  return v.trim();
};
const names=(v:unknown,label:string,min=0,max=8)=>{
  if(!Array.isArray(v)||v.length<min||v.length>max||v.some(n=>typeof n!=='string'||! /^[\w/-]{1,100}$/.test(n)))throw new Error(`Screenplay needs ${label}`);
  return [...new Set(v)] as string[];
};
export function normalizeVectorStory(raw:unknown,targetSeconds:number,options:{requireHandPlan?:boolean;requireVisibleCast?:boolean;requireTurnPlan?:boolean;requireFearPlan?:boolean;requireTravelPlan?:boolean;compactCast?:boolean;nativePerson?:boolean}={}):VectorStory{
  const d=record(raw);
  if(!Array.isArray(d.shots)||d.shots.length<2||d.shots.length>100)throw new Error('Screenplay needs 2-100 purposeful shots, including an ending');
  const ids=new Set<string>();
  const castIds=new Set(Array.isArray(d.cast)?d.cast.map(c=>record(c).id):[]);
  // Registered animal actors keep their own anatomy: a chicken really has
  // leg-l/leg-r, a snake really has segments. Only limbless puppet PEOPLE are
  // barred from leg targets.
  const animalIds=new Set((Array.isArray(d.cast)?d.cast:[]).filter(c=>{
    const r=record(c);
    return /pig|heo|chicken|hen|snake|duck|dog|trau|buffalo|goat|\bga\b|\bran\b|\bvit\b|\bcho\b|\bmeo\b|\bchim\b|cat/i.test(
      [r.id,r.role,r.design].filter(v=>typeof v==='string').join(' '));
  }).map(c=>String(record(c).id)));
  const castDesign=new Map((Array.isArray(d.cast)?d.cast:[]).map(c=>{
    const r=record(c);
    return [String(r.id),[r.role,r.design].filter(v=>typeof v==='string').join(' ')] as const;
  }));
  if(options.nativePerson&&!castIds.has('person'))throw new Error('Screenplay native illustrated-place protagonist must use actor ID person; keep the human name in prose, not a second actor ID');
  const shots=d.shots.map(value=>{
    const s=record(value),id=text(s.id,'unique shot id',100),narration=text(s.narration,'spoken narration',3000),shot=record(s.shot);
    if(!/^[\w-]+$/.test(id)||ids.has(id))throw new Error('Screenplay has duplicate or invalid shot IDs');ids.add(id);
    if(!['wide','action','detail','reaction'].includes(String(shot.size)))throw new Error('Screenplay needs a supported shot size');
    if(shot.framing!==undefined&&!['context','close'].includes(String(shot.framing)))throw new Error('Screenplay needs context or close framing');
    if(options.requireVisibleCast&&s.visibleCast===undefined)throw new Error(`Screenplay ${id} must declare visibleCast, including [] for an empty view`);
    const visibleCast=s.visibleCast===undefined?undefined:names(s.visibleCast,'visible cast',0,12);
    if(visibleCast?.some(actor=>!castIds.has(actor)))throw new Error('Screenplay visibleCast must name registered cast members');
    let backgroundActions:CanvasVectorDirection['backgroundActions'];
    if(s.backgroundActions!==undefined){
      if(!Array.isArray(s.backgroundActions)||s.backgroundActions.length>12)throw new Error('Screenplay needs backgroundActions as an array');
      const assigned=new Set<string>();
      backgroundActions=s.backgroundActions.map(value=>{
        const a=record(value);
        if(typeof a.actor!=='string'||!castIds.has(a.actor)||assigned.has(a.actor)||!['pass','visit','attend','converse','hold'].includes(String(a.activity))
          ||a.activity==='visit'&&a.partner===undefined
          ||a.partner!==undefined&&(typeof a.partner!=='string'||!castIds.has(a.partner)||a.partner===a.actor))throw new Error('Screenplay background task needs a unique cast actor, supported activity and distinct cast partner');
        assigned.add(a.actor);
        return {actor:a.actor,activity:a.activity as NonNullable<typeof backgroundActions>[number]['activity'],...(typeof a.partner==='string'?{partner:a.partner}:{})};
      });
    }
    if(typeof s.durationMs!=='number'||!Number.isFinite(s.durationMs)||s.durationMs<1000||s.durationMs>30000)throw new Error('Screenplay shot must last 1-30 seconds');
    if(!Array.isArray(s.beats)||!s.beats.length||s.beats.length>8)throw new Error('Screenplay needs observable beats for every shot');
    // A scene group has no asset parts. Recover the common weak-model address
    // typo in the SMALL plan before drawing, rather than redrawing a whole film.
    const addresses=(v:unknown,label:string,min=0,max=8)=>names(v,label,min,max).map(id=>{
      const [parent,child]=id.split('/');
      if(child==='root'&&castIds.has(parent)&&id.split('/').length===2)return parent!;
      if(options.compactCast&&castIds.has(parent)&&child){
        if(/^(?:leg|knee|foot)-[lr]$/.test(child)&&!animalIds.has(parent!))throw new Error(`Screenplay compact Model A has no visible legs or feet: ${id}. Stage a supported clue with head, eyes, hands or a scene prop; do not invent anatomy to illustrate an AI-created event`);
        // Crossed anatomies fail much later as "unknown animated part".
        // Catch them here with the correct part names for each rig.
        const design=castDesign.get(parent!)||'';
        if(/simple-chicken/i.test(design)&&/^(?:leg|knee|foot|hoof)-f[lr]$/.test(child))throw new Error(`Screenplay chicken ${parent} walks on leg-l/leg-r (two legs), not ${child}. Use chicken/leg-l, chicken/knee-r or chicken/foot-l.`);
        if(/simple-snake/i.test(design)&&/^(?:leg|knee|foot|hoof)/.test(child))throw new Error(`Screenplay snake ${parent} has no legs; it moves seg-0..seg-4, tail-tip and head-group. Use snake/seg-1 instead of ${child}.`);
        if(/simple-pig/i.test(design)&&/^(?:leg|knee|foot)-[lr]$/.test(child))throw new Error(`Screenplay pig ${parent} walks on leg-fl/fr/hl/hr (four legs), not ${child}. Use pig/leg-fl or pig/knee-fr.`);
        if(/simple-puppet/i.test(design)&&/^(?:leg|knee|foot)-fl|^(?:leg|knee)-fr|^hoof-|^seg-/.test(child))throw new Error(`Screenplay puppet ${parent} is limbless; animal parts like ${child} do not exist on people. Use head-group, eyes, mouth or hand-l/hand-r.`);
        // Puppet-only parts on animals (and vice versa) fail later as a
        // missing world transform. Name the rig's real parts instead.
        if(/simple-chicken/i.test(design)&&/^(?:upper-body|hand-[lr]|arm-[lr]|forearm-[lr]|mouth|tunic-hem|puppet-root)$/.test(child))throw new Error(`Screenplay chicken ${parent} has no ${child}; it acts with head-group, eyes, beak, comb, wing, tail, hand-free legs leg-l/leg-r and feet. Drop ${child}.`);
        if(/simple-snake/i.test(design)&&/^(?:upper-body|hand-[lr]|arm-[lr]|mouth|leg-[lr]|hoof-|comb|beak)$/.test(child))throw new Error(`Screenplay snake ${parent} has no ${child}; it acts with seg-0..seg-4, tail-tip, head-group, head, snout, tongue and eyes. Drop ${child}.`);
        if(/simple-pig/i.test(design)&&/^(?:upper-body|hand-[lr]|arm-[lr]|seg-|comb|beak)$/.test(child))throw new Error(`Screenplay pig ${parent} has no ${child}; it acts with head-group, eyes, ear, snout, tail and leg/knee/hoof-fl/fr/hl/hr. Drop ${child}.`);
        if(child==='head')return parent+'/head-group';
        if(/^(?:arm|forearm)-[lr]$/.test(child))return parent+'/hand-'+child.slice(-1);
      }
      return s.location==='folk-river-boat'&&['deck','boat-world'].includes(parent!)&&child?(child==='root'?parent!:child):id;
    });
    if(options.requireHandPlan&&s.heldProps===undefined)throw new Error(`Screenplay ${id} must declare heldProps; [] retains any preceding inventory until an explicit release`);
    if(s.heldProps!==undefined&&!Array.isArray(s.heldProps))throw new Error('Screenplay needs heldProps as an array');
    const occupied=new Set<string>(),held=new Set<string>();
    const heldProps=(s.heldProps as unknown[]|undefined)?.map(value=>{
      const h=record(value),actor=names([h.actor],'holding actor',1)[0]!,prop=names([h.prop],'held prop',1)[0]!;
      if(!castIds.has(actor)||!['l','r'].includes(String(h.arm))||actor===prop||occupied.has(actor+'/'+h.arm)||held.has(prop))throw new Error('Screenplay needs one prop per valid actor hand');
      if(h.hang!==undefined&&typeof h.hang!=='boolean')throw new Error('Screenplay needs a boolean hanging prop state');
      occupied.add(actor+'/'+h.arm);held.add(prop);
      return {actor,arm:h.arm as 'l'|'r',prop,...(h.hang!==undefined?{hang:h.hang as boolean}:{})};
    });
    if(s.continuity!==undefined&&!['continue','reset'].includes(String(s.continuity)))throw new Error('Screenplay needs a supported continuity state');
    if(s.propEvents!==undefined&&(!Array.isArray(s.propEvents)||s.propEvents.length>16))throw new Error('Screenplay needs a short propEvents array');
    const propEvents=(s.propEvents as unknown[]|undefined)?.map(value=>{
      const e=record(value),cue=text(e.cue,'prop event cue',500);
      if(!narration.includes(cue)||!['take','release'].includes(String(e.action)))throw new Error('Screenplay prop event needs an exact spoken cue and take/release action');
      return {prop:names([e.prop],'event prop',1)[0]!,action:e.action as 'take'|'release',cue};
    });
    const beats=s.beats.map(value=>{
      const b=record(value),cue=text(b.cue,'exact spoken cue',500),kind=String(b.kind) as CanvasVectorDirection['beats'][number]['kind'];
      if(!narration.includes(cue))throw new Error(`Screenplay cue is not spoken: ${cue}`);
      if(!['motion','travel','row','strike','reveal','hide','hold'].includes(kind))throw new Error('Screenplay needs a supported beat kind');
      // Providers sometimes describe a deliberate hold with purpose alone.
      // It is the SAME unchanged state, never a guessed physical action.
      const hold=kind==='hold'?b.purpose:undefined;
      const before=text(b.before??hold,'before state'),after=text(b.after??hold,'after state');
      if(kind!=='hold'&&before.toLocaleLowerCase()===after.toLocaleLowerCase())throw new Error('Screenplay action needs a visible before/after change');
      // An explicitly empty still set can hold its already-declared scenery
      // focus. Do not spend another AI request or invent an actor for it.
      const heldSet=kind==='hold'&&visibleCast?.length===0&&Array.isArray(b.targets)&&b.targets.length===0
        &&typeof shot.focus==='string'&&!castIds.has(shot.focus);
      const targets=addresses(heldSet?[shot.focus]:b.targets,'visible participants',1),motionTargets=addresses(b.motionTargets,`actual moving parts in ${s.id}`,kind==='hold'?0:1,16);
      let turn:CanvasVectorDirection['beats'][number]['turn'];
      let fear:CanvasVectorDirection['beats'][number]['fear'];
      let travel:CanvasVectorDirection['beats'][number]['travel'];
      if(b.travel!==undefined){
        const t=record(b.travel);
        if(kind!=='travel'||typeof t.actor!=='string'||!castIds.has(t.actor)||typeof t.to!=='string'||!names([t.to],'travel destination',1)[0]
          ||t.actor===t.to||!targets.includes(t.actor)||!targets.includes(t.to)||!motionTargets.includes(t.actor)
          ||t.gap!==undefined&&(typeof t.gap!=='number'||!Number.isFinite(t.gap)||t.gap<20||t.gap>640)
          ||t.followDepth!==undefined&&typeof t.followDepth!=='boolean')throw new Error('Screenplay travel needs its cast actor root, distinct destination in targets, finite gap and optional followDepth');
        travel={actor:t.actor,to:t.to,...(t.gap!==undefined?{gap:t.gap as number}:{}),...(t.followDepth!==undefined?{followDepth:t.followDepth as boolean}:{})};
      }
      if(options.requireTravelPlan&&options.compactCast&&kind==='travel'&&!travel&&motionTargets.some(t=>castIds.has(t)))
        throw new Error(`Screenplay travel at "${cue}" must declare travel:{actor,to,gap,followDepth}; name the actual destination, not a guessed slide`);
      if(b.fear!==undefined){
        const f=record(b.fear);
        if(kind!=='motion'||typeof f.actor!=='string'||!castIds.has(f.actor)||!targets.includes(f.actor)
          ||!motionTargets.includes(f.actor+'/upper-body')||!['uneasy','terrified'].includes(String(f.level)))
          throw new Error('Screenplay fear needs a cast actor, motion on actor/upper-body and uneasy/terrified level');
        fear={actor:f.actor,level:f.level as NonNullable<typeof fear>['level']};
      }
      if(b.turn!==undefined){
        const t=record(b.turn),views=['front','back','left','right'];
        if(kind!=='motion'||typeof t.actor!=='string'||!castIds.has(t.actor)||!targets.includes(t.actor)
          ||!motionTargets.includes(t.actor+'/upper-body')||!views.includes(String(t.from))||!views.includes(String(t.to))||t.from===t.to)
          throw new Error('Screenplay turn needs a cast actor, motion on actor/upper-body, and distinct front/back/left/right views');
        turn={actor:t.actor,from:t.from as NonNullable<typeof turn>['from'],to:t.to as NonNullable<typeof turn>['to']};
        if(options.requireTurnPlan&&options.compactCast&&(t.from==='front'?'right':t.from)===(t.to==='front'?'right':t.to))
          throw new Error('Screenplay front and right are the same view; a visible turn must change left/right facing or use back');
      }
      // Only new compact plans require this explicit choice. Retained plans
      // without metadata remain compatible; never guess their intended view.
      const words=(cue+' '+after).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      if(options.requireTravelPlan&&travel){
        const onset=cue.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        if(/\b(?:dung lai|stops?|arriv\w*)\b/.test(onset)&&!/\b(?:buoc|di|walk\w*|approach\w*|tien)\b/.test(onset))
          throw new Error(`Screenplay travel cue "${cue}" names the stop; anchor travel at the earlier spoken walking phrase so the actor moves while walking is narrated`);
      }
      if(options.requireVisibleCast&&kind!=='hold')for(const entry of d.cast as Array<Record<string,unknown>>){
        // Only an explicitly named role ("Thuận - traveler") is unambiguous.
        // Do not guess names from generic roles such as "the old woman".
        const name=String(entry.role).match(/^([^:—–-]{2,40})\s*[:—–-]/)?.[1]?.trim();
        if(name&&cue.startsWith(name+' ')&&!motionTargets.some(t=>t===entry.id||t.startsWith(entry.id+'/')))
          throw new Error(`Screenplay cue "${cue}" names ${entry.id}; animate that actor instead of substituting background reactions`);
      }
      if(options.requireFearPlan&&options.compactCast&&kind==='motion'&&!fear&&motionTargets.some(t=>t.endsWith('/upper-body'))
        &&/\b(?:run (?:ray|ban bat|lap cap)|mo hoi|trembl\w*|shiver\w*|sweat\w*)\b/.test(words))
        throw new Error(`Screenplay trembling/sweating at "${cue}" must declare fear:{actor,level}`);
      if(options.requireTurnPlan&&options.compactCast&&kind==='motion'&&!turn&&motionTargets.some(t=>t.endsWith('/upper-body'))
        &&/\b(?:quay|xoay|turn|turns|turned|facing)\b/.test(words))
        throw new Error(`Screenplay whole-body turn at "${cue}" must declare turn:{actor,from,to}; use back for a rear view`);
      return {cue,kind,targets,motionTargets,before,after,...(turn?{turn}:{}),...(fear?{fear}:{}),...(travel?{travel}:{})};
    });
    const afraid=beats.flatMap(b=>b.fear?[b.fear.actor]:[]);
    const travelers=beats.flatMap(b=>b.travel?[b.travel.actor]:[]);
    if(new Set(travelers).size!==travelers.length)throw new Error('Screenplay needs one destination per traveling actor per shot; split a second errand into the next shot');
    if(new Set(afraid).size!==afraid.length)throw new Error('Screenplay needs only one fear beat per actor in a shot');
    for(const event of propEvents||[])if(!beats.some(b=>b.cue===event.cue&&b.kind!=='hold'&&[...b.targets,...b.motionTargets].includes(event.prop)))
      throw new Error('Screenplay prop event needs a corresponding observable beat naming its prop');
    return {id,name:text(s.name,'shot name',120),durationMs:s.durationMs,narration,purpose:text(s.purpose,'shot purpose'),location:names([s.location],'location',1)[0]!,...(heldProps!==undefined?{heldProps}:{}),
      ...(s.continuity!==undefined?{continuity:s.continuity as 'continue'|'reset'}:{}),...(propEvents!==undefined?{propEvents}:{}),...(visibleCast!==undefined?{visibleCast}:{}),...(backgroundActions!==undefined?{backgroundActions}:{}),
      shot:{size:shot.size as CanvasVectorDirection['shot']['size'],focus:names([shot.focus],'focus',1)[0]!,include:names(shot.include,'shot context',0,4),...(shot.framing!==undefined?{framing:shot.framing as 'context'|'close'}:{})},beats};
  });
  if(options.requireVisibleCast&&options.compactCast)for(const shot of shots){
    const words=(shot.narration+' '+shot.purpose).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const busy=/\b(?:cho|market)\b/.test(words)&&/\b(?:qua lai|mua ke ban|mua ban|nhon nhip|tap nap|busy|passing|shoppers)\b/.test(words);
    if(shot.shot.size!=='wide'||(shot.visibleCast?.length??0)<4||!busy)continue;
    const focus=shot.shot.focus.split('/')[0];
    const active=new Set(shot.beats.filter(b=>b.kind!=='hold').flatMap(b=>b.motionTargets.map(t=>t.split('/')[0]!)).filter(id=>id!==focus&&shot.visibleCast!.includes(id)));
    const tasks=(shot.backgroundActions||[]).filter(a=>a.activity!=='hold'&&a.actor!==focus&&shot.visibleCast!.includes(a.actor));
    for(const task of tasks)active.add(task.actor);
    const passing=tasks.some(a=>a.activity==='pass')||shot.beats.some(b=>b.kind==='travel'&&b.motionTargets.some(id=>id!==focus&&shot.visibleCast!.includes(id)));
    if(active.size<2||!passing)throw new Error(`Screenplay busy wide shot ${shot.id} needs two active background actors including a passing shopper; do not leave the crowd frozen`);
  }
  let hands:NonNullable<CanvasVectorDirection['heldProps']>=[];
  for(let i=0;i<shots.length;i++){
    const resolved=continueVectorHandPlan(shots[i]!,hands);shots[i]={...shots[i]!,...resolved};hands=resolved.heldProps||[];
  }
  const words=shots.reduce((n,s)=>n+s.narration.split(/\s+/u).length,0);
  for(let i=1;i<shots.length;i++)if(shots[i]!.narration===shots[i-1]!.narration)throw new Error('Screenplay repeats adjacent narration instead of advancing the story');
  // An explicitly empty, entirely still set study is not a dramatic film.
  // Do not force an invented disappearance or character into a scenery proof.
  const stillScenery=shots.every(s=>s.visibleCast?.length===0&&s.shot.size==='wide'&&s.beats.every(b=>b.kind==='hold'));
  if(!stillScenery&&shots.slice(-2).every(s=>s.beats.every(b=>b.kind==='hold')))throw new Error('Screenplay ending needs an observable event, not only reflection');
  // Vietnamese whitespace tokens are usually syllables, not English words.
  if(words<targetSeconds*1.4||words>targetSeconds*4.8)throw new Error(`Screenplay has ${words} words for ${targetSeconds}s; shorten or complete the story before drawing`);
  const total=shots.reduce((n,s)=>n+s.durationMs,0);
  if(Math.abs(total-targetSeconds*1000)>targetSeconds*250)throw new Error('Screenplay shot durations must fit the requested runtime');
  if(!Array.isArray(d.cast)||(!d.cast.length&&!stillScenery)||d.cast.length>12)throw new Error('Screenplay needs a small stable cast');
  const cast=d.cast.map(value=>{const c=record(value);return {id:names([c.id],'cast id',1)[0]!,role:text(c.role,'cast role',300),design:text(c.design,'cast design',500)};});
  if(new Set(cast.map(c=>c.id)).size!==cast.length)throw new Error('Screenplay cast IDs must be unique');
  return {name:text(d.name,'title',120),premise:text(d.premise,'premise'),stakes:text(d.stakes,'stakes'),turn:text(d.turn,'reversal'),ending:text(d.ending,'visible ending'),cast,shots};
}

/** The illustrator cannot silently replace the ending or rewrite voiced lines. */
export function assertVectorStoryFilm(data:Record<string,unknown>,story:VectorStory){
  if(!Array.isArray(data.scenes)||data.scenes.length!==story.shots.length)throw new Error('Drawing must include EVERY locked screenplay shot');
  for(const [i,value] of data.scenes.entries()){
    const s=record(value),shot=story.shots[i]!;
    if(s.id!==shot.id||s.narration!==shot.narration)throw new Error(`Drawing changed screenplay shot ${shot.id}; preserve order, ID and exact narration`);
  }
}

export type DirectionIssue={sceneId:string;problem:string;fix:string};
function values(scene:CanvasStudioScene,track:VectorTrack){
  const {start,end}=vectorTrackTiming(track,scene);
  return Array.from({length:25},(_,i)=>evaluateVectorPart(track.target,scene,start+(end-start)*i/24));
}
function moves(scene:CanvasStudioScene,track:VectorTrack,puppetLook=false,nativeFear=false){
  const samples=values(scene,track);
  return (['dx','dy','rotation','scaleX','scaleY'] as const).some(key=>{
    const range=Math.max(...samples.map(s=>s[key]))-Math.min(...samples.map(s=>s[key]));
    return range>=(key.startsWith('scale')?.08: key==='rotation'?(nativeFear?.1:puppetLook?2:6):(nativeFear?.5:puppetLook?2:5));
  })||new Set(track.frames.map(f=>f.d).filter(Boolean)).size>1;
}
/** Objective floor, not a substitute for watching the film. Stage ambience and
 * camera motion cannot prove a declared character action. Applies to new
 * screenplays only; older checkpoints without direction remain compatible. */
export function vectorDirectionIssues(project:CanvasStudioProject):DirectionIssue[]{
  const issues:DirectionIssue[]=[];
  const sceneryStudy=project.scenes.every(s=>{
    const d=s.vectorDirection;
    return d?.visibleCast?.length===0&&d.shot.size==='wide'&&d.shot.framing==='context'
      &&d.beats.length>0&&d.beats.every(b=>b.kind==='hold')&&!d.heldProps?.length&&!d.propEvents?.length
      &&!(d.backgroundActions||[]).some(a=>a.activity!=='hold');
  });
  const supportedReleasedProps=new Set<string>();
  for(const scene of project.scenes){
    if(!scene.vectorDirection||!scene.vectorScene)continue;
    if(scene.vectorDirection.continuity==='reset')supportedReleasedProps.clear();
    for(const event of scene.vectorDirection.propEvents||[])if(event.action==='release')supportedReleasedProps.add(event.prop);
    for(const held of scene.vectorDirection.heldProps||[])supportedReleasedProps.delete(held.prop);
    const targets=vectorTargets(scene.vectorScene,project.vectorAssets||{});
    const report=(problem:string,fix:string)=>issues.push({sceneId:scene.id,problem,fix});
    const shot=scene.vectorDirection.shot;
    const emptyNativeWide=shot.size==='wide'&&scene.vectorDirection.visibleCast?.length===0
      &&scene.vectorScene.nodes.some(n=>n.id==='folk-nature-grammar-v1'||n.id==='folk-setting-grammar-v1');
    const emptyContextStudy=sceneryStudy&&emptyNativeWide&&shot.framing==='context'
      &&scene.vectorDirection.beats.length>0&&scene.vectorDirection.beats.every(b=>b.kind==='hold');
    const scenicContext=new Set(['terrain','tree','forest-backdrop','river-water','river-bank','village','market','clearing']);
    for(const target of new Set([shot.focus,...shot.include])){
      const samples=[.3,.65,.95].map(t=>vectorShotVisibility(scene,project.vectorAssets||{},target,t*scene.durationMs));
      if(samples.some(s=>'missing' in s)){
        report(`Missing shot subject ${target}`, 'Draw the actual named subject in the shared location; do not replace the discovery with an unrelated wide view.');continue;
      }
      if(target===shot.focus&&samples.every(s=>'unmeasured' in s))
        report(`Story focus ${target} has no measurable framing bounds`, 'Give the actual object group finite width/height or use an existing instance/part with explicit local bounds. Frame that discovery on the same world; do not leave it offscreen behind a generic wide.');
      const visible=samples.filter(s=>'opacity' in s&&s.opacity!>.5);
      if(!visible.length)continue; // A cue-timed reveal/hide is checked by its beat below.
      // Framing trees/banks naturally extend beyond an establishing view.
      // Their edges need not fit like a held prop or a discovered story clue.
      if(visible.every(s=>'visibleFraction' in s&&s.visibleFraction!<(emptyNativeWide&&scenicContext.has(target)?.05:shot.framing==='close'&&Math.max(s.widthFraction!,s.heightFraction!)>1?.15:.55)))
        report(`Shot crops required subject ${target}`, 'Reframe the same world with shot.include retaining this story object and its partner. Do not move architecture, erase the subject or enlarge an individual actor.');
      const node=scene.vectorScene.nodes.find(n=>n.id===target),isActor=project.vectorAssets?.[node?.asset||'']?.nodes.some(n=>n.id==='head-group');
      if(target===shot.focus&&!isActor&&!emptyContextStudy&&visible.every(s=>'widthFraction' in s&&Math.max(s.widthFraction!,s.heightFraction!)<.1))
        report(`Story focus ${target} is too small to read`, 'Use a fixed contextual action or detail cut on this actual object, retaining a nearby observer when needed. A tiny clue in a distant wide cannot carry the discovery.');
    }
    const tasks=vectorBackgroundActions(scene,project.vectorAssets||{}).filter(a=>a.activity!=='hold');
    if(scene.vectorDirection.shot.size==='wide'&&tasks.length>=3){
      const coverage=vectorEnsembleCoverage(scene,project.vectorAssets||{});
      if(coverage.activeFraction<.5||coverage.multipleFraction<.15)report('Background ensemble is inactive through most of this populated wide shot', 'Keep purposeful passing, attending or conversation tasks on the continuous stage clock. A single late walk/turn, camera movement or blink does not provide sustained crowd activity. Use explicit backgroundActions:[] only for a deliberate still tableau.');
    }
    if(scene.vectorDirection.visibleCast!==undefined){
      for(const actor of scene.vectorDirection.visibleCast)if(!scene.vectorScene.nodes.some(n=>n.id===actor&&n.type==='instance'))
        report(`Visible cast ${actor} is missing from this view`, 'Draw this cast member in the locked location with its persistent asset.');
      const actors=scene.vectorScene.nodes.filter(n=>n.type==='instance'&&scene.vectorDirection!.visibleCast!.includes(n.id)&&project.vectorAssets?.[n.asset!]?.nodes.some(p=>p.id==='puppet-root'));
      const face=(actor:typeof actors[number],at:number)=>{
        let opacity=1,node:typeof actor|undefined=actor;
        while(node){opacity*=evaluateVectorPart(node.id,scene,at,node.opacity??1).opacity;node=scene.vectorScene!.nodes.find(n=>n.id===node!.parent);}
        if(opacity<.8)return undefined;
        const m=vectorWorldMatrix(actor.id+'/head-group',scene,at,project.vectorAssets);
        const shape=project.vectorAssets![actor.asset!]!.nodes.find(n=>n.id==='face'&&n.type==='ellipse');
        const rx=shape?.rx??56,ry=shape?.ry??60,cx=shape?.x??0,cy=shape?.y??0;
        const points=[[-rx,-ry],[rx,-ry],[-rx,ry],[rx,ry]].map(([x,y])=>vectorPoint(m,cx+x!,cy+y!));
        const left=Math.max(0,Math.min(...points.map(p=>p.x))),right=Math.min(scene.vectorScene!.width,Math.max(...points.map(p=>p.x)));
        const top=Math.max(scene.vectorScene!.height*.19,Math.min(...points.map(p=>p.y))),bottom=Math.min(scene.vectorScene!.height,Math.max(...points.map(p=>p.y)));
        return right>left&&bottom>top?{left,right,top,bottom,area:(right-left)*(bottom-top)}:undefined;
      };
      for(let a=0;a<actors.length;a++)for(let b=a+1;b<actors.length;b++){
        let overlaps=0,tailOverlaps=0;
        for(let i=0;i<9;i++){
          const at=i/8*scene.durationMs,first=face(actors[a]!,at),second=face(actors[b]!,at);
          if(!first||!second){tailOverlaps=0;continue;}
          const overlap=Math.max(0,Math.min(first.right,second.right)-Math.max(first.left,second.left))*Math.max(0,Math.min(first.bottom,second.bottom)-Math.max(first.top,second.top));
          if(overlap/Math.min(first.area,second.area)>.55){overlaps++;tailOverlaps++;}else tailOverlaps=0;
        }
        // A brief crossing is allowed; ending a reaction with merged faces is
        // not. Checking only a majority of the shot missed late backsteps.
        if(overlaps>=4||tailOverlaps>=2)report(`Visible faces ${actors[a]!.id} and ${actors[b]!.id} overlap ${tailOverlaps>=2?'in the settled final pose':'through the shot'}`, 'Fix actor blocking on their support surface so both faces read separately; preserve the set and held-prop grips. For a short retreat, keep the existing initial root pose and use a small displacement from that pose, not from dx=0. Include mirrored scaleX when measuring world positions. Do not solve a world-position collision with camera zoom.');
      }
    }
    const missingContext=scene.vectorDirection.shot.include.filter(id=>!targets.has(id));
    for(const held of scene.vectorDirection.heldProps||[]){
      const prop=scene.vectorScene.nodes.find(n=>n.id===held.prop);
      if(prop?.attachTo!==`${held.actor}/hand-${held.arm}`)report(`Held prop ${held.prop} is not attached to ${held.actor}/hand-${held.arm}`, 'Use native carries with the prop asset grip on the actual hand; preserve ownership across cuts.');
    }
    for(const prop of scene.vectorScene.nodes.filter(n=>n.type==='instance'&&project.vectorAssets?.[n.asset!]?.grip)){
      if((prop.opacity??1)===0)continue;
      if(!prop.attachTo&&!prop.groundAnchor&&!supportedReleasedProps.has(prop.id)&&(!prop.parent||prop.parent==='camera-world'))report(`Carryable prop ${prop.id} floats without a hand or support`, 'Use native carries on its actual handle, place it on a real support, or remove it while stored out of view. Do not leave unused tools beside an elbow.');
    }
    if(missingContext.length)report(`Missing shot context: ${missingContext.join(', ')}`, 'Draw the required partner, support or destination in the shared world; preserve the ending.');
    for(const beat of scene.vectorDirection.beats){
      const missing=[...beat.targets,...beat.motionTargets].filter(id=>!targets.has(id));
      if(missing.length){report(`Missing screenplay participants for "${beat.cue}": ${missing.join(', ')}`,`Draw the named objects and actual action; preserve narration and the locked ending.`);continue;}
      if(beat.kind==='hold')continue;
      if(beat.turn){
        const id=beat.turn.actor+'/upper-body',track=scene.vectorScene.tracks.find(t=>t.target===id&&t.cue===beat.cue);
        if(track){
          const {start,end}=vectorTrackTiming(track,scene);
          const before=evaluateVectorPart(id,scene,start).scaleX,after=evaluateVectorPart(id,scene,end).scaleX;
          const rear=beat.turn.from==='back'||beat.turn.to==='back';
          if(!rear&&Math.sign(before)===Math.sign(after))report(`No facing reversal at "${beat.cue}"`,`Change the whole actor's left/right facing; torso rocking is not a turn.`);
        }
      }
      const tracks=scene.vectorScene.tracks.filter(t=>t.cue===beat.cue||scene.vectorDirection!.propEvents?.some(e=>e.action==='release'&&e.cue===beat.cue&&e.prop===t.target));
      for(const target of beat.motionTargets){
        if(emptyNativeWide&&beat.kind==='reveal'&&scenicContext.has(target))continue;
        const controlled=new Set([target]);
        // Carried objects inherit actual hand/actor motion; requiring a second
        // local translation would detach them from the grip to satisfy QC.
        const attached=scene.vectorScene.nodes.find(n=>n.id===target)?.attachTo;
        if(attached){
          const [actor,part]=attached.split('/'),owner=scene.vectorScene.nodes.find(n=>n.id===actor);
          let node=project.vectorAssets?.[owner?.asset||'']?.nodes.find(n=>n.id===part);
          controlled.add(actor!);controlled.add(attached);
          while(node?.parent){controlled.add(actor+'/'+node.parent);node=project.vectorAssets?.[owner?.asset||'']?.nodes.find(n=>n.id===node!.parent);}
        }
        const [owner,part]=target.split('/'),instance=scene.vectorScene.nodes.find(n=>n.id===owner&&n.type==='instance');
        if(beat.kind==='reveal'||beat.kind==='hide')for(const emitter of vectorLightActionTargets(project.vectorAssets?.[instance?.asset||''],target,beat.cue))controlled.add(emitter);
        let node=part?project.vectorAssets?.[instance?.asset||'']?.nodes.find(n=>n.id===part):undefined;
        if(part&&instance)controlled.add(owner!);
        while(node?.parent&&!controlled.has(owner+'/'+node.parent)){controlled.add(owner+'/'+node.parent);node=project.vectorAssets?.[instance?.asset||'']?.nodes.find(n=>n.id===node!.parent);}
        const owned=tracks.filter(t=>controlled.has(t.target));
        const shown=(beat.kind==='reveal'||beat.kind==='hide')&&!vectorIsReleaseAction(beat.cue)?owned.some(t=>{
          const samples=values(scene,t),opacity=samples.map(s=>s.opacity);
          const targetNode=scene.vectorScene!.nodes.find(n=>n.id===t.target),rest=targetNode?.opacity??1;
          const base=targetNode?.atmosphere||rest===0?Math.max(...opacity):rest;
          return beat.kind==='reveal'?Math.min(...opacity)<base*.1&&Math.max(...opacity)>base*.8:Math.max(...opacity)>.1&&opacity.at(-1)!<.1;
        }):owned.some(t=>moves(scene,t,beat.kind==='motion'&&t.target===target&&
          ['upper-body','head-group','eyes'].includes(part||'')&&Boolean(project.vectorAssets?.[instance?.asset||'']?.nodes.some(n=>n.id==='puppet-root')),
          beat.fear?.actor===instance?.id&&target===beat.fear?.actor+'/upper-body'));
        if(!shown)report(`No evaluated ${beat.kind} on ${target} at "${beat.cue}"`, `Animate ${target} at this exact cue: ${beat.before} -> ${beat.after}. Camera, blinks, mouth and background motion do not count.`);
      }
      if(beat.kind==='travel'){
        const actor=beat.targets.find(t=>scene.vectorScene!.nodes.some(n=>n.id===t&&n.type==='instance'&&project.vectorAssets?.[n.asset!]?.nodes.some(p=>p.id==='knee-r')));
        if(actor&&(!tracks.some(t=>t.target===actor&&moves(scene,t))||!tracks.some(t=>t.target.startsWith(actor+'/')&&/\/(leg|knee)-[lr]$/.test(t.target)&&moves(scene,t))))
          report(`Travel at "${beat.cue}" has no articulated walk`, 'Use native walks with actual root travel and planted alternating legs; do not slide the torso.');
      }
      if(beat.kind==='row'){
        if(!tracks.some(t=>/\/arm-[lr]$/.test(t.target)&&moves(scene,t))||!tracks.some(t=>/\/forearm-[lr]$/.test(t.target)&&moves(scene,t)))
          report(`Rowing at "${beat.cue}" has no connected shoulder/elbow stroke`, 'Use native rows with the oar on the hand chain; keep feet planted and show the blade entering the water.');
      }
      if(beat.kind==='strike'&&beat.motionTargets.some(t=>/\/(?:arm|forearm|hand)-[lr]$/.test(t))){
        const arm=tracks.filter(t=>/\/(?:arm|forearm|hand)-[lr]$/.test(t.target));
        if(!arm.some(t=>{
          const samples=values(scene,t),first=samples[0]!;
          const end=vectorTrackTiming(t,scene).end;
          const follow=scene.vectorScene!.tracks.find(next=>next.target===t.target&&next!==t&&vectorTrackTiming(next,scene).start>=end-1&&vectorTrackTiming(next,scene).start<=end+1500);
          const last=follow?values(scene,follow).at(-1)!:samples.at(-1)!;
          return moves(scene,t)&&Math.abs(first.rotation-last.rotation)<3&&Math.hypot(first.dx-last.dx,first.dy-last.dy)<3;
        }))
          report(`Strike at "${beat.cue}" never withdraws after contact`, 'Use native strikes for the hand and target: prepare, touch, withdraw, then settle the struck object.');
      }
      // A tiny hand wobble beside the chest used to pass as grabbing a distant
      // rope. Check actual contact for explicitly paired puppet-hand/prop beats.
      const words=(beat.cue+' '+beat.after).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
      if(/\b(?:cham|chop|nam|giat|keo|day|touch|grab|pull|push|tap|strike)\b/.test(words))for(const hand of beat.motionTargets.filter(t=>/\/hand-[lr]$/.test(t))){
        const actor=scene.vectorScene.nodes.find(n=>n.id===hand.split('/')[0]);
        if(!project.vectorAssets?.[actor?.asset||'']?.nodes.some(n=>n.id==='puppet-root'))continue;
        const objects=scene.vectorScene.nodes.filter(n=>n.id!==actor!.id&&!n.attachTo&&beat.targets.includes(n.id)&&beat.motionTargets.includes(n.id)
          &&!project.vectorAssets?.[n.asset||'']?.nodes.some(p=>p.id==='head-group'));
        for(const object of objects){
          const asset=project.vectorAssets?.[object.asset||''];
          const bounds=asset?[0,0,asset.width,asset.height]:object.type==='ellipse'?[-object.rx!,-object.ry!,object.rx!,object.ry!]:[0,0,object.width??0,object.height??0];
          if(bounds[2]!<=bounds[0]!||bounds[3]!<=bounds[1]!)continue;
          const touched=tracks.filter(t=>t.target===hand).some(track=>{
            const {start,end}=vectorTrackTiming(track,scene);
            return Array.from({length:41},(_,i)=>start+(end-start)*i/40).some(at=>{
              if(puppetHandOpacity(hand,scene,at)<.5)return false;
              const m=vectorWorldMatrix(hand,scene,at,project.vectorAssets),p=vectorPoint(m,0,0),radius=17*Math.hypot(m.a,m.b);
              const objectMatrix=vectorWorldMatrix(object.id,scene,at,project.vectorAssets);
              const corners=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[3]]].map(([x,y])=>vectorPoint(objectMatrix,x!,y!));
              const dx=Math.max(0,Math.min(...corners.map(c=>c.x))-p.x,p.x-Math.max(...corners.map(c=>c.x)));
              const dy=Math.max(0,Math.min(...corners.map(c=>c.y))-p.y,p.y-Math.max(...corners.map(c=>c.y)));
              return Math.hypot(dx,dy)<=radius+2;
            });
          });
          if(!touched)report(`Puppet hand ${hand} never touches ${object.id} at "${beat.cue}"`, 'Use native reaches/strikes to the actual object-local contact point; move the actor within reach. A chest gesture cannot substitute for contact.');
        }
      }
    }
  }
  return issues;
}
