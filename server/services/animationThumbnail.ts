import type { AnimationAsset, AnimationProject } from '../../shared/animationStudio';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { AIProvider } from '../types';
import { chat, recognizeImage } from '../adapters';
import { generateAnimationAsset, getAnimationAssetFile, updateAnimationAsset } from './animationAssets';
import { selectThumbnailConcepts, thumbnailPackagingRules, type RankedThumbnailConcept, type ThumbnailConceptCandidate, type ThumbnailVariant } from './thumbnailStrategy';

type AnimationThumbnailGeneration = {
  provider?: AIProvider;
  model?: string;
  generator?: 'flow-agent';
  referenceUploadId?: string;
  referenceAssetId?: string;
  characterAppearanceLock?: string;
};

export type AnimationThumbnailInput = {
  project: AnimationProject;
  brief?: string;
  provider: AIProvider;
  model: string;
  assetGeneration: AnimationThumbnailGeneration;
  count?: number;
};

type ThumbnailVisionReview = {
  score: number;
  textReadable: boolean;
  subjectLargeEnough: boolean;
  emotionStrong: boolean;
  contrastStrong: boolean;
  curiosityStrong: boolean;
  semanticallyAccurate: boolean;
  reasons: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonObject(raw: string) {
  const cleaned = String(raw || '').trim().replace(/^\`\`\`(?:json)?/i, '').replace(/\`\`\`$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI thumbnail planner không trả JSON hợp lệ.');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function projectNarration(project: AnimationProject) {
  return [...project.scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene) => String(scene.narration || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function detectLanguageName(value: string) {
  const text = String(value || '');
  if (/[ăâđêôơưĂÂĐÊÔƠƯ]|[àáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/u.test(text)) return 'Vietnamese';
  return 'English';
}

function providerSupportsVision(provider: AIProvider, model: string) {
  const modelCapabilities = provider.models.find((candidate) => candidate.id === model)?.capabilities;
  if (provider.capabilities?.vision === false || modelCapabilities?.vision === false) return false;
  if (provider.capabilities?.vision === true || modelCapabilities?.vision === true || Boolean(provider.endpoints?.vision)) return true;
  return /(?:gpt[-_. ]?(?:4o|4\.1|5)|gemini|claude[-_. ]?3|vision|\bvlm?\b|qwen[^\s]*vl)/i.test(model);
}

export function flowkitVariantDirection(variant: ThumbnailVariant) {
  if (variant === 'face') return 'FACE VARIANT: one recurring character face HUGE, around 40-50% of the frame, extreme readable emotion, threat/context only as a simple secondary background cue.';
  if (variant === 'action') return 'ACTION VARIANT: wide but simple high-stakes action composition showing scale, movement or immediate consequence, with one obvious focal subject.';
  if (variant === 'confrontation') return 'CONFRONTATION VARIANT: two sides or two states visibly oppose each other in one clean composition; create tension through eyelines, scale, direction or split staging.';
  return 'MYSTERY VARIANT: main character reacts strongly toward something partly hidden or off-screen; preserve a clear unanswered visual question that creates a curiosity gap.';
}

export function buildThumbnailPrompt(project: AnimationProject, concept: RankedThumbnailConcept, languageName: string) {
  const materialStyle = String(project.styleProfile?.style || project.styleProfile?.name || '').trim();
  const hook = concept.hookText.replace(/"/g, '”');
  const context = concept.contextText.replace(/"/g, '”');
  const linePosition = concept.variant === 'action' ? 'upper-left' : concept.variant === 'mystery' ? 'upper-right' : 'top center';
  return [
    materialStyle ? `MATERIAL / CHANNEL STYLE: ${materialStyle}.` : '',
    'YouTube thumbnail, 1280x720, 16:9, designed for mobile feed readability.',
    `bold yellow text in ${languageName} clearly "${hook}" at ${linePosition} in a thick condensed sans-serif font with strong dark outline,`,
    `smaller white text in ${languageName} clearly "${context}" directly below in bold sans-serif with dark shadow,`,
    flowkitVariantDirection(concept.variant),
    `CONCEPT: ${concept.prompt}`,
    'Use exactly ONE dominant focal idea. Large subject, clean silhouette, high local contrast, bright enough for mobile, saturated accent colors, simple background, no decorative clutter, no tiny props.',
    'Emotion must read instantly at thumbnail size. Avoid neutral faces, empty center compositions, low-contrast beige-on-beige staging, excessive negative space, and cinematic darkness that hides the subject.',
    'The two approved text lines are the ONLY readable text. No watermark, logo, pseudo-writing, labels, UI, badges or extra numbers.',
    'Do not merely repeat the video title visually. The image should show stakes, conflict, consequence, surprise or an unresolved mystery supported by the video.',
    'Sharp focus, crisp edges, professional YouTube packaging, no black bars.',
  ].filter(Boolean).join('\n');
}

function buildThumbnailReferenceIds(project: AnimationProject, generation: AnimationThumbnailGeneration) {
  const frequency = new Map<string, number>();
  for (const beat of project.productionPlan?.beats || []) {
    for (const ref of beat.characterRefs || []) frequency.set(ref.toUpperCase(), (frequency.get(ref.toUpperCase()) || 0) + 1);
  }
  const castRefs = (project.storyCastReferenceAssetIds || []).map((id, index) => {
    const asset = project.assets.find((candidate) => candidate.id === id);
    const castTag = asset?.tags.find((tag) => /^cast-id-/i.test(tag));
    const castId = castTag ? castTag.replace(/^cast-id-/i, '').replace(/-/g, '_').toUpperCase() : `CAST_${String(index + 1).padStart(2, '0')}`;
    return { id, score: frequency.get(castId) || 0, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const refs = [generation.referenceAssetId, ...castRefs.map((item) => item.id)].filter((id): id is string => Boolean(id));
  return [...new Set(refs)].slice(0, 3);
}

async function planThumbnailConcepts(input: AnimationThumbnailInput) {
  const narration = projectNarration(input.project);
  const language = detectLanguageName(`${input.project.name}\n${narration}`);
  const raw = await chat(input.provider, input.model, [
    {
      role: 'system',
      content: [
        'You are a YouTube packaging director. Return compact JSON only.',
        thumbnailPackagingRules,
        'Create 8 candidates: exactly 2 face, 2 action, 2 confrontation and 2 mystery concepts.',
        'Every candidate needs hookText of exactly 2-3 words and contextText of 5-8 words, both in the same language as the video.',
        'Do not repeat the full title. Hook text should add emotion/urgency/curiosity; context text makes the hook specific.',
        'Each prompt describes the visual idea only: main subject, extreme emotion/action, conflict/stakes, camera framing, setting and one visual proof. Keep it simple enough to understand at 120px wide.',
        'Avoid clickbait unsupported by the narration. Do not invent deaths, attacks, danger, statistics or villains unless the video supports them.',
        'Schema: {"candidates":[{"title":"","variant":"face|action|confrontation|mystery","hookText":"","contextText":"","prompt":"","angle":"","scores":{"titleComplementarity":0,"visualSimplicity":0,"mobileReadability":0,"curiosityGap":0,"semanticAccuracy":0}}]}.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        videoTitle: input.project.name,
        brief: String(input.brief || '').slice(0, 4000),
        language,
        style: input.project.styleProfile,
        narration: narration.slice(0, 18000),
      }),
    },
  ], input.assetGeneration.generator === 'flow-agent' ? undefined : undefined, 7000);
  const parsed = jsonObject(raw);
  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates as ThumbnailConceptCandidate[] : [];
  const selected = selectThumbnailConcepts(input.project.name, candidates, Math.max(1, Math.min(4, input.count || 4)));
  if (!selected.length) throw new Error('AI không tạo được concept thumbnail hợp lệ.');
  return { selected, language };
}

function normalizeVisionReview(raw: string): ThumbnailVisionReview {
  const parsed = jsonObject(raw);
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 5) : [];
  return {
    score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
    textReadable: parsed.textReadable !== false,
    subjectLargeEnough: parsed.subjectLargeEnough !== false,
    emotionStrong: parsed.emotionStrong !== false,
    contrastStrong: parsed.contrastStrong !== false,
    curiosityStrong: parsed.curiosityStrong !== false,
    semanticallyAccurate: parsed.semanticallyAccurate !== false,
    reasons,
  };
}

async function normalizeThumbnailToYoutube(asset: AnimationAsset) {
  const file = await getAnimationAssetFile(asset.id);
  if (file.contentType !== 'image/png') return asset;
  const source = await sharp(file.path).rotate().toBuffer();
  const output = await sharp(source)
    .resize({ width: 1280, height: 720, fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(file.path, output);
  return asset;
}

async function reviewGeneratedThumbnail(input: AnimationThumbnailInput, asset: AnimationAsset, concept: RankedThumbnailConcept) {
  if (!providerSupportsVision(input.provider, input.model)) return undefined;
  const file = await getAnimationAssetFile(asset.id);
  const raw = await recognizeImage(input.provider, input.model, file.path, [
    'Review this actual YouTube thumbnail at mobile-feed size. Return compact JSON only.',
    'Schema: {"score":0,"textReadable":true,"subjectLargeEnough":true,"emotionStrong":true,"contrastStrong":true,"curiosityStrong":true,"semanticallyAccurate":true,"reasons":[]}.',
    `The only intended text is line 1 "${concept.hookText}" and line 2 "${concept.contextText}". Mark textReadable=false for misspelling, pseudo-text, extra text, tiny text, clipped text or weak contrast.`,
    'subjectLargeEnough=false if the focal face/subject is too small to read on a phone.',
    'emotionStrong=false for a neutral/weak expression when the concept depends on emotion.',
    'contrastStrong=false for muddy, dark or low-separation packaging.',
    'curiosityStrong=false if the image fully resolves the question or feels generic.',
    'semanticallyAccurate=false if it promises a conflict/result not supported by the concept.',
    `Concept variant: ${concept.variant}. Visual intent: ${concept.prompt}`,
  ].join('\n'));
  return normalizeVisionReview(raw);
}

function reviewTags(review?: ThumbnailVisionReview) {
  if (!review) return [] as string[];
  const rating = review.score >= 8 && review.textReadable && review.subjectLargeEnough && review.semanticallyAccurate ? 'strong'
    : review.score >= 6 ? 'ok' : 'weak';
  return [
    `thumbnail-actual-score:${review.score.toFixed(1)}`,
    `thumbnail-vision-score:${review.score.toFixed(1)}`,
    `thumbnail-review:${rating}`,
  ];
}


async function generateThumbnailAssetResilient(input: Parameters<typeof generateAnimationAsset>[0]) {
  try {
    return await generateAnimationAsset(input);
  } catch (firstError) {
    const hasReferences = Boolean(input.referenceUploadId || input.referenceAssetId || input.referenceAssetIds?.length);
    if (hasReferences) {
      try {
        return await generateAnimationAsset({
          ...input,
          referenceUploadId: undefined,
          referenceAssetId: undefined,
          referenceAssetIds: undefined,
          tags: [...(input.tags || []), 'thumbnail-reference-fallback'],
          prompt: `${input.prompt}\nREFERENCE FALLBACK: preserve the described recurring character identity as closely as possible even though reference attachment failed.`,
        });
      } catch {
        // Fall through to the one transient retry below.
      }
    }
    if (input.generator === 'flow-agent') await sleep(8000);
    try {
      return await generateAnimationAsset({
        ...input,
        prompt: `${input.prompt}\nTRANSIENT RETRY: generate a fresh variant with the same approved packaging and text.`,
        tags: [...(input.tags || []), 'thumbnail-transient-retry'],
      });
    } catch {
      throw firstError;
    }
  }
}

export async function generateAnimationThumbnailOptions(input: AnimationThumbnailInput, signal?: AbortSignal) {
  if (!input?.project || !input.provider || !input.model || !input.assetGeneration) throw new Error('Thiếu dữ liệu tạo thumbnail.');
  const { selected, language } = await planThumbnailConcepts(input);
  const referenceIds = buildThumbnailReferenceIds(input.project, input.assetGeneration);
  const results: AnimationAsset[] = [];

  for (let index = 0; index < selected.length; index += 1) {
    if (signal?.aborted) throw signal.reason || new Error('Đã hủy tạo thumbnail.');
    const concept = selected[index];
    const prompt = buildThumbnailPrompt(input.project, concept, language);
    const shared = {
      name: `YouTube thumbnail ${index + 1} · ${concept.variant}`,
      type: 'image' as const,
      style: input.project.styleProfile?.style || input.project.styleProfile?.name,
      provider: input.assetGeneration.provider,
      model: input.assetGeneration.model,
      generator: input.assetGeneration.generator,
      width: 1280,
      height: 720,
      referenceUploadId: input.assetGeneration.referenceUploadId,
      referenceAssetId: input.assetGeneration.referenceAssetId,
      ...(input.assetGeneration.generator === 'flow-agent' && referenceIds.length
        ? { referenceAssetIds: referenceIds.filter((id) => id !== input.assetGeneration.referenceAssetId) }
        : {}),
    };

    let asset = await generateThumbnailAssetResilient({
      ...shared,
      prompt,
      tags: [
        'youtube-thumbnail',
        `thumbnail-variant:${concept.variant}`,
        `thumbnail-score:${concept.totalScore.toFixed(1)}`,
        `thumbnail-hook:${concept.hookText}`,
        `thumbnail-context:${concept.contextText}`,
        'thumbnail-flowkit-v2',
      ],
    });
    asset = await normalizeThumbnailToYoutube(asset);

    let review = await reviewGeneratedThumbnail(input, asset, concept).catch(() => undefined);
    const shouldRetry = Boolean(review && (
      review.score < 7 ||
      !review.textReadable ||
      !review.subjectLargeEnough ||
      !review.semanticallyAccurate
    ));

    if (shouldRetry) {
      await updateAnimationAsset(asset.id, { status: 'rejected', tags: [...asset.tags, ...reviewTags(review), 'thumbnail-rejected-first-pass'] }).catch(() => undefined);
      const correction = [
        review?.reasons.join('; ') || 'weak packaging',
        !review?.textReadable ? 'render the two approved Vietnamese text lines exactly, large, clean and unclipped' : '',
        !review?.subjectLargeEnough ? 'make the focal face/subject much larger' : '',
        !review?.contrastStrong ? 'increase local contrast and brighter saturated accents' : '',
        !review?.emotionStrong ? 'use a much stronger readable emotion' : '',
        !review?.curiosityStrong ? 'strengthen the unresolved visual question' : '',
      ].filter(Boolean).join('; ');
      asset = await generateThumbnailAssetResilient({
        ...shared,
        prompt: `${prompt}\nQUALITY CORRECTION: ${correction}. This is a fresh second composition, not a near-duplicate of the rejected thumbnail.`,
        tags: [
          'youtube-thumbnail',
          `thumbnail-variant:${concept.variant}`,
          `thumbnail-score:${concept.totalScore.toFixed(1)}`,
          `thumbnail-hook:${concept.hookText}`,
          `thumbnail-context:${concept.contextText}`,
          'thumbnail-flowkit-v2',
          'thumbnail-qc-retry',
        ],
      });
      asset = await normalizeThumbnailToYoutube(asset);
      review = await reviewGeneratedThumbnail(input, asset, concept).catch(() => review);
    }

    if (review) {
      asset = await updateAnimationAsset(asset.id, { tags: [...new Set([...asset.tags, ...reviewTags(review)])], status: review.score >= 6 ? 'candidate' : 'draft' }).catch(() => asset);
    }
    results.push(asset);

    if (input.assetGeneration.generator === 'flow-agent' && index < selected.length - 1) {
      await sleep(8000);
    }
  }

  return results.sort((a, b) => {
    const score = (asset: AnimationAsset) => Number((asset.tags.find((tag) => tag.startsWith('thumbnail-actual-score:')) || '').split(':')[1])
      || Number((asset.tags.find((tag) => tag.startsWith('thumbnail-score:')) || '').split(':')[1])
      || 0;
    return score(b) - score(a);
  });
}
