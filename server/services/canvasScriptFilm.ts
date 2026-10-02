import { randomUUID } from 'node:crypto';
import type {
  CanvasAnimationAction,
  CanvasSpriteAct,
  CanvasStudioProject,
  CanvasStudioScene,
} from '../../shared/canvasAnimationStudio';
import { createCanvasScene } from '../../shared/canvasAnimationStudio';

export type FilmLine = {
  speaker: string;
  text: string;
  action: CanvasAnimationAction;
  photo?: string;
};

export type FilmSceneInput = {
  title: string;
  background: string;
  lines: FilmLine[];
};

export type FilmCastMember = {
  name: string;
  archetype: 'warrior' | 'scholar' | 'villager' | 'narrator' | 'sailor';
  color: string;
  /** Điền ở F2: sheet talk/point của đúng người này. */
  talkSheetUrl?: string;
  pointSheetUrl?: string;
};

/**
 * Kịch bản text thuần:
 *   CẢNH 1 - Tên cảnh | nền: bãi cọc
 *   Tướng: Lời thoại...
 *   Lính: [chỉ] Lời thoại kèm hành động
 *   [ảnh: Cọc Bạch Đằng 1288]
 */
export function parseFilmScript(text: string): FilmSceneInput[] {
  const scenes: FilmSceneInput[] = [];
  let current: FilmSceneInput | null = null;
  let lastLine: FilmLine | null = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sceneMatch = line.match(/^CẢNH\s+\d+\s*[-–:]\s*(.+?)(\s*\|\s*nền\s*:\s*(.+))?$/i);
    if (sceneMatch) {
      current = { title: sceneMatch[1]!.trim(), background: (sceneMatch[3] || '').trim(), lines: [] };
      scenes.push(current);
      lastLine = null;
      continue;
    }
    if (!current) continue;
    const photoMatch = line.match(/^\[ảnh\s*:\s*(.+)\]$/i);
    if (photoMatch && lastLine) {
      lastLine.photo = photoMatch[1]!.trim();
      continue;
    }
    const dialogueMatch = line.match(/^([^:[\]]+)\s*:\s*(.+)$/);
    if (dialogueMatch) {
      let speech = dialogueMatch[2]!.trim();
      let action: CanvasAnimationAction = 'talk';
      const actionMatch = speech.match(/^\[(chỉ|ngạc nhiên|mừng|buồn|đứng)\]\s*/i);
      if (actionMatch) {
        const key = actionMatch[1]!.toLowerCase();
        action = key === 'chỉ' ? 'point' : key === 'ngạc nhiên' ? 'react' : key === 'mừng' ? 'celebrate' : key === 'buồn' ? 'brace' : 'talk';
        speech = speech.slice(actionMatch[0].length).trim();
      }
      lastLine = { speaker: dialogueMatch[1]!.trim(), text: speech, action };
      current.lines.push(lastLine);
    }
  }
  return scenes.filter((scene) => scene.lines.length > 0);
}

/** Ước lượng thời lượng nói tiếng Việt: ~13 ký tự/giây + đệm diễn. */
export function estimateSpeechMs(text: string): number {
  return Math.max(1200, Math.round((text.length / 13) * 1000) + 500);
}

const PALETTE = ['#e8b04f', '#7fb069', '#5d8aa8', '#d66d4b', '#9b7ede'];
const ARCHETYPES: FilmCastMember['archetype'][] = ['warrior', 'villager', 'scholar', 'sailor', 'narrator'];

export function buildCast(scenes: FilmSceneInput[]): FilmCastMember[] {
  const names = [...new Set(scenes.flatMap((s) => s.lines.map((l) => l.speaker)))];
  return names.map((name, i) => ({
    name,
    archetype: ARCHETYPES[i % ARCHETYPES.length]!,
    color: PALETTE[i % PALETTE.length]!,
  }));
}

