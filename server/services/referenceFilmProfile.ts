export const REFERENCE_FILM_PROFILE = {
  id: 'handdrawn-reference-explainer-v1',
  openingCadenceSeconds: { min: 2.3, target: 2.5, max: 2.8 },
  bodyCadenceSeconds: { min: 3.5, target: 4.3, max: 5.5 },
  exceptionalHoldSeconds: 8,
  textVisualRatio: { min: 0.20, target: 0.25, max: 0.30 },
  characterGrammar: {
    line: 'slightly wobbly organic dark contour, visibly hand-drawn, never ruler-straight or glossy-vector perfect',
    limbs: 'thin one-stroke arms and legs with minimal hands and feet',
    faces: 'simple readable faces with very few marks; supporting people may have hair, beard, age cues or glasses without becoming realistic',
    bodies: 'compact simplified flat-color bodies with restrained anatomy and no realistic muscle/joint rendering',
    shading: 'minimal flat local-color shading; no cinematic gradients, glossy rendering or painterly watercolor depth that separates a character from the rest of the cast',
    cohesion: 'mascot, recurring CAST and one-off supporting people must look drawn by the same artist with the same construction system; identity differs, drawing grammar does not',
  },
  backgrounds: {
    story: 'simplified concrete environment with only the props needed to identify place and action',
    explainer: 'clean white/off-white or cream field with generous negative space for diagrams, comparisons, maps, timelines and object inserts',
  },
} as const;

export function isReferenceHanddrawnStyle(value?: string) {
  const text = String(value || '').trim();
  return Boolean(text) && /hand[- ]?drawn|story explainer|editorial explainer|stick|vẽ tay|drawn line|wobbly/iu.test(text);
}

export function referenceFilmSupportingHumanGrammar(style?: string) {
  const g = REFERENCE_FILM_PROFILE.characterGrammar;
  if (!isReferenceHanddrawnStyle(style)) {
    return 'SAME-ARTIST CHARACTER GRAMMAR: mascot, recurring CAST and one-off supporting people must use the same rendering medium, line/material language, body construction logic, face-detail level and shading system as the selected video style. Keep identities diverse without switching art systems.';
  }
  return [
    'SAME-ARTIST CHARACTER GRAMMAR:',
    g.cohesion + '.',
    'Use ' + g.line + '.',
    'Use ' + g.limbs + '.',
    g.faces + '.',
    g.bodies + '.',
    g.shading + '.',
    'Different people should vary through head silhouette, hair/head features, age cues, facial hair, clothing, profession, body height/shape and palette—not by switching to a more realistic or more detailed rendering system.',
    'A supporting person may be visually richer than the mascot, but only by identity details; line language, limb construction, face simplification and shading level must still belong to the same visual family.',
  ].join(' ');
}

export function referenceFilmCharacterCohesionContract(style?: string) {
  return [
    referenceFilmSupportingHumanGrammar(style),
    'Do not solve identity separation by making supporting people anatomically realistic, thick-limbed, painterly, semi-realistic, 3D, chibi, vector-clean or heavily shaded.',
    'Do not solve style cohesion by cloning the mascot. Keep each human a distinct person while preserving the same artist/construction grammar.',
  ].join(' ');
}

export function referenceFilmProductionContract(style?: string) {
  const p = REFERENCE_FILM_PROFILE;
  return [
    'REFERENCE-FILM PRODUCTION LOCK:',
    `opening meaningful visual changes target about ${p.openingCadenceSeconds.target}s, normally ${p.openingCadenceSeconds.min}-${p.openingCadenceSeconds.max}s`,
    `body stills normally ${p.bodyCadenceSeconds.min}-${p.bodyCadenceSeconds.max}s, target about ${p.bodyCadenceSeconds.target}s`,
    `holds beyond about ${p.exceptionalHoldSeconds}s require a real editorial reason or semantic split`,
    `purposeful short on-image text should land around ${Math.round(p.textVisualRatio.target * 100)}% of visuals, normally 1-4 words or a useful date/number/label`,
    'story scenes use simplified concrete environments; diagrams/details/comparisons may use clean off-white fields',
    referenceFilmCharacterCohesionContract(style),
    'Editorial energy comes from meaningful hard cuts between different semantic views, not Ken Burns motion or near-duplicate frames.',
  ].join('; ') + '.';
}

export function referenceFilmVisualQcContract(style?: string) {
  if (!isReferenceHanddrawnStyle(style)) {
    return 'CHARACTER STYLE COHESION QC: characterStyleCohesion=false when visible humans switch rendering medium, construction logic, face-detail level, material/line language or shading system away from the selected video style. Identity diversity is allowed; art-system drift is not.';
  }
  return [
    'CHARACTER STYLE COHESION QC:',
    'when a human is visible, compare drawing construction rather than identity alone.',
    'lineLanguageMatch=false if the candidate is substantially cleaner/vector-straighter, more painterly, more realistic, more 3D or uses a different line-weight family than the requested hand-drawn style.',
    'limbGrammarMatch=false if supporting humans use thick anatomical/tube limbs while the locked style uses simple one-stroke limbs, or vice versa.',
    'faceComplexityMatch=false if supporting faces become substantially more anatomically detailed/realistic than the same video family.',
    'shadingMatch=false if a supporting human gains materially heavier gradient, volumetric or watercolor shading than the locked cast style.',
    'characterStyleCohesion=false when any two of lineLanguageMatch, limbGrammarMatch, faceComplexityMatch or shadingMatch fail.',
    'Different hair, age, clothing, facial hair and body silhouette are identity diversity and must NOT be penalized when the drawing grammar still matches.',
  ].join(' ');
}

export function visualLikelyContainsHuman(value: string) {
  return /\b(?:man|woman|boy|girl|person|people|human|scientist|doctor|patient|worker|hunter|caveman|student|neighbor|presenter|mascot|CAST_\d{2})\b|(?:người\s*đàn\s*ông|người\s*phụ\s*nữ|chàng\s*trai|cô\s*gái|con\s*người|nhà\s*khoa\s*học|bác\s*sĩ|bệnh\s*nhân|công\s*nhân|thợ\s*săn|người\s*tiền\s*sử|học\s*sinh|hàng\s*xóm|nhân\s*vật)/iu.test(String(value || ''));
}
