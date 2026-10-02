import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

// Một sheet 3 hàng: talk + point + celebrate, cùng 1 khuôn mặt (clip sau
// dùng clip đầu làm reference). Renderer sẽ chuyển hàng theo beat diễn.
const asset = await generateAnimationSprite(
  {
    key: 'chibi-dien-multi',
    name: 'Chibi dien multi',
    design: 'Cute chibi Vietnamese villager boy with HUGE round head and tiny body, conical straw hat, brown tunic, simple dot eyes, big expressive mouth. Flat cartoon style, thick dark outlines, solid colors.',
    clips: ['talk', 'point', 'celebrate'],
  },
  'narwhal',
  'Simple bold cartoon for a history explainer. SHEET LAYOUT IS STRICT: each action is its own image with EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows, four per row. No grid lines, no borders between cells. Same face, hat and tunic in every image.',
  async (stage) => console.log('STAGE', stage),
);
console.log('MULTI_OK', asset.id, JSON.stringify(asset.sprite));
