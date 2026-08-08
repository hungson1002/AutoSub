import { strict as assert } from 'node:assert';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import test from 'node:test';
import { assertUploadSize, cleanupUploadSession, createUploadSession, MAX_UPLOAD_BYTES, persistUploadStream, UploadTooLargeError } from './uploads';

test('streams a synthetic 100 MB upload to disk without aggregating chunks', async () => {
  const directory = await createUploadSession();
  const total = 100 * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024, 7);
  let remaining = total;
  const source = Readable.from((async function* () {
    while (remaining > 0) {
      const size = Math.min(remaining, chunk.length);
      remaining -= size;
      yield size === chunk.length ? chunk : chunk.subarray(0, size);
    }
  })());
  try {
    const result = await persistUploadStream(source, `${directory}/source.bin`);
    assert.equal(result.size, total);
    assert.equal((await stat(result.path)).size, total);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test('rejects a declared upload above 4 GiB before writing it', () => {
  assert.throws(() => assertUploadSize(MAX_UPLOAD_BYTES + 1), UploadTooLargeError);
});

test('removes a partial upload when the client stream fails', async () => {
  const directory = await createUploadSession();
  const source = new Readable({ read() { this.push(Buffer.alloc(1024)); this.destroy(new Error('client disconnected')); } });
  try {
    await assert.rejects(() => persistUploadStream(source, `${directory}/source.bin`), /client disconnected/);
    await assert.rejects(() => stat(`${directory}/source.bin.part`), { code: 'ENOENT' });
  } finally {
    await cleanupUploadSession(directory);
  }
});
