import { generateAnimationAsset, getAnimationAssetFile } from '../server/services/animationAssets';
import { CANVAS_PRO_STYLE_BIBLE } from '../server/services/canvasProfessionalAssets';

const style = CANVAS_PRO_STYLE_BIBLE;
const jobs = [
  {
    name: 'mat-cat-nuoc',
    prompt: `${style} Underwater cross-section diagram view: wooden boat hull seen from below floating at the top, rows of sharpened wooden stakes standing below it, sandy mud riverbed at the bottom, soft god rays through calm blue water, small bubbles, educational diagram mood, no people, no text.`,
  },
  {
    name: 'bai-bun-hoang-hon',
    prompt: `${style} Wide river mudflat at sunset: wet brown mud with small puddles reflecting orange sky, tufts of reeds, distant purple tree line, big pale sun low in hazy pink-orange sky, tranquil evening mood, no people, no boats, no text.`,
  },
  {
    name: 'macro-coc',
    prompt: `${style} Extreme close-up of sharpened wooden stake tips pointing upward, dark wet wood texture with ink contours, blurred muddy riverbank behind, shallow water line at the bottom, dramatic detail-shot mood, no people, no text.`,
  },
];

for (const job of jobs) {
  try {
    const asset = await generateAnimationAsset({
      prompt: job.prompt,
      name: job.name,
      type: 'background',
      tags: ['round23', 'bach-dang', 'custom-shot'],
      style: 'editorial',
      generator: 'flow-agent',
      width: 1280,
      height: 720,
    });
    const file = await getAnimationAssetFile(asset.id);
    console.log('ASSET_OK', job.name, asset.id, file.path);
  } catch (error) {
    console.log('ASSET_FAIL', job.name, error instanceof Error ? error.message.slice(0, 160) : String(error));
  }
}
console.log('DONE');
