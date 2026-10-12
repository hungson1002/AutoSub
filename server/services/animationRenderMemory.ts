/** Serial Canvas export has one browser and one frame in flight. Keep a larger
 * reserve for multi-page Remotion and frames above full HD. Explicit operator
 * thresholds always retain priority. */
export function renderMemoryMinimumMB({canvas,streaming,configured}:{canvas?:{width:number;height:number};streaming?:boolean;configured?:string}={}){
  const override=Number(configured);
  if(Number.isFinite(override)&&override>0)return Math.max(512,override);
  if(streaming&&canvas&&Number.isFinite(canvas.width)&&Number.isFinite(canvas.height)
    &&canvas.width>0&&canvas.height>0&&canvas.width*canvas.height<=1920*1080)return 2048;
  return 3072;
}
