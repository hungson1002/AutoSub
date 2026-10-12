import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS_STUDIO_VERSION } from '../../shared/canvasAnimationStudio';
import { parsePlan,repairCanvasPlanJsonText, splitNarration,wrapCanvasSceneRepair,resumeCanvasPlanCheckpoint,compileSimpleHorrorStaging } from './canvasAnimationDirector';
import {evaluateCanvasCamera} from '../../src/canvasAnimationStudio/runtime';
import {evaluateObjectKeyframes} from '../../src/canvasAnimationStudio/keyframes';

test('simple horror compiles to restrained reference-story staging and suppresses decorative movement', () => {
  const shot = {durationMs:12000,background:'room',template:'two-shot',narration:'Minh và Lan đứng trong nhà sàn nghe tiếng nước.',
    camera:{shot:'wide',motion:'push-in',zoom:1,keyframes:[{atMs:0,zoom:1},{atMs:12000,zoom:1.3}]},
    objects:[{kind:'character',label:'Minh',characterKey:'minh',motion:'bounce'}, {kind:'character',label:'Lan',characterKey:'lan',motion:'none'}],
    animationBeats:[{action:'pulse',targets:['minh'],atMs:1000,durationMs:1000},{action:'talk',targets:['minh'],atMs:2000,durationMs:2000}]};
  const project=parsePlan(JSON.stringify({scenes:[shot,shot]}),'truyện ma đơn giản');
  assert.equal(project.scenes.length,2);
  for(const scene of project.scenes){
    assert.equal(scene.durationMs,12000);
    assert.equal(scene.template,'two-shot');
    assert.equal(scene.backgroundRef,'bg:room-stilt-house');
    assert.equal(scene.camera?.shot,'medium');
    assert.equal(scene.camera?.motion,'none');
    assert.ok((scene.camera?.keyframes || []).length>=2);
    assert.ok((scene.camera?.keyframes || []).every(frame=>(frame.zoom||1)<=1.08));
    assert.equal(scene.objects.find(o=>o.characterKey==='minh')?.motion,'none');
    assert.equal(scene.objects.find(o=>o.characterKey==='minh')?.visualStyle,'horror');
    assert.equal(scene.objects.find(o=>o.characterKey==='minh')?.keyframes,undefined);
    assert.deepEqual(scene.animationBeats?.map(b=>b.action),['talk']);
    assert.ok(scene.effects?.some(effect=>effect.type==='vignette'));
  }
  assert.deepEqual(compileSimpleHorrorStaging(project),project,'safe to reapply after QC and audio production');
});

test('an establishing horror shot keeps the acting character readable when a story beat depends on the performance',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Nghe tiếng gõ',stageId:'room-performance',durationMs:5000,template:'wide-establishing',
    background:'room',backgroundRef:'bg:room-simple-night',
    narration:'Ba tiếng gõ vang lên sau cánh cửa. Linh ngẩng đầu và lắng nghe.',
    visualBrief:'Linh ngẩng đầu về phía cửa.',
    objects:[
      {kind:'character',label:'Linh',characterKey:'linh',role:'focal',slot:'hero-left'},
      {kind:'prop',label:'Cửa',variant:'door',role:'support',slot:'background-right'},
    ],
  }]}),'truyện ma trong phòng trọ');
  const scene=p.scenes[0]!,actor=scene.objects.find(o=>o.characterKey==='linh')!;
  assert.ok(scene.animationBeats?.some(beat=>beat.action==='nod'&&beat.targetIds.includes(actor.id)));
  assert.equal(actor.role,'focal');
  assert.notEqual(actor.sizeClass,'small');
  assert.ok(actor.height>=p.height*.38,'the actor must be large enough for the head action to read in the encoded frame');
  assert.ok(['medium','close-up'].includes(scene.camera?.shot||''),'performance establishing shot cannot remain an unreadable distant wide');
  assert.ok(Math.abs((scene.camera?.focusX||0)-actor.x)<3,'camera focus follows the acting character');
});

test('quiet single-focal indoor establishing shot stays readable even without a performance beat',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Phòng yên tĩnh',durationMs:6000,template:'wide-establishing',background:'room',backgroundRef:'bg:room-simple-night',
    narration:'Linh đứng im trong căn phòng tối.',
    objects:[{kind:'character',label:'Linh',characterKey:'linh',role:'focal',slot:'hero-left'}],
  }]}),'truyện ma trong phòng trọ');
  const actor=p.scenes[0]!.objects.find(o=>o.characterKey==='linh')!;
  assert.equal(actor.role,'focal');
  assert.ok(actor.height>=p.height*.36,'indoor focal establishing actor must remain readable after final horror staging');
  assert.ok(actor.sizeClass==='large'||actor.sizeClass==='medium');
});

test('horror cast is grounded on a depth-aware floor plane instead of one flat baseline',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Hành lang sâu',durationMs:7000,template:'wide-establishing',background:'city',backgroundRef:'bg:city-hallway',
    narration:'Ba người đứng ở ba lớp sâu khác nhau trong hành lang.',
    objects:[
      {kind:'character',label:'Gần',characterKey:'near',role:'focal',slot:'foreground-left',depth:'foreground'},
      {kind:'character',label:'Giữa',characterKey:'mid',role:'support',slot:'mid-center',depth:'midground'},
      {kind:'character',label:'Xa',characterKey:'far',role:'background',slot:'background-right',depth:'background'},
    ],
  }]}),'truyện ma trong hành lang');
  const scene=p.scenes[0]!;
  const contact=(key:string)=>{
    const o=scene.objects.find(item=>item.characterKey===key)!;
    assert.ok(Number.isFinite(o.groundY),`${key}: staged actor must carry an explicit world-space floor contact`);
    return o.groundY!;
  };
  assert.ok(contact('far')<contact('mid'),'background actors must stand closer to the vanishing line than the active cast');
  assert.ok(Math.abs(contact('mid')-contact('near'))<1,'actors directed onto the same midground plane must share one floor contact');
  assert.ok(Math.abs(contact('far')-p.height*.68)<1,'hallway background floor contact follows the authored perspective plane');
  assert.ok(Math.abs(contact('near')-p.height*.81)<1,'wide-shot focal cast directed to midground must use the midground floor plane');
  const far=scene.objects.find(item=>item.characterKey==='far')!;
  const t=(contact('far')-p.height*.49)/(p.height-p.height*.49);
  const floorRight=p.width*.57+(p.width-p.width*.57)*t;
  assert.ok(far.x<=floorRight-far.width*.50,'the full far-actor silhouette must stay inside the visible hallway floor wedge instead of overlapping the wall');
});

