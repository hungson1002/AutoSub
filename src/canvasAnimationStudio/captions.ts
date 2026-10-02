import type {CanvasStudioProject,CanvasStudioScene} from './types';

export function canvasCaptionAt(scene:CanvasStudioScene,timeMs:number):string {
  if(scene.captionTrack){const track=scene.captionTrack;return timeMs+track.offsetMs>=track.durationMs?'':canvasCaptionAt({...scene,captionTrack:undefined,dialogue:undefined,narration:track.text,durationMs:track.durationMs},timeMs+track.offsetMs);}
  if(scene.dialogue?.length){
    const line=scene.dialogue.find(l=>timeMs>=(l.atMs||0)&&timeMs<(l.atMs||0)+(l.durationMs||0));
    return line?canvasCaptionAt({...scene,dialogue:undefined,narration:line.text,durationMs:line.durationMs||1},timeMs-(line.atMs||0)):'';
  }
  const chunks=(scene.narration||'').trim().split(/(?<=[.!?…:])\s+/u).flatMap(clause=>{
    const words=clause.split(/\s+/);return words.length<=10?[clause]:Array.from({length:Math.ceil(words.length/9)},(_,i)=>words.slice(i*9,i*9+9).join(' '));
  }).filter(Boolean);
  const weights=chunks.map(c=>c.split(/\s+/).length),total=weights.reduce((s,n)=>s+n,0);
  let target=Math.max(0,Math.min(.999999,timeMs/Math.max(1,scene.durationMs)))*total;
  for(let i=0;i<chunks.length;i++){target-=weights[i]!;if(target<0)return chunks[i]!;}
  return chunks.at(-1)||'';
}

export function hasCanvasCaptions(project:CanvasStudioProject){
  return /ma\s*xó|ma\s*da|truyện\s*ma|kinh\s*dị|horror|ghost|haunted/iu.test(project.sourcePrompt||'');
}

export function drawCanvasCaption(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,timeMs:number,width:number,height:number){
  const caption=canvasCaptionAt(scene,timeMs);if(!caption)return;
  const size=Math.max(24,Math.round(height*.042));
  ctx.save();ctx.font=`700 ${size}px Arial, Helvetica, sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
  const lines:string[]=[];let current='';
  for(const word of caption.split(/\s+/)){
    const next=current?current+' '+word:word;
    if(current&&ctx.measureText(next).width>width*.84){lines.push(current);current=word;}else current=next;
  }
  if(current)lines.push(current);
  const bottom=height*.948-size*.18;
  lines.forEach((line,index)=>{
    const y=bottom-(lines.length-1-index)*size*1.28;
    ctx.strokeStyle='rgba(0,0,0,.96)';ctx.lineWidth=Math.max(2,Math.round(size*.09))*2;ctx.strokeText(line,width/2,y);
    ctx.fillStyle='#fff';ctx.fillText(line,width/2,y);
  });
  const speaker=scene.dialogue?.find(l=>timeMs>=(l.atMs||0)&&timeMs<(l.atMs||0)+(l.durationMs||0));
  if(speaker&&!/người kể|narrator|người dẫn/iu.test(speaker.speaker)){
    ctx.font=`700 ${Math.round(size*.72)}px Arial`;ctx.lineWidth=3;ctx.strokeText(speaker.speaker,width/2,bottom-lines.length*size*1.28);
    ctx.fillStyle='#ffd37b';ctx.fillText(speaker.speaker,width/2,bottom-lines.length*size*1.28);
  }
  ctx.restore();
}
