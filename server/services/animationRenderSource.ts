import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
/** Source changes invalidate both the live bundle and encoded Canvas cache. */
export async function animationRenderSourceSignature(root:string):Promise<string>{
  const hash=createHash('sha256');
  async function visit(relative:string){
    const directory=path.join(root,relative);
    const entries=(await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const file=path.join(relative,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&/\.(tsx?|css|json)$/.test(entry.name)&&!entry.name.includes('.test.')){
        hash.update(file.replace(/\\/g,'/')).update('\0').update(await readFile(path.join(root,file))).update('\0');
      }
    }
  }
  await visit('src');await visit('shared');return hash.digest('hex');
}