test('horror floor furniture snaps to the floor and tabletop lantern attaches to the table surface',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Phòng trọ',stageId:'room-props',durationMs:6000,template:'hero-left',
    background:'room',backgroundRef:'bg:room-simple-night',narration:'Một chiếc bàn với đèn dầu trong phòng.',
    objects:[
      {kind:'character',label:'Linh',characterKey:'linh',role:'focal',slot:'hero-left'},
      {kind:'prop',label:'Bàn',variant:'table',role:'support',slot:'mid-center'},
      {kind:'prop',label:'Đèn bàn',variant:'lantern',role:'support',slot:'mid-center',designNotes:'đèn dầu đặt trên bàn'},
    ],
  }]}),'truyện ma trong phòng trọ');
  const scene=p.scenes[0]!,table=scene.objects.find(o=>o.variant==='table')!,lamp=scene.objects.find(o=>o.variant==='lantern')!;
  assert.ok(Number.isFinite(table.groundY),'floor furniture carries an explicit perspective floor contact');
  assert.ok(Math.abs(table.y-(table.groundY!-table.height*.44))<1e-6,'table editor y follows the same authored bottom ratio as renderer snap');
  assert.equal(lamp.restingOn,table.id,'tabletop lantern must attach to the table rather than keep an absolute screen y');
  assert.equal(lamp.groundY,undefined,'tabletop props never also snap to the floor');
});

test('horror visual beats evolve one stable shot without rebuilding the stage',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Bóng ở cửa',
    stageId:'main-house-room',
    durationMs:9000,
    template:'hero-left',
    background:'room',
    backgroundRef:'bg:room-stilt-house',
    visualBrief:'Nam ngồi trong căn nhà tối. Một bóng người ở cửa từ từ hiện ra.',
    narration:'Nam nghe tiếng động. Bóng người hiện ra ở cửa. Nam quay sang nhìn, đèn dầu yếu dần.',
    objects:[
      {kind:'character',label:'Nam',characterKey:'nam',role:'focal',pose:'sit',sittingStyle:'ground'},
      {kind:'prop',label:'Bóng cửa',variant:'ghost',role:'support',slot:'background-right'},
      {kind:'prop',label:'Đèn dầu',variant:'lantern',role:'support',designNotes:'đèn đặt trong phòng'},
    ],
    visualBeats:[
      {atMs:2600,durationMs:700,action:'reveal-layer',targets:['Bóng cửa'],speechCue:'Bóng người hiện ra'},
      {atMs:4300,durationMs:250,action:'pose-change',targets:['nam'],pose:'brace',speechCue:'Nam quay sang nhìn'},
      {atMs:4300,durationMs:250,action:'look-at',targets:['nam'],focusTargetId:'Bóng cửa'},
      {atMs:5200,durationMs:900,action:'light-change',targets:['Đèn dầu'],lightLevel:.35,speechCue:'đèn dầu yếu dần'},
      {atMs:6200,durationMs:1400,action:'focus-shift',targets:[],cameraZoomDelta:.014,cameraDy:-3},
    ],
  }]}),'truyện ma trong nhà');
  const scene=p.scenes[0]!,ghost=scene.objects.find(o=>o.label==='Bóng cửa')!,nam=scene.objects.find(o=>o.characterKey==='nam')!,lamp=scene.objects.find(o=>o.variant==='lantern')!;
  assert.equal(scene.stageId,'main-house-room');
  assert.equal(scene.visualBeats?.length,5);
  assert.ok(evaluateObjectKeyframes(ghost.keyframes,2000).opacity<.05,'threat remains hidden before its cue');
  assert.ok(evaluateObjectKeyframes(ghost.keyframes,3500).opacity>.9,'only the threat layer appears after the cue');
  assert.equal(evaluateObjectKeyframes(nam.keyframes,5000).pose,'brace');
  assert.equal(evaluateObjectKeyframes(nam.keyframes,5000).lookAtId,ghost.id);
  assert.ok((evaluateObjectKeyframes(lamp.keyframes,6500).lightLevel||1)<.5);
  const c0=evaluateCanvasCamera(scene,0,p.width,p.height),c1=evaluateCanvasCamera(scene,7600,p.width,p.height);
  assert.ok(c1.scale-c0.scale<=.03,'horror focus shift stays a small camera breath');
});

test('horror atmosphere defaults animate the environment without adding actor loops',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Phòng tối',stageId:'room-a',durationMs:8000,template:'hero-left',background:'room',backgroundRef:'bg:room-stilt-house',
    visualBrief:'Một người ngồi yên cạnh đèn dầu trong phòng tối.',narration:'Anh ngồi im nghe tiếng gió.',
    objects:[{kind:'character',label:'Anh',characterKey:'anh',role:'focal',motion:'none'},{kind:'prop',label:'Đèn',variant:'lantern',role:'support'}],
  }]}),'truyện ma');
  const scene=p.scenes[0]!;
  assert.ok((scene.atmosphere?.filmGrain||0)>0);
  assert.ok((scene.atmosphere?.shadowBreath||0)>0);
  assert.ok((scene.atmosphere?.lampBreath||0)>0);
  assert.equal(scene.objects.find(o=>o.characterKey==='anh')?.motion,'none');
  const frames=scene.camera?.keyframes||[];
  const zooms=frames.map(frame=>frame.zoom).filter((v):v is number=>v!==undefined);
  assert.ok(Math.max(...zooms)-Math.min(...zooms)<=.03);
});

test('horror shot grammar preserves non-stilt physical locations instead of teleporting every story into the reference set',()=>{
  const p=parsePlan(JSON.stringify({scenes:[
    {
      name:'Hành lang chung cư',stageId:'apartment-hall',durationMs:8500,template:'hero-left',background:'city',backgroundRef:'bg:city-street',
      visualBrief:'Hành lang đô thị trước khu chung cư, một bóng người xa cuối lối đi.',narration:'Ở cuối hành lang, một bóng đen đứng im.',
      objects:[{kind:'character',label:'Linh',characterKey:'linh',role:'focal'},{kind:'prop',label:'Bóng đen',variant:'ghost',role:'background'}],
    },
    {
      name:'Đường rừng',stageId:'forest-path',durationMs:8200,template:'wide-establishing',background:'field',backgroundRef:'bg:field-open',
      visualBrief:'Lối mòn rừng núi tối, nhân vật nghe tiếng động sau hàng cây.',narration:'Tiếng động phát ra từ rừng phía sau.',
      objects:[{kind:'character',label:'Linh',characterKey:'linh',role:'focal'},{kind:'prop',label:'Cây',variant:'tree',role:'background'}],
    },
  ]}),'truyện ma đô thị và đường rừng');
  assert.equal(p.scenes[0]!.backgroundRef,'bg:city-hallway');
  assert.equal(p.scenes[0]!.stageId,'apartment-hall');
  assert.equal(p.scenes[1]!.backgroundRef,'bg:field-open');
  assert.equal(p.scenes[1]!.stageId,'forest-path');
  assert.ok(!p.scenes.some(scene=>/stilt-house|underfloor/.test(scene.backgroundRef||'')));
});

