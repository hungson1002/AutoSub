import { canvasLayoutFingerprint, compileCanvasProjectLayout } from './canvasLayoutCompiler';
import { defaultCanvasAssetRef, defaultCanvasBackgroundRef, isCanvasAuthoredAssetSupported, resolveCanvasAuthoredAsset, resolveCanvasAuthoredBackground } from './canvasAssetRegistry';
import type { CanvasStudioProject, CanvasStudioScene } from './canvasAnimationStudio';
import {evaluateCanvasActionCoverage} from './canvasActionCoverage';
import {canvasConversationKey} from './canvasDialogueDirection';
import {canvasFloorPropBottomRatio,canvasSpatialIssues} from './canvasSpatialRelations';
import { isFolkHorrorBrief } from './canvasFolkHorror';
import { folkContactIssues } from '../src/canvasAnimationStudio/folkHorrorContact';

export type CanvasVisualIssue = {
  code:
    | 'raw-layout'
    | 'invalid-physical-attachment'
    | 'missing-action-coverage'
    | 'missing-semantic-focal'
    | 'text-heavy'
    | 'text-focal-over-semantic'
    | 'repeated-composition'
    | 'low-template-variety'
    | 'floating-equipment'
    | 'missing-ground-contact'
    | 'large-overlap'
    | 'unsupported-authored-asset'
    | 'missing-asset-ref'
    | 'unsupported-authored-background'
    | 'missing-background-ref'
    | 'low-detail-asset'
    | 'low-detail-background'
    | 'low-choreography-density'
    | 'semantic-visual-mismatch'
    | 'static-hold'
    | 'motion-overload'
    | 'stage-continuity-jump'
    | 'missing-stage-id'
    | 'weak-visual-beat'
    | 'weak-focal-readability'
    | 'missing-asset-identity'
    | 'mixed-character-style'
    | 'reference-style-gap';
  severity: 'error' | 'warning';
  sceneId?: string;
  sceneName?: string;
  message: string;
};

export type CanvasVisualQualityReport = {
  pass: boolean;
  score: number;
  issues: CanvasVisualIssue[];
  stats: {
    scenes: number;
    uniqueTemplates: number;
    uniqueFingerprints: number;
    maxFingerprintRun: number;
    titleLikeScenes: number;
    semanticObjects: number;
    authoredObjects: number;
    authoredCoverage: number;
    authoredBackgrounds: number;
    backgroundCoverage: number;
    averageAssetDetail: number;
    averageBackgroundDetail: number;
    averageAnimationBeats: number;
    averageVisualBeats: number;
    /** 0-100 timing/continuity grammar score; not a measured visual likeness. */
    referenceStyleScore: number;
    majorShotsPerMinute: number;
    visualEventsPerMinute: number;
  };
};

function wordCount(value: string | undefined) {
  return (value || '').trim().split(/\s+/).filter(Boolean).length;
}

