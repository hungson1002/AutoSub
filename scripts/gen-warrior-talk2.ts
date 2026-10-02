import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

const asset = await generateAnimationSprite(
  {
    key: 'bach-dang-warrior-talk2',
    name: 'Chien binh Bach Dang noi 2',
    design: 'Vietnamese naval soldier in 13th century lamellar armor vest over earth-yellow tunic, conical combat hat with red crest. Flat muted earthy palette, dark ink contours, expressive face. Full body, front facing viewer, arms kept close to torso, compact gestures only.',
    clips: ['talk'],
  },
  'narwhal',
  'Editorial explainer illustration v3. SHEET LAYOUT IS STRICT: the image must contain EXACTLY 8 character cells in EXACTLY 4 columns and EXACTLY 2 rows. Count: eight figures total, four per row, two rows. Not six, not twelve.',
  async (stage) => console.log('STAGE', stage),
);
console.log('TALK_OK', asset.id, JSON.stringify(asset.sprite));
