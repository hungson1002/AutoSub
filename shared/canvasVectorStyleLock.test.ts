import test from 'node:test';
import assert from 'node:assert/strict';
import {lockCustomVectorStyle,lockFolkInkCast} from './canvasVectorStyleLock';
import {normalizeVectorAssets} from './canvasVectorScene';

const drum = [
  { id: 'drum-body', type: 'path', d: 'M -40 -30 L 40 -30 L 34 30 L -34 30 Z', fill: '#a63d32' },
  { id: 'drum-rim-top', type: 'ellipse', x: 0, y: -30, rx: 40, ry: 10, fill: '#d9c4a2', stroke: '#332b2a', strokeWidth: 2 },
  { id: 'drum-lace', type: 'path', d: 'M -40 -30 L 34 30 M 40 -30 L -34 30', fill: 'none', stroke: '#e6dcc9', strokeWidth: 2 },
];

test('in-style custom art passes, missing ink is repaired',()=>{
  const result = lockCustomVectorStyle(drum);
  assert.equal(result.ok, true);
  assert.equal((result.repaired[0] as { stroke: string }).stroke, '#332b2a');
  assert.ok(result.issues.some((i) => i.rule === 'ink-outline' && i.fixed));
  assert.equal((result.repaired[1] as { strokeWidth: number }).strokeWidth, 2);
});

test('line-weight drift is clamped, not rejected',()=>{
  const result = lockCustomVectorStyle([{ id: 'a', type: 'path', d: 'M 0 0 L 10 10', fill: 'none', stroke: '#111111', strokeWidth: 14 }]);
  assert.equal(result.ok, true);
  assert.equal((result.repaired[0] as { strokeWidth: number }).strokeWidth, 6);
});

test('anime eyes, bad paints, bad ids and over-budget art fail loudly',()=>{
  assert.equal(lockCustomVectorStyle([{ id: 'eye-big', type: 'ellipse', rx: 20, ry: 24, fill: '#111111' }]).ok, false);
  assert.ok(lockCustomVectorStyle([{ id: 'eye-big', type: 'ellipse', rx: 20, ry: 24, fill: '#111111' }]).issues.some((i) => i.rule === 'dot-eyes'));
  assert.equal(lockCustomVectorStyle([{ id: 'a', type: 'path', d: 'M 0 0', fill: 'red' }]).ok, false);
  assert.equal(lockCustomVectorStyle([{ id: 'no id!', type: 'path', d: 'M 0 0', fill: 'none' }]).ok, false);
  assert.equal(lockCustomVectorStyle([]).ok, false);
  assert.equal(lockCustomVectorStyle(Array.from({ length: 61 }, (_, i) => ({ id: 'n-' + i, type: 'path', d: 'M 0 0', fill: 'none' }))).ok, false);
  assert.equal(lockCustomVectorStyle([{ id: 'a', type: 'text', d: 'x' }]).ok, false);
});

test('svg cx/cy ellipses are converted to engine x/y instead of snapping to origin',()=>{
  const result = lockCustomVectorStyle([{ id: 'head', type: 'ellipse', cx: 11, cy: -120, rx: 5, ry: 5, fill: '#b54236' }]);
  assert.equal(result.ok, true);
  const node = result.repaired[0] as Record<string, unknown>;
  assert.equal(node.x, 11);
  assert.equal(node.y, -120);
  assert.equal(node.cx, undefined);
  assert.ok(result.issues.some((i) => i.rule === 'center-coords' && i.fixed));
});

test('tiny dot eyes pass and lock is idempotent',()=>{  const nodes = [{ id: 'eye-l', type: 'ellipse', x: -6, y: -4, rx: 4, ry: 5.5, fill: '#141414' }];
  const first = lockCustomVectorStyle(nodes);
  assert.equal(first.ok, true);
  const second = lockCustomVectorStyle(first.repaired);
  assert.equal(second.ok, true);
  assert.deepEqual(second.repaired, first.repaired);
});

test('new cast distinguishes the bound lead even when a provider copies every descriptor',()=>{
  const common={rig:'simple-puppet',gender:'female',age:'adult',headwear:'none',hair:'bun',outfit:'cross-collar',castRole:'lead'};
  const raw=Object.fromEntries(['a','b','c','d','z-lead'].map(id=>[id,{...common}])),before=structuredClone(raw);
  const result=lockFolkInkCast(raw,new Set(['z-lead'])) as Record<string,Record<string,unknown>>;
  assert.equal(result['z-lead']!.castRole,'lead');assert.equal(result['z-lead']!.costumeDetail,'piping');
  assert.equal(Object.values(result).filter(c=>c.castRole==='lead').length,1,'provider cannot promote every extra to lead');
  assert.equal(new Set(Object.values(result).map(c=>c.hair)).size,5,'duplicate supporting silhouettes are resolved together');
  for(const c of Object.values(result)){assert.equal(c.gender,'female');assert.equal(c.age,'adult');assert.equal(c.outfit,'cross-collar');}
  assert.deepEqual(raw,before);
  assert.deepEqual(lockFolkInkCast(result,new Set(['z-lead'])),result,'creation policy is deterministic on retry');
  const assets=normalizeVectorAssets(result),lead=assets['z-lead']!;
  assert.ok(lead.nodes.some(n=>n.id==='approved-identity-clasp'));
  assert.ok(lead.nodes.some(n=>n.id==='village-role-lead'));
  assert.deepEqual(normalizeVectorAssets(assets),assets,'saved art normalization keeps the generated identity unchanged');
  assert.throws(()=>lockFolkInkCast(assets,new Set(['a'])),/raw replacement anatomy/,'new generation cannot inject expanded replacement people');
});

test('uniformed extras retain hats and garment cuts while getting bounded costume details',()=>{
  const common={rig:'simple-puppet',gender:'male',headwear:'conical',hair:'short',outfit:'work-shirt'};
  const raw=Object.fromEntries(['lead','a','b','c','d'].map(id=>[id,{...common}]));
  const result=lockFolkInkCast(raw,new Set(['lead'])) as Record<string,Record<string,unknown>>;
  assert.equal(new Set(Object.values(result).map(c=>c.costumeDetail)).size,5);
  for(const c of Object.values(result)){assert.equal(c.headwear,'conical');assert.equal(c.outfit,'work-shirt');}
});
