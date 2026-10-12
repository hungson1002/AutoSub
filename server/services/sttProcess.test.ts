import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { stopSttProcess } from './sttProcess';

test('STT cancellation terminates Windows launcher and its interpreter', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const parent = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(child.pid); setInterval(()=>{},1000);`], { windowsHide: true });
  const closed = once(parent, 'close');
  let descendant = 0;
  try {
    const [chunk] = await once(parent.stdout!, 'data');
    descendant = Number(String(chunk).trim());
    assert.ok(descendant > 0);
    process.kill(descendant, 0);
    await stopSttProcess(parent);
    await closed;
    assert.throws(() => process.kill(descendant, 0));
    await stopSttProcess(parent); // Idempotent after completion.
  } finally {
    await stopSttProcess(parent);
    if (descendant) { try { process.kill(descendant); } catch { /* Already gone. */ } }
  }
});