test('urban alley semantic upgrades a generic city ref to the authored night alley set',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Nhà trọ cuối hẻm',stageId:'exterior',durationMs:8000,template:'wide-establishing',
    background:'city',backgroundRef:'bg:city-street',
    visualBrief:'Đêm mưa trước dãy nhà trọ cũ cuối hẻm; nhân vật nhỏ trong khung.',
    narration:'Cô đi sâu vào con hẻm tối để tới khu nhà trọ.',
    objects:[{kind:'character',label:'Linh',characterKey:'linh',role:'support'}],
  }]}),'truyện ma đô thị');
  assert.equal(p.scenes[0]!.backgroundRef,'bg:city-alley-night');
  assert.equal(p.scenes[0]!.background,'city');
});

test('urban horror infers reusable hallway and neutral night room sets without stilt-house leakage',()=>{
  const p=parsePlan(JSON.stringify({scenes:[
    {name:'Hành lang chung cư',durationMs:8000,template:'close-reaction',visualBrief:'Hành lang chung cư tối, cuối lối có bóng người.',narration:'Cô nhìn ra hành lang chung cư.',objects:[{kind:'character',label:'Linh',characterKey:'linh'}]},
    {name:'Phòng trọ',durationMs:8000,template:'hero-left',visualBrief:'Trong phòng trọ ban đêm, cô ngồi cạnh cửa.',narration:'Cô quay vào căn phòng trọ tối.',objects:[{kind:'character',label:'Linh',characterKey:'linh'}]},
  ]}),'truyện ma đô thị trong chung cư');
  assert.equal(p.scenes[0]!.backgroundRef,'bg:city-hallway');
  assert.equal(p.scenes[0]!.background,'city');
  assert.equal(p.scenes[1]!.backgroundRef,'bg:room-simple-night');
  assert.equal(p.scenes[1]!.background,'room');
  assert.ok(!p.scenes.some(scene=>/stilt-house/.test(scene.backgroundRef||'')));
});

test('horror staging preserves dialogue and concrete story actions beyond the old two-beat cap',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{durationMs:12000,background:'room',template:'two-shot',
    dialogue:[{id:'tu-line',speaker:'Ông Tư',characterKey:'ong-tu',text:'Không được bước ra sân.'}],
    narration:'Ông Tư nói rồi với tay chặn cửa.',
    objects:[
      {kind:'character',label:'Ông Tư',characterKey:'ong-tu'},
      {kind:'prop',label:'Cửa',variant:'door'},
    ],
    animationBeats:[
      {action:'gesture',targets:['ong-tu'],atMs:300,durationMs:500},
      {action:'nod',targets:['ong-tu'],atMs:900,durationMs:500},
      {action:'reach',targets:['ong-tu'],focusTargetId:'Cửa',speechCue:'với tay chặn cửa',atMs:1800,durationMs:1200},
    ],
  }]}),'truyện ma trong nhà sàn');
  const scene=project.scenes[0]!;
  assert.ok(scene.animationBeats?.some(beat=>beat.action==='talk'&&beat.dialogueId==='tu-line'));
  assert.ok(scene.animationBeats?.some(beat=>beat.action==='reach'));
  assert.ok((scene.animationBeats?.length||0)>=3);
});

test('remote underfloor narration does not teleport an interior or doorway shot',()=>{
  const project=parsePlan(JSON.stringify({scenes:[
    {name:'Bên bếp lửa',template:'two-shot',background:'room',backgroundRef:'bg:room-stilt-house',
      narration:'Dù nghe thấy gì dưới sàn, tuyệt đối không được nhìn.',
      visualBrief:'Gian nhà sàn gỗ tối, ánh lửa ở trung tâm. Minh đứng bên trái, ông Panh bên phải.',
      objects:[{kind:'character',label:'Minh',characterKey:'minh'},{kind:'prop',label:'Bếp lửa',variant:'fire'},{kind:'character',label:'Ông Panh',characterKey:'panh'}]},
    {name:'Góc nhìn cánh cửa',template:'foreground-pov',background:'room',backgroundRef:'bg:room-stilt-house',
      narration:'Tiếng gõ vang ngược từ dưới sàn lên.',
      visualBrief:'Góc nhìn từ phía sau Minh hướng về cánh cửa gỗ tối khép hờ.',
      objects:[{kind:'character',label:'Minh',characterKey:'minh'},{kind:'prop',label:'Cánh cửa tối',variant:'door'}]},
  ]}),'truyện ma trong nhà sàn');
  assert.equal(project.scenes[0]!.backgroundRef,'bg:room-stilt-house');
  assert.equal(project.scenes[0]!.template,'two-shot');
  assert.equal(project.scenes[1]!.backgroundRef,'bg:room-stilt-house');
  assert.equal(project.scenes[1]!.template,'foreground-pov');
});

test('an ordinary person appearing does not get misclassified as a supernatural reveal',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{name:'Có thêm người bước vào',template:'two-shot',background:'room',backgroundRef:'bg:room-stilt-house',narration:'Bà Lý xuất hiện ở phía sau.',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',slot:'hero-left'},
    {kind:'character',label:'Ông Panh',characterKey:'panh',slot:'hero-right'},
    {kind:'character',label:'Bà Lý',characterKey:'ly',slot:'background-right',role:'support'},
  ]}]}),'truyện ma trong cùng một nhà sàn');
  const scene=project.scenes[0]!;
  assert.equal(scene.backgroundRef,'bg:room-stilt-house');
  assert.equal(scene.template,'two-shot');
  assert.equal(scene.objects.some(object=>object.variant==='ghost'),false);
});

