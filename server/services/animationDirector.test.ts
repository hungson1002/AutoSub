import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateTimelineDurations, isRetryableFlowSessionRefreshFailure, narrationDurationFitStatus, narrationRewriteChanged } from './animationDirector';
import { allocateLockedSceneDurations, allocatePostFitVisualBudgets, animationActorPlanIssues, forceStoryboardVisualBeatCount, buildBeatPerformances, buildVisualBeatTimeline, buildVisualDensityPlan, characterReferenceDirective, chooseStoryboardTextBeatIndexes, directorRepairRule, directorReviewDirective, durationSecondsFromBrief, fitStaticImageCueTimings, jsonFromDirectorReply, narrationFitWordTargets, normalizeLongAnimationSegments, normalizeResearchPacket, normalizeStoryboardEmbeddedText, replaceUnavailableGeneratedAssets, researchBlueprintDirective, storyboardShotDirection, storyToneDirective, storyWorldCastDirective, visualMediumDirective, visualMediumFromText, visualTextDirective, visualTextLanguage } from './animationDirector';
import { animationAssetCacheKey, narrationCaptionText, wavDurationMs } from './animationAssets';
import { animationCraftRules } from './directorKnowledge';
import { animationPerformancePlanIssues } from './animationDirector';
import { beatNeedsGeneratedImage, directorFitChunkIndexes, initialIsolatedFlowImageConcurrency, isDirectorJsonTruncationError, limitVieneuEmotionCueDensity, longStoryboardBeatIndexes, nonFlowImageConcurrencyPlan, normalizeStoryboardVisualReview, normalizeStoryCharacterRefs, rebuildNarrationCuesFromNarration, repairNarrationCues, shouldRunStoryboardVision, storyboardNightReadabilityRule, storyboardTextTrapSurfaceRule, storyboardVisualHardFailure, storyboardVisualReviewFeedback, storyboardVisualReviewScore, storyCastCharacterIds, storyCastReferenceDirective, storyCastReferencePrompt } from './animationDirector';
import { evaluateScene } from '../../src/animationStudio/evaluator';
import { defaultTransform } from '../../shared/animationStudio';
import { FlowSessionError } from './googleFlow';

test('a Flow session refresh failure stays separate from unknown outcomes and Google throttling', () => {
  assert.equal(isRetryableFlowSessionRefreshFailure(new FlowSessionError('Flow key refresh did not recover', 'FLOW_SESSION_REFRESH_FAILED')), true);
  assert.equal(isRetryableFlowSessionRefreshFailure(new FlowSessionError('Generation outcome is unknown', 'FLOW_GENERATION_OUTCOME_UNKNOWN')), false);
  assert.equal(isRetryableFlowSessionRefreshFailure(new FlowSessionError('Google Flow throttled the account', 'FLOW_IMAGE_TRAFFIC_THROTTLED')), false);
});

test('visual density follows the reference films: quick opening, calmer explanation', () => {
  const targets = [
    { seconds: 60, count: 25 },
    { seconds: 300, count: 81 },
    { seconds: 600, count: 152 },
    { seconds: 900, count: 223 },
  ];
  for (const target of targets) {
    const plan = buildVisualDensityPlan(target.seconds);
    assert.equal(plan.visualCount, target.count);
    assert.equal(plan.visualsPerScene.reduce((sum, count) => sum + count, 0), plan.visualCount);
    assert.ok(plan.visualsPerScene.every((count) => count >= 1 && count <= 4));
    assert.equal(plan.minimumVisualsPerScene.length, plan.visualsPerScene.length);
    assert.ok(plan.minimumVisualsPerScene.every((count, index) => count >= 1 && count <= plan.visualsPerScene[index]));
    assert.ok(plan.sceneCount < plan.visualCount);
    assert.ok(plan.visualDurationsSeconds.slice(0, plan.openingVisualCount).every((duration) => duration >= 2.3 && duration <= 2.7));
    assert.ok(plan.visualDurationsSeconds.slice(plan.openingVisualCount).every((duration) => duration >= 3.5 && duration <= 5.5));
    assert.ok(Math.abs(plan.sceneDurationsSeconds.reduce((sum, duration) => sum + duration, 0) - target.seconds) < 0.001);
    assert.equal(plan.sceneCount, Math.ceil(plan.visualCount / 4));
  }
  const firstMinute = buildVisualDensityPlan(60);
  assert.equal(firstMinute.openingVisualCount, 25);
  assert.equal(firstMinute.visualCount, 25);
  const fiveMinutes = buildVisualDensityPlan(300);
  assert.equal(fiveMinutes.minimumVisualsPerScene.reduce((sum, count) => sum + count, 0), 68);
});


