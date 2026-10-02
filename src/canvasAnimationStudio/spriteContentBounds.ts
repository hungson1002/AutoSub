export type SpriteContentBounds = {x:number;y:number;width:number;height:number};
/** One shared crop for the whole clip preserves pose movement and the foot baseline. */
export function spriteContentBounds(data:Uint8ClampedArray,width:number,height:number,fw:number,fh:number,columns:number,from:number,to:number):SpriteContentBounds {
 let minX=fw,minY=fh,maxX=-1,maxY=-1;
 for(let frame=from;frame<=to;frame++){
 const ox=frame%columns*fw,oy=Math.floor(frame/columns)*fh;
 if(ox+fw>width||oy+fh>height)continue;
 for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){
 if((data[((oy+y)*width+ox+x)*4+3] ?? 0)>32){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 }}
 if(maxX<minX||maxY<minY)return {x:0,y:0,width:fw,height:fh};
 const pad=2;minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(fw-1,maxX+pad);maxY=Math.min(fh-1,maxY+pad);
 return {x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
}
