import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

// Chibi kiểu mẫu: đầu tròn TO, thân bé, mắt chấm, miệng mở đóng khi nói.
// EXACTLY 8 cells 4x2, NO grid lines (QC cắt biên 3px nhưng vẫn cần đúng lưới).
const asset = await generateAnimationSprite(
  {
    key: 'chibi-tuong-noi',
    name: 'Tuong chibi noi',
    design: 'Cute chibi Vietnamese general with HUGE round head and tiny body, small conical hat with red crest, green robe, simple dot eyes, big expressive mouth opening and closing in different shapes, small stubby arms gesturing. Flat cartoon style, thick dark outlines, solid colors.',
    clips: ['talk'],
  },
  'narwhal',
  'Simple bold cartoon for a history explainer. SHEET LAYOUT IS STRICT: the image must contain EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows, four per row. No grid lines, no borders between cells.',
  async (stage) => console.log('STAGE', stage),
);
console.log('CHIBI_OK', asset.id, JSON.stringify(asset.sprite));
