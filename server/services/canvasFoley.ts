import type { CanvasSoundPreset } from '../../shared/canvasAnimationStudio';

/** Deterministic physical textures, PCM stereo. No model, network or GPU needed. */
export function synthesizeCanvasFoley(preset:CanvasSoundPreset,durationMs:number,seed=1,offsetSeconds=0):Buffer {
  const rate=24000,frames=Math.ceil(Math.max(50,Math.min(30000,durationMs))*rate/1000);
  const output=Buffer.alloc(44+frames*4);
  output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVE',8);
  output.write('fmt ',12);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);output.writeUInt16LE(2,22);
  output.writeUInt32LE(rate,24);output.writeUInt32LE(rate*4,28);output.writeUInt16LE(4,32);output.writeUInt16LE(16,34);
  output.write('data',36);output.writeUInt32LE(frames*4,40);
  let state=seed>>>0,low=0,slow=0,voicePhase=0,energy=0,peak=0;
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
    } else if(preset==='water'){
      sample=(low*.65+slow*1.4)*(.45+.3*Math.sin(t*1.6)**2+.25*Math.sin(t*4.1)**2);
    } else if(preset==='splash'){
      const wash=Math.min(1,t/.045)*Math.exp(-t*6);
      sample=(low*1.8+(noise-low)*.15+slow*.6)*wash;
    } else if(preset==='horror-score'){
      const time=t+offsetSeconds,pulse=.65+.35*Math.sin(time*.39)**2;
      sample=(.10*Math.sin(time*2*Math.PI*55)+.055*Math.sin(time*2*Math.PI*82.41)+.035*Math.sin(time*2*Math.PI*110.3))*pulse;
      sample+=.025*Math.sin(time*2*Math.PI*155.56+.18*Math.sin(time*.2))+slow*.14;
      // Keep the ominous bass, but give small speakers an audible musical bed.
      sample+=(.065*Math.sin(time*2*Math.PI*220)+.045*Math.sin(time*2*Math.PI*329.63)
        +.025*Math.sin(time*2*Math.PI*466.16+.12*Math.sin(time*.31)))*pulse;
    } else if(preset==='bell'){
      const attack=Math.min(1,t/.008),decay=Math.exp(-t*2.2);
      sample=(.48*Math.sin(t*2*Math.PI*440)+.22*Math.sin(t*2*Math.PI*659.3)+.12*Math.sin(t*2*Math.PI*1053))*attack*decay;
    } else if(preset==='pig-grunt'){
      const pulse=t%.38,u=pulse/.38,envelope=Math.sin(Math.PI*Math.min(1,u/.8))**2;
      const f=105+22*Math.sin(Math.PI*u)+9*Math.sin(t*41);
      voicePhase+=2*Math.PI*f/rate;
      sample=(.38*Math.sin(voicePhase)+.24*Math.sin(voicePhase*2)+.15*Math.sin(voicePhase*3)+low*.3)*envelope;
    } else if(preset==='dog-howl'){
      // A single voiced howl, not a repeating alarm. Integrate pitch for a
      // continuous rising/falling tone; harmonics give the open vowel texture.
      const u=t/length,f=260+170*Math.sin(Math.PI*u*.9)+6*Math.sin(2*Math.PI*5*t);
      voicePhase+=2*Math.PI*f/rate;
      const envelope=Math.sin(Math.PI*u)**1.2;
      sample=(.38*Math.sin(voicePhase)+.22*Math.sin(2*voicePhase)+.12*Math.sin(3*voicePhase)+.06*Math.sin(4*voicePhase)+low*.03)*envelope;
    } else if(preset==='door-creak'){
      const f=240+Math.sin(t*2)*110;
      sample=(Math.sin(2*Math.PI*f*t)*.16+low*.3)*(.5+.5*Math.sin(t*19)**2);
    }
    const fade=Math.min(1,t/.015,(length-t)/.06);
    const value=Math.round(Math.max(-.95,Math.min(.95,sample*fade))*32767);
    output.writeInt16LE(value,44+i*4);output.writeInt16LE(value,46+i*4);
    energy+=(value/32768)**2;peak=Math.max(peak,Math.abs(value)/32768);
  }
  // Cue volume should control the balance, rather than each oscillator's
  // arbitrary amplitude. Preserve dynamics and leave headroom for narration.
  const bed=['wind','water','fire','horror-score'].includes(preset);
  const rms=Math.sqrt(energy/frames);
  if(rms>0){
    const gain=Math.min((bed?.14:.18)/rms,.85/peak);
    for(let i=44;i<output.length;i+=2)output.writeInt16LE(Math.round(output.readInt16LE(i)*gain),i);
  }
  return output;
}
