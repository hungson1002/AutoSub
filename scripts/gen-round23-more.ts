import { generateAnimationAsset, getAnimationAssetFile } from '../server/services/animationAssets';
import { CANVAS_PRO_STYLE_BIBLE } from '../server/services/canvasProfessionalAssets';

const style = CANVAS_PRO_STYLE_BIBLE;
const jobs = [
  {
    name: 'linh-tre',
    prompt: `${style} Portrait of a young Vietnamese village soldier in simple 13th century tunic and conical hat, front view, earnest hopeful expression, plain warm beige background, upper body, gentle, no weapon, no text.`,
  },
  {
    name: 'quan-su-tre',
    prompt: `${style} Portrait of a middle-aged Vietnamese scholar strategist with short beard, dark robe and scholar hat, front view, thoughtful explaining expression, one hand raised, plain warm beige background, upper body, no weapon, no text.`,
  },
  {
    name: 'bai-coc',
    prompt: `${style} Close view of rows of sharpened wooden stakes emerging from calm shallow river water at low tide, soft morning mist, green mangrove bank on one side, tranquil tense mood before a historic event, no people, no ships, no text.`,
  },
];

for (const job of jobs) {
  try {
    const asset = await generateAnimationAsset({
      prompt: job.prompt,
      name: job.name,
      type: 'background',
      tags: ['round23', 'bach-dang'],
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
