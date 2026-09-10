import { randomUUID } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { generateAnimationNarration, getAnimationAssetFile } from '../server/services/animationAssets';
import type { AIProvider } from '../server/types';
import { buildBeatPerformances, buildVisualBeatTimeline, type LongAnimationSegment } from '../server/services/animationDirector';
import { compileAnimationProductionPlan } from '../server/services/animationPlan';
import { allocateNarrationTimings } from '../server/services/animationTiming';
import { renderAnimationProject } from '../server/services/animationRender';
import { checkAnimationQuality } from '../server/services/animationQuality';
import { withAnimationAssetManifest } from '../server/services/animationManifest';
import { run, workdir } from '../server/services/ffmpeg';
import { defaultTransform, type AnimationAsset, type AnimationProject, type CompositeScene, type SceneLayer } from '../shared/animationStudio';
import { buildRenderTimeline } from '../src/remotion/timeline';

/**
 * M3 offline pilot. It deliberately does not call an image/video generation API:
 * the backgrounds are deterministic SVG->PNG proxies so timing, staging, export
 * and QA can be reviewed without spending Flow credits.
 */
const width = 1280;
const height = 720;
const fps = 30;
const pilotRoot = path.join(workdir, 'animation-pilot-30s');
const pilotVoice: AIProvider = {
  id: 'animation-pilot-edge-tts',
  name: 'Microsoft Edge TTS (pilot)',
  baseUrl: 'local://edge-tts',
  enabled: true,
  models: [],
  providerType: 'edge-tts',
  authType: 'none',
  capabilities: { tts: true },
};

const narration = [
  'Nếu Mặt Trăng biến mất đêm nay, bầu trời vẫn còn đó, nhưng nhịp sống trên Trái Đất sẽ đổi khác.',
  'Không có vụ nổ: Mặt Trăng chỉ biến mất, còn Trái Đất vẫn tiếp tục quỹ đạo.',
  'Thủy triều yếu hơn vì mất lực kéo chính từ Mặt Trăng; Mặt Trời vẫn góp một phần.',
  'Các loài theo chu kỳ trăng mất tín hiệu quen thuộc; đêm tối hơn, định hướng cũng đổi.',
  'Trái Đất không vỡ tung. Đây là thay đổi chậm, lớn, và hệ sinh thái phải thích nghi.',
];

const point = (t: number, x: number, y: number, rotation = 0) => ({ t, x, y, rotation });
const orbit = (radiusX: number, radiusY: number, centerX = .5, centerY = .5) => Array.from({ length: 13 }, (_, index) => {
  const angle = index / 12 * Math.PI * 2;
  return point(index / 12, centerX + radiusX * Math.cos(angle), centerY + radiusY * Math.sin(angle));
});