test('continuous two-shot does not reshuffle actors just because narration mentions a sound or doorway',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{name:'Nghe tiếng động',template:'two-shot',background:'room',backgroundRef:'bg:room-stilt-house',narration:'Một tiếng động vang lên ngoài cửa. Minh vẫn ở bên trái bếp, ông Panh vẫn ở bên phải.',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',slot:'hero-left'},
    {kind:'character',label:'Ông Panh',characterKey:'panh',slot:'hero-right'},
    {kind:'prop',label:'Bếp lửa',variant:'fire',slot:'mid-center'},
  ]}]}),'truyện ma trong cùng một nhà sàn');
  const scene=project.scenes[0]!;
  assert.equal(scene.template,'two-shot');
  const minh=scene.objects.find(object=>object.characterKey==='minh')!;
  const panh=scene.objects.find(object=>object.characterKey==='panh')!;
  assert.equal(minh.slot,'hero-left');
  assert.equal(panh.slot,'hero-right');
  assert.equal(panh.depth,'midground');
  assert.notEqual(panh.sizeClass,'small');
});

test('a quiet horror shot keeps only a restrained camera creep and no idle actor drift',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{durationMs:10000,background:'room',template:'two-shot',narration:'They listen in silence.',
    camera:{shot:'wide',motion:'none',zoom:1},objects:[{kind:'character',label:'Worker',characterKey:'worker',motion:'none',pose:'idle'}]}]}),'simple horror');
  assert.equal(project.scenes[0]!.camera?.motion,'none');
  assert.ok((project.scenes[0]!.camera?.keyframes||[]).length>=2);
  assert.ok((project.scenes[0]!.camera?.keyframes||[]).every(frame=>(frame.zoom||1)<=1.08));
  assert.equal(project.scenes[0]!.objects[0]!.keyframes,undefined);
});

test('horror reveal locks the threat into the rear-right plane and removes duplicate doorway props',()=>{
  const project=parsePlan(JSON.stringify({scenes:[
    {name:'Cánh cửa tối',narration:'Minh nghe tiếng động ngoài cánh cửa.',objects:[
      {kind:'character',label:'Minh',characterKey:'minh'},
      {kind:'prop',label:'Cửa',variant:'door'},
    ]},
    {name:'Có thứ dưới sàn',narration:'Một bóng ma hiện ra dưới sàn nhà.',objects:[
      {kind:'character',label:'Minh',characterKey:'minh'},
      {kind:'prop',label:'Bóng người',variant:'ghost'},
    ]},
  ]}),'truyện ma xó kinh dị');
  const doorway=project.scenes[0]!,reveal=project.scenes[1]!;
  assert.equal(doorway.objects.some(object=>object.variant==='door'),false);
  const threatened=doorway.objects.find(object=>object.characterKey==='minh')!;
  assert.ok(threatened.x<260);
  assert.equal(threatened.facing,'right');
  assert.equal(threatened.pose,'idle');
  assert.equal(threatened.expression,'afraid');
  const ghost=reveal.objects.find(object=>object.variant==='ghost')!;
  assert.ok(ghost.x>590 && ghost.x<650);
  assert.ok(ghost.opacity>=.94 && ghost.opacity<=.98);
  assert.equal(ghost.slot,'background-center');
  assert.equal(ghost.sizeClass,'large');
  assert.equal(ghost.depth,'background');
  const witness=reveal.objects.find(object=>object.characterKey==='minh')!;
  assert.equal(witness.pose,'idle');
  assert.equal(witness.lookAtId,ghost.id);
  assert.equal(reveal.camera?.shot,'close-up');
  assert.ok((reveal.camera?.focusX||0)>680);
});

test('horror shot grammar maps story beats to location-specific authored locations',()=>{
  const scenes=[
    {name:'Đường vào bản',narration:'Minh đi trên con đường vào bản làng.',objects:[{kind:'character',label:'Minh',characterKey:'minh'}]},
    {name:'Trong nhà',narration:'Minh và ông Panh ngồi trong nhà sàn.',objects:[{kind:'character',label:'Minh',characterKey:'minh'},{kind:'character',label:'Panh',characterKey:'panh'}]},
    {name:'Cánh cửa',narration:'Một bóng đen đứng ngoài cánh cửa.',objects:[{kind:'character',label:'Minh',characterKey:'minh'},{kind:'prop',label:'Cửa',variant:'door'}]},
    {name:'Manh mối',narration:'Minh nhìn thấy vết cào trên sàn.',objects:[{kind:'prop',label:'Vết cào',variant:'floorboard'}]},
    {name:'Gầm nhà',narration:'Tiếng gõ vang lên dưới sàn nhà.',objects:[{kind:'character',label:'Minh',characterKey:'minh'}]},
  ];
  const project=parsePlan(JSON.stringify({scenes}),'truyện ma xó kinh dị');
  assert.deepEqual(project.scenes.map(scene=>[scene.template,scene.backgroundRef,scene.camera?.shot]),[
    ['wide-establishing','bg:night-hill-path','wide'],
    ['two-shot','bg:room-stilt-house','medium'],
    ['foreground-pov','bg:room-stilt-house','pov'],
    ['prop-focus','bg:room-floor-detail','close-up'],
    ['foreground-pov','bg:room-underfloor','pov'],
  ]);
});
import {defaultCanvasAssetRef} from '../../shared/canvasAssetRegistry';

test('auto cast gets distinct roles, hair and clothing without explicit art direction',()=>{
  const mk=(label:string,characterKey:string,extra:object={})=>({kind:'character',label,characterKey,...extra});
  const objects=[
    mk('Ông Panh','panh',{designNotes:'Ông già người nhà, đội khăn rằn.'}),
    mk('Kiên','kien',{designNotes:'Thanh niên làm thuê.'}),
    mk('Chị Mai','mai',{voiceGender:'female'}),
    mk('Bà An','an',{voiceGender:'female',archetype:'villager'}),
    mk('Bà Lan','lan',{voiceGender:'female',archetype:'villager'}),
  ];
  const project=parsePlan(JSON.stringify({scenes:[{narration:'Cả nhà ngồi quanh bếp.',objects}]}),'truyện ma');
  const byKey=(key:string)=>project.scenes[0]!.objects.find(o=>o.characterKey===key)!;
  assert.equal(byKey('panh').archetype,'villager');
  assert.equal(byKey('panh').hair,'hat');
  assert.equal(byKey('kien').archetype,'worker');
  const femaleHair=new Set(['mai','an','lan'].map(key=>byKey(key).hair));
  assert.ok(femaleHair.size>=2,'supporting women should share one drawing grammar without sharing one silhouette');
  assert.notEqual(byKey('an').color,byKey('lan').color,'same-archetype people must not share one costume colour');
});

