import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { workdir } from './ffmpeg';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
export const UPLOAD_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

export class UploadTooLargeError extends Error {
  readonly code = 'UPLOAD_TOO_LARGE';
  readonly statusCode = 413;

  constructor() {
    super('File vượt quá giới hạn 4 GiB.');
    this.name = 'UploadTooLargeError';
  }
}

export class UploadReferenceError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Upload reference không tồn tại hoặc không hợp lệ.');
    this.name = 'UploadReferenceError';
  }
}

export function assertUploadSize(size: number) {
  if (size > MAX_UPLOAD_BYTES) throw new UploadTooLargeError();
}

export const safeUploadName = (name: string, fallback = 'source.mp4') => {
  const base = path.basename(name || fallback).replace(/[^\p{L}\p{N}._-]/gu, '_');
  return base || fallback;
};

export async function createUploadSession() {
  const directory = path.join(workdir, 'uploads', randomUUID());
  await mkdir(directory, { recursive: true });
  return directory;
}

export type StoredUpload = {
  uploadId: string;
  filename: string;
  contentType: string;
  size: number;
  storedPath: string;
  absolutePath: string;
  directory: string;
};

type StoredUploadRecord = Omit<StoredUpload, 'absolutePath' | 'directory'>;

async function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(file, { force: true });
    await rename(temporary, file).catch(() => { throw error; });
  }
}

export async function persistUploadStream(input: Readable, destination: string) {
  const partial = `${destination}.part`;
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) {
        callback(new UploadTooLargeError());
        input.destroy(new UploadTooLargeError());
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(input, limiter, createWriteStream(partial, { flags: 'wx' }));
    if ((input as Readable & { truncated?: boolean }).truncated) throw new UploadTooLargeError();
    await rename(partial, destination);
    return { path: destination, size: bytes };
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function discardUploadStream(input: Readable) {
  await pipeline(input, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
}

export async function storeUpload(input: Readable, filename: string, contentType: string): Promise<StoredUpload> {
  const directory = await createUploadSession();
  const uploadId = path.basename(directory);
  const safeName = safeUploadName(filename);
  const storedName = `source-${safeName}`;
  const absolutePath = path.join(directory, storedName);
  try {
    const persisted = await persistUploadStream(input, absolutePath);
    const record: StoredUploadRecord = {
      uploadId,
      filename: safeName,
      contentType: contentType || 'application/octet-stream',
      size: persisted.size,
      storedPath: path.posix.join('uploads', uploadId, storedName),
    };
    await writeJsonAtomic(path.join(directory, 'upload.json'), record);
    return { ...record, absolutePath, directory };
  } catch (error) {
    await cleanupUploadSession(directory);
    throw error;
  }
}

export async function resolveUpload(uploadId: string): Promise<StoredUpload> {
  if (!/^[a-f0-9-]{36}$/i.test(uploadId)) throw new UploadReferenceError();
  try {
    const directory = path.join(workdir, 'uploads', uploadId);
    const record = JSON.parse(await readFile(path.join(directory, 'upload.json'), 'utf8')) as StoredUploadRecord;
    const absolutePath = path.join(workdir, record.storedPath.replace(/^uploads[\\/]/, 'uploads/'));
    const root = path.resolve(path.join(workdir, 'uploads'));
    if (!path.resolve(absolutePath).startsWith(`${root}${path.sep}`)) throw new UploadReferenceError();
    const file = await stat(absolutePath);
    return { ...record, size: file.size, absolutePath, directory };
  } catch (error) {
    if (error instanceof UploadReferenceError) throw error;
    throw new UploadReferenceError();
  }
}

export async function cleanupUploadSession(directory: string) {
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
}

export async function cleanupIncompleteUploads() {
  const root = path.join(workdir, 'uploads');
  const sessions = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(sessions.filter((entry) => entry.isDirectory()).map(async (session) => {
    const directory = path.join(root, session.name);
    const details = await stat(directory).catch(() => undefined);
    if (details && Date.now() - details.mtimeMs > UPLOAD_SESSION_RETENTION_MS) {
      await rm(directory, { recursive: true, force: true });
      return;
    }
    const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith('.part')).map((file) => rm(path.join(directory, file.name), { force: true })));
  }));
}
