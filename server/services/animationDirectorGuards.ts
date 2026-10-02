export type StoryboardGuardBeat = {
  purpose?: string;
  narrationCue?: string;
  visual?: string;
  characterRefs?: string[];
  onScreenText?: string;
};

export type StoryboardGuardSegment = {
  title?: string;
  narration?: string;
  visualBeats: StoryboardGuardBeat[];
};

export type StoryboardGuardIssue = {
  code:
    | 'MASCOT_STORY_ROLE'
    | 'METAPHOR_REPETITION'
    | 'MISSING_CONCRETE_EVIDENCE'
    | 'UNLOCKED_STORY_CAST'
    | 'MASCOT_CLONE_CAST'
    | 'TEXT_TRAP_RISK';
  sceneIndex: number;
  beatIndex: number;
  message: string;
};

const presenterLanguage = /\b(?:presenter mascot|narrator mascot|guide mascot|host mascot|mascot presenter|mascot narrator|mascot guide|presenter cutaway|narrator cutaway)\b|(?:mascot\s+(?:explains?|demonstrates?|introduces?|points?\s+to))|(?:mascot\s+người\s*dẫn|mascot\s+dẫn\s*chuyện|mascot\s+giải\s*thích|mascot\s+minh\s*họa|mascot\s+chỉ\s+vào)/iu;
const mascotIdentityTakeover = /\b(?:mascot|presenter mascot|narrator mascot|reference mascot)\b[^.]{0,100}\b(?:(?:is|becomes?|acts?\s+as|plays?|portrays?|works?\s+as|dressed\s+as|costumed\s+as)\s+(?:an?\s+)?(?:hunter|prehistoric person|caveman|doctor|patient|customer|worker|employee|driver|cook|victim|shopper|soldier|student|neighbor|homeowner|tenant)|wears?\s+(?:a\s+)?(?:doctor|hunter|worker|soldier|patient)[^.,]{0,30}(?:uniform|costume|outfit))\b|(?:mascot|nhân\s*vật\s*mascot)[^.]{0,100}(?:hóa\s*thành|trở\s*thành|đóng\s*vai|cải\s*trang\s*thành|mặc\s*đồ\s*như|là)\s*(?:người\s*tiền\s*sử|thợ\s*săn|bác\s*sĩ|bệnh\s*nhân|khách\s*hàng|công\s*nhân|nhân\s*viên|tài\s*xế|đầu\s*bếp|nạn\s*nhân|người\s*lính|học\s*sinh|hàng\s*xóm)/iu;
const storyPerson = /\b(?:young\s+)?(?:man|woman|boy|girl|person|character|homeowner|tenant|student|doctor|patient|hunter|worker|employee|driver|neighbor|shopper|customer)\b|(?:chàng\s*trai|cô\s*gái|người\s*đàn\s*ông|người\s*phụ\s*nữ|nhân\s*vật|chủ\s*nhà|người\s*thuê|học\s*sinh|bác\s*sĩ|bệnh\s*nhân|thợ\s*săn|công\s*nhân|nhân\s*viên|tài\s*xế|hàng\s*xóm|khách\s*hàng)/iu;
const anonymousPerson = /\b(?:anonymous|generic|background|distant|crowd|extras?|passers?-?by|silhouettes?)\b|(?:vô\s*danh|đám\s*đông|nhân\s*vật\s*nền|người\s*qua\s*đường|bóng\s*người)/iu;
const mascotCloneLanguage = /\b(?:blank\s+white\s+(?:round|circular)\s+head|white\s+(?:round|circular)\s+head|bald\s+(?:round|circular)\s+head|minimal(?:ist)?\s+dot\s+face|presenter\s+proportions?)\b|(?:đầu\s+trắng\s+tròn|đầu\s+tròn\s+trắng|đầu\s+trọc\s+tròn|mặt\s+chấm\s+tối\s+giản)/iu;
const textTrapSurface = /\b(?:chalkboard|blackboard|whiteboard|board|poster|document|newspaper|receipt|menu|book page|notes?|screen|monitor|phone screen|signage|sign|label|chart|dashboard|form|ticket)\b|(?:bảng\s*viết|bảng\s*đen|bảng\s*trắng|áp\s*phích|tài\s*liệu|báo|hóa\s*đơn|thực\s*đơn|trang\s*sách|ghi\s*chú|màn\s*hình|biển\s*hiệu|nhãn|biểu\s*đồ|bảng\s*điều\s*khiển|biểu\s*mẫu|vé)/iu;
const explicitlyBlankSurface = /\b(?:blank|unmarked|text-free|no text|without text|turned away)\b|(?:để\s*trống|không\s*chữ|không\s*có\s*chữ|không\s*nhãn|quay\s*mặt\s*đi)/iu;