test('indigo shirts and described hair buns retain identity across the story',()=>{
  const objects=[{kind:'character',label:'Minh',characterKey:'minh',designNotes:'Mặc áo cánh xanh chàm sẫm.'},{kind:'character',label:'Lan',characterKey:'lan',hair:'short',designNotes:'Cô gái tóc búi thấp, mặc áo bà ba nâu đất.'}];
  const project=parsePlan(JSON.stringify({scenes:[{narration:'Minh và Lan bên bờ sông.',objects},{narration:'Họ đứng chờ.',objects:objects.map(({designNotes,...actor})=>actor)}]}),'truyện ma');
  for(const scene of project.scenes){
    assert.equal(scene.objects.find(o=>o.characterKey==='minh')?.color,'#607b8c');
    assert.equal(scene.objects.find(o=>o.characterKey==='lan')?.hair,'bun');
    assert.match(scene.objects.find(o=>o.characterKey==='minh')?.designNotes||'',/xanh chàm/i,'identity bible must preserve first-scene design notes when later shots omit them');
    assert.match(scene.objects.find(o=>o.characterKey==='lan')?.designNotes||'',/tóc búi thấp/i,'hair/face design brief must persist across the story');
  }
});

test('absolute AI repair positions retain one continuous travel instead of empty frames',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{narration:'Chiếc đò trôi rồi dừng lại.',objects:[{kind:'ship',label:'Đò',keyframes:[
    {atMs:0,x:690,y:360},{atMs:5000,x:640,y:360},{atMs:12000,x:640,y:360},
  ]}]}]}),'truyện ma');
  assert.deepEqual(project.scenes[0]!.objects[0]!.keyframes?.map(k=>[k.dx,k.dy]),[[0,0],[-50,0],[-50,0]]);
});
import {applyCanvasChoreographyState} from '../../src/canvasAnimationStudio/choreography';
import {resolveStageCharacterRig,canvasCharacterHand} from '../../src/canvasAnimationStudio/characters/characterStaging';
import {characterDrawingScale} from '../../src/canvasAnimationStudio/characters/characterModel';

test('audio interruption resumes the approved visual plan and its scene identities',()=>{
  const project=parsePlan(JSON.stringify({scenes:[{narration:'The complete ending.',objects:[]}]}),'story');
  assert.equal(resumeCanvasPlanCheckpoint({stage:'approved',brief:'story',project},'story'),project);
  assert.equal(resumeCanvasPlanCheckpoint({stage:'approved',brief:'story',project},'different story'),undefined);
  assert.equal(resumeCanvasPlanCheckpoint({stage:'completed',brief:'story',project},'story'),undefined);
  assert.equal(resumeCanvasPlanCheckpoint({stage:'approved',brief:'story',project:{...project,scenes:[]}},'story'),undefined);
});

test('five-toed pig and hoof insert keep authored assets and their anatomy',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{narration:'Con heo có năm móng.',objects:[
    {kind:'prop',label:'Heo Năm Móng',variant:'pig',assetRef:'prop:pig',hoofCount:5},
    {kind:'prop',label:'Bàn chân năm móng',variant:'pig-hoof',assetRef:'prop:pig-hoof',hoofCount:5},
  ]}]}),'folk story');
  assert.deepEqual(p.scenes[0]!.objects.map(o=>[o.variant,o.assetRef,o.hoofCount]),[
    ['pig','prop:pig',5],['pig-hoof','prop:pig-hoof',5],
  ]);
});

test('AI gesture and nod survive production normalization without inventing recoil',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{durationMs:12000,background:'room',backgroundRef:'bg:room-stilt-day',template:'two-shot',
    narration:'Chúng mình gặp nhau nhé.',dialogue:[{speaker:'Minh',characterKey:'minh',text:'Chúng mình gặp nhau nhé.'}],
    objects:[{kind:'character',label:'Minh',characterKey:'minh',pose:'idle',motion:'none'},{kind:'character',label:'Lan',characterKey:'lan',pose:'idle',motion:'none'}],
    animationBeats:[{action:'gesture',targets:['minh'],focusTargetId:'lan',atMs:500,durationMs:1200},{action:'nod',targets:['lan'],focusTargetId:'minh',atMs:3000,durationMs:800}]
  }]}),'quiet dialogue');
  assert.equal(p.scenes.length,1);
  assert.equal(p.scenes[0]!.durationMs,12000,'a complete conversation must not be clamped to 6.5 seconds');
  const actions=p.scenes[0]!.animationBeats!.map(b=>b.action);
  assert.deepEqual([...actions].sort(),['gesture','nod','talk'].sort(),'authored acting and voice beat must all survive regardless of timeline sort');
  assert.equal(actions.includes('react'),false,'normalization must not invent recoil');
});

test('dialogue-only AI replies remain producible without inventing a narrator',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{durationMs:10000,dialogue:[{speaker:'Minh',characterKey:'minh',text:'Lan ơi, mình đến rồi.'}],objects:[{kind:'character',label:'Minh',characterKey:'minh'}]}]}),'conversation');
  assert.equal(p.scenes.length,1);assert.equal(p.scenes[0]!.dialogue!.length,1);assert.equal(p.scenes[0]!.narration,'');
});

test('one-scene visual repairs accept scene envelopes without losing scene content',()=>{
  const scene={name:'Phone',narration:'Minh nghe điện thoại.',objects:[{kind:'character',label:'Minh',characterKey:'minh'}]};
  for(const reply of [scene,{scene},{name:'Film',scenes:[scene]},{brief:'request',project:{name:'Film',scenes:[scene]}}]){
    const project=parsePlan(wrapCanvasSceneRepair(JSON.stringify(reply)),'story');
    assert.equal(project.scenes.length,1);assert.equal(project.scenes[0]!.narration,scene.narration);
  }
  assert.equal(wrapCanvasSceneRepair('{"pass":false}'),'{"pass":false}','an audit report is not a scene');
});

