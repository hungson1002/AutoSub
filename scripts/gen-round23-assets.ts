import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { generateAnimationAsset, getAnimationAssetFile } from '../server/services/animationAssets';
import { synthesize } from '../server/adapters/edgeTts';
import { CANVAS_PRO_STYLE_BIBLE } from '../server/services/canvasProfessionalAssets';
import { workdir } from '../server/services/ffmpeg';

const outDir = path.join(workdir, 'round23-verify', 'assets');
await mkdir(outDir, { recursive: true });

const style = CANVAS_PRO_STYLE_BIBLE;
// NOTE: tránh từ ngữ bạo lực (burning/fighting/battle) vì Flow safety filter chặn.
const jobs = [
  {
    name: 'song-bach-dang',
    prompt: `${style} Wide establishing shot of a calm wide river estuary in Vietnam: green mangrove banks, distant soft mountains, traditional wooden sailboats anchored peacefully mid-river, rows of tall wooden poles emerging from shallow water in the foreground, warm morning light, serene, no people close-up, no text.`,
  },
  {
    name: 'doan-thuyen',
    prompt: `${style} A fleet of traditional wooden sailboats with square sails sailing in formation on a wide calm river at sunrise, colorful flags flying, gentle mist over the water, green riverbanks, peaceful grand voyage mood, no fire, no battle, no text.`,
  },
  {
    name: 'vi-tuong',
    prompt: `${style} Portrait of a wise elderly Vietnamese scholar-general in 13th century traditional robe and hat, front view, calm confident expression, one hand raised explaining, plain warm beige background, upper body, dignified, no weapon, no text.`,
  },
];

const files: string[] = [];
for (const job of jobs) {
  try {
    const asset = await generateAnimationAsset({
      prompt: job.prompt,
      name: job.name,
      type: 'background',
      tags: ['round23', 'bach-dang'],
      style: 'editorial',
      generator: 'flow-agent',
      width: 1280,
      height: 720,
    });
    const file = getAnimationAssetFile(asset.id);
    files.push(file);
    console.log('ASSET_OK', job.name, asset.id, file);
  } catch (error) {
    console.log('ASSET_FAIL', job.name, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
}

const edgeProvider: any = {
  id: 'edge-tts-local', name: 'Edge TTS', baseUrl: 'local://edge-tts',
  enabled: true, models: [], providerType: 'edge-tts', authType: 'none', capabilities: { tts: true },
};
const lines = [
  'Năm một ngàn hai trăm tám mươi tám, trên sông Bạch Đằng, quân dân nhà Trần chuẩn bị trận quyết chiến.',
  'Họ đóng cọc gỗ xuống lòng sông, chờ thủy triều rút để nhấn chìm thuyền giặc.',
  'Khi nước rút, hàng trăm chiến thuyền quân Nguyên mắc cạn giữa bãi cọc.',
  'Chiến thắng Bạch Đằng đi vào sử sách, và người hùng chính là bạn, người giữ nước.',
];
for (let i = 0; i < lines.length; i += 1) {
  try {
    const audio = await synthesize(edgeProvider, 'edge-tts', 'vi-VN-NamMinhNeural', lines[i]!, { speed: 1 });
    const file = path.join(outDir, `narration-${i + 1}.mp3`);
    await writeFile(file, audio);
    console.log('TTS_OK', file, audio.length);
  } catch (error) {
    console.log('TTS_FAIL', i + 1, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }
}
console.log('DONE', JSON.stringify(files));