const metaphorFamilies: Array<{ id: string; pattern: RegExp }> = [
  { id: 'brain', pattern: /\b(?:brain|neural|neuron|amygdala|nervous system|mind)\b|(?:não|nơ-?ron|hệ\s*thần\s*kinh|tâm\s*trí)/iu },
  { id: 'balance', pattern: /\b(?:balance scale|scales?|seesaw|weighing)\b|(?:cân\s*bằng|cán\s*cân)/iu },
  { id: 'gears', pattern: /\b(?:gears?|cogs?|machine inside)\b|(?:bánh\s*răng|cỗ\s*máy)/iu },
  { id: 'fire-water', pattern: /\b(?:fire and water|flame and water|fire versus water)\b|(?:lửa\s*(?:và|với|đối\s*lập)\s*nước)/iu },
];

const evidenceTerms: Array<{ cue: RegExp; visual: RegExp; label: string }> = [
  { cue: /\b(?:coat|jacket)\b|(?:áo\s*khoác)/iu, visual: /\b(?:coat|jacket)\b|(?:áo\s*khoác)/iu, label: 'coat/jacket' },
  { cue: /\b(?:door|doorway)\b|(?:cửa|khung\s*cửa)/iu, visual: /\b(?:door|doorway)\b|(?:cửa|khung\s*cửa)/iu, label: 'door/doorway' },
  { cue: /\b(?:hallway|corridor)\b|(?:hành\s*lang)/iu, visual: /\b(?:hallway|corridor)\b|(?:hành\s*lang)/iu, label: 'hallway/corridor' },
  { cue: /\b(?:phone|smartphone)\b|(?:điện\s*thoại)/iu, visual: /\b(?:phone|smartphone)\b|(?:điện\s*thoại)/iu, label: 'phone' },
  { cue: /\b(?:shadow|silhouette)\b|(?:bóng\s*người|bóng\s*đen|bóng\s*tối)/iu, visual: /\b(?:shadow|silhouette)\b|(?:bóng\s*người|bóng\s*đen|bóng\s*tối)/iu, label: 'shadow/silhouette' },
  { cue: /\b(?:bed|mattress)\b|(?:giường|nệm)/iu, visual: /\b(?:bed|mattress)\b|(?:giường|nệm)/iu, label: 'bed' },
  { cue: /\b(?:lamp|light switch|light)\b|(?:đèn|công\s*tắc)/iu, visual: /\b(?:lamp|light switch|light)\b|(?:đèn|công\s*tắc|ánh\s*sáng)/iu, label: 'lamp/light' },
  { cue: /\b(?:window)\b|(?:cửa\s*sổ)/iu, visual: /\b(?:window)\b|(?:cửa\s*sổ)/iu, label: 'window' },
  { cue: /\b(?:fridge|refrigerator)\b|(?:tủ\s*lạnh)/iu, visual: /\b(?:fridge|refrigerator)\b|(?:tủ\s*lạnh)/iu, label: 'fridge' },
  { cue: /\b(?:keys?)\b|(?:chìa\s*khóa)/iu, visual: /\b(?:keys?)\b|(?:chìa\s*khóa)/iu, label: 'keys' },
  { cue: /\b(?:cat)\b|(?:con\s*mèo|mèo)/iu, visual: /\b(?:cat)\b|(?:con\s*mèo|mèo)/iu, label: 'cat' },
];

function normalizedRefs(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim().toLowerCase()) : [];
}

