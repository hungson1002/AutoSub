import type { AnimationProject } from '../../shared/animationStudio';

export interface AnimationQualityIssue { severity: 'error' | 'warning'; code: string; sceneId: string; layerId?: string; message: string }

export function checkAnimationQuality(project: AnimationProject): AnimationQualityIssue[] {
  const issues: AnimationQualityIssue[] = [];
  for (const scene of project.scenes) {
    if (scene.renderMode !== 'composite') continue;
    if (!scene.layers.length) issues.push({ severity: 'error', code: 'EMPTY_SCENE', sceneId: scene.id, message: 'Scene không có layer.' });
    if (!scene.commands.length && !scene.camera.commands.length && scene.durationMs > 2500) issues.push({ severity: 'warning', code: 'STATIC_SCENE', sceneId: scene.id, message: 'Scene dài nhưng không có chuyển động hoặc camera.' });
    for (const layer of scene.layers) {
      const halfWidth = layer.width * layer.transform.scale.x / 2; const halfHeight = layer.height * layer.transform.scale.y / 2;
      if (layer.type !== 'audio' && (layer.transform.position.x + halfWidth < 0 || layer.transform.position.x - halfWidth > project.width || layer.transform.position.y + halfHeight < 0 || layer.transform.position.y - halfHeight > project.height)) issues.push({ severity: 'error', code: 'OFFSCREEN_LAYER', sceneId: scene.id, layerId: layer.id, message: `${layer.name} nằm hoàn toàn ngoài khung hình.` });
      if (layer.type === 'text' && (layer.text || '').length > 160) issues.push({ severity: 'warning', code: 'LONG_TEXT', sceneId: scene.id, layerId: layer.id, message: `${layer.name} có quá nhiều chữ cho một cảnh.` });
      if (layer.assetId && !project.assets.some((asset) => asset.id === layer.assetId)) issues.push({ severity: 'error', code: 'MISSING_ASSET', sceneId: scene.id, layerId: layer.id, message: `${layer.name} tham chiếu asset không tồn tại.` });
    }
    const visible = scene.layers.filter((layer) => layer.visible && !['audio', 'text'].includes(layer.type));
    for (let index = 0; index < visible.length; index += 1) for (let other = index + 1; other < visible.length; other += 1) {
      const a = visible[index], b = visible[other]; const overlapX = Math.min(a.transform.position.x + a.width / 2, b.transform.position.x + b.width / 2) - Math.max(a.transform.position.x - a.width / 2, b.transform.position.x - b.width / 2); const overlapY = Math.min(a.transform.position.y + a.height / 2, b.transform.position.y + b.height / 2) - Math.max(a.transform.position.y - a.height / 2, b.transform.position.y - b.height / 2);
      if (overlapX > Math.min(a.width, b.width) * .7 && overlapY > Math.min(a.height, b.height) * .7) issues.push({ severity: 'warning', code: 'HEAVY_OVERLAP', sceneId: scene.id, layerId: b.id, message: `${a.name} và ${b.name} chồng lên nhau quá nhiều.` });
    }
  }
  return issues;
}

export function autoFixAnimationQuality(project: AnimationProject) {
  const issues = checkAnimationQuality(project); const byScene = new Map<string, AnimationQualityIssue[]>(); issues.forEach((issue) => byScene.set(issue.sceneId, [...(byScene.get(issue.sceneId) || []), issue]));
  const scenes = project.scenes.map((scene) => { if (scene.renderMode !== 'composite') return scene; const sceneIssues = byScene.get(scene.id) || []; let layers = scene.layers.map((layer) => {
    const layerIssues = sceneIssues.filter((issue) => issue.layerId === layer.id); let next = { ...layer, transform: { ...layer.transform, position: { ...layer.transform.position } } };
    if (layerIssues.some((issue) => issue.code === 'OFFSCREEN_LAYER')) next.transform.position = { x: Math.max(0, Math.min(project.width, next.transform.position.x)), y: Math.max(0, Math.min(project.height, next.transform.position.y)) };
    if (layerIssues.some((issue) => issue.code === 'LONG_TEXT') && next.text) next.text = `${next.text.slice(0, 157).trim()}…`;
    if (layerIssues.some((issue) => issue.code === 'MISSING_ASSET')) next = { ...next, type: 'shape', assetId: undefined, shape: 'rectangle', fill: next.fill || '#ff8a45' };
    if (layerIssues.some((issue) => issue.code === 'HEAVY_OVERLAP')) next.transform.position = { x: Math.max(next.width / 2, Math.min(project.width - next.width / 2, next.transform.position.x + Math.min(project.width * .18, next.width * .75))), y: next.transform.position.y };
    return next;
  });
  if (sceneIssues.some((issue) => issue.code === 'EMPTY_SCENE')) layers = [{ id: `quality-placeholder-${scene.id}`, name: 'Nội dung cần bổ sung', type: 'text', text: scene.narration || 'Cảnh cần bổ sung nội dung', visible: true, locked: false, zIndex: 1, width: project.width * .7, height: 120, fill: '#ffffff', fontSize: 48, transform: { position: { x: project.width / 2, y: project.height / 2 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }];
  const camera = sceneIssues.some((issue) => issue.code === 'STATIC_SCENE') ? { ...scene.camera, commands: [...scene.camera.commands, { id: `quality-zoom-${scene.id}`, type: 'ZOOM_IN' as const, targetId: 'camera', startMs: 0, durationMs: scene.durationMs, easing: 'ease-in-out' as const, from: { x: 1, y: 1 }, to: { x: 1.06, y: 1.06 } }] } : scene.camera;
  return { ...scene, layers, camera };
  });
  return { project: { ...project, scenes, updatedAt: new Date().toISOString() }, fixed: issues.length, remaining: checkAnimationQuality({ ...project, scenes }) };
}
