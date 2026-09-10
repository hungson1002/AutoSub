import { directAnimationProject } from '../server/services/animationDirector';
import { createEmptyAnimationProject, saveAnimationProject } from '../server/services/animationProjects';
import { renderAnimationProject } from '../server/services/animationRender';
import type { AIProvider } from '../server/types';

async function main() {
  const provider: AIProvider = { id: 'smoke-router', name: '9Router smoke test', baseUrl: 'http://127.0.0.1:20128/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { translation: true } };
  const narrationProvider: AIProvider = { ...provider, id: 'smoke-edge', name: 'Edge TTS', providerType: 'edge-tts', capabilities: { tts: true } };
  const project = createEmptyAnimationProject({ name: 'QA Khủng long hiện đại', width: 1280, height: 720, fps: 30 });
  console.log('START', project.id, 'Images only; no generated video calls.');
  const result = await directAnimationProject({ project, provider, model: 'ag/gemini-3.8-flash-high', targetDurationSeconds: 30,
    brief: 'Video kiến thức tiếng Việt 30 giây: Nếu khủng long ăn cỏ sống ở thành phố hiện đại thì sao? Phong cách minh họa khoa học cao cấp, nhất quán, không người que hoặc robot dẫn chuyện. Bốn ý: mở đầu thấy Brachiosaurus cạnh xe buýt; so sánh nhu cầu thức ăn; tác động giao thông; giải pháp khu bảo tồn. Hình phải đúng giải phẫu khủng long cổ dài, không thú có lông. Dùng hình minh họa và motion graphics cho so sánh, không chỉ phóng to ảnh. Bài thử ngắn: tối đa 4 ảnh mới trong toàn bộ video, không chèn chữ vào ảnh; giữ lời và hình khớp nhau.',
    assetGeneration: { generator: 'flow-agent' },
    narration: { provider: narrationProvider, model: 'edge-tts', voice: 'vi-VN-NamMinhNeural', speed: 1 },
  });
  await saveAnimationProject(result);
  console.log('SAVED', result.id, 'scenes', result.scenes.length, 'warnings', result.generationWarnings);
  let last = -1;
  const output = await renderAnimationProject(result, true, undefined, (progress) => { const step = Math.floor(progress * 10); if (step !== last) { last = step; console.log('RENDER', step * 10); } });
  console.log('OUTPUT', output);
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Smoke test failed'); process.exitCode = 1; });
