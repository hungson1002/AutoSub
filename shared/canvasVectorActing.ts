import type {CanvasStudioScene} from './canvasAnimationStudio';
import {evaluateVectorPart,vectorTrackTiming,type VectorDrawing,type VectorTrack} from './canvasVectorScene';
import {vectorPigWalkTracks} from './canvasVectorPig';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {vectorSubjectCamera} from './canvasVectorFraming';

/** Mechanical constraints for native rigs. Story beats select the action;
 * joint chains and support geometry determine how it can actually happen. */
export function groundDirectedActing(input:CanvasStudioScene,assets:Record<string,VectorDrawing>):CanvasStudioScene {
  if(!input.vectorDirection||!input.vectorScene?.ground)return input;
  let scene={...input,vectorScene:{...input.vectorScene,tracks:[...input.vectorScene.tracks]}};
  let reframed=false,contactActor:string|undefined;
  const replace=(targets:string[],tracks:VectorTrack[])=>{
    scene={...scene,vectorScene:{...scene.vectorScene,tracks:[...scene.vectorScene.tracks.filter(t=>!targets.includes(t.target)),...tracks]}};
  };
  const held=(target:string,rotation:number):VectorTrack=>({target,start:0,end:1,frames:[{t:0,rotation,easing:'smooth'}]});
  for(const node of scene.vectorScene.nodes.filter(n=>n.type==='instance'&&n.groundAnchor)){
    const asset=assets[node.asset!]!,pig=asset.width===360&&asset.height===240&&asset.nodes.some(n=>n.id==='body-pose');
    const human=asset.width===240&&asset.height===480&&asset.nodes.some(n=>n.id==='upper-body');
    if(!pig&&!human)continue;
    const beats=input.vectorDirection.beats.filter(b=>b.targets.includes(node.id)||b.motionTargets.some(t=>t.startsWith(node.id+'/')));
    // A distal joint cannot translate independently of its bone. Eye tracking,
    // torso shifts and intentional root travel retain their own channels.
    scene.vectorScene.tracks=scene.vectorScene.tracks.map(t=>{
      if(!t.target.startsWith(node.id+'/')||!/^((?:arm|forearm|hand|leg|knee|foot|hoof)-[a-z]+)$/.test(t.target.split('/')[1]!))return t;
      return {...t,frames:t.frames.map(({dx:_x,dy:_y,...f})=>f)};
    });
    if(pig){
      const roots=scene.vectorScene.tracks.filter(t=>t.target===node.id);
      const falling=beats.some(b=>/ngã|lăn (?:ra|xuống)|nằm (?:ngửa|nghiêng)/i.test(b.cue+' '+b.after));
      const rears=falling?[]:roots.filter(t=>t.frames.some(f=>Math.abs(f.rotation??0)>35));
      if(rears.length){
        const body=rears.map(t=>({...t,target:node.id+'/body-pose',frames:t.frames.map(f=>({t:f.t,rotation:f.rotation??0,easing:f.easing}))}));
        replace([node.id+'/body-pose'],body);
        scene.vectorScene.tracks=scene.vectorScene.tracks.map(t=>t.target!==node.id?t:{...t,frames:t.frames.map(({rotation:_r,dy:_y,...f})=>f)});
        // Keep the head approximately level as the trunk rises.
        const initialHead=evaluateVectorPart(node.id+'/head-group',scene,0).rotation;
        replace([node.id+'/head-group'],body.map(t=>({...t,target:node.id+'/head-group',frames:t.frames.map((f,i)=>({...f,rotation:i?-(f.rotation??0):initialHead}))})));
        reframed=true;
      }
      const upright=scene.vectorScene.tracks.some(t=>t.target===node.id+'/body-pose'&&t.frames.some(f=>Math.abs(f.rotation??0)>35));
      if(upright)reframed=true;
      const travel=beats.find(b=>b.kind==='travel');
      if(travel&&upright){
        const root=scene.vectorScene.tracks.find(t=>t.target===node.id&&t.frames.some(f=>f.dx!==undefined&&f.dx!==t.frames[0]!.dx));
        if(root){
          const from=root.frames[0]!.dx??0,dx=(root.frames.at(-1)!.dx??0)-from;
          const sx=(node.width??asset.width)/asset.width*(node.scaleX??1);
          if(Math.abs(dx)>1&&Math.abs(dx/sx)<=228){
            const walk=vectorPigWalkTracks(node,asset,dx,{start:root.start,end:root.end,cue:root.cue,offsetX:from,biped:true});
            replace([...new Set([node.id,...walk.map(t=>t.target)])],walk);
          }
        }
      }
      const contact=beats.find(b=>b.motionTargets.includes(node.id+'/snout')&&b.motionTargets.some(t=>/^.*\/hoof-f[lr]$/.test(t)));
      if(contact){
        const side=contact.motionTargets.find(t=>/\/hoof-f[lr]$/.test(t))!.split('-').at(-1)!;
        const old=scene.vectorScene.tracks.filter(t=>t.target===node.id+'/hoof-'+side);
        const last=old.find(t=>t.cue===contact.cue)||old.at(-1);
        if(last){
          const at=vectorTrackTiming(last,scene).end;
          const hip=asset.nodes.find(n=>n.id==='leg-'+side)!;
          const m=vectorWorldMatrix(node.id+'/body-pose',scene,at,assets),p=vectorPoint(vectorWorldMatrix(node.id+'/snout',scene,at,assets),0,0);
          const det=m.a*m.d-m.b*m.c;
          const x=(m.d*(p.x-m.e)-m.c*(p.y-m.f))/det-(hip.x??0),y=(-m.b*(p.x-m.e)+m.a*(p.y-m.f))/det-(hip.y??0)+10;
          const distance=Math.hypot(x,y);
          if(distance>1&&distance<84){
            const knee=-Math.acos(Math.max(-1,Math.min(1,(distance**2-2*42**2)/(2*42**2))))*180/Math.PI;
            const upper=(Math.atan2(y,x)-Math.atan2(42*Math.sin(knee*Math.PI/180),42+42*Math.cos(knee*Math.PI/180))-Math.PI/2)*180/Math.PI;
            const first=old[0]!,start=vectorTrackTiming(first,scene).start/scene.durationMs,end=at/scene.durationMs;
            const rounded=(v:number)=>Math.round(v*1e8)/1e8;
            const poses:[string,number][]=[['leg-'+side,rounded(upper)],['knee-'+side,rounded(knee)],['hoof-'+side,rounded(-upper-knee)]];
            const solved=poses.map(([part,rotation]):VectorTrack=>({target:node.id+'/'+part,start:Math.min(start,.98),end:Math.max(Math.min(1,end),Math.min(start,.98)+.01),
              frames:[{t:0,rotation:evaluateVectorPart(node.id+'/'+part,scene,0).rotation,easing:'smooth'},{t:.7,rotation,easing:'smooth'},{t:1,rotation,easing:'smooth'}]}));
            replace(poses.map(([part])=>node.id+'/'+part),solved);contactActor=node.id;reframed=true;
          }
        }
      }
    }
    if(human){
      const recline=beats.find(b=>/ngả lưng|nằm (?:xuống|nghiêng)|ngã (?:lăn|chúi|xuống)/i.test(b.cue+' '+b.after));
      if(recline){
        const authored=scene.vectorScene.tracks.find(t=>t.cue===recline.cue&&(t.target===node.id||t.target===node.id+'/upper-body'));
        if(authored){
          const {start,end,cue}=authored;
          const fall=/ngã/i.test(recline.cue);
          const neighbours=scene.vectorScene.nodes.filter(n=>n.type==='instance'&&n.id!==node.id&&n.groundAnchor&&assets[n.asset!]?.nodes.some(p=>p.id==='head-group'));
          const nearest=neighbours.sort((a,b)=>Math.abs((a.x??0)-(node.x??0))-Math.abs((b.x??0)-(node.x??0)))[0];
          // Land in the open space, not head-first behind the neighbouring
          // actor's opaque torso. Keep the same set and root travel distance.
          const sign=fall&&nearest&&(nearest.x??0)>(node.x??0)?-1:1;
          const parts:[string,number][]=[['upper-body',sign*88],['leg-l',sign*85],['leg-r',sign*70],['knee-l',18],['knee-r',32],['foot-l',-sign*85-18],['foot-r',-sign*70-32]];
          for(const side of ['l','r']){
            // Both palms support the reclining torso, with the correct elbow
            // bending plane; the hands must not pass through the floor.
            const angle=sign*88*Math.PI/180,ax=side==='l'?80:160;
            const shoulder={x:120+(ax-120)*Math.cos(angle)+150*Math.sin(angle),y:340+(ax-120)*Math.sin(angle)-150*Math.cos(angle)};
            const px=shoulder.x-sign*(side===(sign>0?'l':'r')?20:32),py=398;
            const x=(px-120)*Math.cos(angle)+(py-340)*Math.sin(angle)+120-ax,y=-(px-120)*Math.sin(angle)+(py-340)*Math.cos(angle)+150;
            const q=Math.acos(Math.max(-1,Math.min(1,(x*x+y*y-50**2-57**2)/(2*50*57))))*(side==='r'?1:-1);
            const upper=Math.atan2(y,x)-Math.atan2(57*Math.sin(q),50+57*Math.cos(q))-Math.PI/2;
            parts.push(['arm-'+side,upper*180/Math.PI],['forearm-'+side,q*180/Math.PI]);
          }
          const generated=parts.map(([part,rotation]):VectorTrack=>({target:node.id+'/'+part,start,end,cue,
            frames:[{t:0,rotation:evaluateVectorPart(node.id+'/'+part,scene,0).rotation,...(part==='upper-body'?{dx:0,dy:0}:{}),easing:'smooth'},{t:1,rotation,easing:'smooth'}]}));
          const sx=(node.width??asset.width)/asset.width,sy=(node.height??asset.height)/asset.height;
          const dx=fall?Math.min(60,sx*60):0;
          generated.push({target:node.id,start,end,cue,frames:[{t:0,dx:0,dy:0,rotation:0,easing:'smooth'},{t:1,dx,dy:57*sy,rotation:0,easing:'smooth'}]});
          replace([node.id,...parts.map(([part])=>node.id+'/'+part)],generated);reframed=true;
        }
      }else{
        const torso=scene.vectorScene.tracks.filter(t=>t.target===node.id+'/upper-body');
        const lying=torso.some(t=>t.frames.every(f=>f.rotation===undefined||Math.abs(f.rotation)>35)&&t.frames.some(f=>Math.abs(f.rotation??0)>35));
        const stands=beats.some(b=>/đứng|bước|xách|rút|với|chạy/i.test(b.before+' '+b.after))||input.vectorDirection.heldProps?.some(p=>p.actor===node.id);
        if(lying&&stands){
          const parts=['upper-body','leg-l','leg-r','knee-l','knee-r','foot-l','foot-r'];
          replace(parts.map(p=>node.id+'/'+p),parts.map(part=>({...held(node.id+'/'+part,0),frames:[
            {t:0,rotation:evaluateVectorPart(node.id+'/'+part,scene,0).rotation,...(part==='upper-body'?{dx:0,dy:0}:{}),easing:'smooth'},
            {t:1,rotation:0,...(part==='upper-body'?{dx:0,dy:0}:{}),easing:'smooth'}],end:.28})));
          replace([node.id], [{target:node.id,start:0,end:.28,frames:[{t:0,dx:0,dy:evaluateVectorPart(node.id,scene,0).dy,rotation:0,easing:'smooth'},{t:1,dx:0,dy:0,rotation:0,easing:'smooth'}]}]);
          reframed=true;
        }
        // An upright grounded actor cannot retain an old held vertical offset
        // from a previous recoil/lying shot and hover above the new support.
        const torsoAtEnd=evaluateVectorPart(node.id+'/upper-body',scene,scene.durationMs).rotation;
        if(Math.abs(torsoAtEnd)<35)scene.vectorScene.tracks=scene.vectorScene.tracks.map(t=>t.target===node.id&&t.frames.every(f=>f.dy===undefined||f.dy===t.frames[0]!.dy)?
          {...t,frames:t.frames.map(f=>f.dy===undefined?f:{...f,dy:0})}:t);
      }
    }
  }
  if(reframed){
    const camera=scene.vectorScene.tracks.find(t=>/^camera-world(?:-\d+)?$/.test(t.target));
    const focus=input.vectorDirection.shot.focus.split('/')[0]!;
    if(camera&&scene.vectorScene.nodes.some(n=>n.id===focus&&n.type==='instance')){
      const shot=contactActor?{target:contactActor+'/head-group',bounds:{x:-65,y:-75,width:150,height:150}}:
        {target:focus,height:.45,include:input.vectorDirection.shot.include.filter(id=>scene.vectorScene.nodes.some(n=>n.id===id&&n.type==='instance')).slice(0,4)};
      const [framing]=vectorSubjectCamera(scene.vectorScene,assets,shot,scene);
      if(framing){
        const x=Math.max(scene.vectorScene.width/(2*framing.zoom),Math.min(scene.vectorScene.width-scene.vectorScene.width/(2*framing.zoom),framing.x));
        replace([camera.target],[{target:camera.target,start:0,end:1,frames:[{t:0,dx:scene.vectorScene.width/2-x*framing.zoom,dy:scene.vectorScene.height/2-framing.y*framing.zoom,scaleX:framing.zoom,scaleY:framing.zoom,easing:'smooth'}]}]);
      }
    }
  }
  return scene;
}
