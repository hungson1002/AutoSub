import { createHash } from 'node:crypto';
import type { AnimationAsset } from '../../shared/animationStudio';

export interface CharacterDesign { name: string; kind: 'stick' | 'robot'; color?: string }
export const characterClips = ['idle', 'walk', 'run', 'point', 'talk'] as const;
const frames = 12;

// Original articulated vector drawings. Each cell is rendered from the same
// rig and palette, so generated frames cannot drift in identity or crop size.
export function characterFrame(design: CharacterDesign, clip: typeof characterClips[number], frame: number) {
  const color = /^#[0-9a-f]{6}$/i.test(design.color || '') ? design.color! : '#54d8c2';
  const phase = frame / frames * Math.PI * 2;
  const moving = clip === 'walk' || clip === 'run';
  const stride = moving ? Math.sin(phase) * (clip === 'run' ? 42 : 25) : 0;
  const bob = moving ? -Math.abs(Math.sin(phase)) * (clip === 'run' ? 8 : 3) : Math.sin(phase) * 1.4;
  const blink = frame === 10;
  const arm = (x: number, angle: number, far = false) => `<g transform="translate(${x} 108) rotate(${angle})"><path d="M0 0 L0 29 L5 53" fill="none" stroke="${far ? '#244b58' : color}" stroke-width="${design.kind === 'robot' ? 15 : 8}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="53" r="7" fill="#eaf7f3"/></g>`;
  const leg = (x: number, angle: number, far = false) => `<g transform="translate(${x} 158) rotate(${angle})"><path d="M0 0 L0 27 L${moving ? Math.max(0, Math.sin(phase + (far ? Math.PI : 0))) * 13 : 0} 53" fill="none" stroke="${far ? '#244b58' : color}" stroke-width="${design.kind === 'robot' ? 17 : 9}" stroke-linecap="round"/><path d="M-7 56 L13 56" stroke="#eaf7f3" stroke-width="10" stroke-linecap="round"/></g>`;
  const pointing = clip === 'point' ? -105 + Math.sin(phase) * 3 : clip === 'talk' ? -38 + Math.sin(phase) * 12 : -stride;
  return `<g transform="translate(0 ${bob.toFixed(2)})">${arm(112, stride, true)}${leg(116, -stride, true)}${leg(140, stride)}${design.kind === 'robot' ? `<rect x="104" y="101" width="48" height="62" rx="15" fill="${color}" stroke="#163442" stroke-width="5"/><rect x="115" y="118" width="26" height="24" rx="7" fill="#163442"/><circle cx="128" cy="130" r="6" fill="#ffd687"/>` : `<path d="M128 96 L128 157" stroke="${color}" stroke-width="10" stroke-linecap="round"/>`}${arm(145, pointing)}<g transform="rotate(${clip === 'talk' ? Math.sin(phase) * 3 : 0} 128 74)">${design.kind === 'robot' ? `<path d="M128 43 V29" stroke="${color}" stroke-width="5"/><circle cx="128" cy="27" r="6" fill="#ffd687"/><rect x="91" y="44" width="74" height="52" rx="17" fill="${color}" stroke="#163442" stroke-width="5"/><rect x="101" y="55" width="54" height="30" rx="11" fill="#163442"/>` : '<circle cx="128" cy="70" r="30" fill="#f5fbf7" stroke="#163442" stroke-width="5"/>'}<path d="M111 66 v${blink ? 1 : 7} M139 66 v${blink ? 1 : 7}" stroke="${design.kind === 'robot' ? '#eaf7f3' : '#163442'}" stroke-width="5" stroke-linecap="round"/><ellipse cx="128" cy="80" rx="${clip === 'talk' ? 5 : 4}" ry="${clip === 'talk' ? 2 + Math.abs(Math.sin(phase * 2)) * 4 : 1.5}" fill="${design.kind === 'robot' ? '#ffd687' : '#163442'}"/></g></g>`;
}

export function createProceduralCharacter(design: CharacterDesign): AnimationAsset {
  if (!['stick', 'robot'].includes(design.kind)) throw new Error('Chỉ hỗ trợ rig người que và robot.');
  const normalized = { kind: design.kind, color: /^#[0-9a-f]{6}$/i.test(design.color || '') ? design.color!.toLowerCase() : '#54d8c2', name: String(design.name || 'Nhân vật').slice(0, 80) };
  const id = `rig-${createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 20)}`;
  const cells = characterClips.flatMap((clip, row) => Array.from({ length: frames }, (_, frame) => `<svg x="${frame * 256}" y="${row * 256}" width="256" height="256" viewBox="0 0 256 256">${characterFrame(normalized, clip, frame)}</svg>`)).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3072" height="1280" viewBox="0 0 3072 1280">${cells}</svg>`;
  return { id, name: normalized.name, type: 'sprite', uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, tags: ['procedural', normalized.kind, 'articulated'], style: 'flat 2D vector', width: 256, height: 256, createdAt: new Date().toISOString(), source: 'generated', animations: [...characterClips], sprite: { frameWidth: 256, frameHeight: 256, columns: frames, frameCount: frames * characterClips.length, clips: Object.fromEntries(characterClips.map((clip, row) => [clip, { from: row * frames, to: row * frames + frames - 1, fps: clip === 'run' ? 18 : 12, loop: true }])) } };
}
