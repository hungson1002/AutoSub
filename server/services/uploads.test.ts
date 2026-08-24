import { strict as assert } from "node:assert";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import {
  assertUploadSize,
  cleanupUploadSession,
  createTemporarySession,
  createUploadSession,
  MAX_UPLOAD_BYTES,
  persistUploadStream,
  registerLocalUpload,
  resolveUpload,
  UploadTooLargeError,
} from "./uploads";
import { temporaryRoot, workdir } from "./ffmpeg";
import { buildLocalFilePickerScript } from "./localFilePicker";

test("temporary media sessions stay outside the persistent project workdir", async () => {
  const directory = await createTemporarySession("test-");
  try {
    assert.equal(path.resolve(directory).startsWith(`${path.resolve(temporaryRoot)}${path.sep}`), true);
    assert.equal(path.resolve(directory).startsWith(`${path.resolve(workdir)}${path.sep}`), false);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test("local media picker owns a topmost window so the dialog stays visible", () => {
  const script = buildLocalFilePickerScript("video");
  assert.match(script, /TopMost = \$true/);
  assert.match(script, /ShowDialog\(\$owner\)/);
  assert.match(script, /\*\.mp4;\*\.mkv/);
});

test("streams a synthetic 100 MB upload to disk without aggregating chunks", async () => {
  const directory = await createUploadSession();
  const total = 100 * 1024 * 1024;
  const chunk = Buffer.alloc(1024 * 1024, 7);
  let remaining = total;
  const source = Readable.from(
    (async function* () {
      while (remaining > 0) {
        const size = Math.min(remaining, chunk.length);
        remaining -= size;
        yield size === chunk.length ? chunk : chunk.subarray(0, size);
      }
    })(),
  );
  try {
    const result = await persistUploadStream(source, `${directory}/source.bin`);
    assert.equal(result.size, total);
    assert.equal((await stat(result.path)).size, total);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test("rejects a declared upload above 4 GiB before writing it", () => {
  assert.throws(
    () => assertUploadSize(MAX_UPLOAD_BYTES + 1),
    UploadTooLargeError,
  );
});

test("removes a partial upload when the client stream fails", async () => {
  const directory = await createUploadSession();
  const source = new Readable({
    read() {
      this.push(Buffer.alloc(1024));
      this.destroy(new Error("client disconnected"));
    },
  });
  try {
    await assert.rejects(
      () => persistUploadStream(source, `${directory}/source.bin`),
      /client disconnected/,
    );
    await assert.rejects(() => stat(`${directory}/source.bin.part`), {
      code: "ENOENT",
    });
  } finally {
    await cleanupUploadSession(directory);
  }
});

test("registers a local file without copying it and never deletes the source", async () => {
  const sourceDirectory = await mkdtemp(
    path.join(os.tmpdir(), "autosub-linked-upload-"),
  );
  const sourcePath = path.join(sourceDirectory, "large-source.mp4");
  await writeFile(sourcePath, Buffer.from("source-remains-on-disk"));
  const linked = await registerLocalUpload(sourcePath);
  try {
    const resolved = await resolveUpload(linked.uploadId);
    assert.equal(resolved.sourceMode, "linked");
    assert.equal(resolved.absolutePath, path.resolve(sourcePath));
    assert.equal(resolved.size, 22);
    assert.deepEqual(await readdir(linked.directory), ["upload.json"]);
    await cleanupUploadSession(linked.directory);
    assert.equal((await stat(sourcePath)).isFile(), true);
  } finally {
    await cleanupUploadSession(linked.directory);
    await rm(sourceDirectory, { recursive: true, force: true });
  }
});
