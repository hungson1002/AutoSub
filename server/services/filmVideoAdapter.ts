import { generateGoogleFlowVideo, validateGoogleFlowSession, type FlowVideoAspectRatio, type FlowVideoReferences } from './googleFlow';

/**
 * A stable boundary between the film workflow and a concrete video renderer.
 *
 * The director, continuity pass, reference routing and editor do not need to
 * know whether a shot is rendered by Flow, a self-hosted model, or another
 * provider. Providers can register an adapter without changing the workflow
 * state machine or prompt contract.
 */
export type FilmVideoModel = string;

export type FilmVideoGenerationRequest = {
  prompt: string;
  outputFile: string;
  model: FilmVideoModel;
  references?: FlowVideoReferences;
  aspectRatio: FlowVideoAspectRatio;
  signal?: AbortSignal;
};

export type FilmVideoAdapter = {
  id: string;
  label: string;
  models: string[];
  canHandle: (model: FilmVideoModel) => boolean;
  validate?: () => Promise<void>;
  /** Compile the shared cinematic shot contract into provider-specific syntax. */
  compilePrompt?: (request: FilmVideoGenerationRequest) => string;
  generate: (request: FilmVideoGenerationRequest) => Promise<unknown>;
};

const adapters: FilmVideoAdapter[] = [{
  id: 'flow-agent',
  label: 'Google Flow · Veo',
  models: ['Flow Agent Auto'],
  canHandle: (model) => model === 'Flow Agent Auto',
  validate: async () => { await validateGoogleFlowSession(); },
  compilePrompt: ({ prompt }) => prompt,
  generate: ({ prompt, outputFile, references, aspectRatio, signal }) => generateGoogleFlowVideo(
    prompt,
    outputFile,
    'Flow Agent Auto',
    undefined,
    references,
    aspectRatio,
    signal,
    true,
  ),
}];

export function registerFilmVideoAdapter(adapter: FilmVideoAdapter) {
  const existing = adapters.findIndex((item) => item.id === adapter.id);
  if (existing >= 0) adapters[existing] = adapter;
  else adapters.push(adapter);
}

export function listFilmVideoAdapters() {
  return adapters.map(({ id, label, models }) => ({ id, label, models: [...models] }));
}

export function resolveFilmVideoAdapter(model: FilmVideoModel) {
  return adapters.find((adapter) => adapter.canHandle(model));
}

export function assertFilmVideoAdapter(model: FilmVideoModel) {
  const adapter = resolveFilmVideoAdapter(model);
  if (!adapter) throw new Error(`Chưa có adapter tạo video cho model “${model}”. Hãy cài/kết nối adapter tương ứng trước khi chạy shot.`);
  return adapter;
}

export async function validateFilmVideoAdapter(model: FilmVideoModel) {
  await assertFilmVideoAdapter(model).validate?.();
}

export async function generateFilmVideoClip(request: FilmVideoGenerationRequest) {
  const adapter = assertFilmVideoAdapter(request.model);
  const prompt = adapter.compilePrompt ? adapter.compilePrompt(request) : request.prompt;
  return adapter.generate({ ...request, prompt });
}