test('AI walk aliases survive object, keyframe and beat normalization',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{narration:'Minh đi chậm.',objects:[{kind:'character',label:'Minh',characterKey:'minh',pose:'walk',keyframes:[{atMs:0,pose:'walk'},{atMs:3000,dx:80,pose:'walk'}]}],animationBeats:[{action:'walk',targets:['minh'],atMs:0,durationMs:3000,speechCue:'đi chậm'}]}]}),'story');
  assert.equal(p.scenes[0]!.objects[0]!.pose,'run');
  assert.ok(p.scenes[0]!.objects[0]!.keyframes?.every(frame=>frame.pose==='run'));
  assert.equal(p.scenes[0]!.animationBeats?.[0]?.action,'run');
});

test('declared shirt colors survive procedural palette defaults and stay consistent across shots',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{narration:'Minh đến thăm bác.',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',archetype:'villager',designNotes:'Minh mặc áo sơ mi cộc tay màu xanh lam.'},
    {kind:'character',label:'Duy',characterKey:'duy',archetype:'villager',designNotes:'Duy mặc áo nâu.'},
  ]},{narration:'Minh kiểm tra chân.',objects:[{kind:'character',label:'Minh',characterKey:'minh',archetype:'villager'}]}]}),'story');
  assert.notEqual(p.scenes[0]!.objects[0]!.color,p.scenes[0]!.objects[1]!.color);
  assert.equal(p.scenes[0]!.objects[0]!.color,'#607b8c');
  assert.equal(p.scenes[1]!.objects[0]!.color,p.scenes[0]!.objects[0]!.color);
});

test('untreated, wrapping and treated injury states survive normalization and timed playback',()=>{
  const p=parsePlan(JSON.stringify({name:'Treatment',scenes:[{
    name:'Treatment',durationMs:4000,narration:'Minh kiểm tra rồi băng chân cho bác Duy.',background:'room',
    objects:[{kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:0,
      keyframes:[{atMs:0,bandageProgress:0},{atMs:1500,bandageProgress:0},{atMs:3000,bandageProgress:1},{atMs:3500,expression:'happy'}]}],animationBeats:[],
  }]}),'horror');
  const scene=p.scenes[0]!,patient=scene.objects[0]!;
  assert.equal(patient.bandageProgress,0);
  assert.equal(applyCanvasChoreographyState(patient,scene,1000).bandageProgress,0);
  assert.equal(applyCanvasChoreographyState(patient,scene,2250).bandageProgress,.5);
  assert.equal(applyCanvasChoreographyState(patient,scene,3900).bandageProgress,1);
  assert.equal(applyCanvasChoreographyState(patient,scene,1000).sittingStyle,'injured');
  const repaired=parsePlan(JSON.stringify(p),'horror');
  assert.deepEqual(repaired.scenes[0]!.objects[0]!.keyframes,patient.keyframes);
  assert.equal(applyCanvasChoreographyState({...patient,bandageProgress:undefined,keyframes:undefined},scene,1000).bandageProgress,undefined,'old bandaged characters keep the renderer default');
});

test('production stages real manual contact and preserves interaction references on a repair pass',()=>{
  for(const [action,variant] of [['wipe','lantern'],['write','note'],['tie','rope']] as const){
    const p=parsePlan(JSON.stringify({name:'Contact',scenes:[{name:action,background:'room',backgroundRef:'bg:room-stilt-house',narration:'Minh làm việc.',animationBeats:[{action,targets:['minh'],focusTargetId:variant,speechCue:'làm việc',atMs:0,durationMs:2600}],objects:[
      {kind:'character',label:'Minh',characterKey:'minh',role:'focal',sizeClass:'large'},
      {kind:'prop',label:variant,variant,role:'support'},
      {kind:'prop',label:'Phone',variant:'phone',heldBy:'minh'},
    ]}]}),'horror story');
    const scene=p.scenes[0]!,actor=applyCanvasChoreographyState(scene.objects[0]!,scene,1000),target=scene.objects[1]!;
    const hand=canvasCharacterHand(actor,scene,1000,false),{model}=resolveStageCharacterRig(actor,scene,1000,false);
    const fit=characterDrawingScale(actor,model);
    // Remove phone attachment for the physical contact check; it intentionally
    // constrains the same hand and cannot be performed concurrently.
    scene.objects=scene.objects.filter(o=>o.variant!=='phone');
    const physicalHand=canvasCharacterHand(actor,scene,1000,false);
    assert.ok(Math.hypot(physicalHand.x-target.x,physicalHand.y-target.y)<fit*4);
    if(action!=='tie')assert.notDeepEqual(resolveStageCharacterRig(actor,scene,600,false).rig.handR,resolveStageCharacterRig(actor,scene,1400,false).rig.handR);
    assert.ok(Number.isFinite(hand.x));
    const repaired=parsePlan(JSON.stringify(p),p.sourcePrompt!);
    assert.equal(repaired.scenes[0]!.animationBeats![0]!.focusTargetId,target.id);
  }
});

test('repair normalization retains heldBy ids and the explicit injured sitting style',()=>{
  const p=parsePlan(JSON.stringify({name:'Call',scenes:[{name:'Call',narration:'Bác Duy đang gọi.',background:'room',objects:[
    {kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured'},
    {kind:'prop',label:'Phone',variant:'phone',heldBy:'duy'},
  ],animationBeats:[]}]}),'horror');
  const repaired=parsePlan(JSON.stringify(p),'horror');
  assert.equal(repaired.scenes[0]!.objects[1]!.heldBy,p.scenes[0]!.objects[0]!.id);
  assert.equal(repaired.scenes[0]!.objects[0]!.sittingStyle,'injured');
});

test('caregiver is beside the guarded knee rather than overlapping the patient',()=>{
  for(const legBandage of ['left','right']){
    const p=parsePlan(JSON.stringify({name:'Aid',scenes:[{name:'Aid',narration:'Họ kiểm tra chân.',background:'room',backgroundRef:'bg:room-stilt-house',objects:[
      {kind:'character',label:'Doctor',characterKey:'doctor',role:'focal',sizeClass:'large'},
      {kind:'character',label:'Patient',characterKey:'patient',role:'support',pose:'sit',sittingStyle:'injured',legBandage,sizeClass:'large'},
    ],animationBeats:[{action:'aid',targets:['doctor'],focusTargetId:'patient',speechCue:'kiểm tra chân',atMs:0,durationMs:2600}]}]}),'horror');
    const scene=p.scenes[0]!,doctor=applyCanvasChoreographyState(scene.objects[0]!,scene,1000),patient=scene.objects[1]!;
    const {rig,model}=resolveStageCharacterRig(patient,scene,1000,false),scale=characterDrawingScale(patient,model),knee=legBandage==='left'?rig.kneeL:rig.kneeR;
    const hand=canvasCharacterHand(doctor,scene,1000,false);
    assert.ok(Math.abs(doctor.x-patient.x)>scale*35,'faces/torso must remain separated');
    assert.ok(Math.hypot(hand.x-patient.x-knee.x*scale*(patient.facing==='left'?-1:1),hand.y-patient.y-knee.y*scale)<scale*3,'hands must inspect the actual knee');
  }
});

test('held examination keeps the actual knee contact after its spoken cue finishes',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{name:'Examination',narration:'Minh kiểm tra chân bác Duy.',durationMs:5000,background:'room',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',pose:'aid',keyframes:[{atMs:0,pose:'aid'},{atMs:4200,pose:'idle'}]},
    {kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:0},
  ],animationBeats:[{action:'aid',targets:['minh'],focusTargetId:'duy',speechCue:'kiểm tra chân',atMs:200,durationMs:1500}]}]}),'story');
  const scene=p.scenes[0]!,actor=applyCanvasChoreographyState(scene.objects[0]!,scene,3000),patient=scene.objects[1]!;
  assert.equal(actor.lookAtId,patient.id);
  const hand=canvasCharacterHand(actor,scene,3000,false),{rig,model}=resolveStageCharacterRig(patient,scene,3000,false),scale=characterDrawingScale(patient,model);
  assert.ok(Math.hypot(hand.x-patient.x-rig.kneeR.x*scale*(patient.facing==='left'?-1:1),hand.y-patient.y-rig.kneeR.y*scale)<scale*3);
  assert.equal(applyCanvasChoreographyState(scene.objects[0]!,scene,4500).pose,'idle','explicit release still ends the held contact');
});

