/** Style-lock for AI-authored custom vector artwork.
 *
 * The illustrator (AI) may invent brand-new props/stages for any story. This
 * gate keeps those inventions inside the folk-handdrawn family instead of
 * drifting into glossy icon art or anime faces: small dot eyes, ink outlines,
 * restrained line weights, bounded node counts. Auto-fixable problems are
 * repaired; identity problems (giant eyes, bad paints, bad ids) fail loudly
 * so the director retries instead of shipping drifted art.
 *
 * It intentionally does NOT force one palette: a red drum stays red. It locks
 * construction grammar, not color choice.
 */
import {FOLK_INK_STYLE,folkInkPalette,handInkDrawing} from './canvasVectorInk';
import type {VectorDrawing} from './canvasVectorScene';
export type VectorStyleLockIssue = { rule: string; message: string; fixed: boolean };
export type VectorStyleLockResult = { ok: boolean; issues: VectorStyleLockIssue[]; repaired: unknown[] };

type Node = Record<string, unknown>;
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[\w-]{1,100}$/;
const DEFAULT_INK = '#332b2a';

function paint(value: unknown): boolean {
  return value === undefined || value === 'none' || (typeof value === 'string' && HEX.test(value));
}

export function lockCustomVectorStyle(nodes: unknown, maxNodes = 60): VectorStyleLockResult {
  const issues: VectorStyleLockIssue[] = [];
  if (!Array.isArray(nodes)) return { ok: false, issues: [{ rule: 'nodes-array', message: 'Custom artwork must be an array of nodes', fixed: false }], repaired: [] };
  if (nodes.length < 1 || nodes.length > maxNodes) {
    return { ok: false, issues: [{ rule: 'node-budget', message: `Custom artwork needs 1-${maxNodes} nodes, got ${nodes.length}`, fixed: false }], repaired: [] };
  }
  const seen = new Set<string>();
  const repaired = (nodes as Node[]).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ rule: 'node-shape', message: `Node ${index} is not an object`, fixed: false });
      return raw;
    }
    const node = { ...(raw as Node) };
    const id = node.id;
    if (typeof id !== 'string' || !ID.test(id)) {
      issues.push({ rule: 'node-id', message: `Node ${index} needs an id matching [\\w-]{1,100}`, fixed: false });
    } else if (seen.has(id)) {
      issues.push({ rule: 'node-id', message: `Duplicate node identity: ${id}`, fixed: false });
    } else seen.add(id);
    if (!['group', 'path', 'ellipse', 'rect', 'line'].includes(String(node.type))) {
      issues.push({ rule: 'node-type', message: `Node ${String(id)} has unsupported type ${String(node.type)}`, fixed: false });
    }
    for (const key of ['fill', 'stroke'] as const) {
      if (!paint(node[key])) {
        issues.push({ rule: 'paint', message: `Node ${String(id)} has invalid ${key}: ${String(node[key])}`, fixed: false });
      }
    }
    if (node.strokeWidth !== undefined) {
      const w = Number(node.strokeWidth);
      if (!Number.isFinite(w)) {
        issues.push({ rule: 'line-weight', message: `Node ${String(id)} has non-numeric strokeWidth`, fixed: false });
      } else if (w < 0.3 || w > 6) {
        const clamped = Math.min(6, Math.max(0.5, w));
        node.strokeWidth = Math.round(clamped * 100) / 100;
        issues.push({ rule: 'line-weight', message: `Node ${String(id)} strokeWidth ${w} clamped to ${node.strokeWidth}`, fixed: true });
      }
    }
    // Filled shapes without ink read as flat icons, not hand-drawn art.
    if (node.type !== 'group' && node.type !== 'line' && typeof node.fill === 'string' && HEX.test(node.fill)
      && (node.stroke === undefined || node.stroke === 'none')) {
      node.stroke = DEFAULT_INK;
      if (node.strokeWidth === undefined) node.strokeWidth = 2;
      issues.push({ rule: 'ink-outline', message: `Node ${String(id)} gained a folk ink outline`, fixed: true });
    }
    // Dot-eye convention: eyes stay tiny ink dots, never anime lenses.
    if (typeof id === 'string' && /^eye/i.test(id) && node.type === 'ellipse') {
      const rx = Number(node.rx), ry = Number(node.ry);
      if (!(rx > 0 && rx <= 8 && ry > 0 && ry <= 9)) {
        issues.push({ rule: 'dot-eyes', message: `Eye ${id} must stay a tiny dot (rx<=8, ry<=9), got ${String(node.rx)}x${String(node.ry)}`, fixed: false });
      }
    }
    if (node.instance !== undefined || node.asset !== undefined || node.attachTo !== undefined) {
      issues.push({ rule: 'flat-artwork', message: `Node ${String(id)} must be flat art, no instances or attachments`, fixed: false });
    }
    // The engine positions ellipses/rects from x/y; SVG-style cx/cy is silently
    // ignored and would pin the shape to the local origin. Convert, don't drop.
    if ((node.type === 'ellipse' || node.type === 'rect') && (node.cx !== undefined || node.cy !== undefined)) {
      if (node.x === undefined && node.cx !== undefined) node.x = node.cx;
      if (node.y === undefined && node.cy !== undefined) node.y = node.cy;
      delete node.cx;
      delete node.cy;
      issues.push({ rule: 'center-coords', message: `Node ${String(id)} cx/cy converted to engine x/y`, fixed: true });
    }
    return node;
  });
  const failed = issues.some((issue) => !issue.fixed);
  return { ok: !failed, issues, repaired: failed ? [] : repaired };
}

