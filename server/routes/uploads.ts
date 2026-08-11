import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { cleanupUploadSession, discardUploadStream, registerLocalUpload, resolveUpload, storeUpload, UploadReferenceError, UploadTooLargeError } from '../services/uploads';
import { pickLocalMediaFile, type LocalMediaKind } from '../services/localFilePicker';

const uploadError = (error: unknown) => error instanceof UploadTooLargeError || (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE');

type UploadRouteOptions = { pickLocalMediaFile?: (kind: LocalMediaKind, signal?: AbortSignal) => Promise<string | undefined> };

const isLocalOrigin = (origin?: string) => {
  if (!origin) return true;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname); }
  catch { return false; }
};

export async function uploadRoutes(app: FastifyInstance, options: UploadRouteOptions = {}) {
  app.post('/api/uploads', async (request, reply) => {
    let stored: Awaited<ReturnType<typeof storeUpload>> | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        if (part.fieldname === 'file' && !stored) stored = await storeUpload(part.file, part.filename, part.mimetype);
        else await discardUploadStream(part.file);
      }
      if (stored && process.env.AUTOSUB_DEBUG_UPLOADS === '1') console.info(`[upload] ${JSON.stringify({ uploadId: stored.uploadId, storedPath: stored.storedPath, fileSize: stored.size })}`);
      if (!stored) return reply.code(400).send({ error: 'Thiếu file upload.' });
      return reply.code(201).send({ uploadId: stored.uploadId, storedPath: stored.storedPath, filename: stored.filename, contentType: stored.contentType, size: stored.size });
    } catch (error) {
      const details = { method: request.method, url: request.url, contentLength: request.headers['content-length'] || '', contentType: request.headers['content-type'] || '', code: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '' };
      if (uploadError(error)) {
        request.log.warn(details, 'Upload rejected by multipart/file-size layer');
        return reply.code(413).send({ error: 'File vượt quá giới hạn 4 GiB.' });
      }
      request.log.warn(details, error instanceof Error ? error.message : 'Upload failed');
      return reply.code(500).send({ error: 'Không thể lưu file upload. Hãy kiểm tra dung lượng trống và thử lại.' });
    }
  });

  app.post('/api/uploads/import-local', async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Chỉ ứng dụng AutoSub trên máy này được phép mở file local.' });
    const kind = (request.body as { kind?: LocalMediaKind } | undefined)?.kind;
    if (kind !== 'video' && kind !== 'audio' && kind !== 'media') return reply.code(400).send({ error: 'Loại file local không hợp lệ.' });
    const controller = new AbortController();
    const onAborted = () => controller.abort();
    request.raw.once('aborted', onAborted);
    try {
      const sourcePath = await (options.pickLocalMediaFile || pickLocalMediaFile)(kind, controller.signal);
      if (!sourcePath) return reply.send({ cancelled: true });
      const stored = await registerLocalUpload(sourcePath);
      return reply.code(201).send({ uploadId: stored.uploadId, storedPath: stored.storedPath, filename: stored.filename, contentType: stored.contentType, size: stored.size, sourceMode: stored.sourceMode });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return reply.code(499).send({ error: 'Đã hủy chọn file.' });
      return reply.code(error instanceof UploadReferenceError ? 404 : 500).send({ error: error instanceof Error ? error.message : 'Không thể mở file local.' });
    } finally {
      request.raw.off('aborted', onAborted);
    }
  });

  app.delete('/api/uploads/:id', async (request, reply) => {
    try {
      const id = String((request.params as { id?: string }).id || '');
      const upload = await resolveUpload(id);
      await cleanupUploadSession(upload.directory);
      return reply.code(204).send();
    } catch (error) {
      return reply.code(error instanceof UploadReferenceError ? error.statusCode : 404).send({ error: 'Upload reference không tồn tại.' });
    }
  });

  app.get('/api/uploads/:id/media', async (request, reply) => {
    try {
      const id = String((request.params as { id?: string }).id || '');
      const upload = await resolveUpload(id);
      const rangeHeader = request.headers.range;
      let start = 0;
      let end = upload.size - 1;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match) return reply.code(416).header('Content-Range', `bytes */${upload.size}`).send();
        const requestedStart = match[1] ? Number(match[1]) : undefined;
        const requestedEnd = match[2] ? Number(match[2]) : undefined;
        start = requestedStart ?? Math.max(0, upload.size - (requestedEnd || 0));
        end = Math.min(upload.size - 1, requestedEnd ?? upload.size - 1);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= upload.size) return reply.code(416).header('Content-Range', `bytes */${upload.size}`).send();
        reply.code(206).header('Content-Range', `bytes ${start}-${end}/${upload.size}`);
      }
      reply.header('Content-Type', upload.contentType || 'application/octet-stream');
      reply.header('Content-Length', String(end - start + 1));
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Disposition', `inline; filename="${upload.filename.replace(/["\r\n]/g, '_')}"`);
      return reply.send(createReadStream(upload.absolutePath, { start, end }));
    } catch (error) {
      return reply.code(error instanceof UploadReferenceError ? error.statusCode : 404).send({ error: 'Video nguồn không còn tồn tại trên máy.' });
    }
  });
}
