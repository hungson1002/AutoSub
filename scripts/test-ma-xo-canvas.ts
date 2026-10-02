import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';
import { createCanvasObject, type CanvasStudioProject, type CanvasStudioScene } from '../shared/canvasAnimationStudio';
import { defaultTransform, type AnimationProject, type CompositeScene } from '../shared/animationStudio';
import { createEdgeTtsProvider } from '../src/lib/providers';
import { generateAnimationNarration } from '../server/services/animationAssets';
import { renderCanvasAnimationProject } from '../server/services/animationRender';

const now = new Date().toISOString();
const projectId = randomUUID();

const kf = (...frames: NonNullable<ReturnType<typeof createCanvasObject>['keyframes']>) => frames;
const effect = (type: any, startMs = 0, durationMs = 4000, intensity = 1) => ({
  id: randomUUID(), type, x: 640, y: 360, scale: 1, intensity, startMs, durationMs, zIndex: 90,
});

function actor(label: string, key: string, overrides: any = {}) {
  return createCanvasObject('character', {
    label, characterKey: key, archetype: overrides.archetype || 'villager',
    hair: overrides.hair || 'short', role: overrides.role || 'focal',
    slot: overrides.slot || 'hero-left', depth: overrides.depth || 'midground',
    sizeClass: overrides.sizeClass || 'large', motion: 'none',
    expression: overrides.expression || 'neutral', pose: overrides.pose || 'idle',
    facing: overrides.facing || 'right',
    color: overrides.color || '#7b6657', secondaryColor: overrides.secondaryColor || '#4e595b',
    skinTone: '#d6aa84', assetRef: 'character:' + (overrides.archetype || 'villager'),
    keyframes: overrides.keyframes,
  });
}

function prop(label: string, variant: any, slot: any, sizeClass: any = 'medium', overrides: any = {}) {
  return createCanvasObject('prop', {
    label, variant, assetRef: 'prop:' + variant, role: overrides.role || 'support',
    slot, depth: overrides.depth || 'midground', sizeClass, motion: 'none',
    color: overrides.color || '#7d5d44', secondaryColor: overrides.secondaryColor || '#a37f5d',
    keyframes: overrides.keyframes,
  });
}

function scene(input: Partial<CanvasStudioScene> & Pick<CanvasStudioScene, 'name' | 'durationMs' | 'background' | 'objects'>): CanvasStudioScene {
  return {
    id: randomUUID(),
    template: input.template || 'wide-establishing',
    backgroundRef: input.backgroundRef,
    visualBrief: input.visualBrief,
    narration: input.narration || '',
    camera: input.camera || { shot: 'wide', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
    effects: input.effects || [],
    animationBeats: input.animationBeats || [],
    ...input,
  };
}

function narrationProject(project: CanvasStudioProject): AnimationProject {
  const stamp = new Date().toISOString();
  const scenes: CompositeScene[] = project.scenes.map((s, order) => ({
    id: s.id, name: s.name, order, durationMs: s.durationMs, narration: s.narration || '',
    renderMode: 'composite', backgroundColor: '#ffffff', layers: [], commands: [],
    camera: { transform: defaultTransform(), commands: [] },
  }));
  return {
    schemaVersion: 1, id: project.id, name: project.name, width: project.width, height: project.height,
    fps: project.fps, createdAt: stamp, updatedAt: stamp, assets: [], scenes,
  };
}

function attachNarration(project: CanvasStudioProject, voiced: AnimationProject): CanvasStudioProject {
  const assets = new Map(voiced.assets.map((asset) => [asset.id, asset]));
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    scenes: project.scenes.map((s) => {
      const source = voiced.scenes.find((item) => item.id === s.id);
      if (!source || source.renderMode !== 'composite') return s;
      const audioLayer = source.layers.find((layer) => layer.type === 'audio' && layer.visible && layer.assetId);
      const asset = audioLayer?.assetId ? assets.get(audioLayer.assetId) : undefined;
      const oldDuration = Math.max(1, s.durationMs);
      const nextDuration = Math.max(1, source.durationMs);
      const ratio = nextDuration / oldDuration;
      return {
        ...s,
        durationMs: nextDuration,
        animationBeats: (s.animationBeats || []).map((beat) => {
          const atMs = Math.min(Math.max(0, Math.round(beat.atMs * ratio)), Math.max(0, nextDuration - 120));
          return { ...beat, atMs, durationMs: Math.max(120, Math.min(Math.round(beat.durationMs * ratio), nextDuration - atMs)) };
        }),
        ...(asset ? { audioUrl: asset.uri } : {}),
      };
    }),
  };
}

