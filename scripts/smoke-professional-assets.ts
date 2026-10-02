import { randomUUID } from 'node:crypto';
import type { AIProvider } from '../server/types';
import type { CanvasStudioProject } from '../shared/canvasAnimationStudio';
import { professionalizeCanvasProject } from '../server/services/canvasProfessionalAssets';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const gpt: AIProvider = {
  id: 'ima2-gpt-oauth',
  name: 'GPT Image · ChatGPT',
  baseUrl: 'local://ima2-gpt-oauth',
  enabled: true,
  models: [{ id: 'gpt-5.6-luna', name: 'GPT Image · gpt-5.6-luna' }],
  providerType: 'custom',
  authType: 'none',
  capabilities: {},
};

const project: CanvasStudioProject = {
  version: 1,
  id: randomUUID(),
  name: 'professional-assets-smoke',
  width: 640,
  height: 360,
  fps: 30,
  sourcePrompt: 'Bạch Đằng 1288',
  scenes: [{
    id: randomUUID(),
    name: 'Trần Hưng Đạo ra lệnh khi thủy triều rút',
    durationMs: 2200,
    background: 'river',
    narration: '',
    camera: { shot: 'medium', motion: 'push-in', focusX: 320, focusY: 190, zoom: 1 },
    effects: [{ id: randomUUID(), type: 'splash', x: 430, y: 280, scale: .65, intensity: 1, startMs: 1100, durationMs: 700, zIndex: 26 }],
    objects: [
      {
        id: randomUUID(), kind:'character', label:'Trần Hưng Đạo', characterKey:'tran-hung-dao', archetype:'warrior', hair:'hat',
        role:'focal', x:190, y:225, width:150, height:250, scale:1, rotation:0, opacity:1, color:'#a84d42',
        secondaryColor:'#606b69', accent:'#292624', skinTone:'#dfb18a', zIndex:20, motion:'slide-left', motionCurve:'cinematic',
        motionDurationMs:450, motionIntensity:1, delayMs:0, expression:'angry', pose:'point', facing:'right'
      },
      {
        id:randomUUID(), kind:'ship', label:'Chiến thuyền quân Nguyên', assetKey:'yuan-warship-side', role:'support',
        x:445,y:225,width:245,height:130,scale:1,rotation:0,opacity:1,color:'#80503a',secondaryColor:'#d1b88d',
        accent:'#302720',zIndex:15,motion:'drift-left',motionCurve:'smooth',motionDurationMs:600,motionIntensity:.8,delayMs:180
      },
      {
        id:randomUUID(),kind:'stake',label:'Cọc gỗ Bạch Đằng',assetKey:'bach-dang-stake',role:'support',
        x:410,y:295,width:44,height:150,scale:1,rotation:-10,opacity:1,color:'#6d4934',accent:'#34251e',
        zIndex:16,motion:'pop',motionCurve:'snappy',motionDurationMs:350,motionIntensity:1,delayMs:300
      }
    ]
  }]
};

const illustrated = await professionalizeCanvasProject(project, 'Bạch Đằng 1288, Trần Hưng Đạo dùng thủy triều và bãi cọc đánh quân Nguyên.', {
  enabled: true,
  quality: 'professional',
  generator: 'flow-agent',
  model: 'narwhal',
  fallback: { provider: gpt, model: 'gpt-5.6-luna' },
});

console.log('ASSET_REPORT', JSON.stringify(illustrated.assetPipeline, null, 2));
console.log('SCENE_ASSETS', JSON.stringify(illustrated.scenes.map(scene => ({
  backgroundAssetId: scene.backgroundAssetId,
  objects: scene.objects.map(o => ({kind:o.kind,label:o.label,assetId:o.assetId,imageUrl:o.imageUrl}))
})), null, 2));

const render = await renderCanvasAnimationProject(illustrated, 'professional-assets-smoke-gpt-serial-v5');
console.log('RENDER', JSON.stringify(render));
