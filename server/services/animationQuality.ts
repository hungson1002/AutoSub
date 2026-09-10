import type { AnimationProject } from '../../shared/animationStudio';

export interface AnimationQualityIssue { severity: 'error' | 'warning'; code: string; sceneId: string; layerId?: string; message: string }

// Recognize only the old generated overlays, never arbitrary user-authored circles/arrows.
export const isLegacyAnimationAccent = (layer: { id: string; name: string }) => /^motion-accent-\d+$/.test(layer.id) && ['Hạt chuyển động', 'Hướng chuyển động', 'Điểm nhấn'].includes(layer.name);

export function checkAnimationQuality(project: AnimationProject): AnimationQualityIssue[] {
  const issues: AnimationQualityIssue[] = [];
  for (const scene of project.scenes) {
    if (scene.renderMode !== 'composite') continue;
    if (!scene.layers.length) issues.push({ severity: 'error', code: 'EMPTY_SCENE', sceneId: scene.id, message: 'Scene không có layer.' });
    if (!scene.commands.length && !scene.camera.commands.length && scene.durationMs > 2500) issues.push({ severity: 'warning', code: 'STATIC_SCENE', sceneId: scene.id, message: 'Scene dài nhưng không có chuyển động hoặc camera.' });
    const illustrated = scene.layers.some((layer) => layer.visible && layer.type === 'image' && layer.width >= project.width * .8 && layer.height >= project.height * .8);
    const performance = scene.commands.some((command) => {
      const layer = scene.layers.find((item) => item.id === command.targetId && item.visible);
      const cue = command.parameters?.narrationCue;
      const grounded = typeof cue === 'string' && cue.trim().length >= 4 && scene.narration.includes(cue) && typeof command.parameters?.motionPurpose === 'string' && command.parameters.motionPurpose.trim().length > 0;
      const changes = command.from !== undefined && command.to !== undefined && JSON.stringify(command.from) !== JSON.stringify(command.to);
      return layer && !isLegacyAnimationAccent(layer) && grounded && ((layer.type === 'sprite' && command.type === 'PLAY_ANIMATION' && project.assets.find((asset) => asset.id === layer.assetId)?.sprite?.clips[command.animation || '']) || (['shape', 'diagram', 'chart'].includes(layer.type) && ['MOVE', 'SCALE', 'ROTATE'].includes(command.type) && changes));
    });
    if (illustrated && !performance && scene.durationMs > 2500) issues.push({ severity: 'warning', code: 'SLIDESHOW_ONLY', sceneId: scene.id, message: 'Cảnh chỉ chuyển/zoom ảnh minh họa, chưa có chuyển động đối tượng. Cần sprite, sơ đồ có tiến trình hoặc clip video thật.' });
    for (const layer of scene.layers) {
      if (isLegacyAnimationAccent(layer)) issues.push({ severity: 'warning', code: 'DECORATIVE_MOTION', sceneId: scene.id, layerId: layer.id, message: 'Hiệu ứng trang trí tự chèn cũ không gắn với nội dung. Sửa chất lượng sẽ bỏ riêng lớp này.' });
      if (!isLegacyAnimationAccent(layer) && ['shape', 'diagram', 'chart', 'sprite'].includes(layer.type) && scene.commands.some((command) => {
        if (command.targetId !== layer.id || !['MOVE', 'SCALE', 'ROTATE', 'PLAY_ANIMATION'].includes(command.type)) return false;
        const cue = command.parameters?.narrationCue;
        return typeof cue !== 'string' || cue.trim().length < 4 || !scene.narration.includes(cue) || !String(command.parameters?.motionPurpose || '').trim();
      })) issues.push({ severity: 'warning', code: 'UNGROUNDED_MOTION', sceneId: scene.id, layerId: layer.id, message: `${layer.name}: chuyển động chưa gắn với câu lời dẫn và hành động cụ thể; cần kiểm tra nội dung.` });
      const halfWidth = layer.width * Math.abs(layer.transform.scale.x) / 2; const halfHeight = layer.height * Math.abs(layer.transform.scale.y) / 2;
      if (layer.type !== 'audio' && (layer.transform.position.x + halfWidth < 0 || layer.transform.position.x - halfWidth > project.width || layer.transform.position.y + halfHeight < 0 || layer.transform.position.y - halfHeight > project.height)) issues.push({ severity: 'error', code: 'OFFSCREEN_LAYER', sceneId: scene.id, layerId: layer.id, message: `${layer.name} nằm hoàn toàn ngoài khung hình.` });
      if (layer.type === 'text' && (layer.text || '').length > 160) issues.push({ severity: 'warning', code: 'LONG_TEXT', sceneId: scene.id, layerId: layer.id, message: `${layer.name} có quá nhiều chữ cho một cảnh.` });
      if (layer.assetId && !project.assets.some((asset) => asset.id === layer.assetId)) issues.push({ severity: 'error', code: 'MISSING_ASSET', sceneId: scene.id, layerId: layer.id, message: `${layer.name} tham chiếu asset không tồn tại.` });
    }
    // A full-frame background is expected to overlap every foreground layer;
    // including it here makes the checker report false positives for every
    // normal composite scene. Only compare foreground visual elements.
    const visible = scene.layers.filter((layer) => {
      if (!layer.visible || ['audio', 'text'].includes(layer.type)) return false;
      if (layer.type !== 'image') return true;
      const asset = layer.assetId ? project.assets.find((item) => item.id === layer.assetId) : undefined;
      return !(asset?.type === 'background' || (layer.width >= project.width * .8 && layer.height >= project.height * .8));
    });
    for (let index = 0; index < visible.length; index += 1) for (let other = index + 1; other < visible.length; other += 1) {
      const a = visible[index], b = visible[other]; const overlapX = Math.min(a.transform.position.x + a.width / 2, b.transform.position.x + b.width / 2) - Math.max(a.transform.position.x - a.width / 2, b.transform.position.x - b.width / 2); const overlapY = Math.min(a.transform.position.y + a.height / 2, b.transform.position.y + b.height / 2) - Math.max(a.transform.position.y - a.height / 2, b.transform.position.y - b.height / 2);
      if (overlapX > Math.min(a.width, b.width) * .7 && overlapY > Math.min(a.height, b.height) * .7) issues.push({ severity: 'warning', code: 'HEAVY_OVERLAP', sceneId: scene.id, layerId: b.id, message: `${a.name} và ${b.name} chồng lên nhau quá nhiều.` });
    }
  }
  return issues;
}