test('production chooses a real wooden ferry and does not fabricate surprise or reveal',()=>{
  const p=parsePlan(JSON.stringify({name:'River',scenes:[{name:'Waiting',narration:'Minh chờ bên con đò.',background:'river',template:'two-shot',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',pose:'idle',role:'focal'},
    {kind:'ship',label:'Con đò gỗ',role:'support',designNotes:'ferry with a wooden paddle'},
  ]}]}),'A quiet river story');
  assert.equal(p.scenes[0]!.objects.find(o=>o.kind==='ship')!.assetRef,'ship:wooden-ferry');
  assert.equal(p.scenes[0]!.animationBeats?.length,0);
  assert.equal(defaultCanvasAssetRef({kind:'ship',label:'Chiến thuyền quân Nguyên'}),'ship:historical-warship');
});
test('pouring uses a real actor, held teapot and resolved bowl target',()=>{
  const p=parsePlan(JSON.stringify({name:'Tea',scenes:[{name:'Tea',narration:'Bà rót nước nóng.',background:'room',objects:[
    {kind:'character',label:'Bà Lành',characterKey:'lanh'},
    {kind:'prop',label:'Tách trà',variant:'bowl'},
    {kind:'prop',label:'Ấm trà',variant:'teapot',heldBy:'lanh',pouringInto:'Tách trà'},
  ],animationBeats:[]}]}),'A quiet tea scene');
  const scene=p.scenes[0]!,pot=scene.objects.find(o=>o.variant==='teapot')!;
  assert.equal(pot.assetRef,'prop:teapot');assert.equal(pot.heldBy,scene.objects.find(o=>o.characterKey==='lanh')!.id);
  assert.equal(pot.pouringInto,scene.objects.find(o=>o.variant==='bowl')!.id);
});

test('physical signal, held props, rain and injured sitting state survive production parsing',()=>{
  const project=parsePlan(JSON.stringify({name:'Rescue',scenes:[{name:'Bank',durationMs:5000,background:'night',backgroundRef:'bg:night-rescue-banks',template:'two-shot',narration:'A ferryman waits on the bank.',
    atmosphere:{rainIntensity:.6,waterIntensity:1.4},objects:[null,{kind:'unknown',label:'invalid'},
      {kind:'character',label:'Duy',characterKey:'duy',role:'focal',pose:'sit',legBandage:'right'},
      {kind:'prop',label:'Lamp',variant:'lantern',heldBy:'duy',lightSignal:{pattern:'distress'},keyframes:[{atMs:0,lightLevel:1},{atMs:1000,lightLevel:0}]},
      {kind:'prop',label:'Note',variant:'note',text:'two short, one long'},
    ]}]}),'a rescue story');
  const scene=project.scenes[0]!,actor=scene.objects.find(o=>o.characterKey==='duy')!,lamp=scene.objects.find(o=>o.variant==='lantern')!;
  assert.equal(actor.pose,'sit');assert.equal(actor.legBandage,'right');assert.equal(lamp.heldBy,actor.id);
  assert.equal(lamp.lightSignal?.pattern,'distress');assert.equal(lamp.keyframes?.[1]?.lightLevel,0);
  assert.equal(lamp.opacity,1);assert.equal(scene.atmosphere?.rainIntensity,.6);
  assert.equal(scene.objects.find(o=>o.variant==='note')?.text,'two short, one long');
});

test('AI production preserves a single phrase action, resolves its gaze target and avoids automatic entrances',()=>{
  const project=parsePlan(JSON.stringify({name:'Scene',scenes:[{name:'Lamp',durationMs:3000,background:'room',template:'two-shot',narration:'Minh nhìn chiếc đèn.',
    dialogue:[{id:'line',speaker:'Narrator',text:'Minh nhìn chiếc đèn.'}],
    objects:[{kind:'character',label:'Minh',characterKey:'minh',role:'focal',slot:'hero-left'},
      {kind:'prop',label:'Đèn',variant:'lantern',slot:'mid-right',role:'support'},
      {kind:'prop',label:'Cửa',variant:'door',role:'background',doorOpen:.5,keyframes:[{atMs:0,doorOpen:.5},{atMs:2000,doorOpen:0}]}],
    animationBeats:[{action:'point',targets:['minh'],atMs:500,durationMs:1000,speechCue:'chiếc đèn',dialogueId:'line',focusTargetId:'Đèn'}]}]}),'a story');
  const scene=project.scenes[0]!,beat=scene.animationBeats![0]!;
  assert.equal(scene.animationBeats!.length,1);assert.equal(beat.speechCue,'chiếc đèn');assert.equal(beat.dialogueId,'line');
  assert.equal(beat.focusTargetId,scene.objects.find(object=>object.label==='Đèn')!.id);
  assert.ok(scene.objects.every(object=>object.motion==='none'&&object.delayMs===0));
  assert.equal(scene.objects.find(object=>object.variant==='door')!.keyframes![1]!.doorOpen,0);
});