export function compileFilm(
  scenes: FilmSceneInput[],
  cast: Array<FilmCastMember & { acts?: CanvasSpriteAct[] }>,
  options: { scenePaddingMs?: number } = {},
): CanvasStudioProject {
  const pad = options.scenePaddingMs ?? 1200;
  const now = new Date().toISOString();
  const projectScenes: CanvasStudioScene[] = scenes.map((scene, sceneIndex) => {
    const base = createCanvasScene(sceneIndex);
    // Thời lượng = tổng thoại + đệm. Mỗi lời thoại = 1 beat diễn đúng người đó.
    let cursor = 400;
    const beats: CanvasStudioScene['animationBeats'] = [];
    for (const [lineIndex,line] of scene.lines.entries()) {
      const durationMs = estimateSpeechMs(line.text);
      beats.push({
        id: `beat-${sceneIndex}-${beats.length}`,
        atMs: cursor,
        durationMs,
        action: line.action,
        targetIds: [`cast-${slug(line.speaker)}`],
        intensity: 1,
        speechCue: line.text,
        dialogueId: `line-${sceneIndex}-${lineIndex}`,
      });
      cursor += durationMs + 700;
    }
    const durationMs = cursor + pad;
    // Diễn viên đứng sẵn 2 bên như sân khấu: người đầu trái, người sau phải.
    const speakers = [...new Set(scene.lines.map((l) => l.speaker))];
    const slotFor = (name: string): 'mid-left' | 'mid-right' => (speakers.indexOf(name) % 2 === 0 ? 'mid-left' : 'mid-right');
    const objects: CanvasStudioScene['objects'] = speakers.map((name) => {
      const member = cast.find((c) => c.name === name);
      const acts: NonNullable<CanvasStudioScene['objects'][number]['spriteActs']> =
        member?.acts?.length ? member.acts : [];
      if (!acts.length) {
        if (member && 'talkSheetUrl' in member && member.talkSheetUrl) {
          acts.push({
            action: 'talk', imageUrl: member.talkSheetUrl as string,
            frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8,
          });
        }
        if (member && 'pointSheetUrl' in member && member.pointSheetUrl) {
          acts.push({
            action: 'point', imageUrl: member.pointSheetUrl as string,
            frameWidth: 338, frameHeight: 378, columns: 4, from: 0, to: 7, fps: 8, loop: false,
          });
        }
      }
      return {
        id: `cast-${slug(name)}`,
        kind: 'character',
        label: name,
        assetRef: `character:${member?.archetype || 'villager'}`,
        characterKey: `cast-${slug(name)}`,
        archetype: member?.archetype || 'villager',
        hair: 'short',
        role: 'focal',
        slot: slotFor(name),
        depth: 'foreground',
        sizeClass: 'large',
        pose: 'idle',
        expression: 'neutral',
        facing: slotFor(name) === 'mid-left' ? 'right' : 'left',
        x: 640, y: 360, width: 300, height: 380, scale: 1, rotation: 0, opacity: 1,
        color: member?.color || '#e8b04f',
        accent: '#22201f',
        zIndex: 20,
        motion: 'none',
        delayMs: 0, motionDurationMs: 480, motionCurve: 'snappy', motionIntensity: 1,
        ...(acts.length ? {
          imageUrl: acts[0]!.imageUrl,
          sprite: {
            frameWidth: acts[0]!.frameWidth, frameHeight: acts[0]!.frameHeight,
            columns: acts[0]!.columns, from: acts[0]!.from, to: acts[0]!.to, fps: acts[0]!.fps,
          },
          spriteActs: acts,
        } : {}),
      } as CanvasStudioScene['objects'][number];
    });
    const firstPhoto = scene.lines.find((l) => l.photo);
    if (firstPhoto?.photo) {
      objects.push({
        id: `photo-${sceneIndex}`,
        kind: 'image',
        label: firstPhoto.photo,
        x: 640, y: 360, width: 420, height: 520, scale: 1, rotation: 2, opacity: 1,
        color: '#fff', accent: '#000', zIndex: 15,
        slot: 'background-right',
        depth: 'midground', sizeClass: 'large',
        motion: 'pop', delayMs: 400, motionDurationMs: 480,
        motionCurve: 'snappy', motionIntensity: 1,
        imageUrl: '',
        credit: 'Ảnh tư liệu',
      } as CanvasStudioScene['objects'][number]);
      beats.push({
        id: `beat-${sceneIndex}-photo`,
        atMs: 600, durationMs: 2500, action: 'reveal',
        targetIds: [`photo-${sceneIndex}`], intensity: 1,
      });
    }
    objects.push({
      id: `title-${sceneIndex}`,
      kind: 'text', label: scene.title, text: scene.title,
      x: 640, y: 100, width: 640, height: 110, scale: 1, rotation: 0, opacity: 1,
      color: '#ffffff', accent: '#1f1f1f', zIndex: 30,
      slot: 'caption-top', depth: 'midground', sizeClass: 'medium',
      motion: 'pop', delayMs: 100, motionDurationMs: 400,
      motionCurve: 'snappy', motionIntensity: 1,
    } as CanvasStudioScene['objects'][number]);
    return {
      ...base,
      name: scene.title,
      durationMs,
      template: 'two-shot',
      background: 'river',
      narration: scene.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n'),
      dialogue: scene.lines.map((line,index)=>({id:`line-${sceneIndex}-${index}`,speaker:line.speaker,characterKey:`cast-${slug(line.speaker)}`,text:line.text})),
      camera: { shot: 'medium', motion: 'none', focusX: 640, focusY: 360, zoom: 1 },
      effects: [],
      animationBeats: beats.sort((a, b) => a.atMs - b.atMs),
      objects,
    };
  });
  return {
    version: 1,
    id: randomUUID(),
    name: 'Film tu kich ban',
    width: 1280,
    height: 720,
    fps: 30,
    createdAt: now,
    updatedAt: now,
    scenes: projectScenes,
  };
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cast';
}
