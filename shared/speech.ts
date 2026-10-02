export interface SpeechDelivery {
  text:string; spokenText?:string;
  emotion?:'natural'|'storytelling'|'tense'|'gentle'|'firm';
  cue?:'none'|'sigh'|'laugh'|'clear-throat';
}

export const SPEECH_STYLES = {
  natural:'Tự nhiên', storytelling:'Kể chuyện', tense:'Căng thẳng, chậm',
  gentle:'Nhẹ nhàng', firm:'Dứt khoát',
} as const;
const digits=['không','một','hai','ba','bốn','năm','sáu','bảy','tám','chín'];
function underThousand(value:number,full=false):string {
  const hundred=Math.floor(value/100),ten=Math.floor(value%100/10),unit=value%10;
  const parts:string[]=[];
  if(hundred||full)parts.push(digits[hundred]!,'trăm');
  if(ten>1)parts.push(digits[ten]!,'mươi');else if(ten===1)parts.push('mười');
  else if(unit&&(hundred||full))parts.push('linh');
  if(unit)parts.push(unit===1&&ten>1?'mốt':unit===5&&ten>0?'lăm':digits[unit]!);
  return parts.join(' ');
}
export function normalizeSpokenText(text:string) {
  return text.normalize('NFC').replace(/\[\[([^\[\]\r\n]{1,160})\]\]/g,'$1')
    .replace(/[\u200B\uFEFF]/g,'').replace(/\r\n?/g,'\n')
    .replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()
    .replace(/\bnăm\s+(\d{4})(?!\d)/giu,(_,year:string)=>{
      const number=Number(year),thousand=Math.floor(number/1000),rest=number%1000;
      return thousand?`năm ${digits[thousand]} nghìn${rest?' '+underThousand(rest,rest<100):''}`:`năm ${year}`;
    });
}

export type SpeechPart = { text:string } | { pauseMs:number };
/** Explicit pauses are audio operations, never literal text sent to an engine. */
export function planSpeech(text:string):SpeechPart[] {
  const parts:SpeechPart[]=[];
  let cursor=0,totalPause=0;
  for(const match of text.matchAll(/\[pause(?:\s+([^\]]+))?\]/gi)) {
    const content=text.slice(cursor,match.index).trim();
    if(content)parts.push({text:content});
    const value=match[1]?.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i);
    if(match[1]&&!value)throw new Error('Khoảng nghỉ cần dạng [pause 350ms] hoặc [pause 1s].');
    const pauseMs=value?Math.round(Number(value[1])*(value[2]!.toLowerCase()==='s'?1000:1)):350;
    if(pauseMs<0||pauseMs>10000||(totalPause+=pauseMs)>15000)throw new Error('Mỗi khoảng nghỉ tối đa 10 giây, tổng tối đa 15 giây mỗi lượt.');
    const last=parts.at(-1);
    if(last&&'pauseMs' in last)last.pauseMs+=pauseMs;
    else if(pauseMs)parts.push({pauseMs});
    cursor=match.index!+match[0].length;
  }
  const tail=text.slice(cursor).trim();if(tail)parts.push({text:tail});
  if(parts.filter(part=>'text' in part).length>16)throw new Error('Tối đa 16 đoạn đọc có khoảng nghỉ mỗi lượt.');
  if(!parts.some(part=>'text' in part))throw new Error('Nội dung đọc đang trống.');
  return parts;
}
/** Prosody stays within the existing TTS's controls; no invented emotion tags. */
export function resolveSpeech(line:SpeechDelivery,baseSpeed=1,vieneu=false) {
  const style=line.emotion&&Object.hasOwn(SPEECH_STYLES,line.emotion)?line.emotion:'natural';
  let text=normalizeSpokenText(line.spokenText?.trim()||line.text);
  const factor={natural:1,storytelling:.96,tense:.9,gentle:.94,firm:1.02}[style]??1;
  if(style==='firm'&&!/[.!?…]["'’”)]*$/u.test(text))text+='!';
  if(vieneu){
    const cue={sigh:'[thở dài]',laugh:'[cười]','clear-throat':'[hắng giọng]',none:''}[line.cue||'none'];
    if(cue&&!text.includes(cue))text=`${cue} ${text}`;
  }
  return {text,speed:Math.max(.5,Math.min(2,Math.round(baseSpeed*factor*1000)/1000)),
    pauseAfterMs:style==='tense'?380:style==='gentle'?280:200};
}
