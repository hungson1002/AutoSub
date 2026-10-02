import type { CanvasSoundPreset } from '../../shared/canvasAnimationStudio';

/** Deterministic physical textures, PCM stereo. No model, network or GPU needed. */
export function synthesizeCanvasFoley(preset:CanvasSoundPreset,durationMs:number,seed=1):Buffer {
  const rate=24000,frames=Math.ceil(Math.max(50,Math.min(30000,durationMs))*rate/1000);
  const output=Buffer.alloc(44+frames*4);
  output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVE',8);
  output.write('fmt ',12);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(2,22);
  output.writeUInt32LE(rate,24);output.writeUInt32LE(rate*4,28);output.writeUInt16LE(4,32);output.writeUInt16LE(16,34);
  output.write('data',36);output.writeUInt32LE(frames*4,40);
  let state=seed>>>0,low=0,slow=0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296*2-1;};
  const length=frames/rate;
  for(let i=0;i<frames;i++){
    const t=i/rate,noise=random();low+=.085*(noise-low);slow+=.007*(noise-slow);
    let sample=0;
    if(preset==='knock'||preset==='footstep'){
      const spacing=preset==='knock'?.43:.57,p=t%spacing;
      const attack=Math.min(1,p/.002),decay=Math.exp(-p*(preset==='knock'?25:17));
      sample=attack*decay*(.42*Math.sin(2*Math.PI*146*p)+.2*Math.sin(2*Math.PI*311*p)+.45*low);
    } else if(preset==='scratch'){
      const stroke=Math.pow(Math.max(0,Math.sin(2*Math.PI*2.3*t)),.8);
      sample=(noise-low)*.2*stroke+low*.5*stroke;
    } else if(preset==='cloth'){
      const movement=Math.pow(Math.sin(Math.PI*t/length),2);
      sample=(low*.75+(noise-low)*.06)*movement*(.55+.45*Math.sin(t*17)**2);
    } else if(preset==='fire'){
      const crackle=Math.abs(noise)>.997?noise*.8:0;
      sample=low*.22+crackle;
    } else if(preset==='wind'){
      sample=slow*2*(.6+.4*Math.sin(t*.9)**2)+low*.07;
    } else if(preset==='door-creak'){
      const f=240+Math.sin(t*2)*110;
      sample=(Math.sin(2*Math.PI*f*t)*.16+low*.3)*(.5+.5*Math.sin(t*19)**2);
    }
    const fade=Math.min(1,t/.015,(length-t)/.06);
    const value=Math.round(Math.max(-.95,Math.min(.95,sample*fade))*32767);
    output.writeInt16LE(value,44+i*4);output.writeInt16LE(value,46+i*4);
  }
  return output;
}
