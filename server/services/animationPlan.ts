import type { AnimationBeatContract, AnimationNarrationUnit, AnimationProductionPlan, AnimationResearchReference } from '../../shared/animationStudio';
import { buildAnimationBeatWindows } from './animationTiming';

type PlanBeat = {
  narrationCue?: string;
  characterRefs?: string[];
  action?: string;
  visual?: string;
  objects?: unknown[];
  actors?: Array<{ assetId: string; animation: string; fromX?: number; toX?: number }>;
  diagram?: { steps?: string[] };
};

type PlanSegment = { title: string; narration: string; visualBeats: PlanBeat[] };

/** Compile the director's normalized beats into a small, inspectable production contract. */
export function compileAnimationProductionPlan(input: {
  segments: PlanSegment[];
  sceneIds: string[];
  sceneDurationsMs: number[];
  targetDurationMs?: number;
  continuityBible?: string;
  research?: AnimationProductionPlan['research'];
  diagnostics?: string[];
}): AnimationProductionPlan {
  const narrationUnits: AnimationNarrationUnit[] = [];
  const beats: AnimationBeatContract[] = [];
  input.segments.forEach((segment, sceneIndex) => {
    const sceneId = input.sceneIds[sceneIndex] || `scene-${sceneIndex + 1}`;
    const narrationUnitId = `narration-${sceneIndex + 1}`;
    const sceneDuration = Math.max(1, input.sceneDurationsMs[sceneIndex] || 1);
    narrationUnits.push({ id: narrationUnitId, sceneId, text: segment.narration, startMs: 0, endMs: sceneDuration, timingSource: 'planned' });
    const windows = buildAnimationBeatWindows({ beats: segment.visualBeats, narration: segment.narration, durationMs: sceneDuration });
    const occurrences = new Map<string, number>();
    segment.visualBeats.forEach((beat, beatIndex) => {
      const cueText = beat.narrationCue?.trim() || undefined;
      const cueOccurrence = cueText ? (occurrences.get(cueText) || 0) : undefined;
      if (cueText) occurrences.set(cueText, (cueOccurrence || 0) + 1);
      const actor = beat.actors?.[0];
      const subjectIds = [...new Set((beat.actors || []).map((item) => item.assetId).filter(Boolean))];
      const technique = beat.actors?.length ? 'sprite' : beat.objects?.length ? 'object-composite' : beat.diagram?.steps?.length ? 'diagram' : beat.visual ? 'image-camera' : 'hold';
      const action = beat.action?.trim() ? { description: beat.action.trim(), ...(actor ? { actorId: actor.assetId } : {}) } : undefined;
      const window = windows[beatIndex];
      beats.push({
        id: `scene-${sceneIndex + 1}-beat-${beatIndex + 1}`,
        sceneId,
        narrationUnitId,
        ...(cueText ? { cueText, cueOccurrence } : {}),
        subjectIds,
        ...(beat.characterRefs?.length ? { characterRefs: [...new Set(beat.characterRefs)] } : {}),
        ...(action ? { action } : {}),
        technique,
        ...(window ? { startMs: window.startMs, endMs: window.endMs } : {}),
        screenDirection: actor && actor.fromX !== undefined && actor.toX !== undefined ? actor.toX >= actor.fromX ? 'left-to-right' : 'right-to-left' : 'static',
        visibleEvidence: action?.description || beat.visual?.trim() || (beat.diagram?.steps || []).join(' → ') || 'Giữ bố cục và trạng thái hiện tại có chủ ý.',
        failureConditions: [
          'Chủ thể chính không đúng thiết kế hoặc bị cắt khỏi khung.',
          action ? 'Không nhìn thấy thay đổi được mô tả trong beat.' : 'Không để hiệu ứng trang trí thay thế mục đích hình ảnh.',
        ],
      });
    });
  });
  return {
    version: 1,
    source: 'director',
    status: input.diagnostics?.length ? 'warning' : 'draft',
    targetDurationMs: input.targetDurationMs,
    continuityBible: input.continuityBible,
    narrationUnits,
    beats,
    research: input.research ? {
      sources: input.research.sources.map(({ title, url, domain }) => ({ title, url, domain })),
      claims: input.research.claims.map((claim): AnimationResearchReference => ({ ...claim })),
    } : undefined,
    diagnostics: input.diagnostics?.length ? [...new Set(input.diagnostics)] : undefined,
  };
}

/** Catch malformed scene/beat ranges before the expensive image-generation stage. */
export function validateAnimationProductionPlanTimeline(plan: AnimationProductionPlan, sceneIds: string[], sceneDurationsMs: number[]) {
  const durationByScene = new Map(sceneIds.map((sceneId, index) => [sceneId, Number(sceneDurationsMs[index])]));
  const issues: string[] = [];

  for (const unit of plan.narrationUnits) {
    const duration = durationByScene.get(unit.sceneId);
    const { startMs, endMs } = unit;
    if (duration === undefined || !Number.isFinite(duration) || startMs === undefined || endMs === undefined
      || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs > duration) {
      issues.push(`${unit.id}: narration range is outside its scene duration`);
    }
  }

  const previousEndByScene = new Map<string, number>();
  for (const beat of plan.beats) {
    const duration = durationByScene.get(beat.sceneId);
    const { startMs, endMs } = beat;
    const previousEnd = previousEndByScene.get(beat.sceneId);
    if (duration === undefined || !Number.isFinite(duration) || startMs === undefined || endMs === undefined
      || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs > duration) {
      issues.push(`${beat.id}: beat window is outside its scene duration`);
      continue;
    }
    if (previousEnd !== undefined && startMs < previousEnd) issues.push(`${beat.id}: beat window overlaps the previous beat`);
    previousEndByScene.set(beat.sceneId, endMs);
  }

  return issues;
}
