import { generateAnimationSprite } from '../server/services/animationSpriteGeneration';

const asset = await generateAnimationSprite(
  {
    key: 'bach-dang-warrior',
    name: 'Chien binh Bach Dang',
    design: 'Vietnamese naval soldier in 13th century lamellar armor vest over earth-yellow tunic, conical combat hat with red crest, proud stance. Flat muted earthy palette: warm beige, dusty orange, blue-gray, charcoal. Organic imperfect dark ink contours, expressive face. Full body, side facing right.',
    clips: ['walk', 'talk'],
  },
  'narwhal',
  'Editorial explainer illustration for the 1288 Bach Dang river victory story. Same style bible as river backgrounds.',
  async (stage) => console.log('STAGE', stage),
);
console.log('SPRITE_OK', asset.id, JSON.stringify(asset.sprite));
