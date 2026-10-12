function ready(video:HTMLVideoElement,event:string){
  return new Promise<void>((resolve,reject)=>{
    const timer=window.setTimeout(()=>finish(new Error('Không đọc được video mẫu trong 10 giây.')),10000);
    const done=()=>finish(),failed=()=>finish(new Error('Không đọc được video mẫu.'));
    function finish(error?:Error){window.clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);error?reject(error):resolve();}
    video.addEventListener(event,done,{once:true});video.addEventListener('error',failed,{once:true});
  });
}
function capture(image:CanvasImageSource,width:number,height:number){
  const scale=Math.min(1,640/width,900/height),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.82);
}
export async function readVectorStyleReference(file:File):Promise<string[]>{
  if(file.size>100*1024*1024)throw new Error('Video mẫu tối đa 100 MB.');
  if(['image/png','image/jpeg','image/webp'].includes(file.type)){
    const image=await createImageBitmap(file);
    try{return [capture(image,image.width,image.height)];}finally{image.close();}
  }
  if(!file.type.startsWith('video/'))throw new Error('Chọn hình PNG/JPEG/WebP hoặc video.');
  const video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.preload='auto';
  try{
    const loaded=ready(video,'loadedmetadata');video.src=url;await loaded;
    if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('Video mẫu chưa có thời lượng hợp lệ.');
    const result:string[]=[];
    for(const fraction of [.15,.45,.75]){
      const sought=ready(video,'seeked');video.currentTime=Math.min(video.duration-.01,Math.max(.001,video.duration*fraction));await sought;
      result.push(capture(video,video.videoWidth,video.videoHeight));
    }
    return result;
  }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
