import type { CanvasAnimationAction, CanvasStudioProject } from '../../shared/canvasAnimationStudio';

const acting = new Set<CanvasAnimationAction>(['talk', 'point', 'run', 'row', 'brace', 'celebrate']);

/** Fill silent timeline gaps only with an explicitly directed pose or impact. */
export function densifyAnimationBeats(project: CanvasStudioProject): CanvasStudioProject {
  let changed = false;
  const horrorMode = /(?:kinh\s*d[iị]|truy[eệ]n\s*ma|ma\s*x[oó]|ma\s*da|r[uù]ng\s*r[oợ]n|horror|ghost\s*story|creepy|haunted|g[aầ]m\s*s[aà]n)/iu.test(project.sourcePrompt || '');
  const scenes = project.scenes.map((scene) => {
    const required = horrorMode ? 0 : scene.durationMs >= 6000 ? 4 : scene.durationMs >= 4000 ? 3 : scene.durationMs >= 2500 ? 2 : 0;
    const beats = [...(scene.animationBeats || [])];
    // Phrase-directed actions already express intent; density is not acting.
    if (scene.dialogue?.some(line=>line.characterKey) || beats.some(beat => beat.speechCue)) return scene;
    if (!required || beats.length >= required) return scene;
    const candidates: Array<{ action: CanvasAnimationAction; targetIds: string[] }> = [];
    for (const object of scene.objects) {
      if (object.kind === 'character' && object.pose && acting.has(object.pose as CanvasAnimationAction)) {
        candidates.push({ action: object.pose as CanvasAnimationAction, targetIds: [object.id] });
      } else if (object.motion === 'hit') {
        candidates.push({ action: 'impact', targetIds: [object.id] });
      }
    }
    // An idle scene can be an intentional hold. Do not fabricate movement.
    if (!candidates.length) return scene;
    const unused=candidates.filter(candidate=>!beats.some(beat=>beat.action===candidate.action
      &&candidate.targetIds.every(id=>beat.targetIds.includes(id))));
    // A directed pose is one event, not permission to replay it in every gap.
    for (const candidate of unused) {
      const ordered = [...beats].sort((a, b) => a.atMs - b.atMs);
      const gaps: Array<{ start: number; end: number }> = [];
      let cursor = 0;
      for (const beat of ordered) {
        if (beat.atMs > cursor) gaps.push({ start: cursor, end: beat.atMs });
        cursor = Math.max(cursor, beat.atMs + beat.durationMs);
      }
      if (cursor < scene.durationMs) gaps.push({ start: cursor, end: scene.durationMs });
      const gap = gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
      if (!gap || gap.end - gap.start < 300) break;
      const durationMs = Math.min(850, gap.end - gap.start);
      const atMs = Math.round(gap.start + (gap.end - gap.start - durationMs) / 2);
      beats.push({
        id: 'beat-auto-' + scene.id + '-' + beats.length,
        atMs, durationMs, action: candidate.action, targetIds: candidate.targetIds, intensity: 0.7,
      });
      changed = true;
    }
    return { ...scene, animationBeats: beats.sort((a, b) => a.atMs - b.atMs) };
  });
  return changed ? { ...project, updatedAt: new Date().toISOString(), scenes } : project;
}