export function storyboardMascotRoleIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    const visual = String(beat.visual || '');
    const mascotVisible = normalizedRefs(beat.characterRefs).includes('mascot')
      || /\b(?:mascot|presenter mascot|narrator mascot|reference mascot)\b/iu.test(visual);
    if (!mascotVisible || !mascotIdentityTakeover.test(visual)) return;
    issues.push({
      code: 'MASCOT_STORY_ROLE',
      sceneIndex,
      beatIndex,
      message: `Scene ${sceneIndex + 1}, beat ${beatIndex + 1}: the mascot is being redesigned or cast AS a story-world identity. Keep the mascot's normal narrator appearance unchanged; it may share the scene, react, point, walk or hold a neutral prop, but the actual hunter/doctor/patient/worker/victim/etc. must be a distinct CAST_* person.`,
    });
  }));
  return issues;
}

function metaphorFamily(value: string) {
  return metaphorFamilies.find((family) => family.pattern.test(value))?.id;
}

export function storyboardMetaphorDensityIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  const flattened = segments.flatMap((segment, sceneIndex) => segment.visualBeats.map((beat, beatIndex) => ({
    sceneIndex,
    beatIndex,
    family: metaphorFamily(String(beat.visual || '')),
  }))).map((item, flatIndex) => ({ ...item, flatIndex }));

  const byFamily = new Map<string, typeof flattened>();
  for (const item of flattened) {
    if (!item.family) continue;
    byFamily.set(item.family, [...(byFamily.get(item.family) || []), item]);
  }

  for (const [family, familyItems] of byFamily) {
    familyItems.forEach((item) => {
      const recent = familyItems.filter((candidate) =>
        candidate.flatIndex <= item.flatIndex && candidate.flatIndex >= item.flatIndex - 7
      );
      if (recent.length < 3) return;
      issues.push({
        code: 'METAPHOR_REPETITION',
        sceneIndex: item.sceneIndex,
        beatIndex: item.beatIndex,
        message: `Scene ${item.sceneIndex + 1}, beat ${item.beatIndex + 1}: the “${family}” metaphor is repeating too tightly. Keep at most two uses inside any eight adjacent visuals; it may return later when the topic genuinely comes back. Replace this local repeat with concrete story evidence, an object state, POV, reaction, environment or cause/effect action.`,
      });
    });
  }
  return issues;
}

export function storyboardUnlockedStoryCastIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  segments.forEach((segment, sceneIndex) => {
    const descriptorCounts = new Map<string, number>();
    const rows = segment.visualBeats.map((beat, beatIndex) => {
      const visual = String(beat.visual || '');
      const refs = normalizedRefs(beat.characterRefs);
      const mascotVisible = refs.includes('mascot')
        || /\b(?:mascot|presenter mascot|narrator mascot|reference mascot)\b/iu.test(visual);
      const descriptor = !mascotVisible && !anonymousPerson.test(visual)
        ? visual.match(storyPerson)?.[0]?.toLocaleLowerCase('vi') || ''
        : '';
      if (descriptor) descriptorCounts.set(descriptor, (descriptorCounts.get(descriptor) || 0) + 1);
      return { beatIndex, visual, refs, mascotVisible, descriptor };
    });

    for (const row of rows) {
      if (row.mascotVisible || !row.descriptor) continue;
      const hasCastId = row.refs.some((ref) => /^cast_\d{2}$/i.test(ref))
        || /\bCAST[_ -]?\d{1,2}\b/iu.test(row.visual);
      if (hasCastId) continue;
      const explicitlyRecurring = /\b(?:same|recurring|main|protagonist|returning)\s+(?:young\s+)?(?:man|woman|boy|girl|person|character)\b|(?:cùng\s+(?:chàng\s*trai|cô\s*gái|người\s*đàn\s*ông|người\s*phụ\s*nữ|nhân\s*vật)|nhân\s*vật\s*chính|chàng\s*trai\s*này|cô\s*gái\s*này)/iu.test(row.visual);
      const appearsAgainInsideMiniStory = (descriptorCounts.get(row.descriptor) || 0) >= 2;
      if (!explicitlyRecurring && !appearsAgainInsideMiniStory) continue;
      issues.push({
        code: 'UNLOCKED_STORY_CAST',
        sceneIndex,
        beatIndex: row.beatIndex,
        message: `Scene ${sceneIndex + 1}, beat ${row.beatIndex + 1}: a person recurs inside this mini-story but is not bound to a CAST_* identity. Assign a stable CAST_ID only for this exact recurring person, repeat it while the same example/experiment/vignette continues, and do not reuse that ID for a different person later.`,
      });
    }
  });
  return issues;
}

export function storyboardMascotCloneCastIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    const visual = String(beat.visual || '');
    const refs = normalizedRefs(beat.characterRefs);
    const mascotVisible = refs.includes('mascot')
      || /\b(?:mascot|presenter mascot|narrator mascot|reference mascot)\b/iu.test(visual);
    if (mascotVisible || !storyPerson.test(visual) || !mascotCloneLanguage.test(visual)) return;
    issues.push({
      code: 'MASCOT_CLONE_CAST',
      sceneIndex,
      beatIndex,
      message: `Scene ${sceneIndex + 1}, beat ${beatIndex + 1}: a non-mascot human is described with mascot-like identity language (white/round/bald head, minimalist presenter face or presenter proportions). Redesign the head/face, hair/head feature and clothing silhouette/palette so this reads as a different person. Thin one-stroke arms and legs are allowed when they belong to the shared hand-drawn supporting-cast grammar; accessories alone do not make a mascot-clone head acceptable.`,
    });
  }));
  return issues;
}

export function storyboardTextTrapIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    const visual = String(beat.visual || '');
    const approvedText = String(beat.onScreenText || '').trim();
    if (approvedText || !textTrapSurface.test(visual) || explicitlyBlankSurface.test(visual)) return;
    issues.push({
      code: 'TEXT_TRAP_RISK',
      sceneIndex,
      beatIndex,
      message: `Scene ${sceneIndex + 1}, beat ${beatIndex + 1}: the visual includes a writing-bearing surface without approved onScreenText. Restage it as blank/unmarked/turned away, crop it out, or communicate the idea with objects and actions so pseudo-text cannot appear.`,
    });
  }));
  return issues;
}

export function storyboardConcreteEvidenceIssues(segments: StoryboardGuardSegment[]) {
  const issues: StoryboardGuardIssue[] = [];
  segments.forEach((segment, sceneIndex) => segment.visualBeats.forEach((beat, beatIndex) => {
    const cue = String(beat.narrationCue || '');
    const visual = String(beat.visual || '');
    for (const term of evidenceTerms) {
      if (!term.cue.test(cue) || term.visual.test(visual)) continue;
      issues.push({
        code: 'MISSING_CONCRETE_EVIDENCE',
        sceneIndex,
        beatIndex,
        message: `Scene ${sceneIndex + 1}, beat ${beatIndex + 1}: narration explicitly names ${term.label}, but the visual prompt does not. Show that concrete evidence instead of substituting a generic metaphor.`,
      });
    }
  }));
  return issues;
}

export function storyboardDeterministicGuardIssues(segments: StoryboardGuardSegment[]) {
  return [
    ...storyboardMascotRoleIssues(segments),
    ...storyboardUnlockedStoryCastIssues(segments),
    ...storyboardMascotCloneCastIssues(segments),
    ...storyboardMetaphorDensityIssues(segments),
    // Writing-bearing surfaces are handled at image-generation time by the
    // text-free prompt contract plus Vision QC. Keeping TEXT_TRAP_RISK in the
    // deterministic storyboard gate caused otherwise valid jobs to stop when a
    // scene naturally contained a screen/sign/board even though the generated
    // image could be forced blank and verified afterwards.
    ...storyboardConcreteEvidenceIssues(segments),
  ];
}

export function guardRewriteTargets(issues: StoryboardGuardIssue[], maxTargets = 8) {
  return [...new Set(issues.map((issue) => issue.sceneIndex + 1))].slice(0, Math.max(1, maxTargets));
}
