/** Read normalized PCM directly. Unsupported formats retain timed lip-sync. */
function pcmVoice(wav:Buffer) {
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')return undefined;
  let offset=12,rate=0,channels=0,bits=0,format=0,data:Buffer|undefined;
  while(offset+8<=wav.length){
    const tag=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4);
    if(offset+8+size>wav.length)return undefined;
    if(tag==='fmt '&&size>=16){format=wav.readUInt16LE(offset+8);channels=wav.readUInt16LE(offset+10);rate=wav.readUInt32LE(offset+12);bits=wav.readUInt16LE(offset+22);}
    if(tag==='data')data=wav.subarray(offset+8,offset+8+size);
    offset+=8+size+(size%2);
  }
  if(format!==1||bits!==16||!channels||channels>8||!rate||!data)return undefined;
  return {data,rate,channels,frames:Math.floor(data.length/(channels*2))};
}

/** Remove only the outer silence. Internal breaths and dramatic pauses survive. */
export function trimCanvasNarrationEdges(wav:Buffer) {
  const pcm=pcmVoice(wav),windows=canvasSpeechActivity(wav);
  if(!pcm||!windows?.length)return undefined;
  const start=Math.max(0,Math.floor((windows[0]!.startMs-40)*pcm.rate/1000));
  const end=Math.min(pcm.frames,Math.ceil((windows.at(-1)!.endMs+160)*pcm.rate/1000));
  const data=pcm.data.subarray(start*pcm.channels*2,end*pcm.channels*2);
  const output=Buffer.alloc(44+data.length);
  output.write('RIFF');output.writeUInt32LE(36+data.length,4);output.write('WAVEfmt ',8);
  output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(pcm.channels,22);
  output.writeUInt32LE(pcm.rate,24);output.writeUInt32LE(pcm.rate*pcm.channels*2,28);
  output.writeUInt16LE(pcm.channels*2,32);output.writeUInt16LE(16,34);output.write('data',36);
  output.writeUInt32LE(data.length,40);data.copy(output,44);
  return {wav:output,durationMs:(end-start)/pcm.rate*1000,startMs:start/pcm.rate*1000};
}

/** Compact energy track from the unmixed voice; no model or realtime decoding. */
export function canvasSpeechEnvelope(wav:Buffer):Array<{atMs:number;level:number}>|undefined {
  const pcm=pcmVoice(wav);if(!pcm)return undefined;
  const {data,rate,channels,frames}=pcm,block=Math.max(1,Math.round(rate*.04));
  const samples:Array<{atMs:number;rms:number}>=[];
  for(let start=0;start<frames;start+=block){
    const end=Math.min(frames,start+block);let energy=0;
    for(let i=start;i<end;i+=4)for(let c=0;c<channels;c++)energy+=data.readInt16LE((i*channels+c)*2)**2;
    samples.push({atMs:Math.round((start+end)/2/rate*1000),rms:Math.sqrt(energy/(Math.ceil((end-start)/4)*channels))});
  }
  const voiced=samples.map(s=>s.rms).filter(rms=>rms>=420).sort((a,b)=>a-b);
  const reference=Math.max(900,voiced[Math.floor(voiced.length*.9)]||900);
  return [{atMs:0,level:0},...samples.map(s=>({atMs:s.atMs,level:s.rms<420?0:Math.round(Math.min(1,Math.sqrt(s.rms/reference))*100)/100})),{atMs:frames/rate*1000,level:0}];
}

export function canvasSpeechActivity(wav:Buffer):Array<{startMs:number;endMs:number}>|undefined {
  const pcm=pcmVoice(wav);if(!pcm)return undefined;
  const {data,rate,channels,frames}=pcm,block=Math.max(1,Math.round(rate*.02));
  const windows:Array<{startMs:number;endMs:number}>=[];
  for(let start=0;start<frames;start+=block){
    const end=Math.min(frames,start+block);let energy=0;
    for(let i=start;i<end;i+=4)for(let c=0;c<channels;c++)energy+=data.readInt16LE((i*channels+c)*2)**2;
    const rms=Math.sqrt(energy/(Math.ceil((end-start)/4)*channels));
    if(rms<420)continue;
    const startMs=Math.max(0,start/rate*1000-20),endMs=Math.min(frames/rate*1000,end/rate*1000+20);
    const previous=windows.at(-1);
    if(previous&&startMs-previous.endMs<=40)previous.endMs=endMs;
    else windows.push({startMs,endMs});
  }
  return windows.filter(window=>window.endMs-window.startMs>=60);
}