test('storyboard visual QC rejects leaked text and weak semantic/style matches', () => {
  assert.deepEqual(normalizeStoryboardVisualReview('{"pass":true,"textLeak":false,"semanticMatch":true,"styleMatch":true,"reasons":[]}'), {
    pass: true,
    textLeak: false,
    semanticMatch: true,
    styleMatch: true,
    characterStyleCohesion: true,
    lineLanguageMatch: true,
    limbGrammarMatch: true,
    faceComplexityMatch: true,
    shadingMatch: true,
    identityMatch: true,
    headHairMatch: true,
    faceFacialHairMatch: true,
    topOutfitMatch: true,
    bottomSilhouetteMatch: true,
    anchorMismatchCount: 0,
    compositionDistinct: true,
    nightReadability: true,
    reasons: [],
  });
  const failed = normalizeStoryboardVisualReview('{"pass":true,"textLeak":true,"semanticMatch":false,"styleMatch":true,"reasons":["readable label","idea is ambiguous"]}');
  assert.equal(failed.pass, false);
  assert.equal(failed.textLeak, true);
  assert.equal(failed.semanticMatch, false);
  assert.equal(storyboardVisualHardFailure(failed), true);
  const identityFailed = normalizeStoryboardVisualReview('{"pass":false,"textLeak":false,"semanticMatch":true,"styleMatch":true,"identityMatch":false,"compositionDistinct":true,"nightReadability":true,"reasons":["CAST_01 collapsed into mascot identity"]}');
  assert.equal(storyboardVisualHardFailure(identityFailed), true);
  const soft = normalizeStoryboardVisualReview('{"pass":false,"textLeak":false,"semanticMatch":true,"styleMatch":false,"identityMatch":true,"compositionDistinct":false,"nightReadability":true,"reasons":["framing repeats"]}');
  assert.equal(storyboardVisualHardFailure(soft), false);
  const grammarFailed = normalizeStoryboardVisualReview('{"pass":true,"textLeak":false,"semanticMatch":true,"styleMatch":true,"characterStyleCohesion":false,"lineLanguageMatch":false,"limbGrammarMatch":false,"faceComplexityMatch":true,"shadingMatch":true,"identityMatch":true,"compositionDistinct":true,"nightReadability":true,"reasons":["supporting human uses thick vector limbs"]}');
  assert.equal(grammarFailed.pass, false);
  assert.equal(grammarFailed.characterStyleCohesion, false);
  assert.equal(storyboardVisualHardFailure(grammarFailed), true);
  assert.match(storyboardVisualReviewFeedback(grammarFailed), /same hand-drawn construction|same artist|limb/i);
  assert.deepEqual(failed.reasons, ['readable label', 'idea is ambiguous']);
});

test('QC feedback explicitly cleans corner watermark artifacts without changing the beat', () => {
  const review = normalizeStoryboardVisualReview('{"pass":false,"textLeak":true,"semanticMatch":true,"styleMatch":true,"reasons":["Extraneous logo/watermark icon present in lower-right corner."]}');
  const feedback = storyboardVisualReviewFeedback(review);
  assert.match(feedback, /all four corners and outer edges completely clean/i);
  assert.match(feedback, /lower-right corner/i);
  assert.match(feedback, /text-free/i);
});

test('QC scoring keeps the strongest fallback and text-trap rules avoid writing surfaces', () => {
  const weak = normalizeStoryboardVisualReview('{"pass":false,"textLeak":true,"semanticMatch":false,"styleMatch":true,"reasons":["pseudo-writing"]}');
  const stronger = normalizeStoryboardVisualReview('{"pass":false,"textLeak":false,"semanticMatch":true,"styleMatch":true,"reasons":["minor framing issue"]}');
  assert.ok(storyboardVisualReviewScore(stronger) > storyboardVisualReviewScore(weak));
  assert.match(storyboardTextTrapSurfaceRule(), /chalkboards/i);
  assert.match(storyboardTextTrapSurfaceRule(), /documents/i);
  assert.match(storyboardTextTrapSurfaceRule('02:13'), /exactly “02:13” once/i);
  assert.match(storyboardTextTrapSurfaceRule('02:13'), /do not place it on a chalkboard/i);
});

