import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildCast, compileFilm, parseFilmScript } from '../server/services/canvasScriptFilm';
import { ensureCastSprites } from '../server/services/canvasCastSprites';
import { evaluateCanvasVisualQuality } from '../shared/canvasVisualQuality';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { synthesize } from '../server/adapters/edgeTts';

const SCRIPT = `CẢNH 1 - Bãi cọc | nền: bãi cọc
Tướng: Năm một ngàn hai trăm tám mươi tám, trên sông Bạch Đằng, quân ta đóng cọc chờ giặc.
Lính: [chỉ] Thưa tướng, cọc lim đã đóng xong dưới lòng sông!
[ảnh: Cọc Bạch Đằng 1288]
Tướng: Tốt! Giờ ta chờ thủy triều rút.

CẢNH 2 - Chờ triều | nền: bãi cọc
Lính: Nước đang rút, thưa tướng!
Tướng: [chỉ] Truyền lệnh! Toàn quân đánh!`;

const VOICES = ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'];
const edgeProvider: any = {
  id: 'edge-tts-local', name: 'Edge TTS', baseUrl: 'local://edge-tts',
  enabled: true, models: [], providerType: 'edge-tts', authType: 'none', capabilities: { tts: true },
};

const scenes = parseFilmScript(SCRIPT);
console.log('SCENES', scenes.length, 'LINES', scenes.map((s) => s.lines.length).join(','));
const cast = buildCast(scenes);
const DESIGNS: Record<string, string> = {
  'Tướng': 'stern Vietnamese general with small black mustache, green robe, conical hat with red crest',
  'Lính': 'young Vietnamese soldier with round face, brown tunic, straw leaf hat',
};
const withSprites = await ensureCastSprites(
  cast,
  (m) => DESIGNS[m.name] || `Vietnamese villager named ${m.name}`,
  (msg) => console.log('STAGE', msg),
);
for (const c of withSprites) console.log('CAST', c.name, c.acts.map((a) => a.action).join('+'));

const project = compileFilm(scenes, withSprites);
const report = evaluateCanvasVisualQuality(project);
console.log('QC score=' + report.score + ' pass=' + report.pass);
for (const issue of report.issues) console.log(' -', issue.severity, issue.code, issue.sceneName || '', issue.message);
if (!report.pass) throw new Error(`QC failed ${report.score}`);

const result = await renderCanvasAnimationProject(project, 'film-bach-dang-v1');
console.log('SILENT_RENDER', result.path, result.size);

// Lồng tiếng từng câu đúng miệng từng người, đúng thời điểm beat.
const outDir = resolve('workdir/round23-verify/film');
mkdirSync(outDir, { recursive: true });
const slug = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const inputs: string[] = [];
const filters: string[] = [];
let sceneOffset = 0;
let track = 0;
const voiceOf = new Map(withSprites.map((c, i) => [c.name, VOICES[i % VOICES.length]!]));
const compiled = scenes;
for (const [si, scene] of compiled.entries()) {
  const projScene = project.scenes[si]!;
  const usedBeats = new Set<string>();
  for (const line of scene.lines) {
    const target = `cast-${slug(line.speaker)}`;
    const beat = projScene.animationBeats!.find((b) => b.targetIds[0] === target && !usedBeats.has(b.id))
      || projScene.animationBeats!.find((b) => b.targetIds[0] === target);
    if (beat) usedBeats.add(beat.id);
    const audio = await synthesize(edgeProvider, 'edge-tts', voiceOf.get(line.speaker)!, line.text, { speed: 1 });
    const file = `${outDir}/s${si}-t${track}.mp3`;
    await writeFile(file, audio);
    const atMs = sceneOffset + (beat?.atMs || 0);
    inputs.push('-i', file);
    filters.push(`[${track + 1}:a]adelay=${atMs}|${atMs},apad[a${track}]`);
    console.log('DUB', line.speaker, `scene${si}+${beat?.atMs}ms`, audio.length, 'bytes');
    track += 1;
  }
  sceneOffset += projScene.durationMs;
}
filters.push(`[${Array.from({ length: track }, (_, i) => `a${i}`).join('][')}]amix=inputs=${track}:duration=longest:dropout_transition=0[aout]`);
const finalOut = resolve('workdir/round23-verify/bach-dang-phim.mp4');
execFileSync('ffmpeg', ['-y', '-i', result.path, ...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', finalOut], { stdio: 'ignore' });
console.log('FINAL_PHIM', finalOut);
const contact = resolve('workdir/round23-verify/contact-bach-dang-phim.jpg');
execFileSync('ffmpeg', ['-y', '-i', finalOut, '-vf', 'fps=1/4,scale=480:-1,tile=4x2', '-frames:v', '1', contact], { stdio: 'ignore' });
console.log('CONTACT_SHEET', contact);
