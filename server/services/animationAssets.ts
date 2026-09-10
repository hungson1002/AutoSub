import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { defaultTransform, type AnimationAsset, type AnimationCommand, type SceneLayer } from '../../shared/animationStudio';
import { run, workdir } from './ffmpeg';
import type { AIProvider } from '../types';
import { buildAuthHeaders, providerBase, withAuthQuery } from '../providers/base';
import { synthesize } from '../adapters';
import type { AnimationProject } from '../../shared/animationStudio';
import { generateGoogleFlowImage } from './googleFlow';
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
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(assets, null, 2), 'utf8');
  try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; }
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

type AnimationAssetGenerationInput = { prompt: string; name?: string; type?: AnimationAsset['type']; tags?: string[]; style?: string; provider?: AIProvider; model?: string; generator?: 'flow-agent'; width?: number; height?: number };

export function animationAssetCacheKey(input: AnimationAssetGenerationInput) {
  const prompt = String(input.prompt || '').trim().slice(0, 4000);
  return createHash('sha256').update(JSON.stringify({ geometryVersion: 2, prompt, name: String(input.name || '').trim().slice(0, 160), type: input.type || 'image', style: String(input.style || '').trim().slice(0, 80), generator: input.generator || 'provider', provider: input.provider?.id || '', model: input.model || '', width: Number(input.width) || 1024, height: Number(input.height) || 1024 })).digest('hex');
}

export async function findCachedAnimationAsset(cacheKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(cacheKey)) return undefined;
  const asset = (await readLibrary()).find((item) => item.cacheKey?.toLowerCase() === cacheKey.toLowerCase() && item.status !== 'rejected');
  if (!asset) return undefined;
  try { await getAnimationAssetFile(asset.id); return asset; } catch { return undefined; }
}

const generationLocks = new Map<string, Promise<AnimationAsset>>();

