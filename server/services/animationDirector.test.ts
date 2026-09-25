import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateTimelineDurations, narrationDurationFitStatus, narrationRewriteChanged } from './animationDirector';
import { allocateLockedSceneDurations, animationActorPlanIssues, buildBeatPerformances, buildVisualBeatTimeline, buildVisualDensityPlan, characterReferenceDirective, chooseStoryboardTextBeatIndexes, directorRepairRule, directorReviewDirective, durationSecondsFromBrief, jsonFromDirectorReply, narrationFitWordTargets, normalizeLongAnimationSegments, normalizeResearchPacket, normalizeStoryboardEmbeddedText, replaceUnavailableGeneratedAssets, researchBlueprintDirective, storyboardShotDirection, storyToneDirective, storyWorldCastDirective, visualMediumDirective, visualMediumFromText, visualTextDirective, visualTextLanguage } from './animationDirector';
import { animationAssetCacheKey, narrationCaptionText, wavDurationMs } from './animationAssets';
import { animationCraftRules } from './directorKnowledge';
import { animationPerformancePlanIssues } from './animationDirector';
import { initialIsolatedFlowImageConcurrency, limitVieneuEmotionCueDensity, nonFlowImageConcurrencyPlan, normalizeStoryCharacterRefs, storyCastCharacterIds, storyCastReferenceDirective, storyCastReferencePrompt } from './animationDirector';
import { evaluateScene } from '../../src/animationStudio/evaluator';
import { defaultTransform } from '../../shared/animationStudio';

test('visual density follows the reference films: quick opening, calmer explanation', () => {
  const targets = [
    { seconds: 60, count: 22 },
    { seconds: 300, count: 110 },
    { seconds: 600, count: 220 },
    { seconds: 900, count: 330 },
  ];
  for (const target of targets) {
    const plan = buildVisualDensityPlan(target.seconds);
    assert.equal(plan.visualCount, target.count);
    assert.equal(plan.visualsPerScene.reduce((sum, count) => sum + count, 0), plan.visualCount);
    assert.ok(plan.visualsPerScene.every((count) => count >= 1 && count <= 4));
    assert.ok(plan.sceneCount < plan.visualCount);
    assert.ok(plan.visualDurationsSeconds.slice(0, plan.openingVisualCount).every((duration) => duration >= 2.2 && duration <= 2.6));
    assert.ok(plan.visualDurationsSeconds.slice(plan.openingVisualCount).every((duration) => duration >= 2.5 && duration <= 3.5));
    assert.ok(Math.abs(plan.sceneDurationsSeconds.reduce((sum, duration) => sum + duration, 0) - target.seconds) < 0.001);
    assert.equal(plan.sceneCount, Math.ceil(plan.visualCount / 4));
  }
  const firstMinute = buildVisualDensityPlan(60);
  assert.equal(firstMinute.openingVisualCount, 6);
  assert.equal(firstMinute.visualCount, 22);
});

test('character reference directive makes the attached image authoritative over storyboard/style drift', () => {
  const rule = characterReferenceDirective(true);
  assert.match(rule, /defines ONLY the recurring narrator mascot\/presenter/i);
  assert.match(rule, /Read the mascot's identity directly from the image/i);
  assert.match(rule, /preserve its recognizable silhouette, face, proportions, exact clothing, accessories and colors/i);
  assert.match(rule, /occasional narrator\/guide cameo/i);
  assert.match(rule, /Design secondary characters as distinct people/i);
  assert.match(rule, /never copy the mascot's identity or outfit onto them/i);
  assert.match(rule, /If the reference clearly establishes 2D or 3D/i);
  assert.doesNotMatch(rule, /green\/sage clothing to yellow/i);
  assert.match(characterReferenceDirective(true, 'Áo xanh sage, không vàng.'), /EXPLICIT OPTIONAL USER OVERRIDE/i);
  assert.match(characterReferenceDirective(true, 'đổi áo sang xanh dương'), /EXPLICIT OPTIONAL USER OVERRIDE/i);
  assert.match(characterReferenceDirective(true, 'đổi áo sang xanh dương'), /keep every unspecified feature faithful to the reference/i);
});

test('cast continuity separates the presenter from a coherent, period-appropriate supporting cast', () => {
  const rule = storyWorldCastDirective();
  assert.match(rule, /PRESENTER\/MASCOT and STORY-WORLD CAST sections/i);
  assert.match(rule, /stable visual IDs/i);
  assert.match(rule, /Reuse the same ID and appearance/i);
  assert.match(rule, /the JSON field is required even when empty/i);
  assert.match(rule, /same plausible time\/place and visual culture/i);
  assert.match(rule, /Do not assign hunting\/gathering or other roles by gender stereotype/i);
  assert.match(directorReviewDirective('balanced'), /recurring cast ID changes its visible identity/i);
});

test('seven isolated Flow workers start at fourteen image lanes while honoring safe limits', () => {
  const pool = { pendingWorkItems: 242, accountCount: 7, slotsPerAccount: 2, maxConcurrency: 14 };
  assert.equal(initialIsolatedFlowImageConcurrency(pool), 14);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, configuredInitial: 10 }), 10);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, configuredInitial: 20 }), 14);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, pendingWorkItems: 3 }), 3);
});

