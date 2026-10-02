import { useState } from 'react';
import { Plus, Trash2, Volume2 } from '../components/Icons';
import type { CanvasStudioProject,CanvasStudioScene,CanvasSoundPreset } from '../../shared/canvasAnimationStudio';
import { canvasSpeakerKey } from '../../shared/canvasDialogue';
import { CANVAS_SOUND_LABELS,planCanvasSoundCues } from '../../shared/canvasSoundDesign';
import { CANVAS_SPEECH_STYLES } from '../../shared/canvasSpeech';

type Props={project:CanvasStudioProject;scene:CanvasStudioScene;voices:Array<{id:string;name?:string}>;busy:boolean;
  patch:(change:Partial<CanvasStudioScene>)=>void;castVoice:(key:string,voice:string)=>void;build:()=>void};
export function CanvasAudioPanel({project,scene,voices,busy,patch,castVoice,build}:Props){
  const [preset,setPreset]=useState<CanvasSoundPreset>('knock');
  const [speaker,setSpeaker]=useState('Người kể');
  const lines=scene.dialogue||[],cues=scene.soundEffects||[];
  const roles=[...new Map(lines.map(line=>[canvasSpeakerKey(line),line.speaker])).entries()];
  const change=(fields:Partial<CanvasStudioScene>)=>patch({...fields,
    ...(fields.dialogue?{dialogue:fields.dialogue.map(line=>({...line,atMs:undefined}))}:{}),audioMixKey:undefined});
  return <details className="canvas-audio-panel canvas-inspector-section" open>
    <summary><Volume2 size={14}/><span>Âm thanh & lời thoại</span><small>{lines.length+cues.length}</small></summary>
    <fieldset disabled={busy} className="canvas-audio-fields">
      {roles.map(([key,label])=><label key={key}><span>Giọng · {label}</span>
        <select aria-label={`Giọng ${label}`} value={project.castVoices?.[key]||''} onChange={event=>castVoice(key,event.target.value)}>
          <option value="">Tự chọn theo vai</option>
          {project.castVoices?.[key]&&!voices.some(v=>v.id===project.castVoices?.[key])&&<option value={project.castVoices[key]}>Giọng ngoài TTS đang chọn</option>}
          {voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name||voice.id}</option>)}
        </select>
      </label>)}
      {lines.map((line,index)=><div className="canvas-audio-line" key={line.id}>
        <div className="canvas-audio-row"><strong>{line.speaker}</strong><button type="button" aria-label={`Xóa lời thoại ${index+1}`} onClick={()=>change({dialogue:lines.filter(l=>l.id!==line.id)})}><Trash2 size={13}/></button></div>
        <textarea aria-label={`Lời thoại ${line.speaker}`} rows={2} maxLength={3000} value={line.text} onChange={event=>change({dialogue:lines.map(l=>l.id===line.id?{...l,text:event.target.value,audioKey:undefined}:l)})}/>
        <label><span>Nhịp cảm xúc</span><select value={line.emotion||'natural'} onChange={event=>change({dialogue:lines.map(l=>l.id===line.id?{...l,emotion:event.target.value as typeof line.emotion}:l)})}>
          {Object.entries(CANVAS_SPEECH_STYLES).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <details className="canvas-pronunciation"><summary>Cách đọc & sắc thái</summary>
          <label><span>Cách đọc riêng · giữ nguyên phụ đề</span><textarea aria-label={`Cách đọc riêng ${line.speaker}`} rows={2} maxLength={3000} placeholder="Ví dụ: viết tên khó đọc theo cách phát âm mong muốn" value={line.spokenText||''} onChange={event=>change({dialogue:lines.map(l=>l.id===line.id?{...l,spokenText:event.target.value}:l)})}/></label>
          <label><span>Sắc thái · VieNeu, thử nghiệm</span><select value={line.cue||'none'} onChange={event=>change({dialogue:lines.map(l=>l.id===line.id?{...l,cue:event.target.value as typeof line.cue}:l)})}>
            <option value="none">Không thêm</option><option value="sigh">Thở dài</option><option value="laugh">Cười nhẹ</option><option value="clear-throat">Hắng giọng</option>
          </select></label>
        </details>
        <label><span>Cách phát</span><select value={line.delivery||'natural'} onChange={event=>change({dialogue:lines.map(l=>l.id===line.id?{...l,delivery:event.target.value as 'natural'|'distant'}:l)})}>
          <option value="natural">Tự nhiên</option><option value="distant">Vọng từ xa</option></select></label>
      </div>)}
      <div className="canvas-audio-row"><select aria-label="Người nói cho lời thoại mới" value={speaker} onChange={event=>setSpeaker(event.target.value)}>
        <option value="Người kể">Người kể</option>{scene.objects.filter(o=>o.kind==='character').map(o=><option key={o.id} value={o.characterKey||o.label}>{o.label}</option>)}
        <option value="Giọng dưới sàn">Giọng dưới sàn</option></select>
        <button type="button" onClick={()=>{
          const key=speaker;
          const actor=scene.objects.find(o=>(o.characterKey||o.label)===key);
          const source=lines.length?'':scene.narration||'';
          change({dialogue:[...lines,{id:crypto.randomUUID(),speaker:actor?.label||key,characterKey:actor?.characterKey,text:source,delivery:key==='Giọng dưới sàn'?'distant':'natural'}]});
        }}><Plus size={13}/>Lời thoại</button></div>
      {!lines.length&&<small>Lời kể hiện có được giữ nguyên. Thêm lời thoại để chia giọng từng vai.</small>}
      <div className="canvas-audio-subtitle"><span>Tiếng động · {cues.length}</span><button type="button" onClick={()=>change({soundEffects:planCanvasSoundCues(scene)})}>Gợi ý theo cảnh</button></div>
      {cues.map((cue,index)=><div className="canvas-audio-cue" key={cue.id}>
        <div className="canvas-audio-row"><strong>{CANVAS_SOUND_LABELS[cue.preset]}</strong><button type="button" aria-label={`Xóa tiếng động ${index+1}`} onClick={()=>change({soundEffects:cues.filter(c=>c.id!==cue.id)})}><Trash2 size={13}/></button></div>
        <div className="canvas-two-columns"><label><span>Bắt đầu · giây</span><input type="number" min={0} max={scene.durationMs/1000} step={.1} value={cue.atMs/1000} onChange={e=>change({soundEffects:cues.map(c=>c.id===cue.id?{...c,atMs:Number(e.target.value)*1000}:c)})}/></label>
          <label><span>Dài · giây</span><input type="number" min={.1} max={30} step={.1} value={cue.durationMs/1000} onChange={e=>change({soundEffects:cues.map(c=>c.id===cue.id?{...c,durationMs:Number(e.target.value)*1000}:c)})}/></label></div>
        <label><span>Âm lượng · {Math.round(cue.volume*100)}%</span><input type="range" min={0} max={1} step={.01} value={cue.volume} onChange={e=>change({soundEffects:cues.map(c=>c.id===cue.id?{...c,volume:Number(e.target.value)}:c)})}/></label>
        <label><span>Vị trí âm thanh</span><select value={cue.pan||0} onChange={e=>change({soundEffects:cues.map(c=>c.id===cue.id?{...c,pan:Number(e.target.value)}:c)})}>
          {![0,-.65,.65].includes(cue.pan||0)&&<option value={cue.pan}>{(cue.pan||0)<0?'Lệch trái':'Lệch phải'}</option>}
          <option value={-.65}>Trái</option><option value={0}>Giữa</option><option value={.65}>Phải</option></select></label>
      </div>)}
      <div className="canvas-audio-row"><select aria-label="Tiếng động mới" value={preset} onChange={e=>setPreset(e.target.value as CanvasSoundPreset)}>{Object.entries(CANVAS_SOUND_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <button type="button" onClick={()=>change({soundEffects:[...cues,{id:crypto.randomUUID(),preset,atMs:0,durationMs:Math.min(scene.durationMs,1000),volume:.25,pan:0}]})}><Plus size={13}/>Thêm</button></div>
    </fieldset>
    <button className="canvas-audio-build" type="button" disabled={busy||!voices.length} onClick={build}><Volume2 size={14}/>{busy?'Đang dựng âm thanh…':'Dựng âm thanh cảnh'}</button>
    <small role="status">{busy?'Audio đã tạo được dùng lại khi nội dung và giọng không đổi.':scene.audioMixKey?'Âm thanh đã dựng.':lines.length||cues.length?'Có thay đổi chưa dựng thành audio.':'Chọn lời thoại và tiếng động, rồi dựng âm thanh.'}</small>
  </details>;
}
