import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createCanvasObject,type CanvasStudioProject,type CanvasStudioScene,type CanvasStudioObject} from '../shared/canvasAnimationStudio';
import {canvasEnvironmentDoorway} from '../shared/canvasEnvironment';
import {run,workdir} from '../server/services/ffmpeg';
import {getAnimationAssetFile,findCachedAnimationAsset,registerAnimationAsset} from '../server/services/animationAssets';

process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const directory=path.resolve('tmp/chiec-den-cuoi-ban-v2');await mkdir(directory,{recursive:true});
const original=JSON.parse(await readFile('tmp/chiec-den-cuoi-ban-5p/project-natural.json','utf8')) as CanvasStudioProject;
// Cut repetitive exposition, not the voice's natural cadence. All TTS is reused.
const omitted=new Set([7,9,19,23,26,28]);
const coverage:Record<number,Array<[string,string?]>>={
  0:[['house'],['porch','Mỗi tối']],
  1:[['arrival'],['lamp-detail','Trong lúc']],
  2:[['question']],3:[['grandma'],['memory-ferry','Cha cháu']],
  4:[['storm'],['blocked-path','Đường xuống']],
  5:[['river-signal'],['signal-detail','Nó sáng'],['landing','Chỗ ấy']],
  6:[['minh-reports']],8:[['door-wind'],['lamp-wind','Minh giật']],
  10:[['box-open'],['note-detail','Trên đó'],['memory-ferry','Anh nhớ']],
  11:[['note-explain'],['duy-garden','Bến cũ']],
  12:[['minh-worry'],['phone-call','Anh lấy']],13:[['planning']],
  14:[['reply'],['river-reply','Bên kia']],
  15:[['walking-party'],['bridge-flood','Họ không'],['rope-tree','Đến bến']],
  16:[['duy-reveal'],['injury-close','Chiếc đèn'],['landslide','Con đường']],
  17:[['duy-speaks']],18:[['minh-call'],['rescuers-route','Mọi người']],
  20:[['rescuers-arrive'],['first-aid','Họ kiểm tra'],['assist-walk','và dìu'],['river-clear','Ánh đèn']],
  21:[['return-home'],['hot-water','Bà rót'],['family-call','còn Minh']],
  22:[['duy-memory'],['memory-ferry','Có lần']],24:[['grandma-lesson']],
  25:[['minh-note'],['note-detail','Mảnh giấy'],['lamp-clean','Anh lau'],['new-note','và ghi']],
  27:[['morning-plan'],['signal-board','Mình cũng']],
  29:[['house-ending'],['minh-ending','Minh không'],['lamp-ending','Anh hiểu']],
};
const cast:Record<string,{label:string;color:string;hair:CanvasStudioObject['hair'];archetype:CanvasStudioObject['archetype'];age:number}>={
  minh:{label:'Minh',color:'#66747a',hair:'short',archetype:'worker',age:27},
  lanh:{label:'Bà Lành',color:'#79604f',hair:'bun',archetype:'villager',age:68},
  duy:{label:'Bác Duy',color:'#73735b',hair:'bald',archetype:'sailor',age:62},
  father:{label:'Cha Minh',color:'#6d715a',hair:'short',archetype:'sailor',age:45},
  head:{label:'Trưởng bản',color:'#6d644f',hair:'crop',archetype:'villager',age:52},
  neighbour:{label:'Người trong bản',color:'#86694f',hair:'hat',archetype:'worker',age:34},
  rescuer1:{label:'Cứu hộ Hòa',color:'#ab744b',hair:'hat',archetype:'worker',age:35},
  rescuer2:{label:'Cứu hộ Mai',color:'#b48a54',hair:'bun',archetype:'worker',age:30},
};
function actor(key:string,x=620,y=420,height=350):CanvasStudioObject {
  const person=cast[key]!;
  return createCanvasObject('character',{id:`cast-${key}`,characterKey:key,label:person.label,color:person.color,
    secondaryColor:'#46535a',skinTone:'#d6aa84',hair:person.hair,archetype:person.archetype,assetRef:`character:${person.archetype}`,
    designNotes:`${person.age>=60?'older':'adult'} ${person.hair==='bun'?'woman':'man'}, age ${person.age}, restrained mountain village illustrated story`,
    x,y,width:height*.64,height,motion:'none',delayMs:0,pose:'idle',expression:'neutral',facing:'right',zIndex:30});
}
function prop(variant:NonNullable<CanvasStudioObject['variant']>,id:string,x:number,y:number,width:number,height:number,extra:Partial<CanvasStudioObject>={}) {
  return createCanvasObject('prop',{id,label:id,variant,assetRef:`prop:${variant}`,x,y,width,height,motion:'none',zIndex:35,
    color:variant==='note'?'#d5bf92':'#a68c67',...extra});
}
function svg(id:string,x:number,y:number,width:number,height:number,body:string,zIndex=20) {
  const image=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">${body}</svg>`;
  return createCanvasObject('image',{id,label:id,x,y,width,height,zIndex,motion:'none',imageUrl:`data:image/svg+xml;base64,${Buffer.from(image).toString('base64')}`});
}
function focus(scene:CanvasStudioScene,x:number,y:number,zoom=1.08) {
  scene.camera={shot:'wide',motion:'none',focusX:x,focusY:y,zoom,
    keyframes:[{atMs:0,zoom:1},{atMs:scene.durationMs,zoom:1.035,easing:'ease-in-out'}]};
}
function move(scene:CanvasStudioScene,person:CanvasStudioObject,dx:number,start=500,end=scene.durationMs-600) {
  end=Math.max(start+1000,end);
  person.keyframes=[{atMs:0,dx:0},{atMs:start,dx:0},{atMs:end,dx,easing:'ease-in-out'},{atMs:scene.durationMs,dx}];
  scene.animationBeats!.push({id:`walk-${person.id}`,action:'run',atMs:start,durationMs:end-start,targetIds:[person.id],intensity:.25});
}
function point(scene:CanvasStudioScene,person:CanvasStudioObject,target:CanvasStudioObject,start=500) {
  scene.animationBeats!.push({id:`point-${person.id}`,action:'point',atMs:start,durationMs:Math.max(500,scene.durationMs-start-400),targetIds:[person.id],focusTargetId:target.id,intensity:.25});
}
function environment(scene:CanvasStudioScene,ref:string,rain=0) {
  scene.backgroundRef=ref;scene.background=ref.includes('room')?'room':ref.includes('river-establishing')?'river':'night';
  scene.atmosphere={rainIntensity:rain,waterIntensity:1.4,timeOffsetMs:scene.atmosphere?.timeOffsetMs||0};
}
function room(scene:CanvasStudioScene,keys:string[],day=false) {
  environment(scene,day?'bg:room-stilt-day':'bg:room-stilt-house');
  const opening=canvasEnvironmentDoorway(scene.backgroundRef,1280,720)!;
  scene.objects=keys.map((key,i)=>{const p=actor(key,keys.length===1?620:380+i*240);p.facing=i?'left':'right';return p;});
  scene.objects.push(prop('door','door',985,335,340,385,{doorOpen:.22,zIndex:12}),
    prop('lantern','lamp',opening.x+opening.width+44,opening.y+50,85,115,{zIndex:20}));
  focus(scene,640,420,1.03);
}
function bank(scene:CanvasStudioScene) {environment(scene,'bg:night-rescue-banks',.35);scene.objects=[];focus(scene,800,450,1.02);}
function party(scene:CanvasStudioScene,rescuers=false) {
  environment(scene,'bg:night-hill-path',.4);
  const keys=rescuers?['rescuer1','rescuer2']:['minh','head','neighbour'];
  scene.objects=keys.map((key,i)=>actor(key,290+i*230,460,300));
  for(const person of scene.objects)move(scene,person,170);
  scene.objects.push(prop('lantern','carried-lamp',380,490,42,64,{heldBy:scene.objects[0]!.id}));
  if(!rescuers)scene.objects.push(prop('rope','carried-rope',780,580,65,60,{heldBy:'cast-neighbour'}));
  focus(scene,640,440,1);
}
function stage(scene:CanvasStudioScene,mode:string) {
  const o=(id:string)=>scene.objects.find(p=>p.id===id)!;
  switch(mode) {
    case 'house':case 'porch':case 'house-ending':case 'lamp-ending':
      environment(scene,'bg:night-stilt-house');scene.objects=[prop('lantern','porch-lamp',730,363,35,48)];
      if(mode==='porch')focus(scene,700,375,1.65);else focus(scene,630,360,1.04);
      if(mode==='lamp-ending')focus(scene,700,370,1.45);
      break;
    case 'arrival':room(scene,['lanh','minh'],true);o('cast-minh').x=740;move(scene,o('cast-minh'),-90);break;
    case 'lamp-detail':room(scene,[],true);focus(scene,1030,290,1.5);break;
    case 'question':case 'minh-reports':room(scene,['lanh','minh'],mode==='question');point(scene,o('cast-minh'),o('lamp'));break;
    case 'grandma':case 'grandma-lesson':room(scene,['lanh','minh'],mode==='grandma');focus(scene,440,390,1.14);break;
    case 'memory-ferry':
      environment(scene,'bg:river-establishing');scene.atmosphere!.waterIntensity=.55;
      scene.objects=[createCanvasObject('ship',{id:'ferry',assetRef:'ship:historical-warship',label:'Đò cũ',x:700,y:500,width:430,height:120,motion:'none',color:'#745740',zIndex:15}),
        actor('father',610,398,180),actor('duy',785,405,165)];
      o('cast-duy').hair='short';o('cast-duy').designNotes='adult man, age 40, village ferryman';
      o('cast-father').pose='row';scene.objects.push(svg('oar',650,450,230,35,'<path d="M10 150 L500 150" stroke="#9b8060" stroke-width="22"/><path d="M460 110 Q580 60 590 150 Q580 240 460 190 Z" fill="#7b6247" stroke="#433c2c" stroke-width="9"/>',36));o('oar').heldBy='cast-father';o('oar').keyframes=Array.from({length:Math.ceil(scene.durationMs/800)},(_,i)=>({atMs:i*800,rotation:i%2?15:-15,easing:'ease-in-out'}));focus(scene,700,410,1.1);break;
    case 'storm':environment(scene,'bg:night-stilt-house',.9);scene.objects=[prop('lantern','porch-lamp',730,363,35,48)];focus(scene,640,370,1);break;
    case 'blocked-path':
      environment(scene,'bg:night-hill-path',.8);scene.objects=[actor('minh',360,460,280),
        svg('fallen-tree',780,530,620,160,'<path d="M35 190 Q210 80 545 120" fill="none" stroke="#2b2922" stroke-width="53"/><path d="M40 185 Q215 80 540 117" fill="none" stroke="#765f45" stroke-width="40"/><path d="M330 122 L370 38 M235 140 L180 220" stroke="#68573e" stroke-width="20"/>')];
      o('cast-minh').expression='sad';break;
    case 'river-signal':case 'signal-detail':case 'landing':case 'river-reply':
      environment(scene,'bg:night-rescue-banks',.7);scene.objects=[prop('lantern','signal',1040,455,42,62,{lightSignal:{pattern:'distress',offsetMs:scene.atmosphere!.timeOffsetMs}})];
      if(mode==='signal-detail')focus(scene,1010,425,1.5);
      else if(mode==='river-reply'){o('signal').lightSignal={pattern:'distress',offsetMs:-1800};o('signal').keyframes=[{atMs:0,lightLevel:0},{atMs:1800,lightLevel:0},{atMs:1833,lightLevel:.65,easing:'hold'}];focus(scene,960,425,1.2);}
      else focus(scene,750,360,1);
      break;
    case 'door-wind':case 'lamp-wind':
      room(scene,mode==='lamp-wind'?['minh']:[]);
      o('door').keyframes=[{atMs:0,doorOpen:.45},{atMs:900,doorOpen:.2,easing:'ease-in-out'},{atMs:2000,doorOpen:.55,easing:'ease-in-out'},{atMs:scene.durationMs,doorOpen:.3}];
      o('lamp').keyframes=Array.from({length:Math.ceil(scene.durationMs/550)},(_,i)=>({atMs:i*550,rotation:i%2?-5:5,easing:'ease-in-out'}));
      if(mode==='lamp-wind'){o('cast-minh').expression='afraid';point(scene,o('cast-minh'),o('lamp'));}
      focus(scene,930,370,1.15);break;
    case 'box-open':case 'note-detail':case 'note-explain':case 'minh-note':case 'new-note':
      room(scene,mode==='minh-note'||mode==='new-note'?['minh']:['lanh','minh']);
      scene.objects.push(prop('table','table',620,578,330,125,{zIndex:25}),prop('box','box',520,535,95,80,{zIndex:27}),
        prop('note','note',640,510,190,130,{zIndex:36}));
      if(mode==='box-open') {
        o('box').x=435;o('box').boxOpen=0;o('box').keyframes=[{atMs:0,boxOpen:0},{atMs:600,boxOpen:1,easing:'ease-in-out'}];
        o('note').x=435;o('note').y=480;o('note').width=88;o('note').height=60;
        point(scene,o('cast-lanh'),o('note'),0);
        o('note').keyframes=[{atMs:0,dy:38,opacity:0},{atMs:500,dy:38,opacity:0},{atMs:700,dy:25,opacity:1},{atMs:scene.durationMs-300,dy:-20,opacity:1,easing:'ease-in-out'}];
      }
      if(mode==='note-detail'||mode==='note-explain'){scene.objects=scene.objects.filter(p=>p.kind!=='character');o('note').width=430;o('note').height=275;o('note').x=640;o('note').y=425;focus(scene,640,430,1.05);}
      if(mode==='minh-note')focus(scene,620,420,1.12);
      if(mode==='new-note') {
        o('note').text='• • ━  CẦN GIÚP ĐỠ\n━ • •  ĐÃ NHÌN THẤY\nSỐ CỨU HỘ: 114';
        point(scene,o('cast-minh'),o('note'));
        scene.objects.push(svg('pen',665,502,100,18,'<path d="M20 150 L520 150" stroke="#403b34" stroke-width="28"/><path d="M520 136 L580 150 L520 164" fill="#cbc3a0"/>',38));
      }
      break;
    case 'duy-garden':environment(scene,'bg:night-hill-path');scene.objects=[actor('duy',810,460,280),prop('basket','garden-basket',895,558,105,100)];focus(scene,850,425,1.08);break;
    case 'minh-worry':room(scene,['minh']);o('cast-minh').expression='afraid';focus(scene,620,410,1.16);break;
    case 'phone-call':case 'planning':case 'family-call':
      room(scene,mode==='family-call'?['lanh','duy','minh']:['lanh','minh']);
      if(mode==='family-call'){o('cast-duy').pose='sit';o('cast-duy').y=488;scene.objects.push(prop('chair','duy-chair',620,560,140,155,{zIndex:24}));}
      scene.objects.push(prop('phone','phone',o('cast-minh').x+60,390,43,78,{heldBy:'cast-minh',text:mode==='family-call'?'GỌI GIA ĐÌNH':'TRƯỞNG BẢN'}));
      o('phone').y=345;point(scene,o('cast-minh'),o('phone'),0);break;
    case 'reply':
      room(scene,['lanh']);o('cast-lanh').x=965;
      o('lamp').lightSignal={pattern:'acknowledge',offsetMs:0};point(scene,o('cast-lanh'),o('lamp'),0);
      // A visible shading flap demonstrates signaling, without deleting the lamp.
      scene.objects.push(svg('lamp-shade',1110,218,73,95,'<path d="M55 20 Q300 0 540 20 L535 280 L60 280 Z" fill="#534939" stroke="#2c2c28" stroke-width="8"/>',37));
      o('lamp-shade').keyframes=Array.from({length:Math.ceil(scene.durationMs/5200)},(_,i)=>[...[0,1400,2400,2800,3200,3600].map((at,j)=>({atMs:i*5200+at,dx:j%2?0:75,easing:'hold' as const}))]).flat();
      focus(scene,1050,355,1.17);break;
    case 'walking-party':party(scene);break;
    case 'rescuers-route':party(scene,true);break;
    case 'bridge-flood':
      environment(scene,'bg:night-rescue-banks',.8);scene.objects=[prop('bridge','bridge',625,531,520,175,{zIndex:14})];
      scene.objects.push(svg('bridge-foam',630,568,580,70,'<path d="M10 70 Q70 20 160 65 T340 75 T550 70 M40 160 Q110 105 230 150 T570 155 M10 245 Q95 200 180 240 T400 230" fill="none" stroke="#bdcec9" stroke-width="10" opacity=".65"/>',20));o('bridge-foam').keyframes=[{atMs:0,dx:-14},{atMs:scene.durationMs,dx:14}];
      focus(scene,635,430,1.08);break;
    case 'rope-tree':
      environment(scene,'bg:night-hill-path',.45);scene.objects=[actor('minh',430,460,290),actor('head',720,460,290),actor('neighbour',960,460,290),
        prop('tree','anchor-tree',560,365,240,550,{color:'#455943',zIndex:18}),
        svg('tied-rope',720,520,420,130,'<path d="M85 160 C25 70 130 60 145 145 C160 210 40 205 80 145 Q330 165 580 230" fill="none" stroke="#c6ad7f" stroke-width="12"/><path d="M75 152 L105 165 M95 144 L120 164" stroke="#746649" stroke-width="5"/>',36)];
      point(scene,o('cast-minh'),o('tied-rope'));focus(scene,620,420,1.04);break;
    case 'duy-reveal':case 'injury-close':case 'duy-speaks':case 'landslide':
      bank(scene);scene.objects=[actor('duy',985,463,280),prop('lantern','signal',1020,585,40,60,{lightSignal:{pattern:'distress',offsetMs:scene.atmosphere!.timeOffsetMs}})];
      o('cast-duy').pose='sit';o('cast-duy').expression='sad';o('cast-duy').y=503;
      scene.objects.push(prop('mountain','seat-rock',o('cast-duy').x,591,130,100,{color:'#667069',zIndex:24}));
      scene.objects.push(svg('bandage',1040,582,47,39,'<path d="M50 20 L550 35 L540 280 L45 280 Z" fill="#d4ccae" stroke="#77735f" stroke-width="8"/><path d="M90 90 L500 102 M85 168 L490 180" stroke="#aaa286" stroke-width="9"/>',36));
      scene.objects=scene.objects.filter(p=>p.id!=='bandage');
      if(mode==='duy-speaks')scene.objects.push(prop('phone','wet-phone',930,598,28,45,{text:'HỎNG'}));
      if(mode==='injury-close')focus(scene,1000,535,1.32);else focus(scene,995,455,1.16);
      if(mode==='landslide') {
        scene.objects=[svg('landslide',995,450,490,400,'<path d="M5 295 L40 190 L130 90 L210 30 L430 0 L520 100 L590 300 Z" fill="#5b5746" stroke="#343c32" stroke-width="8"/><path d="M50 250 L140 170 L210 210 L290 75 L330 235 L440 120 L545 265" fill="none" stroke="#827966" stroke-width="12"/>')];focus(scene,950,440,1.08);
      }
      break;
    case 'river-clear':bank(scene);scene.objects=[prop('lantern','signal',1020,585,40,60,{lightLevel:0})];focus(scene,960,450,1.05);break;
    case 'minh-call':
      bank(scene);scene.objects=[actor('minh',155,438,270),actor('head',285,453,250),prop('lantern','minh-lamp',200,510,40,60,{heldBy:'cast-minh',lightSignal:{pattern:'acknowledge'}})];
      focus(scene,320,420,1.07);break;
    case 'waiting':
      bank(scene);scene.objects=[actor('minh',145,450,260),actor('duy',990,465,280),prop('lantern','signal',1020,585,40,60,{lightSignal:{pattern:'distress'}}),
        prop('lantern','minh-lamp',195,510,40,60,{heldBy:'cast-minh',lightSignal:{pattern:'acknowledge'}})];o('cast-duy').pose='sit';o('cast-duy').expression='sad';o('cast-duy').y=503;
      scene.objects.push(prop('mountain','seat-rock',o('cast-duy').x,591,130,100,{color:'#667069',zIndex:24}));focus(scene,640,420,1);break;
    case 'rescuers-arrive':case 'first-aid':
      bank(scene);scene.objects=[actor('duy',1010,465,270),actor('rescuer1',830,470,275),actor('rescuer2',1150,468,275),prop('lantern','rescue-lamp',930,585,45,65)];
      o('cast-duy').pose='sit';o('cast-duy').expression='sad';o('cast-duy').y=503;
      scene.objects.push(prop('mountain','seat-rock',o('cast-duy').x,591,130,100,{color:'#667069',zIndex:24}));
      if(mode==='rescuers-arrive'){move(scene,o('cast-rescuer1'),65,300,scene.durationMs-500);move(scene,o('cast-rescuer2'),-35,300,scene.durationMs-500);}
      else {
        o('cast-rescuer1').y=500;o('cast-rescuer1').height=240;o('cast-rescuer1').pose='brace';
        scene.objects.push(svg('bandage',1060,575,48,40,'<path d="M40 20 L550 20 L550 280 L40 280 Z" fill="#ded8be" stroke="#898273" stroke-width="7"/><path d="M50 90 L545 95 M50 170 L545 175" stroke="#aaa68e" stroke-width="9"/>',36));
        o('bandage').opacity=0;o('cast-duy').legBandage='right';point(scene,o('cast-rescuer1'),o('bandage'),0);
      }
      focus(scene,1020,460,1.09);break;
    case 'assist-walk':
      environment(scene,'bg:night-hill-path',.1);scene.objects=[actor('rescuer1',425,460,295),actor('duy',555,466,285),actor('rescuer2',690,460,295)];
      for(const person of scene.objects)move(scene,person,165,500,scene.durationMs-700);
      o('cast-duy').expression='sad';o('cast-duy').rotation=-5;o('cast-duy').legBandage='right';
      scene.objects.push(prop('lantern','carried-lamp',500,490,45,64,{heldBy:'cast-rescuer1'}));focus(scene,660,430,1);break;
    case 'return-home':case 'hot-water':case 'duy-memory':
      room(scene,['lanh','duy','minh']);o('cast-duy').pose='sit';o('cast-duy').y=488;
      scene.objects.push(prop('chair','duy-chair',620,560,140,155,{zIndex:24}),prop('table','table',510,600,280,110,{zIndex:25}),prop('bowl','hot-cup',510,565,65,50));
      if(mode==='return-home') {o('cast-minh').x=810;o('cast-minh').facing='left';move(scene,o('cast-minh'),-60);}
      if(mode==='hot-water') {
        room(scene,[]);scene.objects.push(prop('table','table',660,610,600,200,{zIndex:25}),prop('bowl','hot-cup',740,550,130,80),
          svg('tea-pot',590,470,180,140,'<path d="M100 240 Q45 100 200 90 L345 90 Q380 20 540 40 L600 120 L435 170 Q400 275 100 240 Z" fill="#a38664" stroke="#3d382e" stroke-width="10"/><path d="M115 135 C-20 90 -20 230 125 210" fill="none" stroke="#645846" stroke-width="24"/><path d="M180 88 Q270 30 365 87" fill="#b79d7b" stroke="#4d4436" stroke-width="8"/>',36),
          svg('tea-stream',710,506,60,100,'<path d="M0 0 Q120 65 220 120 T600 300" fill="none" stroke="#cbaa69" stroke-width="22" opacity=".7"/>',36));
        scene.objects.push(svg('pouring-hand',425,455,210,70,'<path d="M0 45 Q180 65 450 125 L450 210 Q170 190 0 150 Z" fill="#79604f" stroke="#3c342c" stroke-width="8"/><path d="M435 123 Q480 113 530 132 Q595 142 580 176 L535 183 L500 167 L443 207 Z" fill="#d6aa84" stroke="#493d31" stroke-width="8"/><path d="M520 141 L555 166 M504 155 L543 180" fill="none" stroke="#977558" stroke-width="5"/>',38));
        o('tea-stream').keyframes=[{atMs:0,opacity:0},{atMs:300,opacity:1},{atMs:scene.durationMs-250,opacity:1},{atMs:scene.durationMs,opacity:0}];
        scene.effects=[{id:'steam',type:'smoke',x:740,y:515,scale:.2,intensity:.25,startMs:0,durationMs:scene.durationMs,zIndex:36}];focus(scene,670,480,1.16);break;
      }
      if(mode==='duy-memory')focus(scene,620,395,1.13);
      scene.effects=[{id:'steam',type:'smoke',x:510,y:545,scale:.2,intensity:.3,startMs:0,durationMs:scene.durationMs,zIndex:36}];break;
    case 'lamp-clean':
      room(scene,['minh']);scene.objects.push(prop('table','table',620,590,330,120,{zIndex:25}),prop('lantern','bench-lamp',715,485,82,112),prop('note','note',525,550,100,65));
      point(scene,o('cast-minh'),o('bench-lamp'),0);
      scene.objects.push(svg('cleaning-cloth',720,474,65,65,'<path d="M40 20 L525 40 L565 270 L60 290 Z" fill="#b2aa8c" stroke="#645f51" stroke-width="8"/>',38));
      o('cleaning-cloth').keyframes=Array.from({length:Math.ceil(scene.durationMs/400)},(_,i)=>({atMs:i*400,dy:i%2?14:-8,easing:'ease-in-out'}));focus(scene,650,440,1.15);break;
    case 'morning-plan':case 'signal-board':case 'minh-ending':
      room(scene,['lanh','minh'],mode!=='minh-ending');
      if(mode==='signal-board'){scene.objects.push(prop('note','notice',620,180,280,165,{text:'• • ━  CẦN GIÚP ĐỠ\n━ • •  ĐÃ NHÌN THẤY\nSỐ CỨU HỘ: 114'}));point(scene,o('cast-minh'),o('notice'));}
      if(mode==='minh-ending')focus(scene,620,410,1.1);break;
    default:throw new Error(`Missing shot: ${mode}`);
  }
  if(['return-home','hot-water','duy-memory','family-call'].includes(mode)&&scene.objects.some(p=>p.id==='cast-duy'))o('cast-duy').legBandage='right';
  // Speech stays on its speaker; offscreen narration never opens bystanders' mouths.
  const line=scene.dialogue?.[0],speaker=line?.characterKey&&scene.objects.find(p=>p.characterKey===line.characterKey);
  if(speaker&&line)scene.animationBeats!.unshift({id:`voice-${line.id}`,action:'talk',atMs:line.atMs||0,durationMs:line.durationMs||scene.durationMs,targetIds:[speaker.id],intensity:.2});
}

