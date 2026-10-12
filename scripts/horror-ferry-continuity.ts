import type {CanvasStudioProject,CanvasStudioScene} from '../shared/canvasAnimationStudio';
import {frameVectorScene,vectorTrackTiming,type VectorNode,type VectorFrame,type VectorTrack,type CanvasVectorScene} from '../shared/canvasVectorScene';

const node=(id:string,type:VectorNode['type'],props:Partial<VectorNode>={}):VectorNode=>({id,type,...props});
const track=(target:string,frames:VectorFrame[]):VectorTrack=>({target,start:0,end:1,frames:frames.map(f=>({...f,easing:f.easing||'smooth'}))});
function setTrack(stage:CanvasVectorScene,next:VectorTrack){
  const keys=new Set(next.frames.flatMap(f=>Object.keys(f).filter(k=>!['t','easing'].includes(k))));
  stage.tracks=stage.tracks.flatMap(old=>{
    if(old.target!==next.target)return [old];
    const frames=old.frames.map(f=>Object.fromEntries(Object.entries(f).filter(([k])=>!keys.has(k))) as VectorFrame);
    return frames.some(f=>Object.keys(f).some(k=>!['t','easing'].includes(k)))?[{...old,frames}]:[];
  });
  stage.tracks.push(next);
}
function cue(scene:CanvasStudioScene,phrase:string){
  return Math.max(.08,Math.min(.78,vectorTrackTiming({target:'',start:0,end:1,cue:phrase,frames:[]},scene).start/scene.durationMs));
}
const step=(at:number)=>Math.min(.99,at);

/** Repair authored shots using one shared boat stage. No generated assets or TTS
 * are replaced. The camera becomes an ordinary world-group track. */
