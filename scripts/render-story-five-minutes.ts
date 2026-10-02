import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {createCanvasObject,type CanvasStudioProject,type CanvasStudioScene,type CanvasDialogueLine} from '../shared/canvasAnimationStudio';
import {canvasEnvironmentDoorway} from '../shared/canvasEnvironment';
import {synchronizeCanvasPerformance} from '../shared/canvasPerformance';
import {createVieneuLocalProvider} from '../src/lib/providers';

process.env.AUTOSUB_VIENEU_WORKERS='1';
process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY='1';
const {prepareCanvasProjectAudio}=await import('../server/services/canvasAudioProduction');
const {run,workdir}=await import('../server/services/ffmpeg');
const {getAnimationAssetFile,findCachedAnimationAsset,registerAnimationAsset}=await import('../server/services/animationAssets');
const directory=path.resolve('tmp/chiec-den-cuoi-ban-5p');
await mkdir(directory,{recursive:true});
type Role='narrator'|'minh'|'lanh'|'duy';
type Place='outside'|'room'|'river'|'bank'|'morning';
type Shot={name:string;place:Place;role:Role;text:string;cast:Role[];action?:'point'|'react'|'walk';cue?:string;insert?:boolean};
const shots:Shot[]=[
  {name:'Ngôi nhà cuối bản',place:'outside',role:'narrator',cast:[],text:'Ở cuối bản Nà Mây có một ngôi nhà sàn nhìn xuống con suối. Mỗi tối, bà Lành đều treo một chiếc đèn vàng ngoài hiên. Người đi ngang thường bảo: đừng nhìn lâu về phía bên kia suối, nhất là những đêm trời trở gió.'},
  {name:'Người cháu trở về',place:'room',role:'narrator',cast:['lanh','minh'],text:'Chiều hôm ấy, Minh trở về sau nhiều năm làm việc dưới phố. Anh định sửa lại mái nhà cho bà rồi sáng hôm sau ra huyện. Trong lúc dọn đồ, anh thấy chiếc đèn cũ vẫn ở đúng chỗ cha mình từng treo, bên cạnh khung cửa gỗ.'},
  {name:'Một câu hỏi',place:'room',role:'minh',cast:['lanh','minh'],text:'Bà vẫn thắp chiếc đèn này mỗi tối sao? Đường vào bản đã có điện rồi mà. Cháu nhớ hồi nhỏ, cha thường lau kính rất kỹ, còn dặn cháu đừng mang nó đi chơi.',action:'point',cue:'chiếc đèn này'},
  {name:'Lời bà Lành',place:'room',role:'lanh',cast:['lanh','minh'],text:'Điện sáng đường, còn đèn này để người bên kia suối biết nhà mình vẫn có người. Cha cháu ngày trước làm nghề đưa đò. Ông ấy bảo, trời tối đến đâu cũng phải để lại một dấu hiệu cho người về muộn.'},
  {name:'Mưa kéo đến',place:'outside',role:'narrator',cast:[],text:'Minh chỉ cười, nghĩ bà đang nhắc chuyện xưa. Nhưng đến tối, mưa từ trên núi kéo xuống. Gió thổi qua những mái nhà, tiếng suối lớn dần. Đường xuống huyện bị chặn bởi một thân cây đổ, khiến anh phải ở lại thêm một đêm.'},
  {name:'Ánh sáng bên kia suối',place:'river',role:'narrator',cast:[],text:'Gần nửa đêm, giữa tiếng mưa, Minh nhìn thấy một chấm sáng bên kia suối. Nó sáng lên hai lần, tắt một lúc, rồi lại sáng. Chỗ ấy chỉ có bến đò cũ, nơi dân bản không còn đi qua kể từ ngày xây chiếc cầu mới.'},
  {name:'Minh báo tin',place:'room',role:'minh',cast:['lanh','minh'],text:'Bà ơi, bên bến cũ có đèn. Nó cứ chớp rồi tắt, như có ai đang gọi. Hay là người ta vẫn sang suối vào giờ này? Cháu ra hiên nhìn rõ hơn nhé.',action:'point',cue:'có đèn'},
  {name:'Đừng vội ra ngoài',place:'room',role:'lanh',cast:['lanh','minh'],text:'Cháu cứ đứng trong nhà đã. Mưa lớn thì mép bờ dễ sạt, đừng chạy xuống một mình. Bà không sợ ánh đèn ấy. Bà chỉ sợ người nhìn thấy nó mà nghĩ là chuyện ma, rồi đóng cửa đi ngủ.'},
  {name:'Tiếng cửa trong gió',place:'room',role:'narrator',cast:[],insert:true,text:'Một luồng gió lùa vào hiên. Cánh cửa gỗ kêu cót két, khép bớt rồi lại mở ra. Minh giật mình vì âm thanh rất gần. Nhưng khi nhìn kỹ, anh thấy chiếc đèn trên tường chỉ đang rung theo gió, còn ánh sáng xa kia vẫn chớp đều.'},
  {name:'Nhịp sáng khác thường',place:'river',role:'narrator',cast:[],text:'Minh bắt đầu đếm. Hai nhịp ngắn, một khoảng nghỉ, rồi một nhịp dài. Không giống ánh chớp, cũng không giống ngọn lửa bị gió thổi. Anh ghi nhịp sáng lên điện thoại, nhưng mạng mất. Từ bên kia, tiếng gọi mỏng đến mức gần như tan trong tiếng nước.'},
  {name:'Mảnh giấy trong hộp cũ',place:'room',role:'narrator',cast:['lanh','minh'],text:'Bà Lành lấy từ chiếc hộp gỗ một mảnh giấy đã ố vàng. Trên đó là những vạch ngắn, vạch dài, cùng nét chữ của cha Minh. Anh nhớ hồi nhỏ cha đã dạy mình cách gọi đò bằng đèn, nhưng nhiều năm qua anh tưởng đó chỉ là trò chơi.'},
  {name:'Tín hiệu cầu cứu',place:'room',role:'lanh',cast:['lanh','minh'],text:'Hai ngắn, một dài là cần giúp đỡ. Ngày trước người lái đò trong vùng đều biết nhịp này. Bến cũ bỏ rồi, nhưng bác Duy vẫn sang chăm vườn ở bên ấy. Chiều nay bà chưa thấy bác về.'},
  {name:'Nỗi lo có tên',place:'room',role:'narrator',cast:['minh'],text:'Lúc này Minh mới thấy sống lưng lạnh đi. Điều đáng sợ không phải một bóng ma trong rừng, mà là một người có thể đang mắc kẹt. Anh lấy áo khoác, gọi trưởng bản bằng cuộc gọi thường. Chuông đổ rất lâu rồi cuối cùng có người nghe máy.'},
  {name:'Kế hoạch của Minh',place:'room',role:'minh',cast:['lanh','minh'],text:'Cháu đã báo trưởng bản. Mọi người sẽ mang dây và đèn xuống bờ cao, đi theo đường phía sau nhà. Bà giúp cháu giữ chiếc đèn này sáng nhé. Nếu bác Duy nhìn thấy, bác sẽ biết có người đang đến.'},
  {name:'Đáp lại người bên kia',place:'room',role:'narrator',cast:[],insert:true,text:'Bà Lành đứng bên hiên, che đèn theo nhịp cha Minh từng dạy. Một nhịp dài, hai nhịp ngắn: đã nhìn thấy, hãy chờ. Bên kia suối, chấm sáng dừng lại vài giây. Rồi nó đáp lại, yếu hơn trước, nhưng rõ ràng và có chủ ý.'},
  {name:'Bờ cao trong đêm',place:'bank',role:'narrator',cast:['minh'],text:'Minh cùng hai người trong bản đi theo đường bờ cao. Họ không xuống lòng suối, cũng không bước lên chiếc cầu đang bị nước cuốn qua mặt. Đến bến cũ, mọi người dừng ở chỗ chắc chắn, buộc dây vào thân cây lớn và gọi về phía ánh đèn.'},
  {name:'Người lái đò xuất hiện',place:'river',role:'narrator',cast:['duy'],text:'Khi mưa thưa đi, họ nhìn thấy bác Duy trên bãi đá bên kia. Chiếc đèn nhỏ đặt trước mặt bác, một bên chân không đứng được. Con đường trở lại vườn đã bị đất lở chắn kín. Bác mắc kẹt từ chiều và phải giữ ánh sáng suốt mấy giờ.'},
  {name:'Tiếng bác Duy',place:'bank',role:'duy',cast:['duy'],text:'Bác trượt chân lúc nước lên. Điện thoại ướt mất rồi, nên chỉ còn chiếc đèn này. Bác biết nhà bà Lành vẫn nhìn về phía bến. Bác cứ ra tín hiệu, nghĩ rằng chỉ cần có người nhớ được nhịp ấy thì vẫn còn hy vọng.'},
  {name:'Giữ liên lạc',place:'bank',role:'minh',cast:['minh'],text:'Bác cứ ngồi ở bãi cao, đừng cố lội sang. Bọn cháu đã gọi đội cứu hộ ở xã. Mọi người đang tìm đường tiếp cận từ phía vườn trên đồi. Cháu ở đây giữ đèn, bác nhìn thấy ánh sáng này thì biết bọn cháu vẫn đang chờ.'},
  {name:'Những phút chờ đợi',place:'river',role:'narrator',cast:[],text:'Thời gian chậm lại trong tiếng nước. Minh nhận ra người bên kia cần một lời đáp hơn là những tiếng hô vội vã. Cứ một lúc, anh lại bật đèn báo rằng mình vẫn ở đó. Từ hiên nhà, chiếc đèn vàng của bà Lành cũng không tắt.'},
  {name:'Đường vòng an toàn',place:'bank',role:'narrator',cast:['minh'],text:'Gần một giờ sau, đội cứu hộ đến được bãi đá bằng lối trên đồi. Họ kiểm tra chân bác Duy, giữ ấm và dìu bác về theo đường an toàn. Minh chỉ rời bến khi nghe tin mọi người đã qua đoạn đất lở. Ánh đèn bên kia lúc ấy mới được tắt.'},
  {name:'Trở lại ngôi nhà sáng đèn',place:'room',role:'narrator',cast:['lanh','duy'],text:'Bác Duy được đưa về nhà bà Lành, nơi bếp vẫn còn ấm. Áo mưa ướt đặt ngoài hiên, tiếng gió đã dịu xuống. Bà rót nước nóng, còn Minh gọi cho gia đình bác. Trong căn nhà nhỏ, ai cũng nói khẽ, như sợ làm vỡ sự bình yên vừa tìm lại được.'},
  {name:'Một ký ức về cha',place:'room',role:'duy',cast:['duy','minh'],text:'Cha cháu đã dạy bác nhịp đèn ấy, hồi hai người còn đưa đò. Có lần chính bác bị kẹt giữa mưa và ông ấy đã đến. Đêm nay nhìn chiếc đèn ở hiên sáng lên, bác thấy như có người bạn cũ đang bảo: cứ chờ, đừng bỏ cuộc.'},
  {name:'Điều Minh chưa hiểu',place:'room',role:'minh',cast:['duy','minh'],text:'Cháu cứ nghĩ những điều cha dạy đã cũ, chẳng còn cần đến nữa. Có điện thoại, có cầu mới, ai lại nhìn một chiếc đèn để đoán ý nhau. Nếu bà không nhớ nhịp ấy, có lẽ cháu đã tưởng đó là ánh sáng trong rừng rồi quay vào ngủ.'},
  {name:'Bà không trách',place:'room',role:'lanh',cast:['lanh','minh'],text:'Điều cũ không phải lúc nào cũng đúng, nhưng điều mới cũng có lúc không dùng được. Cháu không cần tin mọi chuyện người ta kể. Chỉ cần trước khi bỏ qua một dấu hiệu, nghĩ xem bên kia có thể là một người đang cần mình hay không.'},
  {name:'Đêm gần sáng',place:'room',role:'narrator',cast:[],insert:true,text:'Minh ngồi bên chiếc hộp gỗ rất lâu. Mảnh giấy của cha không còn giống một kỷ vật để cất kín. Nó là một lời nhắn vẫn có người trả lời. Anh lau lại kính đèn, thay sợi dây đã sờn và ghi các nhịp sáng vào một tờ giấy mới.'},
  {name:'Sáng bên con suối',place:'morning',role:'narrator',cast:['lanh','minh'],text:'Sáng hôm sau, trời trong dần. Bác Duy được đưa đến trạm y tế, chân không bị thương nặng. Người trong bản rủ nhau kiểm tra lại đường ven suối và chiếc cầu. Câu chuyện về ánh đèn đêm trước được kể lại, lần này không còn bắt đầu bằng một lời dọa ma.'},
  {name:'Minh quyết định ở lại',place:'morning',role:'minh',cast:['lanh','minh'],text:'Cháu sẽ ở lại thêm vài ngày, sửa mái nhà và làm bảng hướng dẫn tín hiệu cho bến cũ. Mình cũng ghi số cứu hộ ở chỗ dễ thấy. Chiếc đèn này cháu giữ lại, nhưng cháu muốn mọi người biết nó dùng để gọi nhau, chứ không phải để sợ nhau.'},
  {name:'Một lời hẹn giản dị',place:'morning',role:'lanh',cast:['lanh','minh'],text:'Vậy tối nay cháu thắp đèn với bà nhé. Không phải vì chắc chắn sẽ có ai gặp nạn. Chỉ vì người đi qua nhìn thấy ánh sáng ấy, biết rằng ở cuối bản vẫn có một ngôi nhà sẵn lòng mở cửa.'},
  {name:'Chiếc đèn cuối bản',place:'outside',role:'narrator',cast:[],text:'Từ hôm đó, chiếc đèn vàng vẫn được thắp mỗi tối. Minh không còn nhìn sang bến cũ với nỗi sợ mơ hồ. Anh hiểu rằng trong bóng tối, một ánh sáng nhỏ chưa chắc là điều bí ẩn. Đôi khi, đó chỉ là một người đang chờ người khác nhìn thấy mình.'},
];
const voices:Record<Role,string>={narrator:'preset:anh-khoi',minh:'preset:minh-quan-pro',lanh:'preset:ngoc-huyen',duy:'preset:quang-son'};
const names:Record<Role,string>={narrator:'Người kể',minh:'Minh',lanh:'Bà Lành',duy:'Bác Duy'};
const backgrounds:Record<Place,[CanvasStudioScene['background'],string]>={outside:['night','bg:night-stilt-house'],room:['room','bg:room-stilt-house'],river:['night','bg:night-river'],bank:['night','bg:night-river-shoreline'],morning:['room','bg:room-stilt-day']};
const actor=(role:Role,index:number,count:number,place:Place)=>{
  const indoor=place==='room'||place==='morning';
  return createCanvasObject('character',{id:`cast-${role}`,characterKey:role,label:names[role],
    archetype:role==='minh'?'worker':role==='duy'?'sailor':'villager',hair:role==='lanh'?'bun':role==='duy'?'bald':'short',
    assetRef:`character:${role==='minh'?'worker':role==='duy'?'sailor':'villager'}`,
    color:role==='minh'?'#66747a':role==='lanh'?'#79604f':'#73735b',secondaryColor:'#46535a',skinTone:'#d6aa84',
    designNotes:role==='lanh'?'older woman, age 68, plain village blouse':role==='duy'?'older man, age 62, village ferryman, bald':'young adult man, age 27, narrow face, work shirt',
    x:place==='bank'?150:count===1?620:index===0?400:715,y:indoor?420:410,width:indoor?250:220,height:indoor?390:340,
    motion:'none',delayMs:0,pose:'idle',expression:'neutral',facing:count===1?'right':index===0?'right':'left',zIndex:30,
  });
};
const makeScene=(shot:Shot,index:number):CanvasStudioScene=>{
  const [background,backgroundRef]=backgrounds[shot.place];
  const objects=shot.cast.map((role,i)=>actor(role,i,shot.cast.length,shot.place));
  const indoor=shot.place==='room'||shot.place==='morning';
  if(indoor) {
    const opening=canvasEnvironmentDoorway(backgroundRef,1280,720)!;
    objects.push(createCanvasObject('prop',{id:'door',variant:'door',assetRef:'prop:door',label:'Cửa hiên',x:985,y:335,width:340,height:385,doorOpen:index===8?.45:0,motion:'none',zIndex:12}));
    objects.push(createCanvasObject('prop',{id:'lamp',variant:'lantern',assetRef:'prop:lantern',label:'Đèn ở hiên',x:opening.x+opening.width+44,y:opening.y+50,width:90,height:120,motion:'none',zIndex:20}));
    if(shot.name.includes('hộp')||index===25) objects.push(createCanvasObject('prop',{id:'box',variant:'box',assetRef:'prop:box',label:'Hộp kỷ vật',x:650,y:588,width:125,height:100,motion:'none',zIndex:18}));
  }
  if(shot.place==='river') objects.push(createCanvasObject('prop',{id:'signal',variant:'lantern',assetRef:'prop:lantern',label:'Tín hiệu ở bến cũ',x:970,y:325,width:23,height:30,motion:'none',zIndex:20,
    keyframes:Array.from({length:20},(_,i)=>({atMs:i*500,opacity:[1,.12,1,.12,.12,1,1,.12][i%8]}))}));
  const line:CanvasDialogueLine={id:`line-${index}`,speaker:names[shot.role],characterKey:shot.role==='narrator'?undefined:shot.role,text:shot.text,voice:voices[shot.role],
    emotion:shot.role==='narrator'?'storytelling':shot.role==='lanh'?'gentle':index===18?'firm':'natural'};
  return {id:randomUUID(),name:shot.name,durationMs:1000,background,backgroundRef,
    visualBrief:'horror illustrated mountain mystery, restrained adult acting, consistent clothes, same house architecture',
    narration:shot.text,dialogue:[line],objects,animationBeats:[],soundEffects:[],
    camera:{shot:shot.insert?'wide':shot.cast.length?'medium':'wide',motion:'none',focusX:640,focusY:360,zoom:1},effects:[]};
};
const checkpoint=path.join(directory,'project.audio-checkpoint.json');
let project:CanvasStudioProject={version:1,id:randomUUID(),name:'Chiếc đèn cuối bản',width:1280,height:720,fps:30,
  createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourcePrompt:'Truyện bí ẩn vùng núi, illustrated horror-style, kết thúc ấm áp: ánh đèn là tín hiệu cầu cứu, không phải ma.',
  castVoices:{minh:voices.minh,lanh:voices.lanh,duy:voices.duy,'Người kể':voices.narrator},scenes:shots.map(makeScene)};