const boy = (overrides: any = {}) => actor('Minh', 'minh-main', {
  archetype: 'worker', hair: 'short', color: '#66747a', secondaryColor: '#3e484c', ...overrides,
});
const woman = (overrides: any = {}) => actor('Bà chủ', 'ba-chu', {
  archetype: 'villager', hair: 'bun', color: '#79604f', secondaryColor: '#51463f', ...overrides,
});

const scenes: CanvasStudioScene[] = [
  scene({
    name: 'Nhà sàn giữa núi', durationMs: 4800, background: 'night', backgroundRef: 'bg:night-stilt-house',
    template: 'wide-establishing',
    narration: 'Tôi lên một bản vùng cao làm thuê, ở nhờ trong căn nhà sàn nằm tách khỏi cả bản.',
    camera: { shot:'wide', motion:'none', focusX:640, focusY:350, zoom:1.02, keyframes:[
      {atMs:0, zoom:1}, {atMs:4800, zoom:1.11, dy:-12, easing:'ease-in-out'}
    ]},
    effects:[effect('vignette',0,4800,1.3), effect('smoke',600,4200,.45)],
    objects:[
      prop('Tre trước nhà','bamboo','foreground-left','large',{role:'focal',depth:'foreground', keyframes:[
        {atMs:0, dx:0, rotation:-1},{atMs:2400,dx:10,rotation:1},{atMs:4800,dx:0,rotation:-1}
      ]}),
      boy({slot:'support-right', role:'support', sizeClass:'medium', keyframes:[{atMs:0,dx:70,opacity:0},{atMs:900,dx:0,opacity:1,easing:'ease-out'}]}),
    ],
  }),
  scene({
    name:'Lời dặn', durationMs:5200, background:'room', backgroundRef:'bg:room-stilt-house', template:'two-shot',
    narration:'Tối đầu tiên, bà chủ chỉ dặn một câu: nửa đêm nghe tiếng gõ dưới gầm sàn thì tuyệt đối đừng cúi xuống nhìn.',
    camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1.02,keyframes:[{atMs:0,zoom:1},{atMs:5200,zoom:1.08}]},
    effects:[effect('vignette',0,5200,1.1),{...effect('flashlight',0,5200,.72),x:505,y:390,scale:1.4}],
    objects:[
      woman({slot:'hero-left',role:'focal',pose:'talk',facing:'right',keyframes:[
        {atMs:0,pose:'idle'},{atMs:450,pose:'talk',expression:'neutral'},{atMs:3900,pose:'point',expression:'sad'}
      ]}),
      boy({slot:'hero-right',role:'support',facing:'left',expression:'neutral',keyframes:[{atMs:0},{atMs:3600,expression:'surprised'}]}),
      prop('Bếp lửa','fire','foreground-left','medium',{depth:'foreground'}),
    ],
  }),
  scene({
    name:'Nằm ngủ', durationMs:4300, background:'room', backgroundRef:'bg:room-stilt-house', template:'hero-left',
    narration:'Tôi nghĩ đó chỉ là lời dọa trẻ con. Đêm xuống, căn nhà yên đến mức nghe rõ tiếng gỗ co lại vì lạnh.',
    camera:{shot:'medium',motion:'none',focusX:390,focusY:420,zoom:1.06,keyframes:[{atMs:0,zoom:1},{atMs:4300,zoom:1.1,dx:-25}]},
    effects:[effect('vignette',0,4300,1.35)],
    objects:[
      prop('Giường gỗ','bed','hero-left','hero',{role:'focal',color:'#6d5142'}),
      boy({slot:'mid-left',role:'support',sizeClass:'medium',pose:'idle',keyframes:[{atMs:0,dy:12,rotation:0},{atMs:4300,dy:8,rotation:-2}]}),
      prop('Cửa gỗ','door','background-right','large',{depth:'background',color:'#49382f'}),
      prop('Bếp lửa','fire','foreground-right','small',{depth:'foreground'}),
    ],
  }),
  scene({
    name:'Tiếng gõ đầu tiên', durationMs:4400, background:'room', backgroundRef:'bg:room-stilt-house', template:'close-reaction',
    narration:'Rồi... cộc. Cộc. Cộc. Tiếng gõ vọng lên từ ngay dưới sàn.',
    camera:{shot:'close-up',motion:'none',focusX:640,focusY:370,zoom:1.08,keyframes:[{atMs:0,zoom:1},{atMs:3000,zoom:1.17},{atMs:4400,zoom:1.2}]},
    effects:[effect('vignette',0,4400,1.5),effect('impact',900,500,.35),effect('impact',2100,500,.4),effect('impact',3250,500,.45)],
    objects:[
      boy({slot:'hero',role:'focal',sizeClass:'hero',expression:'surprised',pose:'idle',keyframes:[
        {atMs:0,dy:5},{atMs:1100,dy:-4,rotation:-1},{atMs:2200,dy:2,rotation:1},{atMs:3400,dy:-5,rotation:-1}
      ]}),
    ],
  }),
  scene({
    name:'Sàn gỗ', durationMs:3900, background:'room', backgroundRef:'bg:room-underfloor', template:'prop-focus',
    narration:'Nó chậm rãi di chuyển từ cột này sang cột khác, như thể có thứ gì đang tìm đúng chỗ tôi nằm.',
    camera:{shot:'extreme-close-up',motion:'none',focusX:640,focusY:420,zoom:1.12,keyframes:[{atMs:0,dx:-90},{atMs:3900,dx:95,easing:'ease-in-out'}]},
    effects:[effect('vignette',0,3900,1.7),effect('dust',0,3900,.28)],
    objects:[
      prop('Ván sàn','floorboard','hero','hero',{role:'focal',color:'#4d392f',secondaryColor:'#6c5140',keyframes:[{atMs:0,rotation:-1},{atMs:3900,rotation:1}]}),
    ],
  }),
  scene({
    name:'Bếp lửa yếu dần', durationMs:3800, background:'room', backgroundRef:'bg:room-stilt-house', template:'prop-focus',
    narration:'Ngọn lửa trong bếp bỗng yếu đi. Bóng trong phòng kéo dài hơn bình thường.',
    camera:{shot:'close-up',motion:'none',focusX:520,focusY:420,zoom:1.05,keyframes:[{atMs:0,zoom:1},{atMs:3800,zoom:1.13}]},
    effects:[effect('vignette',0,3800,1.65),{...effect('flashlight',0,3800,.5),x:500,y:420,scale:1.0}],
    objects:[
      prop('Bếp lửa','fire','hero','large',{role:'focal',keyframes:[{atMs:0,scale:1,opacity:1},{atMs:2500,scale:.72,opacity:.72,easing:'ease-in-out'},{atMs:3800,scale:.58,opacity:.55}]}),
      prop('Cửa gỗ','door','background-right','large',{depth:'background',color:'#3c302b'}),
    ],
  }),
  scene({
    name:'Cào mặt ván', durationMs:4100, background:'room', backgroundRef:'bg:room-underfloor', template:'foreground-pov',
    narration:'Tiếng gõ im bặt. Thay vào đó là tiếng móng tay cào rất nhẹ... ngay dưới mặt ván.',
    camera:{shot:'pov',motion:'none',focusX:640,focusY:470,zoom:1.05,keyframes:[{atMs:0,zoom:1},{atMs:4100,zoom:1.15,dy:35}]},
    effects:[effect('vignette',0,4100,1.8),effect('dust',500,3200,.22)],
    objects:[
      prop('Ván sàn','floorboard','foreground-left','hero',{role:'focal',depth:'foreground',color:'#49372f',keyframes:[{atMs:0,rotation:0},{atMs:1100,rotation:.5},{atMs:2200,rotation:-.6},{atMs:3300,rotation:.4}]}),
      boy({slot:'background-right',role:'support',sizeClass:'small',depth:'background',expression:'surprised'}),
    ],
  }),
  scene({
    name:'Giọng nói dưới sàn', durationMs:4800, background:'room', backgroundRef:'bg:room-stilt-house', template:'close-reaction',
    narration:'Rồi một giọng phụ nữ khàn khàn vang lên phía dưới: Cho xin... bát nước.',
    camera:{shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1.12,keyframes:[{atMs:0,zoom:1},{atMs:4800,zoom:1.18}]},
    effects:[effect('vignette',0,4800,1.9),{...effect('flashlight',0,4800,.42),x:640,y:370,scale:.85}],
    objects:[
      boy({slot:'hero',role:'focal',sizeClass:'hero',pose:'idle',expression:'surprised',keyframes:[{atMs:0},{atMs:2200,dx:10,rotation:1},{atMs:3200,dx:-8,rotation:-1}]}),
      prop('Bát nước','bowl','foreground-right','medium',{depth:'foreground',keyframes:[{atMs:0,opacity:0,scale:.7},{atMs:2800,opacity:.72,scale:1,easing:'ease-out'}]}),

    ],
  }),
  scene({
    name:'Không trả lời', durationMs:3800, background:'room', backgroundRef:'bg:room-stilt-house', template:'hero-right',
    narration:'Tôi nín thở, kéo chăn lên tới mắt và không dám trả lời.',
    camera:{shot:'medium',motion:'none',focusX:820,focusY:430,zoom:1.05,keyframes:[{atMs:0,zoom:1.03},{atMs:3800,zoom:1.12,dx:40}]},
    effects:[effect('vignette',0,3800,1.8)],
    objects:[
      prop('Giường gỗ','bed','hero-right','hero',{role:'focal',color:'#5f493d'}),
      boy({slot:'mid-right',role:'support',sizeClass:'medium',pose:'idle',expression:'surprised',keyframes:[{atMs:0,dy:10},{atMs:3800,dy:4}]}),
      prop('Bóng tối ở cửa','door','background-left','large',{depth:'background',color:'#332a27'}),
    ],
  }),
  scene({
    name:'Sáng hôm sau', durationMs:4400, background:'room', backgroundRef:'bg:room-stilt-house', template:'two-shot',
    narration:'Sáng hôm sau, tôi kể lại. Bà chủ không cười. Bà chỉ nhìn tôi rất lâu.',
    camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1.0,keyframes:[{atMs:0,zoom:1},{atMs:4400,zoom:1.07}]},
    effects:[{...effect('vignette',0,4400,.55),color:'#50483f'}],
    objects:[
      boy({slot:'hero-left',role:'support',facing:'right',expression:'sad'}),
      woman({slot:'hero-right',role:'focal',facing:'left',expression:'sad',keyframes:[{atMs:0},{atMs:2300,pose:'talk'}]}),
      prop('Bát nước','bowl','foreground-left','small',{depth:'foreground'}),
    ],
  }),
  scene({
    name:'Câu kết', durationMs:5200, background:'night', backgroundRef:'bg:night-stilt-house', template:'wide-establishing',
    narration:'Rồi bà nói nhỏ: Đêm qua không ai thức. Và dưới gầm sàn này... chưa từng có ai sống cả.',
    camera:{shot:'wide',motion:'none',focusX:640,focusY:350,zoom:1.02,keyframes:[{atMs:0,zoom:1},{atMs:5200,zoom:1.14,easing:'ease-in-out'}]},
    effects:[effect('vignette',0,5200,1.75),effect('smoke',0,5200,.38)],
    objects:[
      prop('Tre trước nhà','bamboo','foreground-left','large',{role:'focal',depth:'foreground',keyframes:[{atMs:0,rotation:-1},{atMs:2600,rotation:1},{atMs:5200,rotation:-1}]}),
    ],
  }),
];

