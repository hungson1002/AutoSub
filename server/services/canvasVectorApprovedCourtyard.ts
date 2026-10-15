import originalArt from '../assets/vector-styles/folk-horror/approved-courtyard/drawing.json';
import uprightArt from '../assets/vector-styles/folk-horror/upright-courtyard/drawing.json';
import type {VectorNode} from '../../shared/canvasVectorScene';

export const approvedCourtyardSourceHash=originalArt.sourceSha256;
export type CourtyardLight='day'|'dusk'|'night';

/** Tool-owned paint from the accepted SVG, on native contact/animation groups.
 * Model selection cannot change the contours. Saved expanded worlds are untouched. */
export function approvedCourtyard(frame={width:720,height:1280},light:CourtyardLight='night',geometry:'original'|'upright'='original'){
  const art=geometry==='upright'?uprightArt:originalArt;
  const wide=frame.width>frame.height,scale=wide?frame.height/720:frame.width/720;
  const world:VectorNode={id:'courtyard-world',type:'group',x:wide?(frame.width-1280*scale)/2:0,
    y:wide?0:frame.height*.77-620*scale,scaleX:scale,scaleY:scale};
  const colours:Record<string,string>=light==='day'?{}:light==='dusk'?{
    '#a2cbd9':'#8796a3','#87978e':'#7a8c89','#baa071':'#af9673','#c1933d':'#b18b47',
  }:{'#a2cbd9':'#293e53','#87978e':'#687b7c','#baa071':'#9d8c6e','#c1933d':'#a1844b',
    '#a47849':'#927248','#40583c':'#405847','#c7aa67':'#b5a16b','#d0b270':'#bda56c'};
  const tone=(fill:string)=>colours[fill]||fill;
  const nodes:VectorNode[]=[{id:'sky',type:'rect',width:frame.width,height:frame.height,fill:tone('#a2cbd9')},world,
    {id:'physical-ground-plane',type:'rect',parent:world.id,x:-4096,y:620,width:8192,height:4096,fill:tone('#baa071')}];
  const group=(id:string,extra:Partial<VectorNode>={})=>nodes.push({id,type:'group',parent:world.id,...extra});
  const owners:Record<string,Partial<VectorNode>>={
    house:{y:27,width:805,height:518,bounds:{x:-24,y:-8,width:805,height:526},groundAnchor:{x:215,y:518},groundOffsetY:-75},
    // Compensate the base half-scale around the actual right-hand hinge.
    // At rest this is the same paint position; opening keeps x126 fixed.
    door:{x:24,y:151,pivotX:102,pivotY:370,scaleX:.5,scaleY:.5,width:140,height:370,groundAnchor:{x:70,y:370},groundOffsetY:-99},
    tree:{width:250,height:310,bounds:{x:320,y:275,width:270,height:315}},
    'water-jar':{width:100,height:100,bounds:{x:820,y:532,width:105,height:104}},
  };
  const placed=new Set<string>();
  for(const name of art.order){
    if(name==='sky')continue;
    const parent=name==='house'||name==='roof'||name==='straw'||name==='door-opening'?'house':
      name==='door-leaf'?'door':name==='tree'||name==='planter'?'tree':name==='jar'?'water-jar':world.id;
    // A group's first occurrence fixes its SVG paint order. Do not put the
    // house before the landscape, even when its children appear later.
    if(owners[parent]&&!placed.has(parent)){group(parent,owners[parent]);placed.add(parent);}
    const id=name==='fence'?'distant-fence':name==='earth'?'yard-floor':'approved-paint-'+name;
    group(id,{parent,...(parent==='house'?{y:-27}:parent==='door'?{x:-150,y:-672,scaleX:2,scaleY:2}:{})});
    for(const n of (art.parts as Record<string,Array<{id:string;type:string;d:string;fill:string;stroke?:string;strokeWidth?:number}>>)[name]!)
      nodes.push({...n,type:'path',parent:id,fill:tone(n.fill)});
  }
  group('stone-path',{bounds:{x:95,y:535,width:560,height:185}});
  group('window',{bounds:{x:405,y:335,width:105,height:80}});
  group('lamp-mount');
  nodes.push({id:'ring',type:'instance',parent:'door',asset:'folk-courtyard-ring',x:30,y:210,width:40,height:56,pivotX:20,pivotY:4});
  nodes.push({id:'lamp-hook',type:'path',parent:'lamp-mount',d:'M700 318Q698 334 701 351',fill:'none',stroke:'#17120f',strokeWidth:3,opacity:light==='day'?0:1});
  nodes.push({id:'lamp',type:'instance',parent:'lamp-mount',asset:'folk-courtyard-lamp',x:681,y:350,width:38,height:64,opacity:light==='day'?0:1});
  if(light==='night')nodes.push({id:'moon',type:'ellipse',parent:world.id,x:878,y:119,rx:21,ry:21,fill:'#f5e6be',light:{kind:'moon',radius:62}});
  nodes.push({id:'person',type:'instance',parent:world.id,asset:'folk-courtyard-person',x:550,y:495,width:80.36,height:125});
  nodes.push({id:'approved-courtyard-svg-v1',type:'group',parent:world.id});
  return {assets:{
    'folk-courtyard-person':{rig:'simple-puppet',outfit:'ao-dai',hair:'bun',palette:{shirt:'#785e74',accent:'#b48c9a',inner:'#ede1c6',trim:'#d1bd87',skin:'#ead2b3'}},
    'folk-courtyard-lamp':{rig:'lantern'},
    'folk-courtyard-ring':{width:40,height:56,nodes:[
      {id:'mount',type:'ellipse',x:20,y:4,rx:7,ry:4,fill:'#ac925c',stroke:'#25211c',strokeWidth:2},
      {id:'ring',type:'ellipse',x:20,y:31,rx:15,ry:19,fill:'none',stroke:'#d5b66d',strokeWidth:6},
      {id:'ring-inner',type:'ellipse',x:20,y:31,rx:15,ry:19,fill:'none',stroke:'#25211c',strokeWidth:1.5},
    ]},
  },stage:{width:frame.width,height:frame.height,nodes,ground:{y:620,parent:world.id,targets:[{target:'person'},{target:'door',anchor:{x:70,y:370}},{target:'house',anchor:{x:215,y:518}}]},tracks:[]}};
}
