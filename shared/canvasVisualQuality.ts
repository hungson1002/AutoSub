import { canvasLayoutFingerprint, compileCanvasProjectLayout } from './canvasLayoutCompiler';
import { defaultCanvasAssetRef, defaultCanvasBackgroundRef, isCanvasAuthoredAssetSupported, resolveCanvasAuthoredAsset, resolveCanvasAuthoredBackground } from './canvasAssetRegistry';
import type { CanvasStudioProject, CanvasStudioScene } from './canvasAnimationStudio';
import {evaluateCanvasActionCoverage} from './canvasActionCoverage';

export type CanvasVisualIssue = {
  code:
    | 'raw-layout'
    | 'missing-action-coverage'
    | 'missing-semantic-focal'
    | 'text-heavy'
    | 'text-focal-over-semantic'
    | 'repeated-composition'
    | 'low-template-variety'
    | 'floating-equipment'
    | 'large-overlap'
    | 'unsupported-authored-asset'
    | 'missing-asset-ref'
    | 'unsupported-authored-background'
    | 'missing-background-ref'
    | 'low-detail-asset'
    | 'low-detail-background'
    | 'low-choreography-density';
  severity: 'error' | 'warning';
  sceneId?: string;
  sceneName?: string;
  message: string;
};

export type CanvasVisualQualityReport = {
  pass: boolean;
  score: number;
  issues: CanvasVisualIssue[];
  stats: {
    scenes: number;
    uniqueTemplates: number;
    uniqueFingerprints: number;
    maxFingerprintRun: number;
    titleLikeScenes: number;
    semanticObjects: number;
    authoredObjects: number;
    authoredCoverage: number;
    authoredBackgrounds: number;
    backgroundCoverage: number;
    averageAssetDetail: number;
    averageBackgroundDetail: number;
    averageAnimationBeats: number;
  };
};

function wordCount(value: string | undefined) {
  return (value || '').trim().split(/\s+/).filter(Boolean).length;
}