test('portrait 9:16 horror keeps semantic subjects inside frame and anchors the demon dog on the roof',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{
    name:'Quỷ Cẩu lộ diện trên nóc nhà',
    durationMs:9000,
    template:'hero-right',
    background:'night',
    backgroundRef:'bg:night-stilt-house',
    visualBrief:'Ngoài sân dưới ánh trăng, Quỷ Cẩu lông trắng đội nón mê hiện ra trên nóc nhà tranh.',
    narration:'Quỷ Cẩu hiện ra trên nóc nhà.',
    objects:[
      {kind:'prop',label:'Nhà sàn',variant:'house',role:'support'},
      {kind:'prop',label:'Quỷ Cẩu',variant:'demon-dog',role:'focal',designNotes:'lông trắng; nón mê rách; chống gậy tre'},
    ],
  }]}),'truyện ma Quỷ Cẩu',{width:720,height:1280});
  assert.equal(p.width,720);assert.equal(p.height,1280);
  const scene=p.scenes[0]!,dog=scene.objects.find(o=>o.variant==='demon-dog')!;
  assert.ok(dog);
  assert.equal(scene.objects.some(o=>o.variant==='house'),false,'authored house background must not receive a duplicate house prop');
  assert.ok(dog.x-dog.width/2>=0&&dog.x+dog.width/2<=p.width);
  assert.ok(dog.y< p.height*.5,'roof threat must stay in the upper half of a portrait frame');
  assert.ok(dog.width<p.width*.6&&dog.height<p.height*.5,'portrait assets must not inherit distorted 16:9 dimensions');
});

test('support relations keep a table lamp grounded and a sleeping actor attached to the bed',()=>{
  const p=parsePlan(JSON.stringify({scenes:[
    {name:'Trong nhà',durationMs:9000,template:'two-shot',background:'room',backgroundRef:'bg:room-stilt-house',
      visualBrief:'Hai cha con ngồi trong nhà, đèn dầu đặt trên bàn gỗ giữa họ.',narration:'Họ nói chuyện bên chiếc đèn.',
      dialogue:[{speaker:'Ông',characterKey:'ong',text:'Đừng ra ngoài.'},{speaker:'Nam',characterKey:'nam',text:'Vâng.'}],
      objects:[
        {kind:'character',label:'Ông',characterKey:'ong'},{kind:'character',label:'Nam',characterKey:'nam'},
        {kind:'prop',label:'Bàn',variant:'table'},{kind:'prop',label:'Đèn dầu',variant:'lantern',designNotes:'đèn dầu đặt trên bàn'},
      ]},
    {name:'Nằm nghe tiếng động',durationMs:9000,template:'hero-left',background:'room',backgroundRef:'bg:room-stilt-house',
      visualBrief:'Nam nằm co ro trên chõng tre nhìn lên trần nhà.',narration:'Nam nằm co ro trên chõng.',
      objects:[{kind:'character',label:'Nam',characterKey:'nam',pose:'idle'},{kind:'prop',label:'Chõng',variant:'bed'}]},
  ]}),'truyện ma trong nhà');
  const room=p.scenes[0]!,table=room.objects.find(o=>o.variant==='table')!,lamp=room.objects.find(o=>o.variant==='lantern')!;
  assert.ok(Math.abs(lamp.x-table.x)<=table.width*.5);
  assert.ok(lamp.y<table.y,'lamp must sit above the table center instead of overlapping a character');
  const sleep=p.scenes[1]!,bed=sleep.objects.find(o=>o.variant==='bed')!,actor=sleep.objects.find(o=>o.kind==='character')!;
  assert.equal(actor.pose,'lie-down');
  assert.ok(Math.abs(actor.x-bed.x)<bed.width*.1);
});

test('Canvas Studio schema version remains stable', () => {
  assert.equal(CANVAS_STUDIO_VERSION, 1);
});

test('narration splitting respects whitespace and creates short visual beats', () => {
  const input = 'Đây là một câu mở đầu có nhiều từ để kiểm tra việc chia cảnh. Đây là câu thứ hai tiếp tục giải thích về con nước và bãi cọc.';
  const chunks = splitNarration(input, 12);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.split(/\s+/).filter(Boolean).length <= 12));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), input.replace(/\s+/g, ' '));
});


test('repairs a missing comma between adjacent array objects', () => {
  const malformed = '{"name":"demo","scenes":[{"name":"one","narration":"a","objects":[]} {"name":"two","narration":"b","objects":[]}]}';
  const repaired = repairCanvasPlanJsonText(malformed);
  const parsed = JSON.parse(repaired) as { scenes: Array<{ name: string }> };
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(parsed.scenes.map((scene) => scene.name), ['one', 'two']);
});

test('removes trailing commas without touching commas inside strings', () => {
  const malformed = '{"name":"a, b","scenes":[{"name":"one","narration":"x","objects":[],},],}';
  const repaired = repairCanvasPlanJsonText(malformed);
  const parsed = JSON.parse(repaired) as { name: string; scenes: unknown[] };
  assert.equal(parsed.name, 'a, b');
  assert.equal(parsed.scenes.length, 1);
});

test('a complete narrated dialogue scene is never cloned with repeated speech',()=>{
 const words='Trong xóm nhỏ ven sông bà Sáu cùng An và Mai đang nhìn con heo đứng bên hàng tre dưới nắng sớm.';
 const project=parsePlan(JSON.stringify({scenes:[{name:'Opening',durationMs:9000,narration:words,dialogue:[{speaker:'Người kể',text:words}],objects:[{kind:'prop',variant:'pig',label:'Năm'}]}]}),'kể chuyện bí ẩn dân gian');
 assert.equal(project.scenes.length,1);
 assert.equal(project.scenes[0]!.dialogue!.map(l=>l.text).join(' '),words);
 assert.equal(project.scenes[0]!.durationMs,9000);
});

test('long stories preserve every planned scene and the ending',()=>{
 const scenes=Array.from({length:86},(_,i)=>({name:`Scene ${i}`,durationMs:7000,narration:`Cảnh thứ ${i}.`,objects:[{kind:'prop',variant:'pig',label:'Năm'}]}));
 const project=parsePlan(JSON.stringify({scenes}),'truyện kinh dị dài 10 phút');
 assert.equal(project.scenes.length,86);
 assert.equal(project.scenes.at(-1)!.narration,'Cảnh thứ 85.');
});