const pilotSegments: LongAnimationSegment[] = [
  {
    title: 'Một bầu trời không còn Mặt Trăng',
    narration: narration[0],
    motionGraphic: 'none',
    visualBeats: [{
      purpose: 'Mở câu hỏi',
      narrationCue: 'Nếu Mặt Trăng biến mất đêm nay',
      action: 'Mặt Trăng đi hết một vòng quanh Trái Đất để đặt giả định vào đúng bối cảnh.',
      visual: 'Trái Đất và Mặt Trăng trong không gian đêm, một quỹ đạo rõ ràng, không chữ.',
      motion: 'push',
      transition: 'cut',
      objects: [{ name: 'Quỹ đạo Mặt Trăng', shape: 'ellipse', fill: '#8bd9ff', width: .012, height: .012, path: orbit(.28, .16, .5, .52) }],
    }],
  },
  {
    title: 'Không có vụ nổ tức thời',
    narration: narration[1],
    motionGraphic: 'none',
    visualBeats: [{
      purpose: 'Phân biệt giả định',
      narrationCue: 'Không có vụ nổ',
      action: 'Hai thẻ đối chiếu lần lượt cho thấy bối cảnh vẫn ổn định và Mặt Trăng không còn trong khung.',
      visual: 'Trái Đất vẫn nguyên vẹn trong không gian, không chữ.',
      motion: 'locked',
      transition: 'crossfade',
      diagram: { layout: 'comparison', steps: ['Trái Đất vẫn nguyên vẹn', 'Mặt Trăng không còn phản chiếu'] },
    }],
  },
  {
    title: 'Thủy triều đổi nhịp',
    narration: narration[2],
    motionGraphic: 'none',
    visualBeats: [{
      purpose: 'Giải thích lực kéo',
      narrationCue: 'Thủy triều yếu hơn',
      action: 'Hai vùng nước phồng ra rồi thu lại để minh họa lực kéo của Mặt Trăng giảm, không phải đại dương biến mất.',
      visual: 'Trái Đất nhìn nghiêng với đại dương xanh và vùng nước phồng nhẹ, không chữ.',
      motion: 'locked',
      transition: 'match-cut',
      objects: [{ name: 'Vùng nước thủy triều', shape: 'ellipse', fill: '#53c9ec', width: .2, height: .09, path: [point(0, .72, .68), point(.5, .64, .68), point(1, .72, .68)] }],
      diagram: { layout: 'process', steps: ['Lực kéo Mặt Trăng giảm', 'Thủy triều yếu hơn', 'Mặt Trời còn góp một phần'] },
    }],
  },
  {
    title: 'Tín hiệu của sự sống thay đổi',
    narration: narration[3],
    motionGraphic: 'none',
    visualBeats: [{
      purpose: 'Hệ sinh thái',
      narrationCue: 'Các loài theo chu kỳ trăng mất tín hiệu quen thuộc',
      action: 'Các điểm đánh dấu sinh học di chuyển theo chu kỳ rồi lệch khỏi nhịp cũ, không dùng mũi tên trang trí.',
      visual: 'Bờ biển về đêm, một vùng sáng dịu trên Trái Đất và nền sao, không chữ.',
      motion: 'drift-up',
      transition: 'crossfade',
      objects: [{ name: 'Nhịp sinh học', shape: 'ellipse', fill: '#ffbf6b', width: .04, height: .04, path: [point(0, .3, .62), point(.35, .42, .52), point(.7, .58, .58), point(1, .7, .45)] }],
    }],
  },
  {
    title: 'Một thay đổi chậm và lớn',
    narration: narration[4],
    motionGraphic: 'none',
    visualBeats: [{
      purpose: 'Kết luận mở',
      narrationCue: 'Trái Đất không vỡ tung',
      action: 'Các thẻ kết luận xuất hiện theo thứ tự: không vỡ tung, thay đổi chậm, hệ sinh thái thích nghi.',
      visual: 'Trái Đất bình ổn dưới bầu trời sao, ánh sáng xanh-vàng nhất quán, không chữ.',
      motion: 'pull',
      transition: 'crossfade',
      diagram: { layout: 'process', steps: ['Không vỡ tung ngay', 'Thay đổi chậm và lớn', 'Hệ sinh thái thích nghi'] },
    }],
  },
];

function stars(count = 70) {
  return Array.from({ length: count }, (_, index) => {
    const x = (index * 97 + 31) % 1280;
    const y = (index * 53 + 17) % 520;
    const radius = 1 + index % 3 * .45;
    const opacity = .24 + (index % 7) * .09;
    return `<circle cx="${x}" cy="${y}" r="${radius.toFixed(2)}" fill="#d9f4ff" opacity="${opacity.toFixed(2)}"/>`;
  }).join('');
}

