import { generateAnimationAsset } from '../server/services/animationAssets';

try {
  await generateAnimationAsset({
    prompt: 'AUTOSUB FLOW ERROR CLASS PROBE. Simple neutral professional editorial landscape, no text.',
    name: 'flow-error-probe',
    type: 'background',
    tags: ['diagnostic-probe'],
    style: 'diagnostic',
    generator: 'flow-agent',
    model: 'narwhal',
    width: 640,
    height: 360,
  });
  console.log('FLOW_PROBE_SUCCESS');
} catch (error) {
  const value = error as Record<string, unknown>;
  console.log('FLOW_PROBE_ERROR', JSON.stringify({
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    code: value?.code,
    constructor: error && typeof error === 'object' ? error.constructor?.name : undefined,
    keys: error && typeof error === 'object' ? Object.keys(error) : [],
  }, null, 2));
}
