export type CanvasSceneTransitionMode='cut'|'stage-blend';

/**
 * Story shots are normally hard cuts. A same-stage non-editorial continuation
 * gets only a tiny 180ms blend so newly introduced layers do not pop while
 * recurring actors/backgrounds remain visually stationary.
 */
export function canvasTransitionProgress(
  timeMs:number,
  _durationMs:number,
  mode:CanvasSceneTransitionMode='cut',
){
  if(mode==='cut')return 1;
  return Math.max(0,Math.min(1,timeMs/180));
}