export function autoFixAnimationQuality(project: AnimationProject) {
  const issues = checkAnimationQuality(project); const byScene = new Map<string, AnimationQualityIssue[]>(); issues.forEach((issue) => byScene.set(issue.sceneId, [...(byScene.get(issue.sceneId) || []), issue]));
  const scenes = project.scenes.map((scene) => { if (scene.renderMode !== 'composite') return scene; const sceneIssues = byScene.get(scene.id) || []; const removed = new Set(scene.layers.filter(isLegacyAnimationAccent).map((layer) => layer.id)); let layers = scene.layers.filter((layer) => !removed.has(layer.id)).map((layer) => {
    const layerIssues = sceneIssues.filter((issue) => issue.layerId === layer.id); let next = { ...layer, transform: { ...layer.transform, position: { ...layer.transform.position } } };
    if (layerIssues.some((issue) => issue.code === 'OFFSCREEN_LAYER')) next.transform.position = { x: Math.max(0, Math.min(project.width, next.transform.position.x)), y: Math.max(0, Math.min(project.height, next.transform.position.y)) };
    return next;
  });
  return { ...scene, layers, commands: scene.commands.filter((command) => !removed.has(command.targetId)) };
  });
  const remaining = checkAnimationQuality({ ...project, scenes });
  const identity = (issue: AnimationQualityIssue) => JSON.stringify([issue.sceneId, issue.layerId, issue.code]);
  const remainingIds = new Set(remaining.map(identity));
  return { project: { ...project, scenes, updatedAt: new Date().toISOString() }, fixed: issues.filter((issue) => !remainingIds.has(identity(issue))).length, remaining };
}