export function repairFerryContinuity(source:CanvasStudioProject):CanvasStudioProject{
  const project=structuredClone(source),base=structuredClone(source.scenes[3]!.vectorScene!);
  const traveler=project.vectorAssets!.traveler!;
  // One elbow lets the existing shoulder-mounted arm actually reach the collar.
  if(!traveler.nodes.some(n=>n.id==='forearm-r')){
    traveler.nodes.find(n=>n.id==='sleeve-r')!.d='M -10 0 Q -10 -10 0 -10 Q 10 -10 10 0 L 10 49 Q 0 59 -10 49 Z';
    Object.assign(traveler.nodes.find(n=>n.id==='hand-r')!,{parent:'forearm-r',y:60});
    traveler.nodes.push(node('forearm-r','group',{parent:'arm-r',y:50}),
      node('lower-sleeve-r','path',{parent:'forearm-r',fill:'#554a3b',stroke:'#252d2c',strokeWidth:2,d:'M -10 0 Q 0 -7 10 0 L 10 46 Q 0 56 -10 46 Z'}));
  }
  const ghost=structuredClone(source.scenes[9]!.vectorScene!.nodes.find(n=>n.id==='visitor')!);
  const ghostTracks=source.scenes[9]!.vectorScene!.tracks.filter(t=>t.target.startsWith('visitor/'));
  // Interior deck and its plank are real geometry, behind the people/front hull.
  const boat=base.nodes.findIndex(n=>n.id==='boat-world');
  base.nodes.splice(boat+1,0,
    node('deck','path',{parent:'boat-world',fill:'#5a533d',stroke:'#8d805d',strokeWidth:3,d:'M 0 50 L 38 -18 Q 310 15 607 -8 L 630 26 Q 330 125 0 50 Z'}),
    node('back-rail','path',{parent:'boat-world',stroke:'#a99a70',strokeWidth:5,d:'M 38 -18 Q 310 15 607 -8'}),
    node('loose-plank','path',{parent:'boat-world',fill:'#786a48',stroke:'#403e2e',strokeWidth:2,d:'M 255 19 L 383 21 L 375 45 L 247 41 Z'}));
  Object.assign(base.nodes.find(n=>n.id==='old')!,{x:310});
  // The bell/lantern share a fixed mounting post beside the ferryman.
  for(const id of ['lamp-post','lamp-hook','bell-hook','lamp','bell']){
    const n=base.nodes.find(n=>n.id===id)!;n.x=(n.x||0)+225;
  }
  // Mount the lantern above the interaction area, behind the passengers.
  // Otherwise its glass and post hide the collar/shoulder/coin gestures.
  base.nodes.find(n=>n.id==='lamp-post')!.d='M 8 65 L 8 -281 L 46 -281 M 8 -126 L 93 -126';
  base.nodes.find(n=>n.id==='lamp-hook')!.y=-281;
  base.nodes.find(n=>n.id==='lamp')!.y=-250;
  const mounts=new Set(['lamp-post','lamp-hook','bell-hook','lamp','bell']);
  const mounting=base.nodes.filter(n=>mounts.has(n.id));
  base.nodes=base.nodes.filter(n=>!mounts.has(n.id));
  base.nodes.splice(base.nodes.findIndex(n=>n.id==='lam'),0,...mounting);
  setTrack(base,track('boat-world',[{t:0,dx:0},{t:1,dx:0}]));
  function stage(passenger:boolean){
    const s=structuredClone(base);
    if(passenger){
      const hull=s.nodes.findIndex(n=>n.id==='hull');
      s.nodes.splice(hull,0,{...structuredClone(ghost),x:470});s.tracks.push(...structuredClone(ghostTracks));
    }
    return s;
  }
  
  for(const [i,s] of project.scenes.entries()){
    if(i<3||i>21)continue;
    let world=stage(i>=9),focus:{x:number;y:number;zoom:number}|undefined;
    const actions:string[]=[];
    const add=(...n:VectorNode[])=>world.nodes.push(...n);
    const animate=(target:string,frames:VectorFrame[])=>setTrack(world,track(target,frames));
    const arm=(target:string,at:number,rotation:number)=>animate(target,[{t:0,rotation:0},{t:at,rotation:0},{t:step(at+.13),rotation},{t:1,rotation}]);
    if(i===3){
      animate('boat-world',[{t:0,dx:-35},{t:1,dx:25}]);
      actions.push('Thuyền rời bến; mái chèo và đèn cùng thuộc chiếc thuyền.');
    }
    if(i===4){
      focus={x:260,y:800,zoom:1.8};
      arm('lam/arm-r',.08,60);arm('lam/forearm-r',.08,110);
      const at=cue(s,'tấm ván');
      animate('loose-plank',[{t:0,d:'M 255 19 L 383 21 L 375 45 L 247 41 Z'},
        {t:step(at+.08),d:'M 255 19 Q 319 43 383 21 L 375 45 Q 312 61 247 41 Z'}]);
      animate('loose-plank',[{t:0,dy:0},{t:at,dy:0},{t:step(at+.12),dy:8},{t:1,dy:8}]);
      animate('lam/head-group',[{t:0,rotation:0},{t:at,rotation:0},{t:step(at+.2),rotation:13},{t:1,rotation:13}]);
      actions.push('Lâm kéo cổ áo; ván phía sau võng xuống; anh quay đầu về phía ván.');
    }
    if(i===5){
      focus={x:330,y:870,zoom:1.65};
      const wet=cue(s,'vệt nước'),feet=Math.min(.54,cue(s,'dấu bàn chân')-.2);
      for(let k=0;k<4;k++){
        const x=355-k*39,y=52+k*5,id=`wet-foot-${k}`;
        // Heel + forefoot + five toes; compact perspective on the deck plane.
        add(node(id,'group',{parent:'boat-world',x,y,rotation:k%2?12:-12,scaleX:1.35,scaleY:1.35}),
          node(`${id}-heel`,'ellipse',{parent:id,x:0,y:5,rx:6,ry:3,fill:'#8fae9e'}),
          node(`${id}-sole`,'ellipse',{parent:id,x:-1,y:-1,rx:8,ry:4,fill:'#8fae9e'}));
        for(let t=0;t<5;t++)add(node(`${id}-toe-${t}`,'ellipse',{parent:id,x:-7+t*3,y:-6,rx:t===0?2.5:1.8,ry:1.8,fill:'#a5beb0'}));
        const at=step(feet+k*.055);animate(id,[{t:0,opacity:0},{t:at,opacity:0},{t:step(at+.045),opacity:.8},{t:1,opacity:.8}]);
      }
      add(node('wet-trail','path',{parent:'boat-world',x:382,y:25,pivotX:0,pivotY:0,d:'M 0 0 Q -43 21 -80 17 T -165 35',stroke:'#73958a',strokeWidth:5}));
      animate('wet-trail',[{t:0,scaleX:.01,opacity:0},{t:wet,scaleX:.01,opacity:0},{t:step(wet+.32),scaleX:1,opacity:.65},{t:1,scaleX:1,opacity:.65}]);
      actions.push('Vệt nước bò về chân Lâm; bốn dấu chân có gót và ngón hiện lần lượt trên sàn thuyền.');
    }
    if(i===6){
      animate('old/arm-r',[{t:0,rotation:-16},{t:.25,rotation:0},{t:1,rotation:0}]);
      animate('old/oar',[{t:0,rotation:0},{t:1,rotation:0}]);
      animate('old/head-group',[{t:0,rotation:0},{t:.25,rotation:9},{t:1,rotation:9}]);
      actions.push('Chèo ngừng; ông lão cúi đầu nghe.');
    }
    if(i===7||i===8){
      const visitor={...structuredClone(ghost),parent:undefined,x:600,y:520,width:130,height:285};
      world.nodes.splice(world.nodes.findIndex(n=>n.id==='boat-world'),0,visitor);
      world.tracks.push(...structuredClone(ghostTracks));
      animate('visitor',i===7?[{t:0,opacity:0,dx:40},{t:.35,opacity:.8,dx:20},{t:1,opacity:1,dx:0}]:[{t:0,dx:0},{t:1,dx:0}]);
      if(i===8)focus={x:500,y:790,zoom:1.65};
      actions.push('Khách áo trắng đứng ngoài thuyền trên mặt nước, vẫn thấy thuyền và người lái đò.');
    }
    if(i===9){
      const at=cue(s,'đã ngồi');
      animate('visitor',[{t:0,opacity:0,dy:-45},{t:at,opacity:0,dy:-45},{t:step(at+.08),opacity:1,dy:0},{t:1,opacity:1,dy:0}]);
      animate('boat-world',[{t:0,rotation:0},{t:at,rotation:0},{t:step(at+.12),rotation:2},{t:step(at+.3),rotation:-.5},{t:1,rotation:0}]);
      actions.push('Khách hiện ở cuối thuyền; thuyền nghiêng khi khách ngồi xuống rồi ổn định.');
    }
    if(i===10||i===16){
      focus={x:510,y:810,zoom:1.75};
      if(i===10)arm('visitor/arm-r',.18,-27);
      if(i===16){
        const at=cue(s,'rẽ sang hai bên');
        animate('visitor/veil',[{t:0,opacity:1},{t:at,opacity:1},{t:step(at+.2),opacity:0},{t:1,opacity:0}]);
        arm('visitor/hair-l',at,13);arm('visitor/hair-r',at,-13);
      }
      actions.push(i===10?'Cổ tay đeo vòng được đưa lên trong cùng vị trí ngồi trên thuyền.':'Tóc tách sang hai bên để lộ khoảng rỗng; giữ nguyên thuyền và hai người.');
    }
    if(i===11){
      focus={x:330,y:800,zoom:1.75};
      const at=cue(s,'hé miệng');
      animate('lam/mouth',[{t:0,scaleY:.7},{t:at,scaleY:.7},{t:step(at+.08),scaleY:2},{t:step(at+.2),scaleY:.7},{t:1,scaleY:.7}]);
      animate('old',[{t:0,dx:0},{t:at,dx:0},{t:step(at+.15),dx:-60},{t:.9,dx:-60},{t:1,dx:0}]);
      arm('old/arm-l',at,98);
      for(const side of ['l','r'])animate(`old/leg-${side}`,[{t:0,rotation:0},{t:at,rotation:0},{t:step(at+.05),rotation:side==='l'?13:-13},{t:step(at+.1),rotation:side==='l'?-13:13},{t:step(at+.15),rotation:0},{t:1,rotation:0}]);
      actions.push('Lâm hé miệng; ông lão bước sát lại, bàn tay nối với vai/ cánh tay của ông ghì đúng vai Lâm.');
    }
    if(i===12||i===13){
      if(i===12)focus={x:370,y:810,zoom:1.65};
      animate('old/arm-r',[{t:0,rotation:0},{t:1,rotation:0}]);
      animate('old/oar',[{t:0,rotation:i===12?0:112},{t:.7,rotation:112},{t:1,rotation:112}]);
      if(i===12)animate('old/head-group',[{t:0,rotation:-5},{t:.2,rotation:5},{t:.4,rotation:-5},{t:.6,rotation:0},{t:1,rotation:0}]);
      if(i===13){
        // Reflections remain under the actual people and hull, no isolated face on water.
        for(const id of ['lam','old']){
          const actor=world.nodes.find(n=>n.id===id)!;
          add({...actor,id:`reflected-${id}`,parent:undefined,x:35+actor.x!,y:1190,width:actor.width,height:actor.height,scaleY:-.55,opacity:.22});
        }
        add(node('missing-shadow','ellipse',{x:575,y:1075,rx:70,ry:13,stroke:'#658a80',strokeWidth:3}));
      }
      actions.push(i===12?'Ông lão lắc đầu và xoay mái chèo thành thanh chắn ngang thuyền.':'Bóng người ở dưới thuyền; chỗ khách áo trắng chỉ có vòng nước.');
    }
    if(i===14){
      const at=cue(s,'bám vào mạn');
      for(let k=0;k<4;k++){
        const id=`water-hand-${k}`;
        add(node(id,'group',{parent:'boat-world',x:95+k*115,y:120}),
          node(`${id}-skin`,'path',{parent:id,fill:'#a0b9a9',stroke:'#536e65',strokeWidth:2,d:'M -10 60 L -11 10 L -20 -4 L -13 -10 L -7 -4 L -7 -25 Q -3 -32 0 -24 L 2 -8 L 4 -31 Q 10 -38 12 -29 L 12 -7 L 17 -25 Q 23 -29 25 -20 L 22 0 L 16 17 L 12 60 Z'}));
        animate(id,[{t:0,dy:100,opacity:0},{t:step(at+k*.03),dy:100,opacity:0},{t:step(at+.12+k*.03),dy:-18,opacity:1},{t:1,dy:-26,opacity:1}]);
        animate(`${id}-skin`,[{t:0,d:'M -10 60 L -11 10 L -20 -4 L -13 -10 L -7 -4 L -7 -25 Q -3 -32 0 -24 L 2 -8 L 4 -31 Q 10 -38 12 -29 L 12 -7 L 17 -25 Q 23 -29 25 -20 L 22 0 L 16 17 L 12 60 Z'},
          {t:step(at+.2+k*.03),d:'M -10 60 L -11 10 L -21 -2 Q -23 -15 -13 -17 L 14 -18 Q 29 -17 24 -3 L 20 11 L 12 60 Z'}]);
      }
      actions.push('Tay trồi lên đúng mạn thuyền, ngón đổi sang tư thế quặp bám vào gỗ.');
    }
    if(i===15||i===20){
      focus={x:340,y:810,zoom:1.75};
      animate('lamp/flame',i===15?[{t:0,scaleY:1},{t:1,scaleY:.15}]:[{t:0,scaleY:.15},{t:.35,scaleY:1},{t:1,scaleY:1}]);
      animate('lamp/halo',i===15?[{t:0,opacity:.13},{t:1,opacity:.025}]:[{t:0,opacity:.025},{t:.35,opacity:.25},{t:1,opacity:.25}]);
      if(i===15){
        animate('lam/upper-body',[{t:0,dy:0},{t:.22,dy:-10},{t:.48,dy:145},{t:1,dy:145}]);
        arm('lam/arm-r',.25,0);arm('lam/arm-l',.25,0);
      }
      if(i===20)animate('boat-world',[{t:0,dx:0},{t:1,dx:65}]);
      actions.push(i===15?'Lửa nhỏ dần trên đèn gắn cột; Lâm co người, đưa tay bám mạn.':'Lửa đèn phục hồi, ông lão chèo và thuyền tiến đi.');
    }
    if(i===17||i===18||i===19){
      focus={x:350,y:820,zoom:1.8};
      arm('old/arm-l',.12,63);
      arm('lam/arm-r',.2,i===17?18:-70);
      if(i===17)actions.push('Ông lão chìa tay; Lâm đưa tay xuống túi.');
      if(i===18||i===19){
        const at=i===18?cue(s,'đặt đồng tiền'):.13;
        add(node('fare','group',{parent:'boat-world',x:307,y:-95}),
          node('fare-ring','ellipse',{parent:'fare',rx:8,ry:8,fill:'#9e8e52',stroke:'#d0b970',strokeWidth:2}),
          node('fare-hole','rect',{parent:'fare',x:-2,y:-2,width:4,height:4,fill:'#263a35'}),
          node('fare-thread','path',{parent:'fare',d:'M 0 0 Q -5 12 1 18 Q 11 23 6 29',stroke:'#b9553c',strokeWidth:3}));
        animate('fare',i===18?[{t:0,opacity:0},{t:at,opacity:1,dx:0,dy:0},{t:step(at+.16),opacity:1,dx:-9,dy:15},{t:1,opacity:1,dx:-9,dy:15}]:
          [{t:0,dx:-9,dy:15,opacity:1},{t:at,dx:-9,dy:15,opacity:1},{t:step(at+.16),dx:11,dy:25,opacity:1},{t:step(at+.18),dx:11,dy:34,opacity:0},{t:1,opacity:0}]);
        if(i===18){
          const recoil=cue(s,'rụt tay');arm('visitor/arm-r',recoil,-45);
          actions.push('Khách rụt tay; đồng tiền có chỉ đỏ chuyển từ tay Lâm sang lòng bàn tay ông lão.');
        }else{
          animate('bell',[{t:0,rotation:0},{t:step(at+.18),rotation:0},{t:step(at+.25),rotation:12},{t:step(at+.36),rotation:-8},{t:.8,rotation:2},{t:1,rotation:0}]);
          actions.push('Đồng tiền rơi vào chiếc chuông đang gắn cột, rồi chuông mới rung.');
        }
      }
    }
    if(i===21){
      world=stage(false);
      world.nodes.splice(world.nodes.findIndex(n=>n.id==='boat-world'),0,{...structuredClone(ghost),parent:undefined,x:525,y:520,width:155,height:340});
      world.tracks.push(...structuredClone(ghostTracks));
      animate('visitor',[{t:0,opacity:1},{t:.55,dy:35,opacity:.8},{t:1,dy:180,opacity:0}]);
      animate('boat-world',[{t:0,dx:-65},{t:1,dx:65}]);
      actions.push('Thuyền bỏ lại người đàn bà trên nước; bà chìm dần phía sau.');
    }
    // Close shots cut directly to a fixed framing of the complete world. Supports
    // stay in the SVG tree and camera view rather than being reconstructed.
    s.vectorScene=focus?frameVectorScene(world,[{t:0,...focus}]):world;
    s.visualBrief=actions.join(' ');
  }
  // Jetty close-up shares the exact establishing dock, boat, actors and props.
  const jetty=structuredClone(project.scenes[0]!.vectorScene!);
  jetty.nodes=jetty.nodes.filter(n=>n.id!=='fade');jetty.tracks=jetty.tracks.filter(t=>t.target!=='fade');
  jetty.nodes.push(node('mooring-rope','path',{d:'M 361 900 Q 328 860 302 780',stroke:'#a39872',strokeWidth:4}));
  const release=cue(project.scenes[1]!,'tự tuột');
  setTrack(jetty,track('mooring-rope',[{t:0,d:'M 361 900 Q 328 860 302 780'},{t:release,d:'M 361 900 Q 328 860 302 780'},
    {t:step(release+.1),d:'M 361 900 Q 325 990 302 780'}]));
  project.scenes[1]!.vectorScene=frameVectorScene(jetty,[{t:0,x:470,y:790,zoom:1.6}]);
  project.scenes[1]!.visualBrief='Cận ông lão bằng camera trên nguyên bến đò; dây neo thật chuyển từ căng sang tuột/chùng.';
  lightFerryProject(project);
  return project;
}

