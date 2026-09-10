import { directAnimationProject } from '../server/services/animationDirector';
import { createEmptyAnimationProject, saveAnimationProject } from '../server/services/animationProjects';
import { renderAnimationProject } from '../server/services/animationRender';
import type { AIProvider } from '../server/types';

const provider: AIProvider = { id: 'qa-router', name: '9Router QA', baseUrl: 'http://127.0.0.1:20128/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { translation: true } };
const narrationProvider: AIProvider = { ...provider, id: 'qa-edge', name: 'Edge TTS', providerType: 'edge-tts', capabilities: { tts: true } };
async function main() {
  const project = createEmptyAnimationProject({ name: 'What if — Trái Đất có vành đai', width: 1920, height: 1080, fps: 30 });
  await saveAnimationProject(project);
  console.log('START', project.id, '180 seconds; image generation and local animation only.');
  const timer = setInterval(() => console.log('WORKING', new Date().toISOString()), 30000);
  try {
    const result = await directAnimationProject({ project, provider, model: 'ag/gemini-3.8-flash-high', targetDurationSeconds: 180,
      brief: 'Tạo video what if khoa học tiếng Việt khoảng 3 phút: Nếu Trái Đất có vành đai như Sao Thổ? Giả định một vành đai mỏng gồm bụi và đá trong mặt phẳng xích đạo, không nói rằng nó chắc chắn hình thành hoặc bền vững. Phân biệt rõ giả định với khoa học đã biết. Hook bầu trời có dải sáng; quan sát tại xích đạo và các vĩ độ; khác nhau ban ngày/ban đêm; bóng vành đai thay đổi theo mùa có thể ảnh hưởng chiếu sáng nhưng không bịa số nhiệt độ; rủi ro cho quỹ đạo vệ tinh giao cắt vành đai; vẻ đẹp và đánh đổi; kết luận mở. Không bịa số liệu. Minh họa khoa học cao cấp, thống nhất xanh lam/vàng ấm, không người dẫn robot, không người que. Mỗi cảnh chỉ 1-2 visual beats có ý nghĩa. Dùng diagram comparison/process khi thật sự giải thích tốt hơn; các hình khác dùng ảnh Flow không chữ. Không yêu cầu text-to-video hoặc image-to-video. Tránh lặp zoom vô nghĩa, giữ bố cục và hướng chiếu sáng nhất quán. Lời Việt tự nhiên, đủ nội dung gần 3 phút, không có chỉ dẫn sản xuất trong lời đọc.',
      assetGeneration: { generator: 'flow-agent' }, narration: { provider: narrationProvider, model: 'edge-tts', voice: 'vi-VN-NamMinhNeural', speed: 1 },
    });
    await saveAnimationProject(result);
    console.log('SAVED', result.id, 'SCENES', result.scenes.length, 'DURATION_MS', result.scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 'WARNINGS', JSON.stringify(result.generationWarnings));
    let last = -1;
    const output = await renderAnimationProject(result, true, undefined, (p) => { const percent = Math.floor(p * 100); if (percent !== last) { last = percent; console.log('RENDER', percent); } });
    console.log('OUTPUT', JSON.stringify(output));
  } finally { clearInterval(timer); }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : 'Test failed'); process.exitCode = 1; });