/** Enforced on NEW generated assets, never on retained expanded artwork. */
export function lockFolkInkAsset(raw:unknown,castIndex?:number):unknown{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Vector: invalid folk-ink asset');
  const config=structuredClone(raw) as Record<string,unknown>;
  if(config.rig==='simple-puppet'){
    if(config.nodes!==undefined)throw new Error('Vector: folk-ink people use native descriptors, not anatomy overrides');
    // Only NEW cast creation supplies an index. Fill provider omissions with
    // stable native choices; never rewrite an explicit identity or saved art.
    if(castIndex!==undefined){
      const i=castIndex%3,female=config.gender==='female',child=config.age==='child';
      config.faceShape??=female||child?'round':config.age==='elder'?'oval':['round','oval','broad'][i];
      config.outfit??=child||female?'tunic':['tunic','vest','robe'][i];
      config.hair??=female?'bun':['short','side-part','cropped'][i];
      config.eyeShape??=child?'round':i===1?'half-lidded':'round';
      config.headwear??=female||i>0?'none':'headwrap';
      config.facialHair??=config.age==='elder'&&!female?'beard':'none';
      if(config.age==='elder')config.palette={hair:'#aaa294',...(config.palette as object||{})};
    }
    return {...config,design:'village',finish:'handdrawn',artStyle:FOLK_INK_STYLE,palette:folkInkPalette(config.palette,config.gender==='female'&&config.age!=='child')};
  }
  if(config.rig==='simple-human')throw new Error('Vector: folk-ink people require simple-puppet descriptors');
  if(config.rig!==undefined)return {...config,artStyle:FOLK_INK_STYLE};
  const nodes=config.nodes;
  if(!Array.isArray(nodes))throw new Error('Vector: folk-ink custom asset needs nodes');
  if(nodes.some(n=>n?.id==='puppet-root'||n?.id==='head-group'))throw new Error('Vector: folk-ink people require a simple-puppet descriptor; raw replacement anatomy is not allowed');
  const expanded=nodes.filter(n=>n?.id!==FOLK_INK_STYLE).map(n=>{
    const node={...n};
    for(const key of ['fill','stroke'])if(typeof node[key]==='string'&&/^#[0-9a-f]{3}$/i.test(node[key]))node[key]='#'+[...node[key].slice(1)].map(c=>c+c).join('');
    return node;
  });
  const checked=lockCustomVectorStyle(expanded,159);
  if(!checked.ok)throw new Error('Vector: folk-ink style violation: '+checked.issues.filter(i=>!i.fixed).map(i=>i.message).join('; '));
  return handInkDrawing({...config,nodes:checked.repaired} as unknown as VectorDrawing);
}

/** Design a NEW ensemble together; persisted expanded artwork is never restyled. */
export function lockFolkInkCast(raw:Record<string,unknown>,leadIds:ReadonlySet<string>){
  let index=0;
  const entries=Object.entries(raw).sort(([a],[b])=>a.localeCompare(b)).map(([id,asset])=>{
    const person=(asset as {rig?:string})?.rig==='simple-puppet';
    const config=lockFolkInkAsset(asset,person?index++:undefined) as Record<string,unknown>;
    if(person){
      config.age??='adult';config.gender??='male';
      config.castRole=leadIds.size?(leadIds.has(id)?'lead':'support'):(config.castRole==='lead'?'lead':'support');
      if(config.castRole==='lead'){
        if(!config.costumeDetail||config.costumeDetail==='plain')config.costumeDetail='piping';
      }else config.costumeDetail??=['plain','patch','roundel'][(index-1)%3];
    }
    return [id,config] as const;
  });
  const leads=entries.filter(([,c])=>c.rig==='simple-puppet'&&c.castRole==='lead').map(([,c])=>c);
  const used=new Set<string>();
  const signature=(c:Record<string,unknown>)=>JSON.stringify([c.gender,c.age,c.headwear,c.hair,c.outfit,c.costumeDetail]);
  const silhouette=(c:Record<string,unknown>)=>JSON.stringify([c.gender,c.age,c.headwear,c.hair,c.outfit]);
  const usedSilhouettes=new Set<string>();
  for(const [,c] of entries.filter(([,c])=>c.castRole==='lead')){used.add(signature(c));usedSilhouettes.add(silhouette(c));}
  for(const [,c] of entries){
    if(c.rig!=='simple-puppet'||c.castRole==='lead')continue;
    const echoesLead=leads.some(l=>l.headwear===c.headwear&&l.hair===c.hair&&l.outfit===c.outfit);
    if(echoesLead||usedSilhouettes.has(silhouette(c))){
      // Keep age, gender, occupation's garment and hat. Vary only duplicate
      // visual choices at creation, never redraw a retained person's identity.
      const hair=c.age==='child'?['tuft','short','double-bun']:c.gender==='female'
        ?['braid','bob','wavy','double-bun','tied','fringe']:['cropped','wavy','side-part','fringe','bun'];
      if(c.headwear==='none')c.hair=hair.find(h=>!usedSilhouettes.has(silhouette({...c,hair:h}))
        &&!leads.some(l=>l.headwear===c.headwear&&l.hair===h&&l.outfit===c.outfit))??c.hair;
      else c.costumeDetail=['plain','patch','roundel','sash'].find(detail=>!used.has(signature({...c,costumeDetail:detail})))??c.costumeDetail;
    }
    used.add(signature(c));
    usedSilhouettes.add(silhouette(c));
  }
  return Object.fromEntries(entries);
}