test('GPT Image starts at the verified 24-job local limit without raising other providers', () => {
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', Number.NaN), { maxConcurrency: 24, initialConcurrency: 24 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', 30), { maxConcurrency: 24, initialConcurrency: 24 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', 12), { maxConcurrency: 12, initialConcurrency: 12 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('openai-compatible', Number.NaN), { maxConcurrency: 4, initialConcurrency: 3 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('openai-compatible', 24), { maxConcurrency: 8, initialConcurrency: 3 });
});

test('VieNeu emotion cues stay sparse, follow a full sentence, and stay out of captions', () => {
  const segments = [
    { narration: 'Anh đã [cười] tiết kiệm được tiền.', visualBeats: [{ narrationCue: 'Anh đã [cười] tiết kiệm được tiền.' }] },
    { narration: 'Nhưng giá cả vẫn leo thang. [thở dài]', visualBeats: [{ narrationCue: 'giá cả vẫn leo thang' }] },
    { narration: 'Một ngày khác, hóa đơn lại tăng.', visualBeats: [{ narrationCue: 'hóa đơn lại tăng' }] },
    { narration: 'Bạn nhìn lại khoản chi của mình. [thở dài]', visualBeats: [{ narrationCue: 'khoản chi của mình' }] },
    { narration: 'Vậy nên, điều quan trọng là sức mua. [thở dài]', visualBeats: [{ narrationCue: 'điều quan trọng là sức mua' }] },
  ];
  const limited = limitVieneuEmotionCueDensity(segments);
  assert.equal(limited[0]?.narration, 'Anh đã tiết kiệm được tiền. [cười]');
  assert.equal(limited[0]?.visualBeats[0]?.narrationCue, 'Anh đã tiết kiệm được tiền.');
  assert.doesNotMatch(limited[1]?.narration || '', /\[(?:cười|thở dài|hắng giọng)\]/u);
  assert.match(limited[4]?.narration || '', /\[thở dài\]$/u);
  assert.equal(narrationCaptionText('Đúng như vậy. [cười] [thở dài]'), 'Đúng như vậy.');
  assert.equal(narrationCaptionText('That is funny. [chuckle]'), 'That is funny.');
});

test('story cast IDs normalize from beat metadata and visual prompts into reusable role anchors', () => {
  const segments = normalizeLongAnimationSegments({ segments: [{ narration: 'The guide meets the hunter.', visualBeats: [
    { visual: 'CAST_1, a hunter with a woven coat, enters the camp.', characterRefs: ['CAST_1', 'mascot', 'other'] },
    { visual: 'CAST_01 speaks beside the fire.' },
  ] }] }, 1);
  assert.deepEqual(segments[0]?.visualBeats[0]?.characterRefs, ['CAST_01', 'mascot']);
  assert.deepEqual(storyCastCharacterIds('', segments), ['CAST_01']);
  const referenceRule = storyCastReferenceDirective(['mascot', 'CAST_01'], true);
  assert.match(referenceRule, /reference image 1 is the mascot reference/);
  assert.match(referenceRule, /reference image 2 is the exact identity reference for CAST_01/);
  const referencePrompt = storyCastReferencePrompt({ characterId: 'CAST_01', continuity: 'STORY-WORLD CAST: CAST_01 is a hunter.', mediumRule: 'Keep one medium.', languageRule: 'Use Vietnamese.', mascotReferenceAttached: true });
  assert.match(referencePrompt, /do not copy its face, body, silhouette, clothing/i);
  assert.match(referencePrompt, /exactly one person/);
});

