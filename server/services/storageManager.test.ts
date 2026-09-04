import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { deleteStorageItems, inspectStorage } from './storageManager';

test('storage manager lists managed files and only deletes safe, inactive items', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autosub-storage-test-'));
  const outside = path.join(root, '..', `${path.basename(root)}-keep.txt`);
  try {
    const upload = path.join(root, 'uploads', 'upload-1');
    const activeJob = path.join(root, 'jobs', 'job-1');
    await Promise.all([mkdir(upload, { recursive: true }), mkdir(activeJob, { recursive: true })]);
    await Promise.all([
      writeFile(path.join(upload, 'upload.json'), JSON.stringify({ filename: 'nguon.mp4', sourceMode: 'copied' })),
      writeFile(path.join(upload, 'source.mp4'), Buffer.alloc(1024)),
      writeFile(path.join(activeJob, 'job.json'), JSON.stringify({ status: 'running' })),
      writeFile(path.join(activeJob, 'voice.wav'), Buffer.alloc(2048)),
      writeFile(outside, 'keep'),
    ]);

    const snapshot = await inspectStorage(root);
    assert.equal(snapshot.itemCount, 2);
    assert.equal(snapshot.categories.find((item) => item.id === 'uploads')?.items[0]?.displayName, 'nguon.mp4');
    assert.equal(snapshot.categories.find((item) => item.id === 'jobs')?.items[0]?.canDelete, false);

    const deleted = await deleteStorageItems([{ categoryId: 'uploads', name: 'upload-1' }], root);
    assert.equal(deleted.deletedCount, 1);
    assert.ok(deleted.freedBytes >= 1024);

    const protectedResult = await deleteStorageItems([
      { categoryId: 'jobs', name: 'job-1' },
      { categoryId: 'uploads', name: '..' },
    ], root);
    assert.equal(protectedResult.deletedCount, 0);
    assert.equal(protectedResult.errors.length, 2);
    assert.equal(await readFile(outside, 'utf8'), 'keep');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
