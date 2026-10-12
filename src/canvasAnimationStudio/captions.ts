import type {CanvasStudioProject,CanvasStudioScene} from './types';
import { isFolkHorrorScene, isFolkHorrorBrief } from '../../shared/canvasFolkHorror';

export function canvasCaptionAt(scene:CanvasStudioScene,timeMs:number):string {
  if(scene.captionTrack){const track=scene.captionTrack;return timeMs+track.offsetMs>=track.durationMs?'':canvasCaptionAt({...scene,captionTrack:undefined,dialogue:undefined,narration:track.text,durationMs:track.durationMs},timeMs+track.offsetMs);}
  if(scene.dialogue?.length){
    const line=scene.dialogue.find(l=>timeMs>=(l.atMs||0)&&timeMs<(l.atMs||0)+(l.durationMs||0));
    if(!line)return '';
    const local=timeMs-(line.atMs||0);
    const windows=(scene.vectorScene||isFolkHorrorScene(scene))?(line.speechWindows||[]).filter(w=>Number.isFinite(w.startMs)&&Number.isFinite(w.endMs)
      &&w.startMs>=0&&w.endMs>w.startMs&&w.endMs<=(line.durationMs||0)).sort((a,b)=>a.startMs-b.startMs):[];
    if(windows.length){
      const sentences=line.text.trim().split(/(?<=[.!?…:])\s+/u).filter(Boolean);
      const groups:Array<{startMs:number;endMs:number}>=[];
      for(const window of windows){
        const last=groups.at(-1);
        if(last&&window.startMs-last.endMs<400)last.endMs=window.endMs;
        else groups.push({...window});
      }
      if(sentences.length>1&&sentences.length===groups.length){
        let index=0;
        for(let i=1;i<groups.length;i++)if(groups[i]!.startMs<=local)index=i;
        const group=groups[index]!;
        return canvasCaptionAt({...scene,dialogue:undefined,narration:sentences[index]!,durationMs:group.endMs-group.startMs},local-group.startMs);
      }
      const total=windows.reduce((sum,w)=>sum+w.endMs-w.startMs,0);
      let voiced=0,inPause=false;
      for(const window of windows){
        if(local<window.startMs){inPause=true;break;}
        voiced+=Math.min(local,window.endMs)-window.startMs;
        if(local<window.endMs)break;
      }
      return canvasCaptionAt({...scene,dialogue:undefined,narration:line.text,durationMs:total},Math.max(0,voiced-(inPause?.001:0)));
    }
    return canvasCaptionAt({...scene,dialogue:undefined,narration:line.text,durationMs:line.durationMs||1},local);
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
  if(project.scenes.some(scene=>scene.vectorScene))return true;
  return isFolkHorrorBrief(project.sourcePrompt || '') || /ma\s*xó|ma\s*da|truyện\s*ma|kinh\s*dị|horror|ghost|haunted/iu.test(project.sourcePrompt||'');
}

export function drawCanvasCaption(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,timeMs:number,width:number,height:number){
  const caption=canvasCaptionAt(scene,timeMs);if(!caption)return;
  const folk = isFolkHorrorScene(scene);
  const vector=Boolean(scene.vectorScene);
  const size=Math.max(20,Math.round(vector ? Math.min(height*.034,width*.052) : folk ? Math.min(height*.025,width*.042) : height*.032));
  ctx.save();ctx.font=`600 ${size}px Arial, Helvetica, sans-serif`;ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.lineJoin='round';
  const lines:string[]=[];let current='';
  for(const word of caption.split(/\s+/)){
    const next=current?current+' '+word:word;
    if(current&&ctx.measureText(next).width>width*.78){lines.push(current);current=word;}else current=next;
  }
  if(current)lines.push(current);
  const bottom=vector ? height*.155 : folk ? height*.18 : height*.955-size*.2;
  const lineHeight=size*1.22;
  if(vector){ctx.fillStyle='rgba(0,0,0,.38)';ctx.fillRect(width*.08,bottom-lines.length*lineHeight-size*.35,width*.84,lines.length*lineHeight+size*.7);}
  lines.forEach((line,index)=>{
    const y=bottom-(lines.length-1-index)*lineHeight;
    ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineWidth=Math.max(3,Math.round(size*.13));ctx.strokeText(line,width/2,y);
    ctx.fillStyle='rgba(255,255,255,.96)';ctx.fillText(line,width/2,y);
  });
  const speaker=scene.dialogue?.find(l=>timeMs>=(l.atMs||0)&&timeMs<(l.atMs||0)+(l.durationMs||0));
  if(speaker&&!/người kể|narrator|người dẫn/iu.test(speaker.speaker)){
    ctx.font=`600 ${Math.round(size*.68)}px Arial`;ctx.lineWidth=2.5;ctx.strokeText(speaker.speaker,width/2,bottom-lines.length*size*1.22);
    ctx.fillStyle='rgba(255,220,155,.9)';ctx.fillText(speaker.speaker,width/2,bottom-lines.length*size*1.22);
  }
  ctx.restore();
}
