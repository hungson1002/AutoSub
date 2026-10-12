import type {
  CanvasBackgroundSpec,
  CanvasSpecGround,
  CanvasSpecSky,
  CanvasSpecStructure,
  CanvasSpecStructureKind,
} from './canvasAnimationStudio';

export const COMPOSED_BACKGROUND_REF = 'bg:composed';

export const CANVAS_SPEC_SKIES: CanvasSpecSky[] = ['night', 'dusk', 'dawn', 'overcast', 'day'];
export const CANVAS_SPEC_GROUNDS: CanvasSpecGround[] = ['dirt-path', 'grass', 'rice-field', 'stone-yard', 'mud', 'water-edge'];
export const CANVAS_SPEC_STRUCTURES: CanvasSpecStructureKind[] = [
  'stilt-house', 'ground-house', 'shrine', 'village-gate', 'well', 'grave-mound', 'fence', 'buffalo-shed', 'footbridge', 'altar-table',
];

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

/** Accepts loose AI output and returns a safe spec, or undefined when it is not a usable location description. */
export function normalizeCanvasBackgroundSpec(raw: unknown): CanvasBackgroundSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const item = raw as Record<string, unknown>;
  const sky = CANVAS_SPEC_SKIES.includes(item.sky as CanvasSpecSky) ? item.sky as CanvasSpecSky : undefined;
  const ground = CANVAS_SPEC_GROUNDS.includes(item.ground as CanvasSpecGround) ? item.ground as CanvasSpecGround : undefined;
  if (!sky || !ground) return undefined;
  const structures: CanvasSpecStructure[] = Array.isArray(item.structures)
    ? item.structures.slice(0, 4).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const entry = candidate as Record<string, unknown>;
        if (!CANVAS_SPEC_STRUCTURES.includes(entry.kind as CanvasSpecStructureKind)) return [];
        return [{
          kind: entry.kind as CanvasSpecStructureKind,
          x: clamp(entry.x, 0.06, 0.94, 0.5),
          scale: clamp(entry.scale, 0.5, 1.6, 1),
          ...(entry.lit === true ? { lit: true } : {}),
        }];
      })
    : [];
  return {
    sky,
    ...(item.moon === true ? { moon: true } : {}),
    ridges: Math.round(clamp(item.ridges, 0, 3, 1)),
    ground,
    structures,
    trees: Math.round(clamp(item.trees, 0, 8, 2)),
    fog: clamp(item.fog, 0, 1, 0.25),
    ...(Number.isFinite(Number(item.lampX)) ? { lampX: clamp(item.lampX, 0.05, 0.95, 0.5) } : {}),
    palette: ['cold', 'warm', 'ash'].includes(String(item.palette)) ? item.palette as 'cold' | 'warm' | 'ash' : 'cold',
  };
}