async function generateAnimationAssetUncached(input: AnimationAssetGenerationInput & { cacheKey: string }) {
  const prompt = String(input.prompt || '').trim().slice(0, 4000); if (prompt.length < 8) throw new Error('Mô tả asset cần ít nhất 8 ký tự.');
  const id = randomUUID(); await mkdir(path.dirname(generatedFile(id)), { recursive: true });
  if (input.generator === 'flow-agent') {
    await generateGoogleFlowImage(prompt, generatedFile(id), { model: input.model || 'narwhal', size: `${input.width || 1024}x${input.height || 1024}` });
  } else {
    if (!input.provider || !input.model) throw new Error('Thiếu provider/model tạo ảnh.');
    const url = withAuthQuery(`${providerBase(input.provider)}/images/generations`, input.provider); const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...buildAuthHeaders(input.provider) }, body: JSON.stringify({ model: input.model, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }) });
    if (!response.ok) throw new Error(`Image provider trả lỗi ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const body = await response.json() as { data?: Array<{ b64_json?: string }> }; const encoded = body.data?.[0]?.b64_json; if (!encoded) throw new Error('Image provider không trả ảnh base64. Hãy dùng model/API tương thích images/generations.');
    const bytes = Buffer.from(encoded, 'base64'); if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error('Ảnh sinh ra trống hoặc vượt quá 30 MB.');
    await writeFile(generatedFile(id), bytes);
  }
  // Decode before registration and use actual geometry, not requested dimensions.
  const source = await readFile(generatedFile(id));
  const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true });
  await writeFile(generatedFile(id), data);
  return registerAnimationAsset({ id, type: input.type || 'image', name: String(input.name || prompt).trim().slice(0, 160), uri: `/api/animation-studio/assets/${id}/file`, tags: Array.isArray(input.tags) ? input.tags.map(String) : words(prompt).slice(0, 12), style: String(input.style || '').trim().slice(0, 80) || undefined, width: info.width, height: info.height, createdAt: new Date().toISOString(), source: 'generated', status: 'candidate', cacheKey: input.cacheKey, generationPrompt: prompt });
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

export async function generateAnimationNarration(input: { project: AnimationProject; provider: AIProvider; model: string; voice: string; speed?: number }, onStage: (stage: string) => Promise<void> = async () => {}) {
  let project = input.project;
  const speed = Math.max(.5, Math.min(2, Number(input.speed) || 1));
  for (const scene of input.project.scenes) {
    if (scene.renderMode !== 'composite' || !scene.narration.trim()) continue;
    const sentences = splitNarrationUnits(scene.narration);
    const captions: NonNullable<SceneLayer['captionTimings']> = [];
    const audioLayers: SceneLayer[] = [];
    const newAssets: AnimationAsset[] = [];
    let cursor = 0;
    for (const [index, text] of sentences.entries()) {
      await onStage(`Lời đọc: ${scene.name}, câu ${index + 1}/${sentences.length}`);
      const cacheKey = createHash('sha256').update(JSON.stringify({ version: 1, kind: 'narration', text, provider: input.provider.id, model: input.model, voice: input.voice, speed })).digest('hex');
      let asset = await findCachedAnimationAsset(cacheKey);
      let audio: Buffer;
      if (asset) audio = await readFile((await getAnimationAssetFile(asset.id)).path);
      else audio = await synthesize(input.provider, input.model, input.voice, text, { speed, format: 'wav' });
      const measuredMs = await audioDurationMs(audio);
      if (!(measuredMs > 0)) throw new Error(`Không đo được audio câu ${index + 1} của cảnh “${scene.name}”. Đã giữ các tài nguyên tạo trước đó.`);
      // Ceil each audio unit to a frame, so the last samples are never trimmed.
      const durationMs = Math.ceil(measuredMs * project.fps / 1000) * 1000 / project.fps;
      if (!asset) {
        const id = randomUUID();
        const extension = wavDurationMs(audio) > 0 ? 'wav' : 'mp3';
        const target = path.join(workdir, 'animation-assets', 'files', `${id}.${extension}`);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, audio);
        asset = await registerAnimationAsset({ id, type: 'audio', name: `Voiceover · ${scene.name} · ${index + 1}`, uri: `/api/animation-studio/assets/${id}/file`, tags: ['voiceover', 'narration'], createdAt: new Date().toISOString(), source: 'generated', cacheKey, generationPrompt: text });
      }
      newAssets.push(asset);
      captions.push({ id: `sentence-${scene.id}-${index + 1}`, text, startMs: cursor, endMs: cursor + durationMs, source: 'measured-sentence' });
      audioLayers.push({ id: `voiceover-${scene.id}-${index}`, type: 'audio', name: `Voiceover · ${scene.name}`, assetId: asset.id, visible: true, locked: true, zIndex: 999, width: 1, height: 1, startMs: cursor, durationMs, volume: 1, transform: defaultTransform() });
      cursor += durationMs;
    }
    const durationMs = cursor;
    const oldCaptions = scene.layers.find((layer) => layer.name === 'Voiceover · Subtitle')?.captionTimings || allocateNarrationTimings(scene.narration, scene.durationMs);
    const retime = createSentenceTimeMapper(oldCaptions, captions, scene.durationMs, durationMs);
    const retimeCommand = (command: AnimationCommand): AnimationCommand => {
      const startMs = retime(command.startMs);
      const endMs = retime(command.startMs + command.durationMs);
      return { ...command, startMs, durationMs: Math.max(0, endMs - startMs) };
    };
    const subtitle: SceneLayer = { id: `subtitle-${scene.id}`, name: 'Voiceover · Subtitle', type: 'text', text: scene.narration, captionTimings: captions, visible: true, locked: false, zIndex: 1000, width: Math.round(project.width * .78), height: Math.round(Math.min(project.width, project.height) * .16), fill: '#ffffff', fontSize: Math.max(24, Math.round(Math.min(project.width, project.height) * .032)), transform: { ...defaultTransform(), position: { x: project.width / 2, y: project.height * .84 } } };
    const replacement: typeof scene = { ...scene, durationMs, layers: [...scene.layers.filter((layer) => !((layer.type === 'audio' || layer.type === 'text') && layer.name.startsWith('Voiceover ·'))).map((layer) => layer.type !== 'audio' ? layer : { ...layer, startMs: retime(layer.startMs || 0), durationMs: layer.durationMs === undefined ? undefined : Math.min(layer.durationMs, durationMs - retime(layer.startMs || 0)) }), ...audioLayers, subtitle], commands: scene.commands.filter((command) => !command.parameters?.autoVoiceover).map(retimeCommand), camera: { ...scene.camera, commands: scene.camera.commands.map(retimeCommand) } };
    const productionPlan = project.productionPlan ? {
      ...project.productionPlan,
      narrationUnits: project.productionPlan.narrationUnits.map((unit) => unit.sceneId === scene.id ? { ...unit, startMs: retime(unit.startMs || 0), endMs: retime(unit.endMs ?? scene.durationMs), timingSource: 'measured-sentence' as const } : unit),
      beats: project.productionPlan.beats.map((beat) => beat.sceneId === scene.id ? { ...beat, startMs: retime(beat.startMs || 0), endMs: retime(beat.endMs ?? scene.durationMs) } : beat),
    } : undefined;
    project = { ...project, assets: [...new Map([...project.assets, ...newAssets].map((asset) => [asset.id, asset])).values()], productionPlan, assetManifest: undefined, scenes: project.scenes.map((item) => item.id === scene.id ? replacement : item), updatedAt: new Date().toISOString(), generationWarnings: [...new Set([...(project.generationWarnings || []).filter((warning) => !warning.startsWith('Phụ đề đang ở mức câu')), 'Timing được đo theo từng câu TTS; cue giữa câu chưa có forced alignment.'])] };
  }
  return project;
}
