import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

const asset = await generateAnimationSprite(
  {
    key: 'chibi-point-only',
    name: 'Chibi chi tay',
    design: 'Cute chibi Vietnamese villager boy with HUGE round head and tiny body, conical straw hat, brown tunic, simple dot eyes. Flat cartoon style, thick dark outlines, solid colors. Pointing gesture with one arm extended.',
    clips: ['point'],
  },
  'narwhal',
  'Simple bold cartoon, same boy as the talking chibi sheet: round head, straw hat, brown tunic. SHEET LAYOUT IS STRICT: EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows. No grid lines, no borders.',
  async (stage) => console.log('STAGE', stage),
);
console.log('POINT_OK', asset.id, JSON.stringify(asset.sprite));
