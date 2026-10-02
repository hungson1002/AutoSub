import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

// Fresh key (continuity v2) to escape the zombie server-side slot on account-0316302ea37c.
// Unknown-outcome note: old key may still complete later; small duplicate-spend risk accepted.
const asset = await generateAnimationSprite(
  {
    key: 'bach-dang-warrior-talk',
    name: 'Chien binh Bach Dang noi',
    design: 'Vietnamese naval soldier in 13th century lamellar armor vest over earth-yellow tunic, conical combat hat with red crest. Flat muted earthy palette, dark ink contours, expressive face. Full body, front facing viewer.',
    clips: ['talk'],
  },
  'narwhal',
  'Editorial explainer illustration for the 1288 Bach Dang river victory story, v2.',
  async (stage) => console.log('STAGE', stage),
);
console.log('TALK_OK', asset.id, JSON.stringify(asset.sprite));