async function cutAudio(url:string|undefined,start:number,duration:number,water=false) {
  const key=createHash('sha256').update(JSON.stringify({engine:'story-cut-natural-v2',url,start,duration,water})).digest('hex');
  const cached=await findCachedAnimationAsset(key,'audio');if(cached)return cached.uri;
  const id=randomUUID(),file=path.join(workdir,'animation-assets','files',`${id}.wav`);await mkdir(path.dirname(file),{recursive:true});
  const args=['-y'];
  if(url){const asset=url.match(/assets\/([a-f0-9-]{36})\/file/)?.[1];if(!asset)throw new Error('Unregistered voice audio');
    args.push('-ss',String(start/1000),'-i',(await getAnimationAssetFile(asset)).path);
  }else args.push('-f','lavfi','-i',`anullsrc=r=48000:cl=stereo`);
  if(water)args.push('-f','lavfi','-i',`anoisesrc=d=${duration/1000}:c=brown:r=48000:a=1:seed=51`,
    '-filter_complex',`[0:a]apad,atrim=duration=${duration/1000}[voice];[1:a]highpass=f=130,lowpass=f=2000,volume=0.025[water];[voice][water]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9:level=false[a]`,'-map','[a]');
  else args.push('-af',`apad,atrim=duration=${duration/1000}`);
  args.push('-t',String(duration/1000),'-ar','48000','-ac','2','-c:a','pcm_s16le',file);await run('ffmpeg',args);
  const saved=await registerAnimationAsset({id,type:'audio',name:'Chiếc đèn · nhịp tự nhiên',uri:`/api/animation-studio/assets/${id}/file`,source:'generated',createdAt:new Date().toISOString(),tags:['story-edit-v2'],cacheKey:key});return saved.uri;
}
function phraseTime(scene:CanvasStudioScene,phrase:string) {
  const line=scene.dialogue![0]!,index=line.text.indexOf(phrase);if(index<0)throw new Error(`Missing phrase: ${phrase}`);
  const windows=line.speechWindows?.length?line.speechWindows:[{startMs:0,endMs:line.durationMs!}];
  let target=index/line.text.length*windows.reduce((sum,w)=>sum+w.endMs-w.startMs,0);
  for(const window of windows) {if(target<=window.endMs-window.startMs)return window.startMs+target;target-=window.endMs-window.startMs;}
  return line.durationMs!;
}
const scenes:CanvasStudioScene[]=[],manifest:Array<Record<string,unknown>>=[];
let cursor=0;
for(const [index,source] of original.scenes.entries()) {
  if(omitted.has(index))continue;
  const shots=coverage[index]!;
  const sourceFrames=Math.round(source.durationMs*30/1000)+(index===29?78:0);
  const cuts=[0,...shots.slice(1).map(([,cue])=>Math.round(phraseTime(source,cue!)*30/1000)),sourceFrames];
  // A coverage shot should be readable. Keep continuous audio under the cuts.
  for(let i=1;i<cuts.length-1;i++)cuts[i]=Math.max(cuts[i-1]!+75,Math.min(sourceFrames-(cuts.length-1-i)*75,cuts[i]!));
  for(const [part,[mode]] of shots.entries()) {
    const start=cuts[part]!/30*1000,duration=(cuts[part+1]!-cuts[part]!)/30*1000;
    const originalLine=source.dialogue![0]!,speechMs=Math.max(0,Math.min(duration,originalLine.durationMs!-start));
    const from=part?originalLine.text.indexOf(shots[part]![1]!):0;
    const to=part+1<shots.length?originalLine.text.indexOf(shots[part+1]![1]!):originalLine.text.length;
    const line={...originalLine,id:`${originalLine.id}-${part}`,atMs:0,durationMs:speechMs,text:originalLine.text.slice(from,to).trim(),
      audioUrl:undefined,audioKey:undefined,speechWindows:originalLine.speechWindows?.map(w=>({startMs:Math.max(0,w.startMs-start),endMs:Math.min(speechMs,w.endMs-start)})).filter(w=>w.endMs>w.startMs)};
    const scene:CanvasStudioScene={id:randomUUID(),name:`${source.name} · ${mode}`,durationMs:duration,background:'night',
      visualBrief:'Authored horror illustrated mountain story, natural narration with matched visible actions.',narration:line.text,dialogue:[line],
      captionTrack:{text:originalLine.text,durationMs:originalLine.durationMs!,offsetMs:start},
      atmosphere:{timeOffsetMs:cursor},objects:[],animationBeats:[],effects:[],lipSync:line.speechWindows};
    stage(scene,mode);
    scene.audioUrl=await cutAudio(source.audioUrl,start,duration,scene.backgroundRef!.includes('river')||scene.backgroundRef!.includes('rescue-banks'));
    // Save exact unmixed sliced voice as well, so later edits retain this take.
    line.audioUrl=await cutAudio(originalLine.audioUrl,start,Math.max(100,speechMs));line.audioKey=`story-cut:${originalLine.audioKey}:${start}:${speechMs}`;
    scenes.push(scene);manifest.push({source:index,mode,startMs:cursor,durationMs:duration,sourceAudioStartMs:start});cursor+=duration;
  }
  if(index===18) {
    const wait:CanvasStudioScene={id:randomUUID(),name:'Giữ đèn trong tiếng nước',durationMs:4000,background:'night',objects:[],animationBeats:[],dialogue:[],effects:[],atmosphere:{timeOffsetMs:cursor}};
    stage(wait,'waiting');wait.audioUrl=await cutAudio(undefined,0,4000,true);scenes.push(wait);manifest.push({mode:'waiting',startMs:cursor,durationMs:4000});cursor+=4000;
  }
}
if(Math.abs(cursor-300000)>1)throw new Error(`Timeline drift: ${cursor}`);
scenes[0]!.objects.push(createCanvasObject('text',{id:'opening-title',label:'Chiếc đèn cuối bản',text:'Chiếc đèn cuối bản',x:640,y:100,width:760,height:65,color:'#e6cfad',motion:'none',zIndex:80,
  keyframes:[{atMs:0,opacity:0},{atMs:500,opacity:1},{atMs:2800,opacity:1},{atMs:3600,opacity:0}]}));
