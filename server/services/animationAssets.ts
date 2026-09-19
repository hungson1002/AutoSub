import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { defaultTransform, type AnimationAsset, type AnimationCommand, type SceneLayer } from '../../shared/animationStudio';
import { run, workdir } from './ffmpeg';
import type { AIProvider } from '../types';
import { buildAuthHeaders, providerBase, withAuthQuery } from '../providers/base';
import { synthesize } from '../adapters';
import type { AnimationProject } from '../../shared/animationStudio';
import { generateGoogleFlowImage, generateGoogleFlowImages } from './googleFlow';
import { resolveUpload } from './uploads';
import { writeJsonFileResilient } from './resilientFileWrite';
import { allocateNarrationTimings, createSentenceTimeMapper, splitNarrationUnits } from './animationTiming';

const file = path.join(workdir, 'animation-assets', 'library.json');
let libraryWrites: Promise<unknown> = Promise.resolve();
function mutateLibrary<T>(mutation: () => Promise<T>): Promise<T> {
  const pending = libraryWrites.then(mutation, mutation);
  libraryWrites = pending.catch(() => undefined);
  return pending;
}

async function readLibrary(): Promise<AnimationAsset[]> {
  try { const value = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

async function writeLibrary(assets: AnimationAsset[]) {
  await writeJsonFileResilient(file, assets, true);
}

const words = (value: string) => value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

export async function listAnimationAssets(query = '') {
  const assets = await readLibrary(); const terms = words(query);
  if (!terms.length) return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return assets.map((asset) => {
    const name = words(asset.name); const tags = words(asset.tags.join(' '));
    const score = terms.reduce((total, term) => total + (name.includes(term) ? 4 : 0) + (tags.includes(term) ? 2 : 0) + (words(asset.style || '').includes(term) ? 1 : 0), 0);
    return { asset, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.asset);
}

export async function registerAnimationAsset(value: AnimationAsset) {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || !value.name.trim() || typeof value.uri !== 'string' || !value.uri.trim() || !Array.isArray(value.tags)) throw new Error('Metadata asset không hợp lệ.');
  if (value.status !== undefined && !['approved', 'candidate', 'rejected', 'draft'].includes(value.status)) throw new Error('Invalid asset status.');
  if (value.cacheKey !== undefined && !/^[a-f0-9]{64}$/i.test(value.cacheKey)) throw new Error('Invalid asset cache key.');
  return mutateLibrary(async () => {
  const assets = await readLibrary(); const asset = { ...value, id: value.id.trim(), name: value.name.trim(), uri: value.uri.trim(), tags: value.tags.map(String) };
  await writeLibrary([...assets.filter((item) => item.id !== asset.id), asset]); return asset;
  });
}

export async function updateAnimationAsset(id: string, change: Partial<Pick<AnimationAsset, 'name' | 'tags' | 'style' | 'animations' | 'status'>>) {
  if (change.status !== undefined && !['approved', 'candidate', 'rejected', 'draft'].includes(change.status)) throw new Error('Invalid asset status.');
  return mutateLibrary(async () => {
  const assets = await readLibrary(); const current = assets.find((asset) => asset.id === id); if (!current) throw new Error('Không tìm thấy asset.');
  const next: AnimationAsset = { ...current, ...(typeof change.name === 'string' ? { name: change.name.trim().slice(0, 160) || current.name } : {}), ...(Array.isArray(change.tags) ? { tags: change.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 30) } : {}), ...(typeof change.style === 'string' ? { style: change.style.trim().slice(0, 80) } : {}), ...(Array.isArray(change.animations) ? { animations: change.animations.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40) } : {}), ...(change.status ? { status: change.status } : {}) };
  await writeLibrary(assets.map((asset) => asset.id === id ? next : asset)); return next;
  });
}

export async function deleteAnimationAssets(ids: string[]) {
  const idSet = new Set(ids.filter((id) => /^[a-f0-9-]{36}$/i.test(String(id || ''))));
  if (!idSet.size) return [] as string[];
  const removed = await mutateLibrary(async () => {
    const assets = await readLibrary();
    const matched = assets.filter((asset) => idSet.has(asset.id)).map((asset) => asset.id);
    if (matched.length) await writeLibrary(assets.filter((asset) => !idSet.has(asset.id)));
    return matched;
  });
  await Promise.all(removed.flatMap((id) => assetFileFormats.map((format) => rm(path.join(workdir, 'animation-assets', 'files', `${id}.${format.extension}`), { force: true }).catch(() => undefined))));
  return removed;
}

export async function resolveAnimationAssets(query: string, limit = 8) {
  const terms = words(query); const assets = await readLibrary();
  return assets.map((asset) => { const name = words(asset.name); const tags = words(asset.tags.join(' ')); const style = words(asset.style || ''); const matches = terms.filter((term) => name.includes(term) || tags.includes(term) || style.includes(term)); const score = matches.reduce((total, term) => total + (name.includes(term) ? 4 : 0) + (tags.includes(term) ? 2 : 0) + (style.includes(term) ? 1 : 0), 0); return { asset, score, reason: matches.length ? `Khớp: ${matches.join(', ')}` : 'Không khớp metadata' }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(30, limit)));
}

const generatedFile = (id: string) => path.join(workdir, 'animation-assets', 'files', `${id}.png`);
const assetFileFormats = [
  { extension: 'png', contentType: 'image/png' },
  { extension: 'wav', contentType: 'audio/wav' },
  { extension: 'mp3', contentType: 'audio/mpeg' },
  { extension: 'm4a', contentType: 'audio/mp4' },
  { extension: 'ogg', contentType: 'audio/ogg' },
] as const;
export async function getAnimationAssetFile(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Asset id không hợp lệ.');
  for (const format of assetFileFormats) {
    const target = path.join(workdir, 'animation-assets', 'files', `${id}.${format.extension}`);
    try { return { path: target, size: (await stat(target)).size, contentType: format.contentType }; }
    catch { /* try next format */ }
  }
  throw new Error('Không tìm thấy file asset.');
}

export type AnimationAssetGenerationInput = { prompt: string; name?: string; type?: AnimationAsset['type']; tags?: string[]; style?: string; provider?: AIProvider; model?: string; generator?: 'flow-agent'; width?: number; height?: number; referenceUploadId?: string; referenceAssetId?: string };

export async function resolveAnimationGenerationReferencePath(input: Pick<AnimationAssetGenerationInput, 'referenceUploadId' | 'referenceAssetId'>) {
  if (input.referenceUploadId) return (await resolveUpload(input.referenceUploadId)).absolutePath;
  if (input.referenceAssetId) return (await getAnimationAssetFile(input.referenceAssetId)).path;
  return undefined;
}

export function animationAssetCacheKey(input: AnimationAssetGenerationInput) {
  const prompt = String(input.prompt || '').trim().slice(0, 4000);
  return createHash('sha256').update(JSON.stringify({ geometryVersion: 3, prompt, name: String(input.name || '').trim().slice(0, 160), type: input.type || 'image', style: String(input.style || '').trim().slice(0, 80), generator: input.generator || 'provider', provider: input.provider?.id || '', model: input.model || '', width: Number(input.width) || 1024, height: Number(input.height) || 1024, referenceUploadId: input.referenceUploadId || '', referenceAssetId: input.referenceAssetId || '' })).digest('hex');
}

export async function findCachedAnimationAsset(cacheKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(cacheKey)) return undefined;
  const asset = (await readLibrary()).find((item) => item.cacheKey?.toLowerCase() === cacheKey.toLowerCase() && item.status !== 'rejected');
  if (!asset) return undefined;
  try { await getAnimationAssetFile(asset.id); return asset; } catch { return undefined; }
}

