import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

const asset = await generateAnimationSprite(
  {
    key: 'chibi-dien-multi-c',
    name: 'Chibi dien multi c',
    design: 'Cute chibi Vietnamese villager boy with HUGE round head and tiny body, green robe, small conical hat with red crest, simple dot eyes. Flat cartoon style, thick dark outlines, solid colors.',
    clips: ['talk', 'point'],
  },
  'narwhal',
  'Simple bold cartoon v3. SHEET LAYOUT IS STRICT: each action is its own image with EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows, four per row. No grid lines, no borders. Green robe and crest hat identical in every image.',
  async (stage) => console.log('STAGE', stage),
);
console.log('MULTI_OK', asset.id, JSON.stringify(asset.sprite));