try {const saved=JSON.parse(await readFile(checkpoint,'utf8')) as CanvasStudioProject;
  if(saved.name===project.name&&saved.scenes.length===shots.length&&saved.scenes.every((s,i)=>s.dialogue?.[0]?.text===shots[i]!.text))project=saved;
}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const save=async(file:string,value:unknown)=>writeFile(file,JSON.stringify(value,null,2),'utf8');
const narration={provider:createVieneuLocalProvider(),model:'vieneu-v3-turbo',voice:voices.narrator,speed:.98};
console.log(`SCRIPT ${shots.length} scenes, ${shots.reduce((sum,s)=>sum+s.text.split(/\s+/).length,0)} words`);
await writeFile(path.join(directory,'kich-ban.txt'),shots.map((s,i)=>`${i+1}. ${s.name}\n${names[s.role]}: ${s.text}`).join('\n\n'),'utf8');
for(const [index,scene] of project.scenes.entries()) {
  console.log(`AUDIO ${index+1}/${shots.length} ${scene.name}`);
  if(scene.dialogue![0]!.audioUrl)continue;
  const prepared=await prepareCanvasProjectAudio({project:{...project,scenes:[scene]},narration,autoSound:false});
  project.scenes[index]=prepared.scenes[0]!;
  await save(checkpoint,project);
  console.log(`AUDIO_READY ${index+1} ${Math.round(project.scenes[index]!.durationMs)}ms`);
}