const generationLocks = new Map<string, Promise<AnimationAsset>>();

async function normalizeAndRegisterGeneratedAsset(id: string, input: AnimationAssetGenerationInput, cacheKey: string) {
  const prompt = String(input.prompt || '').trim().slice(0, 4000);
  const source = await readFile(generatedFile(id));
  const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
  await writeFile(generatedFile(id), data);
  return registerAnimationAsset({ id, type: input.type || 'image', name: String(input.name || prompt).trim().slice(0, 160), uri: `/api/animation-studio/assets/${id}/file`, tags: Array.isArray(input.tags) ? input.tags.map(String) : words(prompt).slice(0, 12), style: String(input.style || '').trim().slice(0, 80) || undefined, width: info.width, height: info.height, createdAt: new Date().toISOString(), source: 'generated', status: 'candidate', cacheKey, generationPrompt: prompt });
}

async function generateAnimationAssetUncached(input: AnimationAssetGenerationInput & { cacheKey: string }) {
  const prompt = String(input.prompt || '').trim().slice(0, 4000); if (prompt.length < 8) throw new Error('Mô tả asset cần ít nhất 8 ký tự.');
  const id = randomUUID(); await mkdir(path.dirname(generatedFile(id)), { recursive: true });
  if (input.generator === 'flow-agent') {
    const referenceImagePath = await resolveAnimationGenerationReferencePath(input);
    // Use a fresh top-level idempotency key for every explicit retry. googleFlow.ts
    // still reuses that key for transport replays inside the same attempt, but a
    // previously wedged Flow Agent request can no longer poison all later retries
    // merely because the visual cache key is identical.
    await generateGoogleFlowImage(prompt, generatedFile(id), { model: input.model || 'narwhal', size: `${input.width || 1024}x${input.height || 1024}`, referenceImagePath });
  } else {
    if (input.referenceUploadId || input.referenceAssetId) throw new Error('Provider tạo ảnh này chưa hỗ trợ ảnh tham chiếu. Hãy chọn Nano Banana 2 để giữ nhân vật nhất quán.');
    if (!input.provider || !input.model) throw new Error('Thiếu provider/model tạo ảnh.');
    const url = withAuthQuery(`${providerBase(input.provider)}/images/generations`, input.provider); const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(input.provider) }, body: JSON.stringify({ model: input.model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }) });
    if (!response.ok) throw new Error(`Image provider trả lỗi ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const body = await response.json() as { data?: Array<{ b64_json?: string }> }; const encoded = body.data?.[0]?.b64_json; if (!encoded) throw new Error('Image provider không trả ảnh base64. Hãy dùng model/API tương thích images/generations.');
    const bytes = Buffer.from(encoded, 'base64'); if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error('Ảnh sinh ra trống hoặc vượt quá 30 MB.');
    await writeFile(generatedFile(id), bytes);
  }
  return normalizeAndRegisterGeneratedAsset(id, input, input.cacheKey);
}

export async function generateAnimationAsset(input: AnimationAssetGenerationInput) {
  const cacheKey = animationAssetCacheKey(input);
  const cached = await findCachedAnimationAsset(cacheKey);
  if (cached) return cached;
  const existing = generationLocks.get(cacheKey);
  if (existing) return existing;
  const pending = (async () => {
    const afterLock = await findCachedAnimationAsset(cacheKey);
    return afterLock || generateAnimationAssetUncached({ ...input, cacheKey });
  })();
  generationLocks.set(cacheKey, pending);
  try { return await pending; }
  finally { if (generationLocks.get(cacheKey) === pending) generationLocks.delete(cacheKey); }
}

export async function generateFlowAnimationAssetBatch(inputs: AnimationAssetGenerationInput[], batchPrompt: string | string[], signal?: AbortSignal) {
  if (!inputs.length || inputs.length > 4) throw new Error('Batch Flow cần từ 1 đến 4 ảnh.');
  if (Array.isArray(batchPrompt) && batchPrompt.length !== inputs.length) throw new Error('Số prompt batch phải bằng số ảnh cần tạo.');
  if (inputs.some((input) => input.generator !== 'flow-agent')) return Promise.all(inputs.map(generateAnimationAsset));
  const firstReferenceUploadId = inputs[0]?.referenceUploadId || '';
  const firstReferenceAssetId = inputs[0]?.referenceAssetId || '';
  const sharedReference = inputs.every((input) => (input.referenceUploadId || '') === firstReferenceUploadId && (input.referenceAssetId || '') === firstReferenceAssetId);
  if (!sharedReference) return Promise.all(inputs.map(generateAnimationAsset));
  const cacheKeys = inputs.map(animationAssetCacheKey);
  const resolved = await Promise.all(cacheKeys.map(findCachedAnimationAsset));
  const missingIndexes = resolved.map((asset, index) => asset ? -1 : index).filter((index) => index >= 0);
  if (!missingIndexes.length) return resolved as AnimationAsset[];
  const ids = missingIndexes.map(() => randomUUID());
  const outputFiles = ids.map(generatedFile);
  await mkdir(path.dirname(outputFiles[0]), { recursive: true });
  const first = inputs[missingIndexes[0]];
  const referenceImagePath = await resolveAnimationGenerationReferencePath(first);
  const flowPrompts = Array.isArray(batchPrompt)
    ? batchPrompt.map((prompt) => String(prompt || '').trim().slice(0, 4000))
    : String(batchPrompt || '').trim().slice(0, 4000);
  await generateGoogleFlowImages(flowPrompts, outputFiles, { model: first.model || 'narwhal', size: `${first.width || 1024}x${first.height || 1024}`, referenceImagePath, signal });
  const created = await Promise.all(missingIndexes.map((inputIndex, batchIndex) => normalizeAndRegisterGeneratedAsset(ids[batchIndex], inputs[inputIndex], cacheKeys[inputIndex])));
  missingIndexes.forEach((inputIndex, batchIndex) => { resolved[inputIndex] = created[batchIndex]; });
  return resolved as AnimationAsset[];
}

export function wavDurationMs(audio: Buffer) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return 0;
  const byteRate = audio.readUInt32LE(28); let offset = 12;
  while (offset + 8 <= audio.length) { const id = audio.toString('ascii', offset, offset + 4); const size = audio.readUInt32LE(offset + 4); if (id === 'data' && byteRate > 0) return Math.round(size / byteRate * 1000); offset += 8 + size + (size % 2); }
  return 0;
}

/** Read duration for WAV and compressed provider output (Edge TTS returns MP3). */
export async function audioDurationMs(audio: Buffer, extension = 'media') {
  const wavDuration = wavDurationMs(audio);
  if (wavDuration > 0) return wavDuration;
  if (!audio.length) return 0;
  const probeDirectory = path.join(workdir, 'animation-assets', 'duration-probes');
  const probeFile = path.join(probeDirectory, `${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, '') || 'media'}`);
  await mkdir(probeDirectory, { recursive: true });
  await writeFile(probeFile, audio);
  try {
    const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', probeFile]);
    const seconds = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
  } catch {
    return 0;
  } finally {
    await rm(probeFile, { force: true });
  }
}

async function mapConcurrentOrdered<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results = Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, worker));
  return results;
}

export async function generateAnimationNarration(input: { project: AnimationProject; provider: AIProvider; model: string; voice: string; speed?: number; preservePlannedDuration?: boolean; strictSceneDurations?: boolean }, onStage: (stage: string) => Promise<void> = async () => {}) {
  let project = input.project;
  const speed = Math.max(.5, Math.min(2, Number(input.speed) || 1));
  const sentenceTasks = input.project.scenes.flatMap((scene) => scene.renderMode !== 'composite' || !scene.narration.trim()
    ? []
    : splitNarrationUnits(scene.narration).map((text, sentenceIndex) => ({ sceneId: scene.id, sceneName: scene.name, text, sentenceIndex })));
  if (!sentenceTasks.length) return project;

  const configuredConcurrency = Number(process.env.AUTOSUB_ANIMATION_TTS_CONCURRENCY);
  const requestedConcurrency = Math.max(1, Math.min(8, Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.round(configuredConcurrency) : 6));
  const ttsConcurrency = input.provider.providerType === 'capcut-tts' || input.provider.baseUrl.trim().toLowerCase() === 'local://capcut-tts'
    ? 1
    : input.provider.providerType === 'vieneu-local' ? Math.min(2, requestedConcurrency) : requestedConcurrency;
  const prepareSentence = async (task: typeof sentenceTasks[number], renderSpeed: number) => {
    const normalizedSpeed = Math.max(.5, Math.min(2, Number(renderSpeed) || 1));
    const cacheKey = createHash('sha256').update(JSON.stringify({ version: 1, kind: 'narration', text: task.text, provider: input.provider.id, model: input.model, voice: input.voice, speed: normalizedSpeed })).digest('hex');
    let asset = await findCachedAnimationAsset(cacheKey);
    let audio: Buffer | undefined;
    if (asset) audio = await readFile((await getAnimationAssetFile(asset.id)).path);
    else {
      const localVieNeu = input.provider.providerType === 'vieneu-local';
      const maxAttempts = localVieNeu ? 4 : 2;
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          audio = await synthesize(input.provider, input.model, input.voice, task.text, { speed: normalizedSpeed, format: 'wav' });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          const status = Number((error as { status?: unknown })?.status);
          if (error instanceof Error && error.name === 'AbortError') throw error;
          const retryable = localVieNeu
            ? !Number.isFinite(status) || status >= 500 || status === 429
            : !Number.isFinite(status) || status >= 500 || status === 429;
          if (!retryable || attempt >= maxAttempts) break;
          const delayMs = Math.min(2500, 400 * Math.pow(2, attempt - 1));
          await onStage(`${localVieNeu ? 'VieNeu Local' : 'TTS'} lỗi tạm thời ở cảnh “${task.sceneName}”, câu ${task.sentenceIndex + 1} · tự thử lại ${attempt + 1}/${maxAttempts}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      if (!audio) {
        const detail = String((lastError as { detail?: unknown })?.detail || (lastError instanceof Error ? lastError.message : lastError || 'Không rõ lỗi')).replace(/\s+/g, ' ').trim().slice(0, 300);
        throw new Error(`${localVieNeu ? 'VieNeu Local' : 'TTS'} không tạo được cảnh “${task.sceneName}”, câu ${task.sentenceIndex + 1} sau ${maxAttempts} lần thử.${detail ? ` Chi tiết: ${detail}` : ''}`);
      }
    }
    const measuredMs = await audioDurationMs(audio);
    if (!(measuredMs > 0)) throw new Error(`Không đo được audio câu ${task.sentenceIndex + 1} của cảnh “${task.sceneName}”. Đã giữ các tài nguyên tạo trước đó.`);
    const durationMs = Math.ceil(measuredMs * project.fps / 1000) * 1000 / project.fps;
    if (!asset) {
      const id = randomUUID();
      const extension = wavDurationMs(audio) > 0 ? 'wav' : 'mp3';
      const target = path.join(workdir, 'animation-assets', 'files', `${id}.${extension}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, audio);
      asset = await registerAnimationAsset({ id, type: 'audio', name: `Voiceover · ${task.sceneName} · ${task.sentenceIndex + 1}`, uri: `/api/animation-studio/assets/${id}/file`, tags: ['voiceover', 'narration'], createdAt: new Date().toISOString(), source: 'generated', cacheKey, generationPrompt: task.text });
    }
    return { ...task, asset, durationMs, speed: normalizedSpeed };
  };
  await onStage(`Lời đọc Turbo: ${sentenceTasks.length} câu · tối đa ${Math.min(ttsConcurrency, sentenceTasks.length)} câu song song`);
  const prepared = await mapConcurrentOrdered(sentenceTasks, ttsConcurrency, (task) => prepareSentence(task, speed));
  await onStage(`Đã tạo ${prepared.length}/${sentenceTasks.length} câu lời đọc · đang ráp timeline`);

  const preparedByScene = new Map<string, typeof prepared>();
  for (const item of prepared) preparedByScene.set(item.sceneId, [...(preparedByScene.get(item.sceneId) || []), item]);
  if (input.strictSceneDurations) {
    const frameMs = 1000 / Math.max(1, project.fps);
    for (const sourceScene of input.project.scenes) {
      if (sourceScene.renderMode !== 'composite' || !sourceScene.narration.trim()) continue;
      let units = (preparedByScene.get(sourceScene.id) || []).sort((a, b) => a.sentenceIndex - b.sentenceIndex);
      let measured = units.reduce((total, item) => total + item.durationMs, 0);
      if (measured <= sourceScene.durationMs + frameMs) continue;
      let fitSpeed = Math.min(1.2, Math.max(speed, speed * measured / Math.max(1, sourceScene.durationMs) * 1.03));
      await onStage(`Cảnh “${sourceScene.name}” có lời đọc dài hơn timeline · tự căn TTS nhẹ ${fitSpeed.toFixed(2)}×`);
      units = await mapConcurrentOrdered(units, ttsConcurrency, (item) => prepareSentence(item, fitSpeed));
      measured = units.reduce((total, item) => total + item.durationMs, 0);
      if (measured > sourceScene.durationMs + frameMs && fitSpeed < 1.3) {
        fitSpeed = Math.min(1.3, fitSpeed * measured / Math.max(1, sourceScene.durationMs) * 1.02);
        await onStage(`Cảnh “${sourceScene.name}” vẫn dài · căn TTS lần cuối ${fitSpeed.toFixed(2)}×`);
        units = await mapConcurrentOrdered(units, ttsConcurrency, (item) => prepareSentence(item, fitSpeed));
        measured = units.reduce((total, item) => total + item.durationMs, 0);
      }
      if (measured > sourceScene.durationMs + frameMs) throw new Error(`Lời đọc cảnh “${sourceScene.name}” vẫn vượt thời lượng đã khóa dù đã căn tốc độ tối đa hợp lý. Hãy rút gọn narration thay vì kéo dài video.`);
      preparedByScene.set(sourceScene.id, units);
    }
  }

  for (const sourceScene of input.project.scenes) {
    if (sourceScene.renderMode !== 'composite' || !sourceScene.narration.trim()) continue;
    const scene = project.scenes.find((item) => item.id === sourceScene.id);
    if (!scene || scene.renderMode !== 'composite') continue;
    const units = (preparedByScene.get(scene.id) || []).sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    const captions: NonNullable<SceneLayer['captionTimings']> = [];
    const audioLayers: SceneLayer[] = [];
    const newAssets: AnimationAsset[] = [];
    let cursor = 0;
    for (const item of units) {
      newAssets.push(item.asset);
      captions.push({ id: `sentence-${scene.id}-${item.sentenceIndex + 1}`, text: item.text, startMs: cursor, endMs: cursor + item.durationMs, source: 'measured-sentence' });
      audioLayers.push({ id: `voiceover-${scene.id}-${item.sentenceIndex}`, type: 'audio', name: `Voiceover · ${scene.name}`, assetId: item.asset.id, visible: true, locked: true, zIndex: 999, width: 1, height: 1, startMs: cursor, durationMs: item.durationMs, volume: 1, transform: defaultTransform() });
      cursor += item.durationMs;
    }
    const measuredDurationMs = cursor;
    const durationMs = input.preservePlannedDuration ? Math.max(scene.durationMs, measuredDurationMs) : measuredDurationMs;
    const oldCaptions = scene.layers.find((layer) => layer.name === 'Voiceover · Subtitle')?.captionTimings || allocateNarrationTimings(scene.narration, scene.durationMs);
    const retime = createSentenceTimeMapper(oldCaptions, captions, scene.durationMs, measuredDurationMs);
    const retimeVisuals = measuredDurationMs > scene.durationMs;
    const retimeCommand = (command: AnimationCommand): AnimationCommand => {
      if (!retimeVisuals) return command;
      const startMs = retime(command.startMs);
      const endMs = retime(command.startMs + command.durationMs);
      return { ...command, startMs, durationMs: Math.max(0, endMs - startMs) };
    };
    const whiteboardStyle = /whiteboard|doodle/i.test(`${project.styleProfile?.name || ''} ${project.styleProfile?.style || ''}`);
    const subtitleFill = whiteboardStyle ? '#263238' : '#ffffff';
    const subtitle: SceneLayer = { id: `subtitle-${scene.id}`, name: 'Voiceover · Subtitle', type: 'text', text: scene.narration, captionTimings: captions, visible: true, locked: false, zIndex: 1000, width: Math.round(project.width * .78), height: Math.round(Math.min(project.width, project.height) * .16), fill: subtitleFill, fontSize: Math.max(24, Math.round(Math.min(project.width, project.height) * .032)), transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height * .84 } } };
    const replacement: typeof scene = { ...scene, durationMs, layers: [...scene.layers.filter((layer) => !((layer.type === 'audio' || layer.type === 'text') && layer.name.startsWith('Voiceover ·'))).map((layer) => layer.type !== 'audio' ? layer : { ...layer, startMs: retime(layer.startMs || 0), durationMs: layer.durationMs === undefined ? undefined : Math.min(layer.durationMs, durationMs - retime(layer.startMs || 0)) }), ...audioLayers, subtitle], commands: scene.commands.filter((command) => !command.parameters?.autoVoiceover).map(retimeCommand), camera: { ...scene.camera, commands: scene.camera.commands.map(retimeCommand) } };
    const productionPlan = project.productionPlan ? {
      ...project.productionPlan,
      narrationUnits: project.productionPlan.narrationUnits.map((unit) => unit.sceneId === scene.id ? { ...unit, startMs: 0, endMs: measuredDurationMs, timingSource: 'measured-sentence' as const } : unit),
      beats: project.productionPlan.beats.map((beat) => beat.sceneId === scene.id && retimeVisuals ? { ...beat, startMs: retime(beat.startMs || 0), endMs: retime(beat.endMs ?? scene.durationMs) } : beat),
    } : undefined;
    project = { ...project, assets: [...new Map([...project.assets, ...newAssets].map((asset) => [asset.id, asset])).values()], productionPlan, assetManifest: undefined, scenes: project.scenes.map((item) => item.id === scene.id ? replacement : item), updatedAt: new Date().toISOString(), generationWarnings: (project.generationWarnings || []).filter((warning) => !warning.startsWith('Phụ đề đang ở mức câu') && !warning.startsWith('Timing được đo theo từng câu TTS')) };
  }
  return project;
}