/** Flat concentric light, like the references: bright source, restrained rings.
 * Ordinary nodes/tracks work identically in preview and native Remotion. */
function lightFerryProject(project:CanvasStudioProject){
  const lantern=project.vectorAssets!.lantern!;
  const aura=lantern.nodes.find(n=>n.id==='aura')!,halo=lantern.nodes.find(n=>n.id==='halo')!;
  Object.assign(aura,{parent:'glow-light',rx:125,ry:150,fill:'#ffa53b',opacity:.10});
  Object.assign(halo,{parent:'glow-light',rx:78,ry:94,fill:'#ffbe52',opacity:.17});
  lantern.nodes.unshift(node('glow-light','group',{pivotX:50,pivotY:104,pivotSpace:'local'}));
  lantern.nodes.splice(2,0,
    node('glow-middle','ellipse',{parent:'glow-light',x:50,y:104,rx:100,ry:120,fill:'#ffb341',opacity:.08}),
    node('glow-inner','ellipse',{parent:'glow-light',x:50,y:104,rx:59,ry:73,fill:'#ffcf72',opacity:.20}));
  Object.assign(lantern.nodes.find(n=>n.id==='glass')!,{fill:'#ffb943'});
  const flame=lantern.nodes.find(n=>n.id==='flame')!;
  flame.id='flame-shape';flame.parent='flame';flame.fill='#fff4b0';
  delete flame.pivotX;delete flame.pivotY;delete flame.pivotSpace;
  lantern.nodes.splice(lantern.nodes.indexOf(flame),0,
    node('fire-light','group',{pivotX:50,pivotY:121,pivotSpace:'local'}),
    node('flame','group',{parent:'fire-light',pivotX:50,pivotY:121,pivotSpace:'local'}));
  lantern.nodes.push(node('flame-core','path',{parent:'flame',fill:'#fffde9',d:'M 50 91 Q 55 103 54 112 Q 61 121 51 122 Q 41 119 46 109 Z'}));
  for(const [index,scene] of project.scenes.entries()){
    const stage=scene.vectorScene!;
    const moon=stage.nodes.find(n=>n.id==='moon');
    if(moon){
      Object.assign(moon,{fill:'#fff3ce',opacity:1});
      const cloud=stage.nodes.find(n=>n.id==='moon-cloud');if(cloud)cloud.opacity=.32;
      const at=stage.nodes.indexOf(moon);
      stage.nodes.splice(at,0,
        node('moon-aura','ellipse',{parent:moon.parent,x:moon.x,y:moon.y,rx:92,ry:92,fill:'#e9edcf',opacity:.035}),
        node('moon-halo','ellipse',{parent:moon.parent,x:moon.x,y:moon.y,rx:64,ry:64,fill:'#e9edcf',opacity:.08}));
    }
    for(const lamp of stage.nodes.filter(n=>n.type==='instance'&&n.asset==='lantern')){
      const count=Math.min(31,Math.ceil(scene.durationMs/240));
      const fire:VectorFrame[]=[],glow:VectorFrame[]=[],power:VectorFrame[]=[],glass:VectorFrame[]=[];
      for(let k=0;k<=count;k++){
        const t=k/count,seconds=t*scene.durationMs/1000;
        const flutter=Math.sin(seconds*17+index*.7)*.10+Math.sin(seconds*29+1)*.035;
        const brightness=index===15?1-.86*t:index===20?Math.min(1,.14+t/.35*.86):1;
        fire.push({t,scaleY:1+flutter,scaleX:1-flutter*.45,rotation:Math.sin(seconds*11)*4});
        glow.push({t,opacity:brightness*(.94+flutter*.4),scaleX:1+flutter*.23,scaleY:1+flutter*.23});
        power.push({t,scaleY:.2+brightness*.8,scaleX:.65+brightness*.35,opacity:.2+brightness*.8});
        glass.push({t,opacity:.18+brightness*.82});
      }
      setTrack(stage,track(`${lamp.id}/flame`,fire));
      setTrack(stage,track(`${lamp.id}/glow-light`,glow));
      setTrack(stage,track(`${lamp.id}/fire-light`,power));
      setTrack(stage,track(`${lamp.id}/glass`,glass));
      // The old separate halo opacity would otherwise remain dim during recovery.
      stage.tracks=stage.tracks.filter(t=>t.target!==`${lamp.id}/halo`);
    }
  }
}