function earth(cx: number, cy: number, radius: number, glow = '#53c9ec') {
  return `<g><circle cx="${cx}" cy="${cy}" r="${radius * 1.18}" fill="${glow}" opacity=".10"/><circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#earth)" stroke="#7fe5f4" stroke-width="3"/><path d="M ${cx - radius * .78} ${cy - radius * .08} C ${cx - radius * .48} ${cy - radius * .35}, ${cx - radius * .28} ${cy - radius * .08}, ${cx - radius * .02} ${cy - radius * .22} S ${cx + radius * .42} ${cy - radius * .55}, ${cx + radius * .78} ${cy - radius * .23} C ${cx + radius * .55} ${cy + radius * .08}, ${cx + radius * .52} ${cy + radius * .38}, ${cx + radius * .13} ${cy + radius * .6} S ${cx - radius * .38} ${cy + radius * .38}, ${cx - radius * .78} ${cy + radius * .26} Z" fill="#2e9f75" opacity=".82"/><path d="M ${cx - radius * .9} ${cy + radius * .08} Q ${cx} ${cy + radius * .4} ${cx + radius * .9} ${cy + radius * .02}" fill="none" stroke="#d8fbff" stroke-width="2" opacity=".30"/></g>`;
}

function moon(cx: number, cy: number, radius: number, opacity = 1) {
  return `<g opacity="${opacity}"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="url(#moon)" stroke="#d8e9f4" stroke-width="2"/><circle cx="${cx - radius * .32}" cy="${cy - radius * .17}" r="${radius * .13}" fill="#8f9cac" opacity=".45"/><circle cx="${cx + radius * .28}" cy="${cy + radius * .23}" r="${radius * .18}" fill="#7e8c9b" opacity=".35"/><circle cx="${cx + radius * .05}" cy="${cy - radius * .38}" r="${radius * .09}" fill="#8f9cac" opacity=".36"/></g>`;
}

function backgroundSvg(index: number) {
  const common = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#06101f"/><stop offset=".55" stop-color="#0b2340"/><stop offset="1" stop-color="#10152d"/></linearGradient><radialGradient id="earth" cx="35%" cy="30%"><stop stop-color="#80e2e9"/><stop offset=".52" stop-color="#2d86bf"/><stop offset="1" stop-color="#122c58"/></radialGradient><radialGradient id="moon" cx="35%" cy="30%"><stop stop-color="#f7f0d6"/><stop offset="1" stop-color="#8798a9"/></radialGradient><linearGradient id="water" x1="0" x2="1"><stop stop-color="#154e85"/><stop offset=".5" stop-color="#62d7eb"/><stop offset="1" stop-color="#10345f"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="18"/></filter></defs><rect width="${width}" height="${height}" fill="url(#bg)"/>${stars()}</svg>`;
  const content = index === 0
    ? `<g>${earth(565, 390, 144)}<ellipse cx="565" cy="390" rx="354" ry="194" fill="none" stroke="#7fcee9" stroke-width="2" stroke-dasharray="9 14" opacity=".45" transform="rotate(-13 565 390)"/>${moon(905, 262, 54)}</g>`
    : index === 1
      ? `<g>${earth(565, 390, 144)}<ellipse cx="565" cy="390" rx="354" ry="194" fill="none" stroke="#6aa8cf" stroke-width="2" stroke-dasharray="9 14" opacity=".28" transform="rotate(-13 565 390)"/><circle cx="940" cy="260" r="34" fill="#8ea2b6" opacity=".07" filter="url(#soft)"/></g>`
      : index === 2
        ? `<g>${earth(570, 382, 152)}<ellipse cx="570" cy="382" rx="226" ry="63" fill="url(#water)" opacity=".72" transform="rotate(-8 570 382)"/><ellipse cx="570" cy="382" rx="222" ry="54" fill="none" stroke="#a2edf5" stroke-width="2" opacity=".5" transform="rotate(-8 570 382)"/></g>`
        : index === 3
          ? `<g>${earth(620, 392, 154)}<ellipse cx="620" cy="392" rx="300" ry="170" fill="none" stroke="#6ccfe8" stroke-width="3" stroke-dasharray="5 13" opacity=".45" transform="rotate(-16 620 392)"/><circle cx="350" cy="303" r="9" fill="#ffbf6b"/><circle cx="870" cy="484" r="7" fill="#ffd98b"/></g>`
          : `<g>${earth(610, 388, 160)}<path d="M 360 550 Q 610 450 860 550" fill="none" stroke="#ffcf79" stroke-width="4" opacity=".5"/><path d="M 360 570 Q 610 470 860 570" fill="none" stroke="#51d4e5" stroke-width="3" opacity=".45"/></g>`;
  return common.replace('</svg>', `${content}</svg>`);
}