test('shot direction rotates composition and carries contextual backgrounds', () => {
  const shots = Array.from({ length: 8 }, (_, index) => storyboardShotDirection(index).type);
  assert.deepEqual(shots, ['establishing', 'action', 'detail', 'over-shoulder', 'comparison', 'process', 'reaction', 'metaphor']);
  assert.equal(storyboardShotDirection(20, 'comparison').type, 'comparison');
  assert.match(storyboardShotDirection(1).instruction, /medium or full-body/i);
  assert.match(storyboardShotDirection(0).instruction, /foreground, midground and background/i);
});

test('research packet normalizes a narrative blueprint with a safe fallback', () => {
  const packet = normalizeResearchPacket({
    centralQuestion: 'Vì sao giá tăng?',
    thesis: 'Cầu tăng nhanh hơn cung trong ngắn hạn.',
    audiencePromise: 'Người xem hiểu cơ chế bằng một ví dụ đời thường.',
    sourceQueries: ['Tìm số liệu CPI chính thức'],
    facts: [
      { claim: 'Cross-checked fact', evidence: 'Evidence in source excerpts.', sources: ['https://one.example/report', 'https://two.example/report'], use: 'use' },
      { claim: 'Single-source claim', evidence: 'Only one source.', source: 'https://one.example/other', use: 'use' },
    ],
    narrativeArc: [
      { phase: 'hook', objective: 'Mở bằng một lần đi chợ.' },
      { phase: 'question', objective: 'Đặt câu hỏi về hóa đơn.' },
      { phase: 'mechanism', objective: 'Giải thích cung và cầu.' },
      { phase: 'payoff', objective: 'Trả lời và callback.' },
    ],
  });
  assert.equal(packet.audiencePromise, 'Người xem hiểu cơ chế bằng một ví dụ đời thường.');
  assert.deepEqual(packet.sourceQueries, ['Tìm số liệu CPI chính thức']);
  assert.equal(packet.narrativeArc.length, 4);
  assert.equal(packet.facts[0]?.use, 'use');
  assert.deepEqual(packet.facts[0]?.sourceUrls, ['https://one.example/report', 'https://two.example/report']);
  assert.equal(packet.facts[1]?.use, 'qualify');
  assert.match(researchBlueprintDirective(packet), /sourceQueries/);
  assert.match(researchBlueprintDirective(packet), /sourceUrls/);
  const fallback = normalizeResearchPacket({ centralQuestion: 'Một câu hỏi', thesis: 'Một luận đề' });
  assert.equal(fallback.narrativeArc.length, 6);
  assert.equal(fallback.narrativeArc.at(-1)?.phase, 'payoff');
});

test('storyboard text policy keeps normal frames visual-first like the references', () => {
  const rule = visualTextDirective('Vietnamese');
  assert.match(rule, /ZERO readable text/i);
  assert.match(rule, /in any language/i);
  assert.match(rule, /blank or show only non-linguistic abstract shapes/i);
  assert.match(rule, /spoken video language is Vietnamese/i);
});

test('visual text language follows the video language', () => {
  assert.equal(visualTextLanguage('Tại sao mua 2 tặng 1 khiến bạn tiêu nhiều tiền hơn?'), 'Vietnamese');
  assert.equal(visualTextLanguage('Why buy two get one free makes you spend more money'), 'English');
  assert.match(visualTextDirective('English'), /spoken video language is English/i);
});