const end=scenes.at(-1)!;end.objects.push(createCanvasObject('text',{id:'end-title',label:'Chiếc đèn cuối bản',text:'Chiếc đèn cuối bản',x:640,y:220,width:760,height:65,color:'#e6cfad',motion:'none',zIndex:80,
  keyframes:[{atMs:0,opacity:0},{atMs:end.durationMs-2600,opacity:0},{atMs:end.durationMs-1800,opacity:1}]}));
const project={...original,id:randomUUID(),name:'Chiếc đèn cuối bản · bản dựng hành động',scenes,updatedAt:new Date().toISOString()};
await writeFile(path.join(directory,'project.json'),JSON.stringify(project,null,2),'utf8');
await writeFile(path.join(directory,'shot-timing.json'),JSON.stringify({durationMs:cursor,voiceTempo:1,omitted:[...omitted],shots:manifest},null,2),'utf8');
console.log(`PROJECT ${scenes.length} shots, ${cursor}ms, ${Object.keys(cast).length} visual characters, voice tempo 1.0`);
if(process.argv.includes('--prepare-only'))process.exit(0);
const {renderCanvasAnimationProject}=await import('../server/services/animationRender');
const preview=process.argv.includes('--preview');
const toRender=preview?{...project,name:project.name+' · test',scenes:[scenes.find(s=>s.name.includes('signal-detail'))!,scenes.find(s=>s.name.includes('walking-party'))!,scenes.find(s=>s.name.includes('first-aid'))!,scenes.find(s=>s.name.includes('assist-walk'))!]}:project;
let previous=-1;
const result=await renderCanvasAnimationProject(toRender,undefined,p=>{const percent=Math.floor(p*100);if(percent!==previous){previous=percent;console.log(`RENDER ${percent}%`);}});
const target=path.join(directory,preview?'test-hanh-dong.mp4':'chiec-den-cuoi-ban-5-phut-v2.mp4');
await copyFile(result.path,target);console.log(`VIDEO=${target}`);process.exit(0);
