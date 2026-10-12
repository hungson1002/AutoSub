import type { CanvasStudioProject, CanvasStudioObject, CanvasStudioScene } from './canvasAnimationStudio';

const folkCuePatterns: Record<string, RegExp> = {
  grab: /(?:(?<![\p{L}])vươn[^.!?,]{0,45}?)?(?<![\p{L}])quấn[^.!?,]{0,65}?cổ/giu,
  pull: /(?<![\p{L}])kéo[^.!?,]{0,65}?ngã/giu,
  release: /(?<![\p{L}])thu(?![\p{L}])[^.!?,]{0,70}?(?:lại|về)/giu,
};

/** Fill a missing cue only when the authored action and spoken phrase are unique. */
function folkActionCue(scene: CanvasStudioScene, action: string) {
  const pattern = folkCuePatterns[action];
  if (!pattern || scene.animationBeats?.filter(beat => beat.action === action).length !== 1) return;
  const spoken = scene.dialogue?.filter(line => !line.characterKey).map(line => line.text).join(' ') || scene.narration || '';
  const matches = [...spoken.matchAll(pattern)];
  if (matches.length !== 1) return;
  const match = matches[0]!;
  const prefix = spoken.slice(Math.max(0, match.index! - 35), match.index).normalize('NFD')
    .replace(/\p{M}/gu, '').toLowerCase();
  if (/(?:khong|dung|se|tung)\b[^,.;!?]{0,28}$/.test(prefix)) return;
  return match[0];
}

export function isFolkHorrorBrief(brief: string) {
  return /folk-horror|ma\s*v[uú]\s*d[aà]i|m[aặ]t\s*(?:d[aạ]ng\s*)?s[oọ]|flat\s*folk\s*horror/iu.test(brief);
}

export function isFolkHorrorScene(scene: CanvasStudioScene) {
  return scene.backgroundRef?.startsWith('bg:folk-') === true
    || scene.objects.some(object => object.visualStyle === 'folk-horror');
}

export function folkCharacterScale(object: CanvasStudioObject) {
  return Math.min(object.width / 56, object.height / 100);
}

/** Shared by planning, editor preview and both export paths. Never replaces assets or cues. */
export function compileCanvasFolkHorror(project: CanvasStudioProject): CanvasStudioProject {
  if (!isFolkHorrorBrief(project.sourcePrompt || '') && !project.scenes.some(isFolkHorrorScene)) return project;
  const stagedScenes: CanvasStudioScene[] = [];
  const scenes = project.scenes.map(scene => {
    const flatField = scene.background === 'field' || scene.backgroundRef?.startsWith('bg:folk-') === true
      || (scene.background === 'night' && (!scene.backgroundRef || scene.backgroundRef === 'bg:night-hill-path'));
    const day = scene.atmosphere?.timeOfDay === 'day'
      || (!scene.atmosphere?.timeOfDay && scene.background === 'field');
    const objects = scene.objects.map(object => {
      if (object.kind === 'prop' && object.variant === 'tree' && !object.imageUrl && !object.sprite && !object.spriteActs?.length) {
        // A field tree is the set, not a small icon behind the actors. Keep its
        // trunk rooted on the same ground as travelers in every shot.
        const width = flatField && !scene.backgroundImageUrl ? Math.max(object.width, project.width * .60) : object.width;
        const height = Math.max(object.height, width * 1.4);
        return { ...object, width, height,
          ...(flatField && !scene.backgroundImageUrl ? { y: project.height * .8 - height * .5 } : {}) };
      }
      if (object.kind !== 'character') return { ...object };
      const grounded = flatField && !scene.backgroundImageUrl && !object.imageUrl && !object.sprite
        && !object.spriteActs?.length && object.appearance !== 'long-limbed-spirit' && !object.perchedOn;
      const lying = object.pose === 'lie-down' || object.keyframes?.find(frame => frame.atMs === 0)?.pose === 'lie-down';
      const inferredRecline = grounded && lying && (object.rotation === 0 || object.rotation === object.folkReclineAngle)
        && !object.keyframes?.some(frame => frame.rotation !== undefined && frame.rotation !== 0);
      const prior = stagedScenes.at(-1);
      const priorVictim = prior?.objects.find(candidate => candidate.characterKey === object.characterKey && candidate.kind === 'character');
      const priorPull = prior?.animationBeats?.find(beat => beat.action === 'pull' && beat.focusTargetId === priorVictim?.id);
      const priorSource = priorPull && prior?.objects.find(candidate => priorPull.targetIds.includes(candidate.id));
      const recliningAngle = priorSource && priorVictim && priorSource.x < priorVictim.x ? -88 : 88;
      const groundY = project.height * .8;
      return { ...object, visualStyle: 'folk-horror' as const,
        ...(grounded ? { y: groundY - folkCharacterScale(object) * (lying ? 22 : 39) } : {}),
        ...(inferredRecline ? { rotation: recliningAngle, folkReclineAngle: recliningAngle } : {}),
        groundY: grounded ? groundY : undefined };
    });
    for (const object of objects) {
      if (object.kind !== 'character' || !object.perchedOn) continue;
      const tree = objects.find(candidate => candidate.variant === 'tree'
        && [candidate.id, candidate.label, candidate.characterKey].includes(object.perchedOn));
      if (!tree) continue;
      object.perchedOn = tree.id;
      object.pose = 'sit';
      object.x = tree.x + tree.width * .28;
      object.y = tree.y - tree.height * .17 - folkCharacterScale(object) * 34;
    }
    // Measured speech may shorten the gap between contact and pulling. Keep the
    // pull on its spoken cue and finish extension before that cue, without moving it.
    const animationBeats = scene.animationBeats?.map(beat => {
      if (!['grab','pull','release'].includes(beat.action) || !objects.some(object => beat.targetIds.includes(object.id)
        && object.appearance === 'long-limbed-spirit')) return beat;
      if (!beat.speechCue && objects.some(object => object.id === beat.focusTargetId && object.kind === 'character'
        && !beat.targetIds.includes(object.id))) {
        const speechCue = folkActionCue(scene, beat.action);
        if (speechCue) beat = { ...beat, speechCue };
      }
      if (beat.action === 'release') return beat;
      const nextAction = beat.action === 'grab' ? 'pull' : 'release';
      const pull = scene.animationBeats?.filter(next => next.action === nextAction
        && next.focusTargetId === beat.focusTargetId && next.atMs > beat.atMs
        && next.targetIds.some(id => beat.targetIds.includes(id))).sort((a,b)=>a.atMs-b.atMs)[0];
      const gap = pull ? pull.atMs - beat.atMs : beat.durationMs;
      return gap >= 120 && gap < beat.durationMs ? {...beat,durationMs:gap} : beat;
    });
    const staged: CanvasStudioScene = {
      ...scene,
      ...(flatField && !scene.backgroundImageUrl ? {
        background: day ? 'field' as const : 'night' as const,
        backgroundRef: day ? 'bg:folk-day-field' : 'bg:folk-night-field',
      } : {}),
      atmosphere: { ...scene.atmosphere, shadowBreath: scene.atmosphere?.shadowBreath ?? .035 },
      camera: scene.camera ? { ...scene.camera, motion: 'none' as const } : scene.camera,
      objects,
      animationBeats,
    };
    stagedScenes.push(staged);
    return staged;
  });
  return { ...project, scenes };
}