test('showrunner review rejects repeated rhetorical hooks and unsupported dopamine claims', () => {
  const rule = directorReviewDirective('balanced');
  assert.match(rule, /same rhetorical question or full-price\/buying prompt repeats/i);
  assert.match(rule, /reject with severity=high/i);
  assert.match(rule, /at most one concise callback/i);
  assert.match(rule, /do not describe dopamine as a simple pleasure chemical/i);
  assert.match(rule, /fetched source URL plus evidence/i);
  assert.match(rule, /at least two independently fetched publisher URLs plus evidence/i);
});

test('humorous storytelling requires audible setup and payoff instead of a label only', () => {
  const rule = storyToneDirective('humorous');
  assert.match(rule, /HUMOR IS REQUIRED BUT CONTROLLED/i);
  assert.match(rule, /everyday setup/i);
  assert.match(rule, /visual\/reaction payoff/i);
  assert.match(rule, /must be audible/i);
});

test('visual medium locks 3D or 2D and lets a reference decide when unspecified', () => {
  assert.equal(visualMediumFromText('Tạo mascot 3D kiểu CGI'), '3D');
  assert.equal(visualMediumFromText('flat vector 2D, nét vẽ whiteboard'), '2D');
  assert.equal(visualMediumFromText('Editorial hiện đại'), 'auto');
  assert.match(visualMediumDirective('3D', true), /NON-NEGOTIABLE 3D MEDIUM LOCK/i);
  assert.match(visualMediumDirective('2D', true), /NON-NEGOTIABLE 2D MEDIUM LOCK/i);
  assert.match(visualMediumDirective('auto', true), /inspect the attached mascot reference/i);
  assert.match(visualMediumDirective('auto', true), /overrides generic editorial\/style presets/i);
});

test('AI storyboard frames never select on-image text', () => {
  const beats = Array.from({ length: 23 }, (_, index) => ({
    visual: index % 2 === 0 ? `Price sign ${index} with ${index + 10}% discount` : `Mascot walking through aisle ${index}`,
    narrationCue: index % 3 === 0 ? `Giảm giá ${index + 10}%` : 'Nhân vật tiếp tục đi',
  }));
  assert.deepEqual([...chooseStoryboardTextBeatIndexes(beats)], []);
});

test('model-proposed text is removed after storyboard rewrites', () => {
  const segments = [{
    title: 'A', narration: 'Một hai ba bốn năm sáu bảy tám chín mười', motionGraphic: 'none' as const,
    visualBeats: Array.from({ length: 10 }, (_, index) => ({
      purpose: index === 0 ? 'comparison' : 'explain', visual: index % 2 ? 'Mascot in a room' : `Price sign ${index} 10%`,
      narrationCue: 'Một hai ba bốn', motion: 'locked' as const, transition: 'cut' as const,
      onScreenText: index === 0 ? 'Giá tăng' : `Unapproved long label ${index}`,
    })),
  }];
  const normalized = normalizeStoryboardEmbeddedText(segments);
  assert.ok(normalized[0]!.visualBeats.every((beat) => !beat.onScreenText));
});

test('explicit duration written in a brief overrides prompt length when auto mode is used', () => {
  assert.equal(durationSecondsFromBrief('Tạo video dài khoảng 90 giây về kinh tế.'), 90);
  assert.equal(durationSecondsFromBrief('Make this a 2 minute explainer.'), 120);
  assert.equal(durationSecondsFromBrief('Video khoảng 60-90 giây, nhịp nhanh.'), 75);
  assert.equal(durationSecondsFromBrief('Không ghi thời lượng, chỉ có chủ đề.'), undefined);
});

test('locked duration distributes only small proportional breathing room after measured narration', () => {
  const durations = allocateLockedSceneDurations([7_800, 8_100, 7_900, 8_000, 7_700, 8_200, 7_900, 2_900], 60_000);
  assert.ok(Math.abs(durations.reduce((sum, value) => sum + value, 0) - 60_000) < 0.001);
  durations.forEach((duration, index) => assert.ok(duration >= [7_800, 8_100, 7_900, 8_000, 7_700, 8_200, 7_900, 2_900][index]));
  assert.throws(() => allocateLockedSceneDurations([31_000, 31_000], 60_000), /dài hơn timeline/);
});