test('identity, composition and night readability are first-class QC gates', () => {
  const failed = normalizeStoryboardVisualReview('{"pass":true,"textLeak":false,"semanticMatch":true,"styleMatch":true,"identityMatch":false,"compositionDistinct":false,"nightReadability":false,"reasons":["new glasses","same framing","subject too dark"]}');
  assert.equal(failed.pass, false);
  assert.equal(failed.identityMatch, false);
  assert.equal(failed.compositionDistinct, false);
  assert.equal(failed.nightReadability, false);
  const feedback = storyboardVisualReviewFeedback(failed);
  assert.match(feedback, /glasses|identity/i);
});

test('two identity-anchor mismatches fail recurring CAST continuity even if generic identityMatch is true', () => {
  const failed = normalizeStoryboardVisualReview('{"pass":true,"textLeak":false,"semanticMatch":true,"styleMatch":true,"identityMatch":true,"headHairMatch":false,"faceFacialHairMatch":true,"topOutfitMatch":false,"bottomSilhouetteMatch":true,"compositionDistinct":true,"nightReadability":true,"reasons":["hair changed","top color changed"]}');
  assert.equal(failed.anchorMismatchCount, 2);
  assert.equal(failed.identityMatch, false);
  assert.equal(failed.pass, false);
  assert.equal(storyboardVisualHardFailure(failed), true);
});

test('night shots stay dark but protect phone-size readability', () => {
  assert.match(storyboardNightReadabilityRule('Nhân vật bước vào hành lang tối lúc ban đêm'), /NIGHT READABILITY LOCK/i);
  assert.match(storyboardNightReadabilityRule('dark hallway at night'), /midtones/i);
  assert.equal(storyboardNightReadabilityRule('bright kitchen at noon'), '');
});

test('long visual hold helper treats only holds above eight seconds as exceptional', () => {
  const segment = { narration: 'Ý đầu tiên. Sau đó là một hệ quả khác.', visualBeats: [{ purpose: 'explain', visual: 'One frame', narrationCue: 'Ý đầu tiên.', motion: 'locked' as const, transition: 'cut' as const }] };
  assert.deepEqual(longStoryboardBeatIndexes(segment, 9000, 8000), [0]);
  assert.deepEqual(longStoryboardBeatIndexes(segment, 7000, 8000), []);
  const singleThought = { narration: 'Một ý duy nhất được giải thích chậm rãi.', visualBeats: [{ purpose: 'explain', visual: 'One frame', narrationCue: 'Một ý duy nhất được giải thích chậm rãi.', motion: 'locked' as const, transition: 'cut' as const }] };
  assert.deepEqual(longStoryboardBeatIndexes(singleThought, 9000, 8000), []);
});

test('narration-fit requests are chunked to avoid giant truncated JSON replies', () => {
  assert.deepEqual(directorFitChunkIndexes(20, 4), [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15],[16,17,18,19]]);
  assert.deepEqual(directorFitChunkIndexes(3, 4), [[0,1,2]]);
  assert.equal(isDirectorJsonTruncationError(new Error('JSON từ AI Director bị thiếu phần kết thúc.')), true);
  assert.equal(isDirectorJsonTruncationError(new Error('Unexpected end of JSON input')), true);
  assert.equal(isDirectorJsonTruncationError(new SyntaxError("Expected ',' or ']' after array element in JSON at position 4612 (line 1 column 4613)")), true);
  assert.equal(isDirectorJsonTruncationError(new Error('provider timeout')), false);
});

