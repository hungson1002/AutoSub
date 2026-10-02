export type CalibrationBeatLike = {
  purpose?: string;
  visual?: string;
  onScreenText?: string;
  characterRefs?: string[];
};

export type CalibrationTaskLike = {
  beat: CalibrationBeatLike;
  sceneIndex: number;
  beatIndex: number;
};

function hasRef(task: CalibrationTaskLike, predicate: (value: string) => boolean) {
  return (task.beat.characterRefs || []).some((value) => predicate(String(value)));
}

function pushUnique(output: number[], index: number | undefined, max: number) {
  if (typeof index !== 'number' || index < 0 || output.includes(index) || output.length >= max) return;
  output.push(index);
}

/**
 * Select a small representative batch before full storyboard generation.
 * The goal is not coverage of every scene; it is to expose expensive systemic
 * failures (wrong human grammar, mascot/CAST collapse, text rendering, diagram
 * medium drift) while only a handful of images exist.
 */
export function selectCalibrationStoryboardIndexes<T extends CalibrationTaskLike>(tasks: T[], max = 7) {
  const limit = Math.max(1, Math.min(8, Math.floor(Number(max) || 7)));
  const picked: number[] = [];
  const find = (predicate: (task: T, index: number) => boolean) => tasks.findIndex(predicate);
  const findFamilySafe = (predicate: (task: T, index: number) => boolean) => {
    const firstBeat = tasks.findIndex((task, index) => task.beatIndex === 0 && predicate(task, index));
    return firstBeat >= 0 ? firstBeat : find(predicate);
  };

  // Cold open / first real frame.
  pushUnique(picked, tasks.length ? 0 : undefined, limit);
  // Recurring story CAST without mascot.
  pushUnique(picked, findFamilySafe((task) => hasRef(task, (value) => /^CAST_\d{2}$/i.test(value)) && !hasRef(task, (value) => value === 'mascot')), limit);
  // Mascot sharing a frame with CAST is the highest-risk cohesion case.
  pushUnique(picked, findFamilySafe((task) => hasRef(task, (value) => value === 'mascot') && hasRef(task, (value) => /^CAST_\d{2}$/i.test(value))), limit);
  // One-off human without identity lock.
  pushUnique(picked, findFamilySafe((task) => /\b(?:man|woman|boy|girl|person|scientist|doctor|worker|hunter)\b|(?:người\s*đàn\s*ông|người\s*phụ\s*nữ|nhà\s*khoa\s*học|bác\s*sĩ|công\s*nhân)/iu.test(String(task.beat.visual || '')) && !(task.beat.characterRefs || []).some((value) => /^CAST_\d{2}$/i.test(String(value)))), limit);
  // Purposeful text frame.
  pushUnique(picked, findFamilySafe((task) => Boolean(String(task.beat.onScreenText || '').trim())), limit);
  // Diagram/comparison/process.
  pushUnique(picked, findFamilySafe((task) => /diagram|comparison|process|timeline|map|mechanism/i.test(String(task.beat.purpose || '') + ' ' + String(task.beat.visual || ''))), limit);
  // Object/detail/POV style frame.
  pushUnique(picked, findFamilySafe((task) => /detail|object|pov|close|insert/i.test(String(task.beat.purpose || '') + ' ' + String(task.beat.visual || ''))), limit);

  // Fill remaining slots across the timeline rather than neighboring frames.
  if (picked.length < limit && tasks.length) {
    for (let step = 1; picked.length < limit && step <= limit * 2; step += 1) {
      const index = Math.min(tasks.length - 1, Math.round(step * (tasks.length - 1) / Math.max(1, limit)));
      pushUnique(picked, index, limit);
    }
  }

  return picked.sort((a, b) => a - b);
}