test('locked narration timing rejects an overrun and only pads a small shortfall', () => {
  assert.equal(narrationDurationFitStatus([50_000, 49_500], 100_000), 'fit');
  assert.equal(narrationDurationFitStatus([50_000, 48_000], 100_000), 'fit');
  assert.equal(narrationDurationFitStatus([50_000, 47_000], 100_000), 'short');
  assert.equal(narrationDurationFitStatus([50_000, 50_001], 100_000), 'long');
});

test('small narration edits are remeasured instead of rejected by a fixed word-count threshold', () => {
  const current = [{ narration: 'A sentence with a small timing mismatch.' }];
  assert.equal(narrationDurationFitStatus([302_864], 300_000), 'long');
  assert.equal(narrationRewriteChanged(current, [{ narration: 'A sentence with a small timing mismatch, trimmed.' }]), true);
  assert.equal(narrationRewriteChanged(current, current), false);
});

test('planned scene durations add up exactly on the render frame grid', () => {
  const durations = allocateTimelineDurations([2_500, 2_500, 2_700, 2_700], 10_400, 30);
  assert.ok(Math.abs(durations.reduce((sum, value) => sum + value, 0) - 10_400) < 0.001);
  durations.forEach((duration) => assert.ok(Math.abs(duration / (1000 / 30) - Math.round(duration / (1000 / 30))) < 0.000001));
});

test('narration word targets respond to real measured TTS instead of a fixed words-per-second guess', () => {
  const targets = narrationFitWordTargets([{ narration: 'một hai ba bốn năm sáu bảy tám chín mười' }], [4_000], [8_000]);
  assert.equal(targets[0], 20);
  const shorter = narrationFitWordTargets([{ narration: 'một hai ba bốn năm sáu bảy tám chín mười' }], [10_000], [5_000]);
  assert.equal(shorter[0], 6);
});

test('cue timing cannot leave the first storyboard image visible past three seconds', () => {
  const now = new Date().toISOString();
  const visuals = Array.from({ length: 2 }, (_, index) => ({ id: `dense-${index}`, type: 'background' as const, name: `Dense ${index}`, uri: `/dense-${index}.png`, tags: [], createdAt: now }));
  const timeline = buildVisualBeatTimeline({
    sceneIndex: 0,
    durationMs: 5_000,
    width: 1280,
    height: 720,
    narration: 'Nguyên nhân xuất hiện từ đầu, trong khi kết quả chỉ được nói ở tận cuối câu.',
    visuals,
    beats: [
      { purpose: 'cause', narrationCue: 'Nguyên nhân', visual: 'cause', motion: 'locked', transition: 'crossfade' },
      { purpose: 'result', narrationCue: 'kết quả', visual: 'result', motion: 'locked', transition: 'crossfade' },
    ],
  });
  const secondImageStart = timeline.layers[1]?.startMs;
  assert.ok(secondImageStart !== undefined && secondImageStart <= 3_000);
});

test('rejects action stills and slide-only plans but compiles a moving subject', () => {
  const segments = normalizeLongAnimationSegments({ segments: [{ narration: 'Quả bóng đi từ trái sang phải.', visualBeats: [{ purpose: 'action', visual: 'A ball', motion: 'push', narrationCue: 'Quả bóng đi từ trái sang phải', action: 'Ball travels left to right' }] }] }, 1);
  assert.ok(animationPerformancePlanIssues(segments).length);
  segments[0].visualBeats[0].objects = [{ name: 'Ball', shape: 'ellipse', fill: '#ff873d', width: .1, height: .1, path: [{ t: 0, x: .2, y: .4, rotation: 0 }, { t: 1, x: .8, y: .4, rotation: 180 }] }];
  assert.deepEqual(animationPerformancePlanIssues(segments), []);
  const performance = buildBeatPerformances({ sceneIndex: 0, durationMs: 5000, width: 1280, height: 720, assets: [], beats: segments[0].visualBeats });
  const scene = { id: 'test', name: 'Ball travels', renderMode: 'composite' as const, durationMs: 5000, narration: segments[0].narration, order: 0, backgroundColor: '#000000', ...performance, camera: { transform: defaultTransform(), commands: [] } };
  const before = evaluateScene(scene, 1000).layers.find((layer) => layer.type === 'shape')!;
  const after = evaluateScene(scene, 4000).layers.find((layer) => layer.id === before.id)!;
  assert.ok(after.transform.position.x > before.transform.position.x);
  assert.ok(after.transform.rotation > before.transform.rotation);
  assert.deepEqual(evaluateScene(scene, 1000).camera, evaluateScene(scene, 4000).camera);
});

