import type { CanvasStudioProject, CanvasStudioScene } from '../../shared/canvasAnimationStudio';
import { fetchRealImagePack, type RealImageAsset } from './realImageTool';

export type TopicPackRequest = {
  sceneId: string;
  keywords: string[];
  allowBackground?: boolean;
};

function isMapKeyword(keyword: string): boolean {
  return /bản đồ|bản do|map|trận|so đồ|sơ đồ/i.test(keyword);
}

export function assignRealImagesToProject(
  project: CanvasStudioProject,
  packByScene: Map<string, RealImageAsset[]>,
): CanvasStudioProject {
  const scenes = project.scenes.map((scene) => {
    const pack = packByScene.get(scene.id) || [];
    if (!pack.length) return scene;
    let remaining = [...pack];
    const objects = scene.objects.map((object) => {
      if (!remaining.length) return object;
      const wantsImage = object.kind === 'image' && !object.imageUrl;
      if (!wantsImage) return object;
      const [asset, ...rest] = remaining;
      remaining = rest;
      return {
        ...object,
        imageUrl: asset.localPath || asset.imageUrl,
        assetKey: object.assetKey || asset.id,
        credit: asset.credit,
      };
    });
    let { backgroundImageUrl, backgroundCredit, backgroundAssetId } = scene;
    if (!backgroundImageUrl && remaining.length) {
      const mapFirst = [...remaining].sort((a, b) => Number(isMapKeyword(b.title)) - Number(isMapKeyword(a.title)))[0];
      backgroundImageUrl = mapFirst.localPath || mapFirst.imageUrl;
      backgroundCredit = mapFirst.credit;
      backgroundAssetId = backgroundAssetId || mapFirst.id;
      remaining = remaining.filter((item) => item.id !== mapFirst.id);
    }
    void remaining;
    return { ...scene, backgroundImageUrl, backgroundCredit, backgroundAssetId, objects };
  });
  return { ...project, updatedAt: new Date().toISOString(), scenes };
}

export async function buildTopicPack(
  project: CanvasStudioProject,
  requests: TopicPackRequest[],
  options: { perKeyword?: number; signal?: AbortSignal } = {},
): Promise<CanvasStudioProject> {
  const packByScene = new Map<string, RealImageAsset[]>();
  for (const request of requests) {
    const scene: CanvasStudioScene | undefined = project.scenes.find((s) => s.id === request.sceneId);
    if (!scene) continue;
    const keywords = request.keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 3);
    if (!keywords.length) continue;
    const pack = await fetchRealImagePack(keywords, { perKeyword: options.perKeyword ?? 1, signal: options.signal });
    if (pack.length) packByScene.set(request.sceneId, pack);
  }
  return assignRealImagesToProject(project, packByScene);
}
