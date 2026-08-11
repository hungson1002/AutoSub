import type { SubtitleStyle } from '../types';

export type SubtitlePreset = {
  id: string;
  name: string;
  description: string;
  style: Partial<SubtitleStyle>;
};

export const subtitlePresets: SubtitlePreset[] = [
  {
    id: 'clean-review',
    name: 'Review rõ nét',
    description: 'Trắng, viền mảnh, dễ đọc trên hầu hết cảnh phim.',
    style: { fontFamily: 'Arial', fontSize: 34, outlineWidth: 2, textColor: '#ffffff', outlineColor: '#10141b', background: 'outline', bold: false, italic: false, position: 'bottom' },
  },
  {
    id: 'cinema-box',
    name: 'Cinema hộp đục',
    description: 'Phụ đề mềm, hợp video review và cảnh sáng.',
    style: { fontFamily: 'Segoe UI', fontSize: 32, outlineWidth: 0, textColor: '#ffffff', outlineColor: '#10141b', background: 'box', backgroundColor: '#10141b', backgroundOpacity: 0.78, bold: true, italic: false, position: 'bottom' },
  },
  {
    id: 'anime-pop',
    name: 'Anime nổi bật',
    description: 'Vàng tươi, viền đậm cho cảnh chuyển động nhanh.',
    style: { fontFamily: 'Arial', fontSize: 36, outlineWidth: 3, textColor: '#ffd51f', outlineColor: '#16110a', background: 'outline', bold: true, italic: false, position: 'bottom' },
  },
  {
    id: 'short-form',
    name: 'Short-form',
    description: 'Chữ lớn cho TikTok, Reels và video dọc.',
    style: { fontFamily: 'Verdana', fontSize: 42, outlineWidth: 3, textColor: '#ffffff', outlineColor: '#111827', background: 'box', backgroundColor: '#111827', backgroundOpacity: 0.68, bold: true, italic: false, position: 'middle' },
  },
  {
    id: 'minimal',
    name: 'Tối giản',
    description: 'Không nền, không viền, gọn cho cảnh tối.',
    style: { fontFamily: 'Segoe UI', fontSize: 30, outlineWidth: 0, textColor: '#ffffff', outlineColor: '#10141b', background: 'none', bold: false, italic: false, position: 'bottom' },
  },
];
