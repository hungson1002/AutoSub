import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AnimationAsset } from '../../shared/animationStudio';
import { workdir } from './ffmpeg';
import type { AIProvider } from '../types';
import { buildAuthHeaders, providerBase, withAuthQuery } from '../providers/base';
import { synthesize } from '../adapters';
import type { AnimationProject } from '../../shared/animationStudio';
import { generateGoogleFlowImage } from './googleFlow';

const file = path.join(workdir, 'animation-assets', 'library.json');

async function readLibrary(): Promise<AnimationAsset[]> {
  try { const value = JSON.parse(await readFile(file, 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

async function writeLibrary(assets: AnimationAsset[]) {
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`;
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
  const assets = await readLibrary(); const asset = { ...value, id: value.id.trim(), name: value.name.trim(), uri: value.uri.trim(), tags: value.tags.map(String) };
  await writeLibrary([...assets.filter((item) => item.id !== asset.id), asset]); return asset;
}

export async function updateAnimationAsset(id: string, change: Partial<Pick<AnimationAsset, 'name' | 'tags' | 'style' | 'animations'>>) {
  const assets = await readLibrary(); const current = assets.find((asset) => asset.id === id); if (!current) throw new Error('Không tìm thấy asset.');
  const next: AnimationAsset = { ...current, ...(typeof change.name === 'string' ? { name: change.name.trim().slice(0, 160) || current.name } : {}), ...(Array.isArray(change.tags) ? { tags: change.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 30) } : {}), ...(typeof change.style === 'string' ? { style: change.style.trim().slice(0, 80) } : {}), ...(Array.isArray(change.animations) ? { animations: change.animations.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 40) } : {}) };
  await writeLibrary(assets.map((asset) => asset.id === id ? next : asset)); return next;
}

export async function resolveAnimationAssets(query: string, limit = 8) {
  const terms = words(query); const assets = await readLibrary();
  return assets.map((asset) => { const name = words(asset.name); const tags = words(asset.tags.join(' ')); const style = words(asset.style || ''); const matches = terms.filter((term) => name.includes(term) || tags.includes(term) || style.includes(term)); const score = matches.reduce((total, term) => total + (name.includes(term) ? 4 : 0) + (tags.includes(term) ? 2 : 0) + (style.includes(term) ? 1 : 0), 0); return { asset, score, reason: matches.length ? `Khớp: ${matches.join(', ')}` : 'Không khớp metadata' }; }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(30, limit)));
}

const generatedFile = (id: string) => path.join(workdir, 'animation-assets', 'files', `${id}.png`);
export async function getAnimationAssetFile(id: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Asset id không hợp lệ.'); for (const extension of ['png', 'wav']) { const target = path.join(workdir, 'animation-assets', 'files', `${id}.${extension}`); try { return { path: target, size: (await stat(target)).size, contentType: extension === 'wav' ? 'audio/wav' : 'image/png' }; } catch { /* try next format */ } } throw new Error('Không tìm thấy file asset.'); }

export async function generateAnimationAsset(input: { prompt: string; name?: string; type?: AnimationAsset['type']; tags?: string[]; style?: string; provider?: AIProvider; model?: string; generator?: 'flow-agent'; width?: number; height?: number }) {
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
  return registerAnimationAsset({ id, type: input.type || 'image', name: String(input.name || prompt).trim().slice(0, 160), uri: `/api/animation-studio/assets/${id}/file`, tags: Array.isArray(input.tags) ? input.tags.map(String) : words(prompt).slice(0, 12), style: String(input.style || '').trim().slice(0, 80) || undefined, width: input.width || 1024, height: input.height || 1024, createdAt: new Date().toISOString(), source: 'generated', generationPrompt: prompt });
}

export function wavDurationMs(audio: Buffer) {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return 0;
  const byteRate = audio.readUInt32LE(28); let offset = 12;
  while (offset + 8 <= audio.length) { const id = audio.toString('ascii', offset, offset + 4); const size = audio.readUInt32LE(offset + 4); if (id === 'data' && byteRate > 0) return Math.round(size / byteRate * 1000); offset += 8 + size + (size % 2); }
  return 0;
}

export async function generateAnimationNarration(input: { project: AnimationProject; provider: AIProvider; model: string; voice: string; speed?: number }) {
  let project = input.project;
  for (const scene of project.scenes) {
    if (scene.renderMode !== 'composite' || !scene.narration.trim()) continue;
    const audio = await synthesize(input.provider, input.model, input.voice, scene.narration, { speed: Math.max(.5, Math.min(2, Number(input.speed) || 1)), format: 'wav' }); const id = randomUUID(); const target = path.join(workdir, 'animation-assets', 'files', `${id}.wav`); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, audio);
    const asset = await registerAnimationAsset({ id, type: 'audio', name: `Voiceover · ${scene.name}`, uri: `/api/animation-studio/assets/${id}/file`, tags: ['voiceover', 'narration'], createdAt: new Date().toISOString(), source: 'generated', generationPrompt: scene.narration });
    const durationMs = Math.max(1000, wavDurationMs(audio) || scene.durationMs); const timingScale = durationMs / scene.durationMs;
    const words = scene.narration.trim().split(/\s+/); const wordDuration = durationMs / Math.max(1, words.length); const wordTimings = words.map((word, index) => ({ word, startMs: Math.round(index * wordDuration), endMs: Math.round((index + 1) * wordDuration) }));
    project = { ...project, assets: [...project.assets, asset], scenes: project.scenes.map((item) => { if (item.id !== scene.id || item.renderMode !== 'composite') return item; const speaking = item.layers.find((layer) => layer.type === 'sprite' && layer.visible); const commands = item.commands.map((command) => ({ ...command, startMs: Math.round(command.startMs * timingScale), durationMs: Math.round(command.durationMs * timingScale) })); return { ...item, durationMs, layers: [...item.layers.filter((layer) => !((layer.type === 'audio' || layer.type === 'text') && layer.name.startsWith('Voiceover ·'))), { id: `voiceover-${id}`, name: `Voiceover · ${scene.name}`, type: 'audio', assetId: id, visible: true, locked: true, zIndex: 999, width: 1, height: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }, { id: `subtitle-${id}`, name: `Voiceover · Subtitle`, type: 'text', text: scene.narration, wordTimings, visible: true, locked: false, zIndex: 1000, width: Math.round(project.width * .84), height: 180, fill: '#ffffff', fontSize: Math.max(28, Math.round(project.width * .038)), transform: { position: { x: project.width / 2, y: project.height * .84 }, scale: { x: 1, y: 1 }, rotation: 0, opacity: 1, anchor: { x: .5, y: .5 } } }], commands: speaking ? [...commands.filter((command) => !(command.type === 'TALK' && command.parameters?.autoVoiceover === true)), { id: `talk-${id}`, type: 'TALK', targetId: speaking.id, startMs: 0, durationMs, animation: 'talk', parameters: { autoVoiceover: true } }] : commands, camera: { ...item.camera, commands: item.camera.commands.map((command) => ({ ...command, startMs: Math.round(command.startMs * timingScale), durationMs: Math.round(command.durationMs * timingScale) })) } }; }), updatedAt: new Date().toISOString() };
  }
  return project;
}