test('actor preflight rejects missing or unsupported clips before image generation', () => {
  const segments = normalizeLongAnimationSegments({ segments: [{ narration: 'Nhân vật bước tới bàn.', visualBeats: [{ visual: 'A room', narrationCue: 'Nhân vật bước tới bàn', action: 'Walk towards table', actors: [{ assetId: 'hero', animation: 'walk', fromX: .2, toX: .6, y: .6 }] }] }] }, 1);
  const spriteRequests = [{ key: 'hero', name: 'Hero', design: 'A consistent blue cutout character with a yellow jacket', clips: ['walk'] }];
  assert.equal(animationActorPlanIssues(segments, {}, [], true).length, 1);
  assert.equal(animationActorPlanIssues(segments, { spriteRequests }, [], false).length, 1);
  assert.deepEqual(animationActorPlanIssues(segments, { spriteRequests }, [], true), []);
  segments[0].visualBeats[0].actors![0].animation = 'pick-up';
  assert.equal(animationActorPlanIssues(segments, { spriteRequests }, [], true).length, 1);
});

test('legacy decorative motion is disabled and invented narration cues are rejected', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Mặt Trăng quay quanh Trái Đất.', motionGraphic: 'focus', visualBeats: [{ visual: 'Space', narrationCue: 'Câu không tồn tại', action: 'Orbit' }] }] }, 1);
  assert.equal(segment.motionGraphic, 'none');
  assert.equal(segment.visualBeats[0].narrationCue, undefined);
});

test('performance commands preserve the exact narration cue and semantic action', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 5000, width: 1280, height: 720, assets: [], beats: [{ purpose: 'So sánh', narrationCue: 'A khác B', action: 'Lần lượt hiện hai thuộc tính để đối chiếu', visual: '', motion: 'locked', transition: 'cut', diagram: { steps: ['A nóng', 'B lạnh'], layout: 'comparison' } }] });
  assert.ok(result.commands.every((c) => c.parameters?.narrationCue === 'A khác B'));
});

test('staged diagrams create independent editable movement within each beat', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1920, height: 1080, assets: [], beats: [{ purpose: 'process', visual: '', motion: 'locked', transition: 'cut', diagram: { steps: ['Mưa', 'Nước ngấm', 'Cây phát triển'] } }] });
  assert.equal(result.layers.length, 9);
  assert.equal(result.commands.filter((item) => item.type === 'MOVE').length, 9);
  assert.ok(result.commands.every((item) => item.startMs + item.durationMs <= 4000));
  const reveals = result.commands.filter((item) => item.type === 'FADE_IN');
  assert.ok(reveals[3].startMs > reveals[0].startMs);
});

test('portrait comparison cards stay readable, separated and inside the safe area', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 6000, width: 1080, height: 1920, assets: [], beats: [{ purpose: 'contrast', visual: '', motion: 'locked', transition: 'cut', diagram: { layout: 'comparison', steps: ['Ăn thực vật', 'Ăn thịt'] } }] });
  const cards = result.layers.filter((layer) => layer.id.endsWith('-card'));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].transform.position.y + cards[0].height / 2 < cards[1].transform.position.y - cards[1].height / 2);
  assert.ok(cards.every((layer) => layer.transform.position.x - layer.width / 2 >= 100 && layer.transform.position.x + layer.width / 2 <= 980));
  assert.equal(result.commands.filter((command) => command.type === 'SCALE').length, 6);
  assert.ok(result.commands.every((command) => command.startMs + command.durationMs <= 6000));
});