// Direct actions AFTER the real voices exist; no guessed clocks or entrance pops.
for(const [index,scene] of project.scenes.entries()) {
  const shot=shots[index]!,line=scene.dialogue![0]!;
  scene.animationBeats=(scene.animationBeats||[]).filter(beat=>beat.id.startsWith('voice-'));
  const person=scene.objects.find(object=>object.characterKey===shot.role);
  if(shot.action&&person) {
    scene.animationBeats.push({id:`act-${index}`,action:shot.action==='walk'?'run':shot.action,atMs:700,durationMs:shot.action==='point'?2400:900,targetIds:[person.id],
      speechCue:shot.cue,dialogueId:line.id,focusTargetId:scene.objects.some(object=>object.id==='lamp')?'lamp':undefined,intensity:.25});
    if(shot.action==='point')person.facing='right';
  }
  synchronizeCanvasPerformance(scene);
  const lamp=scene.objects.find(object=>object.id==='lamp'),door=scene.objects.find(object=>object.id==='door');
  if(index===8&&door&&lamp) {
    door.keyframes=[{atMs:0,doorOpen:.45},{atMs:700,doorOpen:.45},{atMs:1500,doorOpen:.15,easing:'ease-in-out'},
      {atMs:2300,doorOpen:.55,easing:'ease-in-out'},{atMs:3300,doorOpen:.45,easing:'ease-in-out'}];
    lamp.keyframes=[{atMs:0,rotation:0},...Array.from({length:12},(_,i)=>({atMs:500+i*400,rotation:i%2?-3:3,easing:'ease-in-out' as const})),{atMs:6000,rotation:0}];
  }
  if(index===14&&lamp)lamp.keyframes=Array.from({length:20},(_,i)=>({atMs:i*450,opacity:[1,1,.08,1,.08,1,.08,.08][i%8],easing:'hold' as const}));
  // Motivate the mystery with restrained ambient sound, not constant scares.
  scene.soundEffects=undefined;
  const prepared=await prepareCanvasProjectAudio({project:{...project,scenes:[scene]},narration,autoSound:true});
  project.scenes[index]=prepared.scenes[0]!;
}
await save(path.join(directory,'project-natural.json'),project);
const naturalMs=project.scenes.reduce((sum,scene)=>sum+scene.durationMs,0);
const tempo=naturalMs/300000;
if(tempo<.65||tempo>1.5)throw new Error(`Speech timing outside acceptable range: ${naturalMs}ms, tempo ${tempo}. Check the retained audio before rendering.`);
console.log(`TIMING natural=${Math.round(naturalMs)}ms, delivery tempo=${tempo.toFixed(4)}, target=300000ms`);
const scaleTime=(value:number,ratio:number)=>Math.round(value*ratio);
async function retimeAudio(url:string,rate:number,label:string,outputDuration?:number) {
  const key=createHash('sha256').update(JSON.stringify({engine:'story-tempo-v1',url,rate,outputDuration})).digest('hex');
  const cached=await findCachedAnimationAsset(key,'audio');if(cached)return cached.uri;
  const sourceId=url.match(/assets\/([a-f0-9-]{36})\/file/)?.[1];if(!sourceId)throw new Error('Unknown audio asset');
  const input=(await getAnimationAssetFile(sourceId)).path,id=randomUUID();
  const file=path.join(workdir,'animation-assets','files',`${id}.wav`);await mkdir(path.dirname(file),{recursive:true});
  const filter=`atempo=${rate.toFixed(8)}`+(outputDuration?`,apad,atrim=duration=${outputDuration/1000}`:'');
  await run('ffmpeg',['-y','-i',input,'-af',filter,'-ar','48000','-ac','2','-c:a','pcm_s16le',file]);
  const asset=await registerAnimationAsset({id,type:'audio',name:label,uri:`/api/animation-studio/assets/${id}/file`,tags:['story-five-minutes','tempo'],createdAt:new Date().toISOString(),source:'generated',cacheKey:key});
  return asset.uri;
}
let allocatedFrames=0;
for(const [index,scene] of project.scenes.entries()) {
  const frames=index===project.scenes.length-1?9000-allocatedFrames:Math.round(scene.durationMs/naturalMs*9000);
  allocatedFrames+=frames;
  const targetMs=frames/30*1000,ratio=targetMs/scene.durationMs,rate=1/ratio;
  scene.audioUrl=await retimeAudio(scene.audioUrl!,rate,`${scene.name} · mix 5 phút`,targetMs);
  scene.audioMixKey=undefined;
  for(const line of scene.dialogue||[]) {
    line.audioUrl=await retimeAudio(line.audioUrl!,rate,`${scene.name} · ${line.speaker}`);
    line.audioKey=`story-retimed:${line.audioKey}`;
    line.atMs=scaleTime(line.atMs||0,ratio);line.durationMs=scaleTime(line.durationMs||0,ratio);
    line.speechWindows=line.speechWindows?.map(window=>({startMs:scaleTime(window.startMs,ratio),endMs:scaleTime(window.endMs,ratio)}));
  }
  scene.lipSync=scene.lipSync?.map(window=>({startMs:scaleTime(window.startMs,ratio),endMs:scaleTime(window.endMs,ratio)}));
  scene.animationBeats=scene.animationBeats?.map(beat=>({...beat,atMs:scaleTime(beat.atMs,ratio),durationMs:scaleTime(beat.durationMs,ratio)}));
  scene.soundEffects=scene.soundEffects?.map(cue=>({...cue,atMs:scaleTime(cue.atMs,ratio),durationMs:scaleTime(cue.durationMs,ratio)}));
  scene.objects=scene.objects.map(object=>({...object,keyframes:object.keyframes?.map(frame=>({...frame,atMs:scaleTime(frame.atMs,ratio)}))}));
  scene.durationMs=targetMs;
}
project.updatedAt=new Date().toISOString();
await save(path.join(directory,'project.json'),project);
await save(path.join(directory,'timing.json'),{naturalMs,tempo,finalFrames:allocatedFrames,finalDurationMs:300000,scenes:project.scenes.map(s=>({name:s.name,durationMs:s.durationMs}))});
await import('./finalize-story-five-minutes');