test('narration cue mismatch self-repairs instead of becoming a fatal Director error', () => {
  const narration = 'Não thiếu dữ liệu trong bóng tối. Vì thế nó bắt đầu dự đoán nguy hiểm. Khi bật đèn, vật thể trở nên rõ ràng.';
  const repaired = repairNarrationCues(narration, ['não thiếu dữ liệu', 'Vì thế nó bắt đầu dự đoán nguy hiểm.', 'không tồn tại'], 3);
  assert.equal(repaired.length, 3);
  assert.ok(repaired.every((cue) => narration.includes(cue)));
  const rebuilt = rebuildNarrationCuesFromNarration(narration, 3);
  assert.equal(rebuilt.length, 3);
  let cursor = 0;
  for (const cue of rebuilt) {
    const found = narration.indexOf(cue, cursor);
    assert.ok(found >= cursor);
    cursor = found + cue.length;
  }
});

test('vision QC still runs for common multimodal model names when provider metadata is missing', () => {
  const provider = { id: 'p', name: 'P', baseUrl: 'https://example.invalid', enabled: true, models: [{ id: 'gpt-5.6-luna' }], providerType: 'openai-compatible' as const, authType: 'none' as const, capabilities: {} };
  assert.equal(shouldRunStoryboardVision(provider, 'gpt-5.6-luna'), true);
  assert.equal(shouldRunStoryboardVision({ ...provider, capabilities: { vision: false } }, 'gpt-5.6-luna'), false);
  assert.equal(shouldRunStoryboardVision({ ...provider, models: [{ id: 'text-only' }] }, 'text-only'), false);
});

test('character reference directive makes the attached image authoritative over storyboard/style drift', () => {
  const rule = characterReferenceDirective(true);
  assert.match(rule, /defines ONLY the recurring narrator mascot\/presenter/i);
  assert.match(rule, /Read the mascot's identity directly from the image/i);
  assert.match(rule, /preserve its recognizable silhouette, face, proportions, exact clothing, accessories and colors/i);
  assert.match(rule, /narrator\/viewer-proxy/i);
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
  assert.match(rule, /CAST_\* IDs only when the exact same person recurs inside one mini-story/i);
  assert.match(rule, /never recycle the ID for a different person/i);
  assert.match(rule, /the JSON field is required even when empty/i);
  assert.match(rule, /same plausible time\/place and visual culture/i);
  assert.match(rule, /Do not assign hunting\/gathering or other roles by gender stereotype/i);
  assert.match(directorReviewDirective('balanced'), /recurring cast ID changes its visible identity/i);
  assert.match(storyCastReferenceDirective(['CAST_01'], true), /must not spontaneously gain or lose glasses/i);
  const castPrompt = storyCastReferencePrompt({ characterId: 'CAST_01', continuity: 'CAST_01: nam tóc nâu, áo xanh.', style: 'hand-drawn', mediumRule: '2D', languageRule: 'English prompts', mascotReferenceAttached: true });
  assert.match(castPrompt, /decorative sparkles/i);
  assert.match(castPrompt, /NOT the narrator mascot/i);
  assert.match(castPrompt, /at least three stable visual anchors/i);
  assert.match(castPrompt, /bald round head/i);
  assert.match(castPrompt, /glasses, scarf or hat/i);
  assert.match(castPrompt, /same artist|same construction system/i);
  assert.match(storyWorldCastDirective(), /blank white circular\/bald head/i);
  assert.match(directorReviewDirective('balanced'), /HOOK CHECK/i);
  assert.match(directorReviewDirective('balanced'), /RETENTION CHECK/i);
  assert.match(directorReviewDirective('balanced'), /DENSITY CHECK/i);
  assert.match(directorReviewDirective('balanced'), /NIGHT READABILITY CHECK/i);
  assert.match(directorReviewDirective('balanced'), /more than about eight seconds|beyond about eight seconds/i);
});

test('isolated Flow image concurrency stays under the profile-wide provider ceiling', () => {
  const pool = { pendingWorkItems: 242, accountCount: 9, slotsPerAccount: 1, maxConcurrency: 1 };
  assert.equal(initialIsolatedFlowImageConcurrency(pool), 1);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, configuredInitial: 10 }), 1);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, configuredInitial: 18 }), 1);
  assert.equal(initialIsolatedFlowImageConcurrency({ ...pool, pendingWorkItems: 3 }), 1);
});

