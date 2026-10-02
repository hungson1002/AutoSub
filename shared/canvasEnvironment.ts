import type { CanvasStudioScene } from './canvasAnimationStudio';

/** Same local geometry is used by the door panel and its architectural layout. */
export const CANVAS_DOOR_PANEL = { left: -30, top: -44, width: 60, height: 88 } as const;

export function canvasEnvironmentDoorway(backgroundRef: string | undefined, width: number, height: number) {
  if (backgroundRef !== 'bg:room-stilt-house' && backgroundRef !== 'bg:room-stilt-day') return undefined;
  return { x: width * .69, y: height * .23, width: width * .16, height: height * .47 };
}

/** Bind one procedural door to the real opening. Other doors stay free props.
 * Uploaded/generated plates have no known architectural coordinates.
 */
export function attachCanvasArchitecture(scene: CanvasStudioScene, width: number, height: number): CanvasStudioScene {
  const opening = !scene.backgroundImageUrl && canvasEnvironmentDoorway(scene.backgroundRef, width, height);
  if (!opening) return scene;
  const doors = scene.objects.filter(object => object.kind === 'prop' && !object.imageUrl && object.environmentAnchor !== 'free'
    && (object.variant === 'door' || object.assetRef === 'prop:door'));
  const door = doors.find(object => object.environmentAnchor === 'doorway') || doors[0];
  if (!door) return scene;
  const panelWidth = opening.width * 100 / CANVAS_DOOR_PANEL.width;
  const panelHeight = opening.height * 100 / CANVAS_DOOR_PANEL.height;
  return { ...scene, objects: scene.objects.map(object => object.id !== door.id ? object : {
    ...object, environmentAnchor: 'doorway',
    x: opening.x - CANVAS_DOOR_PANEL.left * panelWidth / 100,
    y: opening.y - CANVAS_DOOR_PANEL.top * panelHeight / 100,
    width: panelWidth, height: panelHeight,
    scale: 1, rotation: 0, motion: 'none', delayMs: 0, doorOpen: object.doorOpen ?? 0,
  }) };
}