test('missing sprite clips are reported rather than replaced by fake motion', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1920, height: 1080, assets: [], beats: [{ purpose: 'walk', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: 'missing', animation: 'walk', fromX: .2, toX: .8, y: .5 }] }] });
  assert.equal(result.layers.length, 0);
  assert.equal(result.warnings.length, 1);
});

test('leftward sprite travel mirrors the character without changing clip timing', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1280, height: 720, assets: [{ id: 'hero', name: 'Hero', type: 'sprite', uri: '/hero.png', tags: [], createdAt: '', sprite: { frameWidth: 128, frameHeight: 128, columns: 4, frameCount: 8, clips: { walk: { from: 0, to: 7, fps: 8, loop: true } } } }], beats: [{ purpose: 'walk', visual: '', motion: 'locked', transition: 'cut', actors: [{ assetId: 'hero', animation: 'walk', fromX: .8, toX: .2, y: .5 }] }] });
  assert.equal(result.layers[0].transform.scale.x, -1);
  assert.equal(result.commands.find((command) => command.type === 'PLAY_ANIMATION')?.durationMs, 4000);
});

test('missing images preserve the assigned beat instead of shifting later shots', () => {
  const asset = { id: 'last', name: 'Last', type: 'background' as const, uri: '/last.png', tags: [], createdAt: new Date().toISOString() };
  const beat = { purpose: 'reveal', visual: 'test', motion: 'locked' as const, transition: 'cut' as const };
  const result = buildVisualBeatTimeline({ sceneIndex: 0, durationMs: 8000, width: 1920, height: 1080, visuals: [undefined, asset], beats: [beat, beat] });
  assert.equal(result.layers[0].id, 'visual-0-1');
  assert.equal(result.layers[0]?.startMs, 4000);
});

test('animation craft knowledge rejects static slideshow direction', () => {
  assert.match(animationCraftRules, /ANIMATION CRAFT GATE/);
  assert.match(animationCraftRules, /anticipation before important movement and follow-through/i);
  assert.match(animationCraftRules, /visual state change every 2–4 seconds/i);
});

test('parses Director JSON wrapped in provider explanation and fenced output', () => {
  const explained = jsonFromDirectorReply('Here is the project:\n{"name":"Demo","scenes":[]}\nDone.');
  const fenced = jsonFromDirectorReply('```json\n{"name":"Fenced","scenes":[]}\n```');
  assert.equal(explained.name, 'Demo');
  assert.equal(fenced.name, 'Fenced');
});

test('does not stop at braces inside a JSON string', () => {
  const result = jsonFromDirectorReply('Result: {"name":"A {useful} title","scenes":[]} thanks');
  assert.equal(result.name, 'A {useful} title');
});

test('uses a smaller retry when provider output is truncated', () => {
  const rule = directorRepairRule('JSON từ AI Director bị thiếu phần kết thúc.');
  assert.match(rule, /exactly 2 scenes/);
  assert.match(rule, /compact one-line JSON/);
});

test('keeps the project editable when an optional generated asset fails', () => {
  const scene = { id: 'scene', name: 'Scene', order: 0, durationMs: 3000, narration: '', renderMode: 'composite' as const, backgroundColor: '#000000', layers: [{ id: 'visual', name: 'Planet', type: 'image' as const, assetId: 'requested-planet', visible: true, locked: false, zIndex: 1, width: 300, height: 300, transform: { position: { x: 100, y: 100 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }], commands: [], camera: { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } }, commands: [] } };
  const [result] = replaceUnavailableGeneratedAssets([scene], new Map(), new Set(['requested-planet']));
  assert.equal(result.renderMode, 'composite');
  if (result.renderMode !== 'composite') return;
  assert.equal(result.layers[0].type, 'shape');
  assert.equal(result.layers[0].assetId, undefined);
});

test('reads real WAV duration for voice-synced scenes', () => {
  const wav = Buffer.alloc(44 + 32_000);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32_000, 40);
  assert.equal(wavDurationMs(wav), 1000);
});