const raw: CanvasStudioProject = {
  version:1,
  id:projectId,
  name:'Ma Xó Canvas Pilot',
  width:1280,
  height:720,
  fps:30,
  createdAt:now,
  updatedAt:now,
  sourcePrompt:'Truyện kể bí ẩn phong cách Ma Xó, code-first Canvas animation.',
  scenes,
};

const project = compileCanvasProjectLayout(raw);
const outDir = path.resolve('tmp/ma-xo-pilot');
await mkdir(outDir,{recursive:true});
console.log('Generating Vietnamese voiceover...');
const voiced = await generateAnimationNarration({
  project: narrationProject(project),
  provider: createEdgeTtsProvider(),
  model: 'edge-tts',
  voice: 'vi-VN-NamMinhNeural',
  speed: 0.9,
  preservePlannedDuration: false,
  includeSubtitles: false,
});
const finalProject = attachNarration(project, voiced);
await writeFile(path.join(outDir,'project.json'),JSON.stringify(finalProject,null,2),'utf8');
const result = await renderCanvasAnimationProject(finalProject, undefined, (p)=> {
  if (Math.round(p*100)%20===0) process.stdout.write('.');
});
const target = path.join(outDir,'ma-xo-pilot.mp4');
await copyFile(result.path,target);
console.log('\nPILOT_PROJECT=' + finalProject.id);
console.log('PILOT_VIDEO=' + target);
console.log('SOURCE_VIDEO=' + result.path);