test('GPT Image starts conservatively and ramps instead of bursting into rate limits', () => {
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', Number.NaN), { maxConcurrency: 8, initialConcurrency: 4 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', 30), { maxConcurrency: 12, initialConcurrency: 4 });
  assert.deepEqual(nonFlowImageConcurrencyPlan('ima2-gpt-oauth', 12), { maxConcurrency: 12, initialConcurrency: 4 });
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
  assert.match(referencePrompt, /intentionally NOT attached/i);
  assert.match(referencePrompt, /different head\/face silhouette/i);
  assert.match(referencePrompt, /Do not create a bald\/simple round-headed mascot clone/i);
  assert.match(referencePrompt, /exactly one person/i);
});

test('shot direction builds coherent four-shot families and carries contextual backgrounds', () => {
  const shots = Array.from({ length: 8 }, (_, index) => storyboardShotDirection(index).type);
  assert.deepEqual(shots, ['establishing', 'action', 'detail', 'reaction', 'establishing', 'action', 'detail', 'reaction']);
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

test('storyboard text policy allows purposeful short image text at the reference-like density', () => {
  const rule = visualTextDirective('Vietnamese');
  assert.match(rule, /only when the storyboard beat explicitly supplies onScreenText/i);
  assert.match(rule, /one short factual token, number, date, unit or 1-4 word label/i);
  assert.match(rule, /25-30% of frames/i);
  assert.match(rule, /Vietnamese/i);
  assert.match(rule, /do not invent extra words/i);
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

test('AI storyboard selects a reference-like quarter of intentional on-image text', () => {
  const beats = Array.from({ length: 25 }, (_, index) => ({
    purpose: index % 5 === 0 ? 'comparison' : 'explain',
    visual: `Visual ${index}`,
    narrationCue: `Mốc ${index}: ${index + 10}%`,
    onScreenText: index % 4 === 0 ? `${index + 10}%` : '',
  }));
  const selected = [...chooseStoryboardTextBeatIndexes(beats, .28)];
  assert.equal(selected.length, 7);
  assert.ok(selected.every((index) => beats[index].onScreenText));
});

test('storyboard text normalization keeps a controlled reference-like budget of short tokens', () => {
  const segments = [{
    title: 'A', narration: 'Khẩu phần là 4.000 calo rồi giảm dần theo thời gian.', motionGraphic: 'none' as const,
    visualBeats: Array.from({ length: 10 }, (_, index) => ({
      purpose: index === 0 ? 'comparison' : 'explain', visual: `Frame ${index}`,
      narrationCue: index === 0 ? '4.000 calo' : 'giảm dần', motion: 'locked' as const, transition: 'cut' as const,
      onScreenText: index === 0 ? '4.000 calo' : index === 1 ? 'giảm dần' : `Unapproved long label ${index}`,
    })),
  }];
  const normalized = normalizeStoryboardEmbeddedText(segments, .28, 'Vietnamese');
  assert.equal(normalized[0]!.visualBeats.filter((beat) => beat.onScreenText).length, 2);
  assert.equal(normalized[0]!.visualBeats[0].onScreenText, '4.000 calo');
});

test('explicit duration written in a brief overrides prompt length when auto mode is used', () => {
  assert.equal(durationSecondsFromBrief('Tạo video dài khoảng 90 giây về kinh tế.'), 90);
  assert.equal(durationSecondsFromBrief('Make this a 2 minute explainer.'), 120);
  assert.equal(durationSecondsFromBrief('Video khoảng 60-90 giây, nhịp nhanh.'), 75);
  assert.equal(durationSecondsFromBrief('Không ghi thời lượng, chỉ có chủ đề.'), undefined);
});

test('locked duration distributes breathing room on the global frame grid without per-scene ceil overflow', () => {
  const durations = allocateLockedSceneDurations([7_800, 8_100, 7_900, 8_000, 7_700, 8_200, 7_900, 2_900], 60_000);
  assert.ok(Math.abs(durations.reduce((sum, value) => sum + value, 0) - 60_000) < 0.001);
  const measured = [7_800, 8_100, 7_900, 8_000, 7_700, 8_200, 7_900, 2_900];
  durations.forEach((duration, index) => assert.ok(duration >= measured[index] - 1000 / 30));
  durations.slice(0, -1).forEach((duration, index) => assert.ok(duration - measured[index] < 1000 / 30 + 0.001, 'intermediate scenes must not receive distributed dead air'));
  assert.ok(durations.at(-1)! > measured.at(-1)! + 1000, 'remaining duration slack should be held only at the final scene');

  // Regression: raw narration fits 300s, but independently ceiling 20 scenes
  // would add four extra 30fps frames = 133.333ms and falsely abort the job.
  const twentyScenes = [...Array.from({ length: 4 }, () => 15_001), ...Array.from({ length: 16 }, () => 14_991)];
  const locked = allocateLockedSceneDurations(twentyScenes, 300_000, 30);
  assert.ok(Math.abs(locked.reduce((sum, value) => sum + value, 0) - 300_000) < 0.001);
  locked.forEach((duration, index) => assert.ok(twentyScenes[index] - duration < 1000 / 30 + 0.001));

  assert.throws(() => allocateLockedSceneDurations([31_000, 31_000], 60_000), /dài hơn timeline/);
});

test('locked narration timing keeps boundary silence small and rejects real overruns', () => {
  assert.equal(narrationDurationFitStatus([50_000, 49_500], 100_000), 'fit');
  assert.equal(narrationDurationFitStatus([50_000, 49_400], 100_000), 'short');
  assert.equal(narrationDurationFitStatus([50_000, 49_200], 100_000), 'short');
  assert.equal(narrationDurationFitStatus([50_000, 48_000], 100_000), 'short');
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
  assert.equal(targets[0], 21);
  const shorter = narrationFitWordTargets([{ narration: 'một hai ba bốn năm sáu bảy tám chín mười' }], [10_000], [5_000]);
  assert.equal(shorter[0], 6);
  const overrun = narrationFitWordTargets([{ narration: Array.from({ length: 100 }, (_, index) => `từ${index}`).join(' ') }], [142_500], [120_000]);
  assert.ok(overrun[0] >= 76 && overrun[0] <= 80, `expected strong first-pass trim, got ${overrun[0]}`);
});

test('deterministic post-fit fallback always enforces the requested beat count without changing narration', () => {
  const narration = 'Anh đứng dậy khỏi bàn, đi qua hành lang, bước vào bếp rồi bất chợt quên mất mình định lấy gì.';
  const segment = {
    title: 'Quên khi đổi phòng',
    narration,
    motionGraphic: 'none' as const,
    visualBeats: [
      { purpose: 'establishing', narrationCue: 'Anh đứng dậy khỏi bàn', visual: 'A young man rises from his desk.', characterRefs: ['CAST_01'], motion: 'locked' as const, transition: 'cut' as const },
      { purpose: 'action', narrationCue: 'đi qua hành lang', visual: 'The same man walks through a hallway.', characterRefs: ['CAST_01'], motion: 'locked' as const, transition: 'cut' as const },
      { purpose: 'reaction', narrationCue: 'bất chợt quên mất', visual: 'He pauses in the kitchen looking confused.', characterRefs: ['CAST_01'], motion: 'locked' as const, transition: 'cut' as const },
    ],
  };
  const expanded = forceStoryboardVisualBeatCount(segment, 6);
  assert.equal(expanded.narration, narration);
  assert.equal(expanded.visualBeats.length, 6);
  assert.ok(expanded.visualBeats.every((beat) => narration.includes(beat.narrationCue || '')));
  assert.ok(expanded.visualBeats.slice(1).some((beat) => /EDITORIAL ALTERNATE VIEW/.test(beat.visual)));
  assert.ok(expanded.visualBeats.every((beat) => beat.motion === 'locked' && beat.transition === 'cut'));
  assert.ok(expanded.visualBeats.every((beat) => beat.characterRefs?.includes('CAST_01')));

  const reduced = forceStoryboardVisualBeatCount(expanded, 2);
  assert.equal(reduced.visualBeats.length, 2);
  assert.equal(reduced.narration, narration);
});

test('post-fit visual budgets keep the same total while front-loading the measured first minute', () => {
  const initial = [4, 4, 4, 4, 4, 4, 4, 4, 4, 3]; // 39 visuals total
  // Simulate the failed 2-minute shape: early narration scenes became long,
  // so a fixed 4-beat-per-scene plan would show only ~14 visuals in minute one.
  const measured = [15_000, 15_000, 15_000, 15_000, 10_000, 10_000, 10_000, 10_000, 5_000, 5_000];
  const budgets = allocatePostFitVisualBudgets(measured, initial);
  assert.equal(budgets.reduce((sum, value) => sum + value, 0), 39);
  let cursor = 0;
  let firstMinuteVisuals = 0;
  measured.forEach((duration, index) => {
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    if (start < 60_000) firstMinuteVisuals += budgets[index];
  });
  assert.ok(firstMinuteVisuals >= 23, `expected front-loaded opening, got ${firstMinuteVisuals}`);
  assert.ok(budgets.slice(0, 4).some((value) => value > 4));
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
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 5000, width: 1280, height: 720, assets: [], beats: [{ purpose: 'So sánh', narrationCue: 'A khác B', action: 'Quả cầu đi từ A sang B', visual: 'A ball crossing the frame', motion: 'locked', transition: 'cut', objects: [{ name: 'Ball', shape: 'ellipse', fill: '#ff873d', width: .1, height: .1, path: [{ t: 0, x: .2, y: .5, rotation: 0 }, { t: 1, x: .8, y: .5, rotation: 0 }] }] }] });
  assert.ok(result.commands.length > 0);
  assert.ok(result.commands.every((c) => c.parameters?.narrationCue === 'A khác B'));
});

test('AI-image-only beats do not synthesize runtime infographic layers', () => {
  const result = buildBeatPerformances({ sceneIndex: 0, durationMs: 4000, width: 1920, height: 1080, assets: [], beats: [{ purpose: 'comparison', visual: 'A full-frame hand-drawn comparison of a small plate and a large plate.', motion: 'locked', transition: 'cut' }] });
  assert.equal(result.layers.length, 0);
  assert.equal(result.commands.length, 0);
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
  assert.match(animationCraftRules, /opening.*2–3 seconds.*body.*3\.5–5\.5 seconds/i);
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


test('long storyboard ignores legacy diagram metadata and keeps the AI image prompt', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{
    narration: 'Khẩu phần giảm từ 4.000 calo xuống 1.500 calo.',
    visualBeats: [
      { purpose: 'comparison', narrationCue: '4.000 calo', onScreenText: '4.000 calo', visual: 'A hand-drawn before-and-after plate comparison with one large 4.000 calo label.' },
      { purpose: 'reaction', visual: 'A tired person sitting beside an almost empty plate.' },
    ],
  }] }, 1);
  assert.equal(segment.visualBeats.length, 2);
  assert.match(segment.visualBeats[0].visual, /before-and-after plate comparison/i);
  assert.equal(segment.visualBeats[0].onScreenText, '4.000 calo');
  assert.equal(beatNeedsGeneratedImage(segment.visualBeats[0]), true);
  assert.equal(beatNeedsGeneratedImage(segment.visualBeats[1]), true);
});