function semanticObjects(scene: CanvasStudioScene) {
  return scene.objects.filter((object) =>
    object.kind === 'character'
    || object.kind === 'ship'
    || object.kind === 'stake'
    || object.kind === 'prop',
  );
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const ax1 = a.x - a.width / 2;
  const ax2 = a.x + a.width / 2;
  const ay1 = a.y - a.height / 2;
  const ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2;
  const bx2 = b.x + b.width / 2;
  const by1 = b.y - b.height / 2;
  const by2 = b.y + b.height / 2;
  const width = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const height = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = width * height;
  if (!intersection) return 0;
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export function evaluateCanvasVisualQuality(project: CanvasStudioProject): CanvasVisualQualityReport {
  const compiled = compileCanvasProjectLayout(project);
  const horrorMode = /(?:kinh\s*d[iị]|truy[eệ]n\s*ma|ma\s*x[oó]|ma\s*da|r[uù]ng\s*r[oợ]n|horror|ghost\s*story|creepy|haunted|g[aầ]m\s*s[aà]n)/iu.test(project.sourcePrompt || '');
  const issues: CanvasVisualIssue[] = evaluateCanvasActionCoverage(compiled).map(issue=>({
    code:'missing-action-coverage',severity:'error',sceneId:issue.sceneId,sceneName:issue.sceneName,message:issue.message,
  }));
  const fingerprints = compiled.scenes.map(canvasLayoutFingerprint);
  const templates = new Set(compiled.scenes.map((scene) => scene.template || 'raw'));
  const uniqueFingerprints = new Set(fingerprints);
  let maxFingerprintRun = 0;
  let currentRun = 0;
  let lastFingerprint = '';
  let titleLikeScenes = 0;
  let semanticObjectCount = 0;
  let authoredObjectCount = 0;
  let authoredBackgroundCount = 0;
  let assetDetailTotal = 0;
  let backgroundDetailTotal = 0;
  let animationBeatTotal = 0;

  compiled.scenes.forEach((scene, sceneIndex) => {
    const animationBeatCount = scene.animationBeats?.length || 0;
    animationBeatTotal += animationBeatCount;
    const atmosphericMotionChannels =
      animationBeatCount
      + scene.objects.filter((object) => (object.keyframes?.length || 0) >= 2).length
      + ((scene.effects?.length || 0) > 0 ? 1 : 0)
      + (scene.camera?.motion && scene.camera.motion !== 'none' ? 1 : 0)
      + ((scene.camera?.keyframes?.length || 0) >= 2 ? 1 : 0);
    const phraseDirected = scene.animationBeats?.some(beat => beat.speechCue?.trim() && scene.dialogue?.some(line =>
      (!beat.dialogueId || beat.dialogueId === line.id) && line.text.toLocaleLowerCase().includes(beat.speechCue!.toLocaleLowerCase())));
    const requiredBeats = horrorMode || phraseDirected ? 0 : scene.durationMs >= 6000 ? 4 : scene.durationMs >= 4000 ? 3 : scene.durationMs >= 2500 ? 2 : 0;
    if (horrorMode && scene.durationMs >= 4200 && atmosphericMotionChannels < 1) {
      issues.push({
        code: 'low-choreography-density',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Horror scene dài ${Math.round(scene.durationMs / 100) / 10}s đang hoàn toàn chết hình; cần ít nhất một lớp atmosphere/keyframe/camera motion có chủ đích, không cần ép nhiều animation beat.`,
      });
    }
    if (!horrorMode && requiredBeats > 0 && animationBeatCount < requiredBeats) {
      issues.push({
        code: 'low-choreography-density',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Scene dài ${Math.round(scene.durationMs / 100) / 10}s nhưng chỉ có ${animationBeatCount} animation beat; production yêu cầu ít nhất ${requiredBeats} (mật độ mẫu 5-8s/shot).`,
      });
    }
    if (!horrorMode && requiredBeats > 0 && animationBeatCount >= requiredBeats) {
      // Phủ sóng thời gian: gộp khoảng beat chồng nhau, tìm đoạn chết thật sự.
      const spans = [...(scene.animationBeats || [])]
        .map((b) => [Math.max(0, b.atMs), Math.max(0, b.atMs) + Math.max(120, b.durationMs)] as const)
        .sort((a, b) => a[0] - b[0]);
      let maxGap = spans.length ? spans[0]![0] : scene.durationMs;
      let coveredUntil = 0;
      for (const [start, end] of spans) {
        if (start > coveredUntil) maxGap = Math.max(maxGap, start - coveredUntil);
        coveredUntil = Math.max(coveredUntil, end);
      }
      maxGap = Math.max(maxGap, scene.durationMs - coveredUntil);
      if (maxGap > 3000) {
        issues.push({
          code: 'low-choreography-density',
          severity: 'error',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Scene có khoảng chết ${Math.round(maxGap / 100) / 10}s không beat; mẫu yêu cầu beat cách nhau tối đa 3s.`,
        });
      }
    }

    const resolvedBackgroundRef = scene.backgroundRef || defaultCanvasBackgroundRef(scene);
    if (!scene.backgroundRef && resolvedBackgroundRef) {
      issues.push({
        code: 'missing-background-ref',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Scene đang dựa vào backgroundRef mặc định ${resolvedBackgroundRef}; production Director nên ghi backgroundRef rõ ràng.`,
      });
    }
    const authoredBackground = resolveCanvasAuthoredBackground({ ...scene, backgroundRef: resolvedBackgroundRef });
    if (authoredBackground) {
      authoredBackgroundCount += 1;
      backgroundDetailTotal += authoredBackground.detailScore;
      if (authoredBackground.detailScore < 8) {
        issues.push({
          code: 'low-detail-background',
          severity: 'error',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Authored background ${authoredBackground.id} chỉ đạt detail score ${authoredBackground.detailScore}/10; production yêu cầu >=8.`,
        });
      }
    } else {
      issues.push({
        code: 'unsupported-authored-background',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Không có authored background cho ${scene.background}/${scene.template || 'raw'}. Generic background fallback bị cấm trong production.`,
      });
    }

    const semantic = semanticObjects(scene);
    semanticObjectCount += semantic.length;
    for (const object of semantic) {
      const resolvedRef = object.assetRef || defaultCanvasAssetRef(object);
      if (!object.assetRef && resolvedRef) {
        issues.push({
          code: 'missing-asset-ref',
          severity: 'warning',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Semantic object ${object.label} đang dựa vào assetRef mặc định ${resolvedRef}; production Director nên ghi assetRef rõ ràng.`,
        });
      }
      if (isCanvasAuthoredAssetSupported({ ...object, assetRef: resolvedRef })) {
        authoredObjectCount += 1;
        const authoredAsset = resolveCanvasAuthoredAsset({ ...object, assetRef: resolvedRef });
        if (authoredAsset) {
          assetDetailTotal += authoredAsset.detailScore;
          const requiredDetail = object.role === 'focal' ? 8 : 7;
          if (authoredAsset.detailScore < requiredDetail) {
            issues.push({
              code: 'low-detail-asset',
              severity: 'error',
              sceneId: scene.id,
              sceneName: scene.name,
              message: `${authoredAsset.id} detail score ${authoredAsset.detailScore}/10 thấp hơn production threshold ${requiredDetail}/10.`,
            });
          }
        }
      } else {
        issues.push({
          code: 'unsupported-authored-asset',
          severity: 'error',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Không có authored asset cho ${object.assetRef || `${object.kind}:${object.variant || object.archetype || object.label}`}. Generic fallback bị cấm trong production.`,
        });
      }
    }
    const focalSemantic = semantic.find((object) => object.role === 'focal');
    const textObjects = scene.objects.filter((object) => object.kind === 'text');

    if (!scene.template) {
      issues.push({
        code: 'raw-layout',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Scene vẫn dùng raw pixel layout thay vì semantic template.',
      });
    }

    if (!focalSemantic && scene.template !== 'diagram-clean' && !horrorMode) {
      issues.push({
        code: 'missing-semantic-focal',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Scene không có semantic focal subject.',
      });
    }

    const textFocal = textObjects.find((object) => object.role === 'focal');
    if (textFocal && semantic.length) {
      issues.push({
        code: 'text-focal-over-semantic',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Text đang làm focal dù scene có semantic object.',
      });
    }

    // Sub phim (caption-bottom) mang lời thoại dài là đúng ngữ pháp, không phạt.
    const subObjects = textObjects.filter((object) =>
      object.slot === 'caption-bottom' && object.sizeClass === 'medium',
    );
    if (textObjects.filter((object) => !subObjects.includes(object)).some((object) => wordCount(object.text || object.label) > 6)) {
      issues.push({
        code: 'text-heavy',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'On-screen text dài hơn 6 từ.',
      });
    }

    const abstractOnly = semantic.length === 0 && scene.objects.every((object) =>
      object.kind === 'text' || object.kind === 'shape',
    );
    if (abstractOnly || (scene.template === 'diagram-clean' && textObjects.length > 0)) titleLikeScenes += 1;

    const floating = scene.objects.filter((object) =>
      object.kind === 'prop'
      && ['sword', 'shield', 'crown'].includes(object.variant || '')
      && object.role !== 'focal',
    );
    if (floating.length && scene.objects.some((object) => object.kind === 'character')) {
      issues.push({
        code: 'floating-equipment',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Equipment prop đang đứng riêng cạnh character; nên gắn vào actor trừ khi chính prop là chủ thể.',
      });
    }

    const important = scene.objects.filter((object) =>
      object.role !== 'background'
      && object.kind !== 'text'
      && object.depth !== 'background',
    );
    for (let a = 0; a < important.length; a += 1) {
      for (let b = a + 1; b < important.length; b += 1) {
        const left=important[a]!,right=important[b]!;
        const attached=(prop:typeof left,actor:typeof left)=>
          (prop.heldBy===actor.id&&actor.kind==='character')
          ||(prop.tiedTo===actor.id&&actor.variant==='tree')
          ||(prop.onBoat===actor.id&&actor.kind==='ship')
          ||(prop.variant==='chair'&&actor.kind==='character'&&actor.pose==='sit'&&actor.sittingStyle!=='ground'&&Math.abs(prop.x-actor.x)<actor.width*.2);
        if(attached(left,right)||attached(right,left))continue;
        const ratio = overlapRatio(important[a]!, important[b]!);
        if (ratio > .58) {
          issues.push({
            code: 'large-overlap',
            severity: 'warning',
            sceneId: scene.id,
            sceneName: scene.name,
            message: `Hai semantic subject overlap quá lớn (${Math.round(ratio * 100)}%).`,
          });
          a = important.length;
          break;
        }
      }
    }

    const fingerprint = fingerprints[sceneIndex] || '';
    if (fingerprint === lastFingerprint) currentRun += 1;
    else {
      currentRun = 1;
      lastFingerprint = fingerprint;
    }
    maxFingerprintRun = Math.max(maxFingerprintRun, currentRun);
  });

  if (maxFingerprintRun >= 3) {
    issues.push({
      code: 'repeated-composition',
      severity: 'error',
      message: `Có composition fingerprint lặp ${maxFingerprintRun} beat liên tiếp.`,
    });
  }

  if (compiled.scenes.length >= 6 && templates.size < 3) {
    issues.push({
      code: 'low-template-variety',
      severity: 'error',
      message: `Video có ${compiled.scenes.length} scene nhưng chỉ dùng ${templates.size} scene template.`,
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const score = Math.max(0, 100 - errorCount * 18 - warningCount * 5);

  return {
    pass: errorCount === 0 && score >= 80,
    score,
    issues,
    stats: {
      scenes: compiled.scenes.length,
      uniqueTemplates: templates.size,
      uniqueFingerprints: uniqueFingerprints.size,
      maxFingerprintRun,
      titleLikeScenes,
      semanticObjects: semanticObjectCount,
      authoredObjects: authoredObjectCount,
      authoredCoverage: semanticObjectCount ? authoredObjectCount / semanticObjectCount : 1,
      authoredBackgrounds: authoredBackgroundCount,
      backgroundCoverage: compiled.scenes.length ? authoredBackgroundCount / compiled.scenes.length : 1,
      averageAssetDetail: authoredObjectCount ? assetDetailTotal / authoredObjectCount : 10,
      averageBackgroundDetail: authoredBackgroundCount ? backgroundDetailTotal / authoredBackgroundCount : 10,
      averageAnimationBeats: compiled.scenes.length ? animationBeatTotal / compiled.scenes.length : 0,
    },
  };
}