function semanticObjects(scene: CanvasStudioScene) {
  return scene.objects.filter((object) =>
    object.kind === 'character'
    || object.kind === 'ship'
    || object.kind === 'stake'
    || object.kind === 'prop',
  );
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const ax1 = a.x - a.width / 2;
  const ax2 = a.x + a.width / 2;
  const ay1 = a.y - a.height / 2;
  const ay2 = a.y + a.height / 2;
  const bx1 = b.x - b.width / 2;
  const bx2 = b.x + b.width / 2;
  const by1 = b.y - b.height / 2;
  const by2 = b.y + b.height / 2;
  const width = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const height = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = width * height;
  if (!intersection) return 0;
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export function evaluateCanvasVisualQuality(project: CanvasStudioProject): CanvasVisualQualityReport {
  const compiled = compileCanvasProjectLayout(project);
  if(compiled.scenes.every(scene=>scene.vectorScene)){
    const reviewed=compiled.vectorReview?.pass===true;
    const shots=compiled.scenes.length,parts=compiled.scenes.reduce((sum,s)=>sum+s.vectorScene!.nodes.length,0);
    const events=compiled.scenes.reduce((sum,s)=>sum+s.vectorScene!.tracks.length,0);
    const minutes=compiled.scenes.reduce((sum,s)=>sum+s.durationMs,0)/60000;
    return {pass:reviewed,score:reviewed?100:0,issues:reviewed?[]:compiled.vectorReview?.issues?.length?compiled.vectorReview.issues.map(issue=>({code:'reference-style-gap' as const,severity:'warning' as const,sceneId:issue.sceneId,message:issue.problem})):[{code:'reference-style-gap',severity:'warning',message:'Vector có hình hợp lệ nhưng chưa được kiểm tra trên ảnh render.'}],
      stats:{scenes:shots,uniqueTemplates:shots,uniqueFingerprints:shots,maxFingerprintRun:1,titleLikeScenes:0,
        semanticObjects:parts,authoredObjects:parts,authoredCoverage:1,authoredBackgrounds:shots,backgroundCoverage:1,
        averageAssetDetail:0,averageBackgroundDetail:0,averageAnimationBeats:events/shots,averageVisualBeats:events/shots,
        referenceStyleScore:0,majorShotsPerMinute:shots/Math.max(.001,minutes),visualEventsPerMinute:events/Math.max(.001,minutes)}};
  }
  const folkMode = isFolkHorrorBrief(project.sourcePrompt || '');
  const horrorMode = folkMode || /(?:kinh\s*d[iị]|truy[eệ]n\s*ma|ma\s*x[oó]|ma\s*da|r[uù]ng\s*r[oợ]n|horror|ghost\s*story|creepy|haunted|g[aầ]m\s*s[aà]n)/iu.test(project.sourcePrompt || '');
  const issues: CanvasVisualIssue[] = evaluateCanvasActionCoverage(compiled).map(issue=>({
    code:'missing-action-coverage',severity:'error',sceneId:issue.sceneId,sceneName:issue.sceneName,message:issue.message,
  }));
  const fingerprints = compiled.scenes.map(canvasLayoutFingerprint);
  const templates = new Set(compiled.scenes.map((scene) => scene.template || 'raw'));
  const uniqueFingerprints = new Set(fingerprints);
  let maxFingerprintRun = 0;
  let currentRun = 0;
  let lastFingerprint = '';
  let unmotivatedRun=0,maxUnmotivatedRun=0;
  let titleLikeScenes = 0;
  let semanticObjectCount = 0;
  let authoredObjectCount = 0;
  let authoredBackgroundCount = 0;
  let assetDetailTotal = 0;
  let backgroundDetailTotal = 0;
  let animationBeatTotal = 0;
  let visualBeatTotal = 0;
  let horrorDurationMs=0;
  let horrorInternalEvents=0;
  let horrorPacedShots=0;
  let horrorSubtleCameraShots=0;
  let horrorAtmosphereShots=0;
  let horrorStageShots=0;
  let horrorDecorativeObjects=0;
  let horrorSemanticObjects=0;

  compiled.scenes.forEach((scene, sceneIndex) => {
    for(const message of canvasSpatialIssues(scene))issues.push({code:'invalid-physical-attachment',severity:'error',sceneId:scene.id,sceneName:scene.name,message});
    const animationBeatCount = scene.animationBeats?.length || 0;
    const visualBeatCount = scene.visualBeats?.length || 0;
    animationBeatTotal += animationBeatCount;
    visualBeatTotal += visualBeatCount;

    // Perceptual QC: a beat is not production-ready merely because it exists in
    // JSON. The target must be large/opaque/different enough to survive final
    // 720p encoding and phone-size playback.
    for(const beat of scene.visualBeats||[]){
      const targets=beat.targetIds.map(id=>scene.objects.find(object=>object.id===id)).filter(Boolean) as typeof scene.objects;
      if(!targets.length&&beat.action!=='focus-shift'){
        issues.push({
          code:'weak-visual-beat',severity:'error',sceneId:scene.id,sceneName:scene.name,
          message:`Visual beat ${beat.action} không còn target render được.`,
        });
        continue;
      }
      if(beat.action==='reveal-layer'){
        for(const target of targets){
          const end=target.keyframes?.find(frame=>frame.visualBeatId===beat.id&&frame.visualBeatPhase==='end');
          const endOpacity=end?.opacity??beat.opacity??target.opacity;
          const readableHeight=target.height/Math.max(1,project.height);
          if(endOpacity<.65||readableHeight<.16){
            issues.push({
              code:'weak-visual-beat',
              severity:endOpacity<.55||readableHeight<.12?'error':'warning',
              sceneId:scene.id,sceneName:scene.name,
              message:`Reveal ${target.label} chưa đủ đọc (opacity ${endOpacity.toFixed(2)}, cao ${Math.round(readableHeight*100)}% khung).`,
            });
          }
        }
      }else if(beat.action==='draw-on'){
        for(const target of targets){
          if(target.width/project.width<.16){
            issues.push({
              code:'weak-visual-beat',severity:'warning',sceneId:scene.id,sceneName:scene.name,
              message:`Draw-on clue ${target.label} chỉ rộng ${Math.round(target.width/project.width*100)}% khung; chữ/chi tiết sẽ khó đọc.`,
            });
          }
        }
      }else if(beat.action==='light-change'&&beat.lightLevel!==undefined){
        for(const target of targets){
          const frames=(target.keyframes||[]).filter(frame=>frame.visualBeatId===beat.id);
          const start=frames.find(frame=>frame.visualBeatPhase==='start')?.lightLevel??target.lightLevel??1;
          const end=frames.find(frame=>frame.visualBeatPhase==='end')?.lightLevel??beat.lightLevel;
          if(Math.abs(start-end)<.28){
            issues.push({
              code:'weak-visual-beat',severity:'warning',sceneId:scene.id,sceneName:scene.name,
              message:`Light beat của ${target.label} chỉ đổi ${Math.round(Math.abs(start-end)*100)}%; thay đổi exposure khó nhận bằng mắt.`,
            });
          }
        }
      }
    }

    const shotFocal=semanticObjects(scene).find(object=>object.role==='focal');
    if(scene.template==='close-reaction'&&shotFocal?.kind==='character'&&shotFocal.height/project.height<.40){
      issues.push({
        code:'weak-focal-readability',severity:'error',sceneId:scene.id,sceneName:scene.name,
        message:`Close reaction nhưng nhân vật focal chỉ cao ${Math.round(shotFocal.height/project.height*100)}% khung.`,
      });
    }
    if(scene.template==='prop-focus'&&shotFocal?.kind==='prop'&&shotFocal.width/project.width<.24){
      issues.push({
        code:'weak-focal-readability',severity:'error',sceneId:scene.id,sceneName:scene.name,
        message:`Prop-focus nhưng ${shotFocal.label} chỉ rộng ${Math.round(shotFocal.width/project.width*100)}% khung.`,
      });
    }
    // Coverage checks above verify concrete narrated actions. A numerical
    // beat quota cannot distinguish a missing event from a deliberate quiet
    // hold and used to force repeated gestures into otherwise correct shots.

    if(horrorMode){
      const spokenWords=wordCount(scene.narration)||scene.dialogue?.reduce((sum,line)=>sum+wordCount(line.text),0)||0;
      const concreteActions=(scene.animationBeats||[]).filter(beat=>!['talk','gesture','nod','float','pulse'].includes(beat.action));
      horrorDurationMs+=scene.durationMs;
      horrorInternalEvents+=visualBeatCount+concreteActions.length;
      if(scene.durationMs>=4000&&scene.durationMs<=12000)horrorPacedShots+=1;
      if(scene.stageId)horrorStageShots+=1;
      const ambience=scene.atmosphere;
      if(ambience&&[
        ambience.fogDrift,ambience.dustMotes,ambience.filmGrain,ambience.shadowBreath,
        ambience.fireFlicker,ambience.lampBreath,ambience.wind,ambience.rainIntensity,
      ].some(value=>(value||0)>.01))horrorAtmosphereShots+=1;
      const semantic=semanticObjects(scene);
      horrorSemanticObjects+=semantic.length;
      horrorDecorativeObjects+=semantic.filter(object=>['bounce','float','pulse','shake','pop'].includes(object.motion||'')).length;
      if(scene.durationMs>=9500&&spokenWords>=18&&!visualBeatCount&&!concreteActions.length){
        issues.push({
          code:'static-hold',
          severity:scene.durationMs>=12000&&spokenWords>=26?'error':'warning',
          sceneId:scene.id,
          sceneName:scene.name,
          message:`Horror shot dài ${(scene.durationMs/1000).toFixed(1)}s có nhiều nội dung nhưng không có visualBeat/action nội cảnh; nên để layer/pose/light/clue thay đổi có chủ đích thay vì giữ nguyên toàn khung.`,
        });
      }
      const animatedIds=new Set<string>();
      for(const object of scene.objects){
        const movingPreset=object.motion&&object.motion!=='none';
        const frames=[...(object.keyframes||[])].sort((a,b)=>a.atMs-b.atMs);
        const initial={dx:0,dy:0,scale:1,rotation:0,opacity:object.opacity??1,
          pose:object.pose||'idle',expression:object.expression||'neutral',
          ...(frames[0]?.atMs===0?frames[0]:{})};
        // A constant placement/pose at frame zero is not an animated track.
        // Count real changes from that state, including later fades and poses.
        const movingTrack=frames.some(frame=>
          frame.dx!==undefined&&Math.abs(frame.dx-initial.dx)>2
          ||frame.dy!==undefined&&Math.abs(frame.dy-initial.dy)>2
          ||frame.scale!==undefined&&Math.abs(frame.scale-initial.scale)>.015
          ||frame.rotation!==undefined&&Math.abs(frame.rotation-initial.rotation)>1
          ||frame.opacity!==undefined&&Math.abs(frame.opacity-initial.opacity)>.015
          ||frame.pose!==undefined&&frame.pose!==initial.pose
          ||frame.expression!==undefined&&frame.expression!==initial.expression);
        if(movingPreset||movingTrack)animatedIds.add(object.id);
      }
      for(const beat of scene.animationBeats||[])for(const id of beat.targetIds)if(beat.action!=='talk')animatedIds.add(id);
      for(const beat of scene.visualBeats||[])for(const id of beat.targetIds)animatedIds.add(id);
      const animatedArea=[...animatedIds].reduce((sum,id)=>{
        const object=scene.objects.find(item=>item.id===id);
        return sum+(object?object.width*object.height:0);
      },0)/(project.width*project.height);
      const majorPhysical=concreteActions.some(beat=>['run','row','struggle','sink','surface','impact','assist','aid'].includes(beat.action))
        ||folkMode&&(scene.animationBeats||[]).some(beat=>['grab','pull'].includes(beat.action)
          &&scene.objects.some(o=>o.appearance==='long-limbed-spirit'&&beat.targetIds.includes(o.id))
          &&scene.objects.some(o=>o.id===beat.focusTargetId&&o.kind==='character'&&!beat.targetIds.includes(o.id)));
      if(animatedArea>.38&&!majorPhysical){
        issues.push({
          code:'motion-overload',
          severity:animatedArea>.55?'error':'warning',
          sceneId:scene.id,
          sceneName:scene.name,
          message:`Khoảng ${Math.round(animatedArea*100)}% diện tích semantic đang chuyển động trong một horror hold yên; mẫu mục tiêu chỉ chuyển động cục bộ, hãy giữ phần lớn khung hình ổn định.`,
        });
      }
      const cameraFrames=[...(scene.camera?.keyframes||[])].sort((a,b)=>a.atMs-b.atMs);
      if(cameraFrames.length<2)horrorSubtleCameraShots+=1;
      if(cameraFrames.length>=2){
        const zooms=cameraFrames.map(frame=>frame.zoom).filter((value):value is number=>value!==undefined);
        const dxs=cameraFrames.map(frame=>frame.dx||0),dys=cameraFrames.map(frame=>frame.dy||0);
        const zoomRange=zooms.length?Math.max(...zooms)-Math.min(...zooms):0;
        const dxRange=Math.max(...dxs)-Math.min(...dxs),dyRange=Math.max(...dys)-Math.min(...dys);
        if(zoomRange<=.035&&dxRange<=24&&dyRange<=18)horrorSubtleCameraShots+=1;
        if(zoomRange>.035||dxRange>24||dyRange>18){
          issues.push({
            code:'motion-overload',
            severity:'warning',
            sceneId:scene.id,
            sceneName:scene.name,
            message:`Camera horror di chuyển quá mạnh (zoom Δ${(zoomRange*100).toFixed(1)}%, dx ${Math.round(dxRange)}px, dy ${Math.round(dyRange)}px); mục tiêu là camera breath khoảng 0.8-2.5%.`,
          });
        }
      }

      const semanticText=`${scene.name||''} ${scene.visualBrief||''} ${scene.narration||''}`.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
      const explicitDemonDog=/(quy cau|cho quy|cho thanh tinh|demon dog|hellhound)/.test(semanticText);
      const explicitReveal=explicitDemonDog&&/(lo dien|hien ra|hien hinh|thanh tinh|doi mang|tren noc|mai nha|rooftop)/.test(semanticText);
      if(explicitReveal&&!scene.objects.some(o=>o.kind==='prop'&&o.variant==='demon-dog')){
        issues.push({
          code:'semantic-visual-mismatch',
          severity:'error',
          sceneId:scene.id,
          sceneName:scene.name,
          message:'Cảnh mô tả rõ Quỷ Cẩu/chó quỷ lộ diện nhưng không dùng authored prop:demon-dog; ghost silhouette hình người là sai semantic.',
        });
      }
      const outdoorCue=/(ngoai san|ngoai nha|mai nha|noc nha|mai tranh|rang tre|bia rung|anh trang|vang trang|roof|rooftop|yard|outside|exterior)/.test(semanticText);
      if(outdoorCue&&scene.backgroundRef==='bg:room-underfloor'){
        issues.push({
          code:'semantic-visual-mismatch',
          severity:'error',
          sceneId:scene.id,
          sceneName:scene.name,
          message:'Visual brief là ngoại cảnh/nóc nhà nhưng backgroundRef lại là bg:room-underfloor.',
        });
      }
    }

    const ownsArchitecture=['bg:night-stilt-house','bg:room-stilt-house','bg:room-stilt-day','bg:room-underfloor','bg:room-floor-detail'].includes(scene.backgroundRef||'');
    if(ownsArchitecture&&scene.objects.some(object=>object.kind==='prop'&&object.variant==='house')){
      issues.push({code:'semantic-visual-mismatch',severity:'error',sceneId:scene.id,sceneName:scene.name,
        message:'Background đã chứa kiến trúc nhà nhưng scene vẫn chèn prop:house trùng lên trên.'});
    }
    const table=scene.objects.find(object=>object.kind==='prop'&&object.variant==='table');
    if(table)for(const lamp of scene.objects.filter(object=>object.kind==='prop'&&object.variant==='lantern'&&!object.heldBy&&!object.onBoat)){
      const tableTop=table.y-table.height*.19;
      const attached=Math.abs(lamp.x-table.x)<=table.width*.48&&Math.abs((lamp.y+lamp.height*.22)-tableTop)<=Math.max(28,table.height*.25);
      if(scene.background==='room'&&!attached){
        issues.push({code:'semantic-visual-mismatch',severity:'error',sceneId:scene.id,sceneName:scene.name,
          message:'Đèn dầu trong cảnh có bàn nhưng đang lơ lửng/không bám mặt bàn.'});
      }
    }
    const semanticPlain=`${scene.visualBrief||''} ${scene.narration||''}`.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d');
    const bed=scene.objects.find(object=>object.kind==='prop'&&object.variant==='bed');
    if(bed&&/(nam ngu|nam tren|nam co ro|giuong|chong|lying|asleep)/.test(semanticPlain)){
      const sleeper=scene.objects.find(object=>object.kind==='character'&&['lie-down','cover-face'].includes(object.pose||''));
      if(!sleeper||Math.abs(sleeper.x-bed.x)>bed.width*.25){
        issues.push({code:'semantic-visual-mismatch',severity:'error',sceneId:scene.id,sceneName:scene.name,
          message:'Cảnh mô tả nhân vật nằm nhưng actor chưa được gắn đúng lên giường/chõng.'});
      }
    }

    const resolvedBackgroundRef = scene.backgroundRef || defaultCanvasBackgroundRef(scene);
    if (!scene.backgroundRef && resolvedBackgroundRef) {
      issues.push({
        code: 'missing-background-ref',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Scene đang dựa vào backgroundRef mặc định ${resolvedBackgroundRef}; production Director nên ghi backgroundRef rõ ràng.`,
      });
    }
    const authoredBackground = resolveCanvasAuthoredBackground({ ...scene, backgroundRef: resolvedBackgroundRef });
    if (authoredBackground) {
      authoredBackgroundCount += 1;
      backgroundDetailTotal += authoredBackground.detailScore;
      if (authoredBackground.detailScore < 8) {
        issues.push({
          code: 'low-detail-background',
          severity: 'error',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Authored background ${authoredBackground.id} chỉ đạt detail score ${authoredBackground.detailScore}/10; production yêu cầu >=8.`,
        });
      }
    } else {
      issues.push({
        code: 'unsupported-authored-background',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Không có authored background cho ${scene.background}/${scene.template || 'raw'}. Generic background fallback bị cấm trong production.`,
      });
    }

    const semantic = semanticObjects(scene);
    for (const message of folkContactIssues(scene)) {
      issues.push({code:'invalid-physical-attachment',severity:'error',sceneId:scene.id,sceneName:scene.name,message});
    }
    semanticObjectCount += semantic.length;
    for (const object of semantic) {
      if(horrorMode&&object.kind==='character'&&!object.imageUrl&&!object.spriteActs?.length
        && object.visualStyle !== (folkMode ? 'folk-horror' : 'horror')){
        issues.push({
          code:'mixed-character-style',severity:'error',sceneId:scene.id,sceneName:scene.name,
          message:`Nhân vật ${object.label} không cùng procedural horror style family với cast còn lại.`,
        });
      }
      if(!object.assetKey){
        issues.push({
          code:'missing-asset-identity',severity:'warning',sceneId:scene.id,sceneName:scene.name,
          message:`Semantic asset ${object.label} chưa có assetKey ổn định; thiết kế có thể đổi giữa các shot.`,
        });
      }
      const resolvedRef = object.assetRef || defaultCanvasAssetRef(object);
      if (!object.assetRef && resolvedRef) {
        issues.push({
          code: 'missing-asset-ref',
          severity: 'warning',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Semantic object ${object.label} đang dựa vào assetRef mặc định ${resolvedRef}; production Director nên ghi assetRef rõ ràng.`,
        });
      }
      if (isCanvasAuthoredAssetSupported({ ...object, assetRef: resolvedRef })) {
        authoredObjectCount += 1;
        const authoredAsset = resolveCanvasAuthoredAsset({ ...object, assetRef: resolvedRef });
        if (authoredAsset) {
          assetDetailTotal += authoredAsset.detailScore;
          const requiredDetail = object.role === 'focal' ? 8 : 7;
          if (authoredAsset.detailScore < requiredDetail) {
            issues.push({
              code: 'low-detail-asset',
              severity: 'error',
              sceneId: scene.id,
              sceneName: scene.name,
              message: `${authoredAsset.id} detail score ${authoredAsset.detailScore}/10 thấp hơn production threshold ${requiredDetail}/10.`,
            });
          }
        }
      } else {
        issues.push({
          code: 'unsupported-authored-asset',
          severity: 'error',
          sceneId: scene.id,
          sceneName: scene.name,
          message: `Không có authored asset cho ${object.assetRef || `${object.kind}:${object.variant || object.archetype || object.label}`}. Generic fallback bị cấm trong production.`,
        });
      }
    }
    const focalSemantic = semantic.find((object) => object.role === 'focal');
    const textObjects = scene.objects.filter((object) => object.kind === 'text');

    if (!scene.template) {
      issues.push({
        code: 'raw-layout',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Scene vẫn dùng raw pixel layout thay vì semantic template.',
      });
    }

    if (!focalSemantic && scene.template !== 'diagram-clean' && !horrorMode) {
      issues.push({
        code: 'missing-semantic-focal',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Scene không có semantic focal subject.',
      });
    }

    const textFocal = textObjects.find((object) => object.role === 'focal');
    if (textFocal && semantic.length) {
      issues.push({
        code: 'text-focal-over-semantic',
        severity: 'error',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Text đang làm focal dù scene có semantic object.',
      });
    }

    // Sub phim (caption-bottom) mang lời thoại dài là đúng ngữ pháp, không phạt.
    const subObjects = textObjects.filter((object) =>
      object.slot === 'caption-bottom' && object.sizeClass === 'medium',
    );
    if (textObjects.filter((object) => !subObjects.includes(object)).some((object) => wordCount(object.text || object.label) > 6)) {
      issues.push({
        code: 'text-heavy',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'On-screen text dài hơn 6 từ.',
      });
    }

    const abstractOnly = semantic.length === 0 && scene.objects.every((object) =>
      object.kind === 'text' || object.kind === 'shape',
    );
    if (abstractOnly || (scene.template === 'diagram-clean' && textObjects.length > 0)) titleLikeScenes += 1;

    const floating = scene.objects.filter((object) =>
      object.kind === 'prop'
      && ['sword', 'shield', 'crown'].includes(object.variant || '')
      && object.role !== 'focal',
    );
    if (floating.length && scene.objects.some((object) => object.kind === 'character')) {
      issues.push({
        code: 'floating-equipment',
        severity: 'warning',
        sceneId: scene.id,
        sceneName: scene.name,
        message: 'Equipment prop đang đứng riêng cạnh character; nên gắn vào actor trừ khi chính prop là chủ thể.',
      });
    }

    if(horrorMode&&scene.template!=='foreground-pov'&&[
      'bg:room-simple-night','bg:room-stilt-house','bg:room-stilt-day','bg:city-hallway','bg:city-alley-night',
    ].includes(scene.backgroundRef||'')){
      for(const object of scene.objects){
        if(object.kind==='character'
          &&!object.onBoat&&!object.sittingStyle
          &&!['sit','lie-down','cover-face','float-body'].includes(object.pose||'')
          &&!Number.isFinite(object.groundY)){
          issues.push({
            code:'missing-ground-contact',severity:'error',sceneId:scene.id,sceneName:scene.name,
            message:`Standing actor ${object.label} không có groundY trên authored floor plane; render có thể bị lơ lửng.`,
          });
        }
        const floorBottom=canvasFloorPropBottomRatio(object);
        if(floorBottom!==undefined
          &&!object.heldBy&&!object.onBoat&&!object.handling&&!object.restingOn&&object.environmentAnchor!=='doorway'
          &&!Number.isFinite(object.groundY)){
          issues.push({
            code:'missing-ground-contact',severity:'error',sceneId:scene.id,sceneName:scene.name,
            message:`Floor prop ${object.label} chưa có groundY; đáy asset không được khóa vào perspective floor.`,
          });
        }
        if(object.restingOn&&!scene.objects.some(support=>support.id===object.restingOn)){
          issues.push({
            code:'invalid-physical-attachment',severity:'error',sceneId:scene.id,sceneName:scene.name,
            message:`Prop ${object.label} restingOn=${object.restingOn} nhưng support object không tồn tại trong scene.`,
          });
        }
      }
    }

    const important = scene.objects.filter((object) =>
      object.role !== 'background'
      && object.kind !== 'text'
      && object.depth !== 'background',
    );
    for (let a = 0; a < important.length; a += 1) {
      for (let b = a + 1; b < important.length; b += 1) {
        const left=important[a]!,right=important[b]!;
        const attached=(prop:typeof left,actor:typeof left)=>
          (prop.heldBy===actor.id&&actor.kind==='character')
          ||(prop.kind==='prop'&&actor.kind==='character'&&scene.animationBeats?.some(beat=>
            ['reach','wipe','write','tie'].includes(beat.action)&&beat.focusTargetId===prop.id&&beat.targetIds.includes(actor.id)))
          ||(prop.tiedTo===actor.id&&actor.variant==='tree')
          ||(prop.onBoat===actor.id&&actor.kind==='ship')
          ||(actor.variant==='table'&&['teapot','bowl','note','book','lantern','pipe','phone'].includes(prop.variant||'')
            &&Math.abs(prop.x-actor.x)<actor.width*.5&&prop.y<=actor.y&&prop.y>=actor.y-actor.height*.7)
          ||(prop.variant==='chair'&&actor.kind==='character'&&actor.pose==='sit'&&actor.sittingStyle!=='ground'&&Math.abs(prop.x-actor.x)<actor.width*.2)
          ||(prop.variant==='bed'&&actor.kind==='character'&&['lie-down','cover-face'].includes(actor.pose||'')
            &&Math.abs(prop.x-actor.x)<prop.width*.28&&Math.abs(prop.y-actor.y)<prop.height*.55);
        if(attached(left,right)||attached(right,left))continue;
        const ratio = overlapRatio(important[a]!, important[b]!);
        if (ratio > .58) {
          issues.push({
            code: 'large-overlap',
            severity: 'warning',
            sceneId: scene.id,
            sceneName: scene.name,
            message: `Hai semantic subject overlap quá lớn (${Math.round(ratio * 100)}%): ${left.label} (${left.id}) và ${right.label} (${right.id}). Điều chỉnh slot hoặc sizeClass của đúng cặp này.`,
          });
          a = important.length;
          break;
        }
      }
    }

    const fingerprint = fingerprints[sceneIndex] || '';
    if(canvasConversationKey(scene))unmotivatedRun=0;
    else unmotivatedRun=fingerprint===lastFingerprint?unmotivatedRun+1:1;
    maxUnmotivatedRun=Math.max(maxUnmotivatedRun,unmotivatedRun);
    if (fingerprint === lastFingerprint) currentRun += 1;
    else {
      currentRun = 1;
      lastFingerprint = fingerprint;
    }
    maxFingerprintRun = Math.max(maxFingerprintRun, currentRun);
  });

  for(let index=1;index<compiled.scenes.length;index++){
    const previous=compiled.scenes[index-1]!,current=compiled.scenes[index]!;
    if(!previous.stageId||previous.stageId!==current.stageId)continue;
    if(previous.template!==current.template||previous.camera?.shot!==current.camera?.shot)continue;
    const identity=(object:any)=>object.characterKey?'character:'+object.characterKey
      :object.assetKey?'asset:'+object.assetKey
      :object.kind==='prop'&&object.variant?'prop:'+object.variant+':'+String(object.label||'').toLowerCase():undefined;
    const prior=new Map(previous.objects.map(object=>[identity(object),object]).filter(([key])=>Boolean(key)) as Array<[string,typeof previous.objects[number]]>);
    for(const object of current.objects){
      const key=identity(object);const before=key&&prior.get(key);if(!before)continue;
      const travels=current.animationBeats?.some(beat=>beat.targetIds.includes(object.id)&&['run','row','assist','aid','reach','grab','tie','wipe','write'].includes(beat.action))
        ||object.keyframes?.some(frame=>Math.abs(frame.dx||0)>8||Math.abs(frame.dy||0)>8);
      if(travels)continue;
      const delta=Math.hypot(object.x-before.x,object.y-before.y);
      const sizeDelta=Math.max(Math.abs(object.width-before.width)/Math.max(1,before.width),Math.abs(object.height-before.height)/Math.max(1,before.height));
      if(delta>Math.max(project.width,project.height)*.055||sizeDelta>.12){
        issues.push({
          code:'stage-continuity-jump',
          severity:'error',
          sceneId:current.id,
          sceneName:current.name,
          message:'Stage '+current.stageId+' bị nhảy vị trí/kích thước của '+object.label+' giữa hai shot cùng framing mà không có travel action.',
        });
      }
    }
  }

  if(horrorMode&&compiled.scenes.length>=3){
    const missingStage=compiled.scenes.filter(scene=>!scene.stageId).length;
    if(missingStage>compiled.scenes.length/2){
      issues.push({
        code:'missing-stage-id',
        severity:'warning',
        message:`${missingStage}/${compiled.scenes.length} horror shots chưa có stageId; set continuity sẽ phải suy đoán từ background và dễ giật layout khi thêm layer.`,
      });
    }
  }

  const durationMinutes=Math.max(1/60,horrorDurationMs/60000);
  const majorShotsPerMinute=horrorMode?compiled.scenes.length/durationMinutes:0;
  const visualEventsPerMinute=horrorMode?(compiled.scenes.length+horrorInternalEvents)/durationMinutes:0;
  const bandScore=(value:number,idealMin:number,idealMax:number,outerMin:number,outerMax:number)=>{
    if(value>=idealMin&&value<=idealMax)return 1;
    if(value<idealMin)return Math.max(0,(value-outerMin)/Math.max(.001,idealMin-outerMin));
    return Math.max(0,(outerMax-value)/Math.max(.001,outerMax-idealMax));
  };
  const sceneCount=Math.max(1,compiled.scenes.length);
  const pacedRatio=horrorPacedShots/sceneCount;
  const shotRateScore=bandScore(majorShotsPerMinute,5.5,9.5,3,13);
  const cadenceScore=pacedRatio*.55+shotRateScore*.45;
  const eventScore=bandScore(visualEventsPerMinute,10,24,6,32);
  const cameraScore=horrorSubtleCameraShots/sceneCount;
  const atmosphereScore=horrorAtmosphereShots/sceneCount;
  const stageScore=horrorStageShots/sceneCount;
  const restraintScore=1-Math.min(1,horrorDecorativeObjects/Math.max(1,horrorSemanticObjects));
  const referenceStyleScore=horrorMode?Math.round(100*(
    cadenceScore*.20+eventScore*.20+cameraScore*.20+atmosphereScore*.15+stageScore*.15+restraintScore*.10
  )):100;
  if(horrorMode&&referenceStyleScore<90){
    issues.push({
      code:'reference-style-gap',
      severity:referenceStyleScore<78?'error':'warning',
      message:`Reference-style benchmark ${referenceStyleScore}/100: shot rate ${majorShotsPerMinute.toFixed(1)}/min, visual events ${visualEventsPerMinute.toFixed(1)}/min, stage continuity ${Math.round(stageScore*100)}%, atmosphere ${Math.round(atmosphereScore*100)}%, subtle camera ${Math.round(cameraScore*100)}%. Mục tiêu production là >=90.`,
    });
  }

  if (maxUnmotivatedRun >= 3) {
    issues.push({
      code: 'repeated-composition',
      severity: 'error',
      message: `Có composition fingerprint lặp ${maxUnmotivatedRun} beat liên tiếp mà không có hội thoại liên tục.`,
    });
  }

  const nonConversationScenes=compiled.scenes.filter(s=>!canvasConversationKey(s));
  const nonConversationTemplates=new Set(nonConversationScenes.map(s=>s.template||'raw'));
  if (!folkMode && nonConversationScenes.length >= 6 && nonConversationTemplates.size < 3) {
    issues.push({
      code: 'low-template-variety',
      severity: 'error',
      message: `Video có ${compiled.scenes.length} scene nhưng chỉ dùng ${templates.size} scene template.`,
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const score = Math.max(0, 100 - errorCount * 18 - warningCount * 5);

  return {
    pass: errorCount === 0 && score >= 80 && (!horrorMode || referenceStyleScore >= 88),
    score,
    issues,
    stats: {
      scenes: compiled.scenes.length,
      uniqueTemplates: templates.size,
      uniqueFingerprints: uniqueFingerprints.size,
      maxFingerprintRun,
      titleLikeScenes,
      semanticObjects: semanticObjectCount,
      authoredObjects: authoredObjectCount,
      authoredCoverage: semanticObjectCount ? authoredObjectCount / semanticObjectCount : 1,
      authoredBackgrounds: authoredBackgroundCount,
      backgroundCoverage: compiled.scenes.length ? authoredBackgroundCount / compiled.scenes.length : 1,
      averageAssetDetail: authoredObjectCount ? assetDetailTotal / authoredObjectCount : 10,
      averageBackgroundDetail: authoredBackgroundCount ? backgroundDetailTotal / authoredBackgroundCount : 10,
      averageAnimationBeats: compiled.scenes.length ? animationBeatTotal / compiled.scenes.length : 0,
      averageVisualBeats: compiled.scenes.length ? visualBeatTotal / compiled.scenes.length : 0,
      referenceStyleScore,
      majorShotsPerMinute,
      visualEventsPerMinute,
    },
  };
}