test('comparison beats remain complete AI image requests', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{
    narration: 'Khẩu phần giảm rõ rệt.',
    visualBeats: [{ purpose: 'comparison', visual: 'Two plates showing a visibly smaller portion on the right.' }],
  }] }, 1);
  assert.match(segment.visualBeats[0].visual, /Two plates/);
  assert.equal(beatNeedsGeneratedImage(segment.visualBeats[0]), true);
});

test('timeline explanation must be represented by a complete AI image prompt', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{
    narration: 'Tuần 1, tuần 4, tuần 8 và tuần 12 đều được đo.',
    visualBeats: [{ purpose: 'timeline', narrationCue: 'Tuần 12', onScreenText: 'Tuần 12', visual: 'A simple hand-drawn horizontal progression of four field observations ending at Tuần 12.' }],
  }] }, 1);
  assert.equal(segment.visualBeats.length, 1);
  assert.match(segment.visualBeats[0].visual, /horizontal progression/i);
  assert.equal(segment.visualBeats[0].onScreenText, 'Tuần 12');
});

test('empty beats are dropped and duplicate AI prompts are removed', () => {
  const [segment] = normalizeLongAnimationSegments({ segments: [{ narration: 'Giải thích', visualBeats: [{ visual: 'Forest' }, { visual: ' forest ' }, { visual: '' }] }] }, 1);
  assert.equal(segment.visualBeats.length, 1);
  assert.equal(segment.visualBeats[0].visual, 'Forest');
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
