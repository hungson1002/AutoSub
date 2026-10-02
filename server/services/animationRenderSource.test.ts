import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {animationRenderSourceSignature} from './animationRenderSource';
test('renderer source changes invalidate cache even when filename and length stay the same',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'autosub-render-source-'));
  try{
    await mkdir(path.join(root,'src'));await mkdir(path.join(root,'shared'));
    await writeFile(path.join(root,'src','renderer.ts'),'old');
    const before=await animationRenderSourceSignature(root);
    assert.equal(before,await animationRenderSourceSignature(root));
    await writeFile(path.join(root,'src','renderer.ts'),'new');
    const after=await animationRenderSourceSignature(root);assert.notEqual(before,after);
    await writeFile(path.join(root,'src','renderer.test.ts'),'test');
    assert.equal(after,await animationRenderSourceSignature(root));
  }finally{await rm(root,{recursive:true,force:true});}
});