const toDataUri = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;
const toSrtTimestamp = (milliseconds: number) => {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total % 3_600_000 / 60_000);
  const seconds = Math.floor(total % 60_000 / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

async function main() {
  await mkdir(pilotRoot, { recursive: true });
  const warnings: string[] = ['M3 pilot dùng background SVG->PNG proxy để không gọi API tạo ảnh/video và không tiêu credit.'];
  const images: AnimationAsset[] = [];
  for (let index = 0; index < pilotSegments.length; index += 1) {
    const png = await sharp(Buffer.from(backgroundSvg(index))).png().toBuffer();
    images.push({ id: `pilot-background-${index + 1}`, type: 'background', name: `Pilot background ${index + 1}`, uri: toDataUri('image/png', png), tags: ['pilot', 'background', `scene-${index + 1}`], style: 'clean educational 2D space illustration', width, height, createdAt: new Date().toISOString(), source: 'bundled', generationPrompt: 'Deterministic M3 proxy; replace with reviewed asset before final publication.' });
  }

  const now = new Date().toISOString();
  const scenes: CompositeScene[] = [];
  const sceneDurationsMs = pilotSegments.map(() => 6000);
  for (let index = 0; index < pilotSegments.length; index += 1) {
    const segment = pilotSegments[index];
    const durationMs = sceneDurationsMs[index]!;
    const visualTimeline = buildVisualBeatTimeline({ sceneIndex: index, durationMs, width, height, visuals: [images[index]], beats: segment.visualBeats, narration: segment.narration });
    const performance = buildBeatPerformances({ sceneIndex: index, durationMs, width, height, assets: [], beats: segment.visualBeats, narration: segment.narration });
    const captionTimings = allocateNarrationTimings(segment.narration, durationMs, `pilot-scene-${index + 1}`);
    const subtitle: SceneLayer = { id: `pilot-subtitle-${index + 1}`, type: 'text', name: 'Voiceover · Subtitle', text: segment.narration, captionTimings, visible: true, locked: true, zIndex: 1000, width: width * .78, height: 100, fill: '#ffffff', fontSize: 34, transform: { ...defaultTransform(), position: { x: width / 2, y: height * .86 } } };
    scenes.push({ id: `pilot-scene-${index + 1}`, name: segment.title, order: index, durationMs, narration: segment.narration, renderMode: 'composite', backgroundColor: '#06101f', layers: [...visualTimeline.layers, ...performance.layers, subtitle], commands: [...visualTimeline.commands, ...performance.commands], camera: { transform: defaultTransform(), commands: [] } });
  }

  const sceneIds = scenes.map((scene) => scene.id);
  const productionPlan = compileAnimationProductionPlan({ segments: pilotSegments, sceneIds, sceneDurationsMs, continuityBible: 'Clean educational 2D space illustration. Midnight navy background, cyan water/earth highlights, warm amber emphasis. Earth stays spherical and intact; no photoreal/cartoon mixing, no baked labels, no generic presenter.', diagnostics: warnings });
  let project: AnimationProject = withAnimationAssetManifest({ schemaVersion: 1, id: randomUUID(), name: 'M3 pilot · Nếu Mặt Trăng biến mất', width, height, fps, createdAt: now, updatedAt: now, assets: images, scenes, productionPlan, styleProfile: { name: 'M3 pilot', style: 'clean educational 2D space illustration', palette: ['#06101f', '#2d86bf', '#53c9ec', '#ffbf6b'], pacing: 'balanced', subtitlePreset: 'sentence-cue' }, generationWarnings: warnings });
  project = await generateAnimationNarration({ project, provider: pilotVoice, model: 'edge-tts', voice: 'vi-VN-NamMinhNeural', speed: 1 });
  // Embed generated audio so this standalone pilot renders without the web server.
  project.assets = await Promise.all(project.assets.map(async (asset) => {
    if (asset.type !== 'audio' || asset.uri.startsWith('data:')) return asset;
    const file = await getAnimationAssetFile(asset.id);
    return { ...asset, uri: toDataUri(file.contentType, await readFile(file.path)) };
  }));
  project = withAnimationAssetManifest(project);
  const qualityIssues = checkAnimationQuality(project);
  if (qualityIssues.some((issue) => issue.severity === 'error')) throw new Error(`M3 pilot quality blocker: ${qualityIssues.filter((issue) => issue.severity === 'error').map((issue) => issue.message).join(' ')}`);

  const projectPath = path.join(pilotRoot, 'animation-pilot-30s.project.json');
  await writeFile(projectPath, JSON.stringify(project, null, 2), 'utf8');
  let last = -1;
  const rendered = await renderAnimationProject(project, true, undefined, (progress) => {
    const percent = Math.floor(progress * 100);
    if (percent !== last) { last = percent; console.log(`RENDER ${percent}`); }
  });
  const outputPath = path.join(pilotRoot, 'animation-pilot-30s.mp4');
  if (rendered.path !== outputPath) await copyFile(rendered.path, outputPath);
  const cues: string[] = [];
  const renderTimeline = buildRenderTimeline(project);
  let cueNumber = 1;
  for (const scene of project.scenes) {
    if (scene.renderMode !== 'composite') continue;
    const range = renderTimeline.find((candidate) => candidate.scene.id === scene.id);
    const offsetMs = range ? Math.round(range.from / fps * 1000) : 0;
    const subtitle = scene.layers.find((layer) => layer.type === 'text' && layer.captionTimings?.length);
    for (const timing of subtitle?.captionTimings || []) cues.push(`${cueNumber++}\n${toSrtTimestamp(offsetMs + timing.startMs)} --> ${toSrtTimestamp(offsetMs + timing.endMs)}\n${timing.text}\n`);
  }
  await writeFile(path.join(pilotRoot, 'animation-pilot-30s.srt'), `\uFEFF${cues.join('\n')}`, 'utf8');
  const qa = { pilot: 'M3', topic: 'Nếu Mặt Trăng biến mất?', durationMs: project.scenes.reduce((sum, scene) => sum + scene.durationMs, 0), sceneCount: project.scenes.length, audioSources: ['edge-tts-measured-sentence'], render: { path: outputPath, cached: rendered.cached, size: rendered.size }, qualityIssues, checks: { projectJson: true, productionPlan: true, assetManifest: Boolean(project.assetManifest), sentenceCaptionTimings: project.scenes.every((scene) => scene.renderMode === 'composite' && scene.layers.some((layer) => layer.captionTimings?.every((cue) => cue.source === 'measured-sentence'))), srt: cues.length > 0, noPaidImageOrVideoCalls: true, visualProxy: true }, warnings: [...warnings, 'Chưa phải nghiệm thu chất lượng phim cuối: background là proxy vector và chưa có human review theo từng timestamp.'], nextGate: 'M4 asset production và M5 pilot nhân vật sau khi người dùng xem toàn bộ pilot.' };
  await writeFile(path.join(pilotRoot, 'animation-pilot-30s.qa.json'), JSON.stringify(qa, null, 2), 'utf8');
  console.log(JSON.stringify({ projectPath, outputPath, srtPath: path.join(pilotRoot, 'animation-pilot-30s.srt'), qaPath: path.join(pilotRoot, 'animation-pilot-30s.qa.json'), durationMs: qa.durationMs, warnings: qa.warnings }, null, 2));
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