test('long animation keeps real visual beats without manufacturing four image prompts', () => {
  const segments = normalizeLongAnimationSegments({ segments: Array.from({ length: 9 }, (_, index) => ({
    title: `Scene ${index + 1}`,
    narration: `Narration ${index + 1}`,
    visual: `Subject ${index + 1}`,
  })) }, 6);
  assert.equal(segments.length, 6);
  assert.equal(segments[0].visualBeats.length, 1);
  assert.equal(segments[0].visualBeats[0].visual, 'Subject 1');
});

test('diagram-only beats survive and duplicate still prompts are removed', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Giải thích', visualBeats: [{ visual: 'Forest' }, { visual: ' forest ' }, { diagram: { steps: ['Nguyên nhân', 'Kết quả'] } }] }] }, 1);
  assert.equal(segment.visualBeats.length, 2);
  assert.equal(segment.visualBeats[1].diagram?.steps.length, 2);
});

test('auto storyboard stills default to static holds instead of invented Ken Burns motion', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Một cảnh tĩnh rõ ràng.', visual: 'Wide supermarket aisle', visualBeats: [{ purpose: 'explain', visual: 'Milk at the back of the store' }] }] }, 1);
  assert.ok(segment.visualBeats.length >= 1);
  assert.ok(segment.visualBeats.every((beat) => beat.motion === 'locked'));
  assert.ok(segment.visualBeats.every((beat) => beat.transition === 'cut'));
});

test('visual beats create static full-frame cuts without runtime motion', () => {
  const now = new Date().toISOString();
  const visuals = Array.from({ length: 4 }, (_, index) => ({ id: `asset-${index}`, type: 'background' as const, name: `Shot ${index}`, uri: `/shot-${index}.png`, tags: [], createdAt: now }));
  const beats = [
    { purpose: 'Establish', visual: 'wide', motion: 'push' as const, transition: 'cut' as const },
    { purpose: 'Action', visual: 'action', motion: 'pan-right' as const, transition: 'match-cut' as const },
    { purpose: 'Detail', visual: 'detail', motion: 'pull' as const, transition: 'crossfade' as const },
    { purpose: 'Reveal', visual: 'reveal', motion: 'drift-up' as const, transition: 'crossfade' as const },
  ];
  const timeline = buildVisualBeatTimeline({ sceneIndex: 0, durationMs: 10_000, width: 1920, height: 1080, visuals, beats });
  assert.equal(timeline.layers.length, 4);
  assert.equal(timeline.commands.length, 0);
  assert.ok(timeline.layers.every((layer) => layer.width === 1920 && layer.height === 1080));
  assert.ok(timeline.layers.every((layer) => layer.transform?.scale?.x === 1 && layer.transform?.scale?.y === 1));
});

test('long locked storyboard holds stay static instead of inventing camera motion', () => {
  const now = new Date().toISOString();
  const visual = { id: 'whiteboard-shot', type: 'background' as const, name: 'Whiteboard shot', uri: '/whiteboard.png', tags: [], createdAt: now };
  const timeline = buildVisualBeatTimeline({
    sceneIndex: 0,
    durationMs: 8_000,
    width: 1280,
    height: 720,
    visuals: [visual],
    beats: [{ purpose: 'Explain', visual: 'presenter and cooking fire', motion: 'locked', transition: 'crossfade' }],
  });
  assert.equal(timeline.layers.length, 1);
  assert.equal(timeline.layers[0].width, 1280);
  assert.equal(timeline.layers[0].height, 720);
  assert.equal(timeline.commands.length, 0);
});

test('character references create distinct image cache entries', () => {
  const base = { prompt: 'A cat explores a distant planet', generator: 'flow-agent' as const, model: 'narwhal' };
  assert.notEqual(animationAssetCacheKey({ ...base, referenceUploadId: 'reference-a' }), animationAssetCacheKey({ ...base, referenceUploadId: 'reference-b' }));
  assert.notEqual(animationAssetCacheKey({ ...base, referenceAssetId: 'candidate-a' }), animationAssetCacheKey(base));
  assert.notEqual(animationAssetCacheKey({ ...base, referenceAssetIds: ['cast-a'] }), animationAssetCacheKey({ ...base, referenceAssetIds: ['cast-b'] }));
});
