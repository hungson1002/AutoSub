import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ANIMATION_PROJECT_VERSION,
  assertAnimationProject,
  type AnimationProject,
} from '../../shared/animationStudio';
import { workdir } from './ffmpeg';

const projectsRoot = path.join(workdir, 'animation-projects');
const safeId = (value: string) => /^[a-f0-9-]{36}$/i.test(value) ? value : '';
const projectFile = (id: string) => path.join(projectsRoot, safeId(id), 'project.json');
const versionsDir = (id: string) => path.join(projectsRoot, safeId(id), 'versions');

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try { await rename(temporary, file); }
  catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function createEmptyAnimationProject(input: { name?: string; width?: number; height?: number; fps?: number } = {}): AnimationProject {
  const now = new Date().toISOString();
  return {
    schemaVersion: ANIMATION_PROJECT_VERSION,
    id: randomUUID(),
    name: String(input.name || 'Untitled animation').trim().slice(0, 120) || 'Untitled animation',
    width: Math.max(1, Math.min(7680, Math.round(Number(input.width) || 1080))),
    height: Math.max(1, Math.min(7680, Math.round(Number(input.height) || 1920))),
    fps: Math.max(1, Math.min(120, Math.round(Number(input.fps) || 30))),
    createdAt: now,
    updatedAt: now,
    assets: [],
    scenes: [],
  };
}

export async function saveAnimationProject(value: unknown, expectedId?: string) {
  assertAnimationProject(value);
  if (expectedId && value.id !== expectedId) throw new Error('Project id does not match the request path.');
  if (!safeId(value.id)) throw new Error('Project id is invalid.');
  try { const previous = await readFile(projectFile(value.id), 'utf8'); if (previous !== JSON.stringify(value, null, 2)) await writeJsonAtomic(path.join(versionsDir(value.id), `${Date.now()}.json`), JSON.parse(previous)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const project: AnimationProject = { ...value, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(projectFile(project.id), project);
  return project;
}

export async function listAnimationProjectVersions(id: string) {
  if (!safeId(id)) throw new Error('Project id is invalid.');
  try { const files = (await readdir(versionsDir(id))).filter((name) => /^\d+\.json$/.test(name)).sort().reverse(); return Promise.all(files.slice(0, 50).map(async (name) => { const project = JSON.parse(await readFile(path.join(versionsDir(id), name), 'utf8')) as AnimationProject; return { id: name.replace('.json', ''), createdAt: new Date(Number(name.replace('.json', ''))).toISOString(), name: project.name, sceneCount: project.scenes.length }; })); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function restoreAnimationProjectVersion(id: string, versionId: string) {
  if (!safeId(id) || !/^\d+$/.test(versionId)) throw new Error('Project/version id is invalid.'); const value: unknown = JSON.parse(await readFile(path.join(versionsDir(id), `${versionId}.json`), 'utf8')); assertAnimationProject(value); return saveAnimationProject({ ...value, id, updatedAt: new Date().toISOString() }, id);
}

export async function getAnimationProject(id: string) {
  const validId = safeId(id);
  if (!validId) throw new Error('Animation project id is invalid.');
  const value: unknown = JSON.parse(await readFile(projectFile(validId), 'utf8'));
  assertAnimationProject(value);
  return value;
}

export async function createAnimationProject(input: { name?: string; width?: number; height?: number; fps?: number } = {}) {
  return saveAnimationProject(createEmptyAnimationProject(input));
}
