import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failResumedAiVideoJob, getAiVideoClip, selectShotCharacters, type AiVideoScene } from './aiVideoJobs';
import { workdir } from './ffmpeg';

test('shot cast routing excludes absent characters and preserves legacy metadata', () => {
  const cast = [{ index: 1, name: 'Robot', description: 'robot' }, { index: 2, name: 'Creature', description: 'quadruped' }];
  assert.deepEqual(selectShotCharacters(cast, { charactersInShot: ['robot'] } as AiVideoScene), [cast[0]]);
  assert.deepEqual(selectShotCharacters(cast, { charactersInShot: [] } as unknown as AiVideoScene), []);
  assert.deepEqual(selectShotCharacters(cast, {} as AiVideoScene), cast);
});

test('partial assembly uses original shot IDs even when middle shots are missing', () => {
  const manifest = buildAiVideoConcatManifest('clips', [{ index: 2, transition: 'cut' }, { index: 5, transition: 'cut' }] as AiVideoScene[]);
  assert.match(manifest, /002\.mp4/);
  assert.match(manifest, /005\.mp4/);
  assert.doesNotMatch(manifest, /001\.mp4/);
});

test('resume failure preserves the latest completed clips instead of resetting to the initial snapshot', async () => {
  const id = randomUUID();
  const directory = path.join(workdir, 'ai-video-jobs', id);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, 'job.json'), JSON.stringify({
      id, status: 'failed', progressPercent: 84,
      scenes: [
        { index: 1, status: 'completed' },
        { index: 2, status: 'completed' },
        { index: 3, status: 'failed' },
        { index: 4, status: 'generating' },
      ],
    }));
    const result = await failResumedAiVideoJob(id, new Error('last shot rejected'));
    assert.deepEqual(result.scenes.map((scene) => scene.status), ['completed', 'completed', 'failed', 'failed']);
    assert.equal(result.progressPercent, 84);
    assert.equal(result.error, 'last shot rejected');
    const persisted = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8'));
    assert.deepEqual(persisted.scenes, result.scenes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
import { AUTOMATIC_VISUAL_QUALITY_ATTEMPTS, aiVideoCandidateFileName, buildAiVideoConcatManifest, buildAiVideoContinuityReviewPrompt, buildAiVideoDirectorPrompt, buildCharacterSheetPrompt, buildFlowPrompt, buildFlowVideoReferences, buildStoryboardPrompt, compactProductionBible, getAiVideoVisualQualityIssue, getProfessionalShotPlanIssue, isRetryableNoChargeFlowError, parseAiVideoPlan, parseAiVideoVisualQualityLog, parseBlurScore, planAiVideoShotDurations, qualityRetakeReferences, runWithConcurrency } from './aiVideoJobs';

test('retained video candidates use a safe, scene-scoped filename', () => {
  assert.equal(aiVideoCandidateFileName(3, 2), '003.mp4.candidate-2.mp4');
  assert.equal(aiVideoCandidateFileName(0, 0), '001.mp4.candidate-1.mp4');
});

test('last candidate remains streamable while a shot is marked failed', async () => {
  const id = randomUUID();
  const directory = path.join(workdir, 'ai-video-jobs', id);
  const candidate = '001.mp4.candidate-1.mp4';
  await mkdir(path.join(directory, 'clips'), { recursive: true });
  try {
    await writeFile(path.join(directory, 'clips', candidate), 'candidate');
    await writeFile(path.join(directory, 'job.json'), JSON.stringify({
      id, status: 'failed', progressPercent: 84, scenes: [{ index: 1, status: 'failed', lastCandidate: { attempt: 1, fileName: candidate, status: 'needs-review', issue: 'frozen opening', createdAt: new Date().toISOString() } }],
    }));
    const result = await getAiVideoClip(id, 1, 'last');
    assert.equal(path.basename(result.path), candidate);
    assert.equal(result.size, Buffer.byteLength('candidate'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parseBlurScore averages FFmpeg blur measurements', () => {
  assert.equal(parseBlurScore('blur mean: 4.0\nblur mean: 6.0'), 5);
});

test('parseBlurScore rejects missing or invalid measurements', () => {
  assert.equal(parseBlurScore('blur mean: unknown'), Number.POSITIVE_INFINITY);
});

test('only retries Flow failures that explicitly did not charge credit', () => {
  assert.equal(isRetryableNoChargeFlowError(new Error('Flow báo tạo video không thành công và xác nhận chưa tính phí.')), true);
  assert.equal(isRetryableNoChargeFlowError(new Error("Generation failed. You weren't charged.")), true);
  assert.equal(isRetryableNoChargeFlowError(new Error('Google Flow session expired or unauthorized (HTTP 401).')), false);
  assert.equal(isRetryableNoChargeFlowError(new Error('Không tải được video Flow.')), false);
});

test('does not spend paid credits on automatic artistic retakes', () => {
  assert.equal(AUTOMATIC_VISUAL_QUALITY_ATTEMPTS, 1);
});

test('plans fewer provider-valid shots and does not force every beat to four seconds', () => {
  assert.deepEqual(planAiVideoShotDurations(30), [6, 8, 8, 8]);
  assert.deepEqual(planAiVideoShotDurations(20), [4, 8, 8]);
  assert.deepEqual(planAiVideoShotDurations(10), [4, 6]);
  assert.deepEqual(planAiVideoShotDurations(5), [6]);
  for (const duration of planAiVideoShotDurations(123)) assert.ok([4, 6, 8].includes(duration as 4 | 6 | 8));
});

test('video shot scheduler never exceeds its safe concurrency', async () => {
  let active = 0;
  let maximum = 0;
  const completed: number[] = [];
  await runWithConcurrency([1, 2, 3, 4], 2, async (index) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(index);
    active -= 1;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(completed.sort((a, b) => a - b), [1, 2, 3, 4]);
});

test('final quality retake relaxes a frozen opening frame but keeps identity reference', () => {
  assert.deepEqual(qualityRetakeReferences({ startImagePath: 'prior-frame.jpg' }, 3), { startImagePath: 'prior-frame.jpg' });
  assert.deepEqual(qualityRetakeReferences({ startImagePath: 'prior-frame.jpg' }, 4), { referenceImagePaths: ['prior-frame.jpg'] });
  assert.deepEqual(qualityRetakeReferences({ referenceImagePaths: ['character.png', 'storyboard.png'] }, 4), { referenceImagePaths: ['character.png'] });
});

test('director prompt plans professional coverage and respects the selected frame', () => {
  const prompt = buildAiVideoDirectorPrompt({
    brief: 'Một cô bé phát hiện người lạ đứng ngoài cổng.',
    durationSeconds: 16,
    aspectRatio: '16:9',
    sceneDurations: [8, 8],
  });
  assert.match(prompt.system, /exactly 2 connected horizontal 16:9 individual shots/i);
  assert.match(prompt.system, /2–3 timestamped chronological action beats/i);
  assert.match(prompt.system, /single shot, never a mini-montage/i);
  assert.match(prompt.system, /motion-first shotPlans/i);
  assert.match(prompt.system, /Use cameraMovement "locked" only/i);
  assert.match(prompt.system, /no internal cut/i);
  assert.match(prompt.system, /shotSize.*lensMm.*cameraAngle.*cameraMovement/i);
  assert.match(prompt.system, /charactersInShot/i);
  assert.match(prompt.system, /editMotivation/i);
  assert.match(prompt.system, /pay off the title\/premise/i);
  assert.match(prompt.system, /180-degree line/i);
  assert.match(prompt.system, /reaction, occlusion and negative space/i);
  assert.match(prompt.system, /strict voice bible/i);
  assert.match(prompt.system, /DIRECTOR CRAFT GATE/);
  assert.match(prompt.system, /provider-neutral video clips/);
  assert.match(prompt.system, /renderer adapter will translate/i);
  assert.match(prompt.system, /desire, obstacle, spatial geometry, gaze and rhythm/i);
  assert.match(prompt.system, /transition.*cut\|continue/i);
  assert.match(prompt.user, /<story_material>/);
});

test('continuity review performs a real script-supervisor pass before Flow generation', () => {
  const prompt = buildAiVideoContinuityReviewPrompt({ brief: 'Mai opens the gate.', rawPlan: '{"scenes":[]}', sceneDurations: [8, 8] });
  assert.match(prompt.system, /senior director, script supervisor and picture editor/i);
  assert.match(prompt.system, /continuityOut and the next continuityIn/i);
  assert.match(prompt.system, /prop hand, pose, gaze, screen direction/i);
  assert.match(prompt.system, /keeper names the one indispensable result/i);
  assert.match(prompt.system, /Motion reliability/i);
  assert.match(prompt.system, /explicit shotSize\/lensMm\/cameraAngle\/cameraMovement/i);
  assert.match(prompt.user, /Mai opens the gate/);
});

test('plan parser preserves directing fields used by Flow', () => {
  const plan = parseAiVideoPlan(JSON.stringify({
    productionBible: {
      storySpine: 'A child notices a stranger, investigates, then discovers the person needs help.',
      characters: [
        { name: 'Mai', description: 'Nine-year-old girl with short black hair and a blue school uniform.' },
        { name: 'Visitor', description: 'Elderly visitor wearing a weathered brown raincoat.' },
      ],
      worldGeography: 'Narrow kitchen behind a folding gate; the street stays screen-right.',
      soundVoice: 'Mai speaks Vietnamese with a soft northern accent and close microphone perspective.',
    },
    scenes: [{
      title: 'At the gate',
      dramaticBeat: 'Curiosity turns into concern when Mai notices the visitor does not answer.',
      shotSize: 'WS', lensMm: 35, cameraAngle: 'eye-level through the gate', cameraMovement: 'slow track toward the latch', editMotivation: 'sound', charactersInShot: ['Mai'],
      shotPlan: '0.0–1.2s locked wide through gate; 1.2–3.0s Mai approaches the latch; 3.0–4.0s camera tracks her hand beginning to open it.',
      blocking: 'Mai stops inside the gate, grips one bar and looks screen-right.',
      continuityIn: 'Mai enters from frame-left holding a rice bowl in her left hand.',
      continuityOut: 'Close frame of her hand opening the latch, motion beginning screen-right.',
      soundDesign: 'Ceiling fan, metal bowl set down, latch click bridges the cut.',
      keeper: 'Mai must remain framed behind the blue gate as concern replaces curiosity.',
      editorHandoff: 'Cut on the latch click and Mai beginning to pull screen-right.',
      negativeConstraints: 'No wardrobe drift, no extra visitors, no gate color change.',
      narration: 'Ông có cần giúp không ạ?',
      visualPrompt: 'Naturalistic Vietnamese neighborhood drama in humid afternoon light. Frame the child through the blue folding gate, preserving layered depth and restrained performances. Use the gate as foreground obstruction, then reveal only the visitor hand while keeping the face outside frame.',
    }],
  }), 1, [4]);
  assert.equal(plan.scenes[0].durationSeconds, 4);
  assert.equal(plan.scenes[0].shotSize, 'WS');
  assert.equal(plan.scenes[0].lensMm, 35);
  assert.deepEqual(plan.scenes[0].charactersInShot, ['Mai']);
  assert.match(plan.scenes[0].shotPlan || '', /locked wide/);
  assert.match(plan.scenes[0].continuityOut || '', /opening the latch/);
  assert.match(plan.scenes[0].keeper || '', /blue gate/);
});

test('plan parser keeps one character bible entry per recurring character', () => {
  const plan = parseAiVideoPlan(JSON.stringify({
    productionBible: {
      directorContract: 'A restrained two-character drama with consistent screen direction and identity.',
      storySpine: 'An meets Binh and they decide to leave together.',
      characters: [
        { name: 'An', description: 'Young architect with short black hair, green field jacket and a silver watch.' },
        { name: 'Binh', description: 'Older photographer with curly gray hair, brown coat and a brass camera.' },
      ],
      worldGeography: 'A narrow station platform with the exit screen-right.',
    },
    scenes: [{
      title: 'The meeting', dramaticBeat: 'Recognition changes hesitation into trust.',
      primaryAction: 'An and Binh walk toward the exit.',
      openingState: 'An wears headphones over both ears; Binh carries his camera in his right hand.',
      closingState: 'Both move screen-right; An still wears headphones; camera stays in Binh right hand.',
      successCriteria: 'Both characters take a shared step toward the exit.',
      shotSize: 'WS', lensMm: 35, cameraAngle: 'eye-level profile', cameraMovement: 'parallel track screen-right', editMotivation: 'action', charactersInShot: ['An', 'Binh'],
      shotPlan: '0.0–2.5s wide meeting; 2.5–5.0s medium reaction; 5.0–8.0s exit action.',
      blocking: 'An waits frame-left while Binh approaches from frame-right.', transition: 'cut',
      continuityIn: 'Both enter the platform from opposite sides.', continuityOut: 'They begin walking screen-right together.',
      soundDesign: 'Train ambience and a soft camera shutter.', keeper: 'Their recognition must read clearly.',
      editorHandoff: 'Cut on their first shared step.', negativeConstraints: 'No identity or wardrobe drift.', narration: '',
      visualPrompt: 'Wide station platform with An waiting frame-left and Binh approaching from frame-right. They recognize one another, exchange a restrained nod, then begin walking together toward the exit while the camera tracks parallel.',
    }],
  }), 1);
  assert.deepEqual(plan.characters.map(({ name }) => name), ['An', 'Binh']);
  assert.match(plan.productionBible, /An — Young architect/);
  assert.match(plan.productionBible, /Binh — Older photographer/);
  const scene = plan.scenes[0];
  assert.match(scene.openingState || '', /headphones/);
  assert.match(buildFlowPrompt(plan.productionBible, scene, 1, 4), /SHOT OPENING STATE: An wears headphones/);
  assert.match(buildStoryboardPrompt(plan.productionBible, scene, '16:9'), /EXACT WORN PROPS AND OPENING STATE: An wears headphones/);
});

test('plan parser extracts a complete JSON object from provider prose and fenced output', () => {
  const raw = `Here is the plan:\n\`\`\`json\n${JSON.stringify({
    productionBible: {
      directorContract: 'A restrained short film with a clear visual payoff and no identity drift.',
      storySpine: 'A courier reaches the final address and discovers why the delivery matters.',
      characters: [{ name: 'R-7', description: 'Small weathered orange courier robot with a cracked left shoulder plate and blue optical sensor.' }],
      worldGeography: 'A flooded alley runs screen-left to screen-right toward one lit doorway.',
    },
    scenes: [{
      title: 'The final door', dramaticBeat: 'Duty turns into recognition at the destination.',
      shotSize: 'WS', lensMm: 24, cameraAngle: 'low at wheel height', cameraMovement: 'track screen-right', editMotivation: 'sound', charactersInShot: ['R-7'],
      shotPlan: '0.0–2.5s low wide tracking right; 2.5–5.0s medium approach; 5.0–8.0s close reaction.',
      blocking: 'R-7 crosses screen-right, stops at the door and raises the parcel.', transition: 'cut',
      continuityIn: 'R-7 enters frame-left carrying the parcel in both hands.', continuityOut: 'The blue sensor brightens as the door opens.',
      soundDesign: 'Rain, servo steps and a door latch.', keeper: 'The sensor reaction must remain readable.',
      editorHandoff: 'Cut on the door latch.', negativeConstraints: 'No robot or parcel design drift.', narration: '',
      visualPrompt: 'Low wide view of a flooded alley as R-7 walks from frame-left to frame-right carrying a sealed parcel. The camera tracks at wheel height, rain ripples respond to each step, and the robot stops beneath one warm doorway before lifting the parcel as its blue optical sensor brightens. A sign reads "Unit {7}" beside the door.',
    }],
  })}\n\`\`\`\nEnd of response.`;
  assert.equal(parseAiVideoPlan(raw, 1).characters[0].name, 'R-7');
});

test('plan parser reports a truncated provider response clearly', () => {
  assert.throws(() => parseAiVideoPlan('{"productionBible":{"storySpine":"cut off', 1), /bị cắt giữa chừng/);
});

test('professional shot gate rejects contradictory continuation camera setups', () => {
  const base = { title: 'Beat', narration: '', visualPrompt: 'A detailed generated shot with visible action and a readable ending state.', dramaticBeat: 'Pressure increases.', shotPlan: '0.0–2.0s subject moves; 2.0–4.0s action reaches the exit state.', blocking: 'Subject crosses screen-right.', continuityIn: 'Subject is moving screen-right.', continuityOut: 'Subject remains moving screen-right.', soundDesign: 'Footsteps.', keeper: 'Motion remains readable.', editorHandoff: 'Cut on action.', negativeConstraints: 'No identity drift.', cameraAngle: 'eye-level profile', cameraMovement: 'parallel track', editMotivation: 'action' as const, status: 'pending' as const };
  assert.match(getProfessionalShotPlanIssue([
    { ...base, index: 1, shotSize: 'WS', lensMm: 35, transition: 'cut' },
    { ...base, index: 2, shotSize: 'CU', lensMm: 85, transition: 'continue' },
  ]) || '', /tiếp diễn.*đổi cỡ cảnh/i);
});

test('production bible compression preserves late continuity and voice fields', () => {
  const bible = [
    `storySpine: ${'cause and effect '.repeat(30)}`,
    `characters: ${'same face and body '.repeat(30)}`,
    `wardrobeProps: blue coat, brass key in left hand`,
    `worldGeography: door frame-left, street frame-right`,
    `visualGrammar: 35mm natural perspective`,
    `lightingColor: warm window light from frame-left`,
    `soundVoice: Vietnamese northern accent, low warm register, restrained cadence`,
  ].join('\n');
  const compact = compactProductionBible(bible, 900);
  assert.match(compact, /wardrobeProps:/);
  assert.match(compact, /lightingColor:/);
  assert.match(compact, /soundVoice: Vietnamese northern accent/);
  assert.ok(compact.length <= 900);
});

test('Flow prompt turns a plan into timed shots with a stable handoff frame', () => {
  const prompt = buildFlowPrompt('characters: same child\nworldGeography: kitchen behind gate', {
    index: 2,
    title: 'Reaction',
    dramaticBeat: 'She recognizes danger.',
    shotSize: 'CU',
    lensMm: 85,
    cameraAngle: 'eye-level profile through the gate',
    cameraMovement: 'slow lateral track',
    editMotivation: 'eyeline',
    charactersInShot: ['Mai'],
    shotPlan: '0.0–3.0s medium profile as she turns; 3.0–8.0s camera tracks her reaction.',
    blocking: 'She freezes and looks screen-right.',
    continuityIn: 'Her left hand is already on the latch.',
    continuityOut: 'She remains still in close-up, eyes fixed screen-right.',
    soundDesign: 'The latch click drops into silence.',
    keeper: 'Her recognition must remain readable in the eyes.',
    editorHandoff: 'Cut on her eyeline toward screen-right.',
    negativeConstraints: 'No identity drift or wardrobe change.',
    narration: '',
    visualPrompt: 'A restrained close reaction framed through the gate, with shallow depth and natural daylight.',
    status: 'pending',
  }, 2, 8);
  assert.match(prompt, /CONTINUOUS ACTION/);
  assert.match(prompt, /NON-NEGOTIABLE MOTION CONTRACT/);
  assert.match(prompt, /PRIMARY CHRONOLOGICAL MOTION/);
  assert.match(prompt, /first physical verb is already underway/i);
  assert.match(prompt, /"locked" means only the camera is stationary/i);
  assert.match(prompt, /CAMERA CONTRACT: CU at 85mm/i);
  assert.match(prompt, /EDITOR HANDOFF \(eyeline\)/i);
  assert.match(prompt, /No spoken dialogue/);
  assert.match(prompt, /Do not settle, pose, fade or pause/);
  assert.match(prompt, /No slideshow, dissolve, morph, teleport/);
  assert.match(prompt, /motion alive from the first frame/i);
  assert.match(prompt, /one editorial shot, not a montage/i);
  assert.match(prompt, /no internal cuts/i);
  assert.match(prompt, /VOICE CONTINUITY/);
  assert.match(prompt, /KEEPER — DO NOT LOSE/);
  assert.match(prompt, /SHOT-SPECIFIC AVOID LIST/);
});

test('professional planner creates real shot-level durations supported by Flow', () => {
  assert.deepEqual(planAiVideoShotDurations(20), [4, 8, 8]);
  assert.deepEqual(planAiVideoShotDurations(62), [6, 8, 8, 8, 8, 8, 8, 8]);
  assert.deepEqual(planAiVideoShotDurations(7), [8]);
});

test('visual quality gate catches single black frames and frozen boundaries', () => {
  const report = parseAiVideoVisualQualityLog([
    '[blackdetect] black_start:3.95833 black_end:4 black_duration:0.0416667',
    '[freezedetect] lavfi.freezedetect.freeze_start: 0.04',
    '[freezedetect] lavfi.freezedetect.freeze_end: 0.92 | lavfi.freezedetect.freeze_duration: 0.88',
  ].join('\n'));
  assert.equal(report.blackSegments.length, 1);
  assert.equal(report.freezeSegments[0].duration, 0.88);
  assert.match(getAiVideoVisualQualityIssue(report, 8) || '', /khung đen/);

  const frozenOnly = parseAiVideoVisualQualityLog([
    'lavfi.freezedetect.freeze_start: 0.02',
    'lavfi.freezedetect.freeze_duration: 1.30',
    'lavfi.freezedetect.freeze_end: 1.32',
  ].join('\n'));
  assert.match(getAiVideoVisualQualityIssue(frozenOnly, 8) || '', /hình đứng/);
});

test('concat manifest trims only the generated hold on continuous clips', () => {
  const base = { title: 'Beat', narration: '', visualPrompt: 'A detailed generated scene.', status: 'completed' as const };
  const manifest = buildAiVideoConcatManifest('C:\\clips', [
    { ...base, index: 1, transition: 'cut' },
    { ...base, index: 2, transition: 'continue' },
    { ...base, index: 3, transition: 'cut' },
  ]);
  assert.equal((manifest.match(/inpoint/g) || []).length, 1);
  assert.match(manifest, /002\.mp4'\ninpoint 0\.16/);
});

test('reference strategy uses a start frame only for unbroken action', () => {
  const scene = {
    index: 2,
    title: 'Next beat',
    narration: '',
    visualPrompt: 'A sufficiently detailed visual direction for a generated film scene.',
    status: 'pending' as const,
  };
  assert.deepEqual(buildFlowVideoReferences({ ...scene, transition: 'continue' }, 'last-frame.jpg', 'character.jpg'), { startImagePath: 'last-frame.jpg' });
  assert.deepEqual(buildFlowVideoReferences({ ...scene, transition: 'cut' }, 'last-frame.jpg', 'character.jpg'), { referenceImagePaths: ['character.jpg'] });
});

test('character sheet prompt locks the recurring design before video generation', () => {
  const prompt = buildCharacterSheetPrompt('characters: Sticky, circular white head, black hoodie, backward cap\nwardrobeProps: white sneakers', 'cinematic');
  assert.match(prompt, /front, 3\/4 view, exact side profile, back view/i);
  assert.match(prompt, /six consistent facial expressions/i);
  assert.match(prompt, /three dynamic action poses/i);
  assert.match(prompt, /Same person and proportions in every panel/i);
  assert.match(prompt, /No title, labels, captions/i);
});

test('storyboard prompt turns the approved design into one production frame', () => {
  const prompt = buildStoryboardPrompt('characters: same Sticky design', {
    index: 1,
    title: 'Leap over',
    dramaticBeat: 'Fear becomes commitment.',
    shotSize: 'WS',
    lensMm: 24,
    cameraAngle: 'low profile at rail height',
    cameraMovement: 'parallel track',
    editMotivation: 'action',
    charactersInShot: ['Sticky'],
    shotPlan: 'Low 24mm tracking shot as Sticky clears the rail.',
    continuityIn: 'Sticky enters frame-left at full sprint.',
    narration: '',
    visualPrompt: 'Sticky plants one foot and leaps over the rail.',
    negativeConstraints: 'No costume drift.',
    status: 'pending',
  }, '16:9');
  assert.match(prompt, /production still used to generate video, not a collage/i);
  assert.match(prompt, /exact character identity/i);
  assert.match(prompt, /camera height, lens feel, framing, blocking, screen direction/i);
  assert.match(prompt, /wide view/i);
  assert.doesNotMatch(prompt, /WS at 24mm|SHOT PLAN:/i);
  assert.match(prompt, /ONLY the opening continuity state/i);
  assert.match(prompt, /No typography, captions, labels/i);
});
