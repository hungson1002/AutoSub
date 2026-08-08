import type { FastifyInstance } from 'fastify';
import { cleanupUploadSession, discardUploadStream, resolveUpload, storeUpload, UploadReferenceError, UploadTooLargeError } from '../services/uploads';

const uploadError = (error: unknown) => error instanceof UploadTooLargeError || (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE');

export async function uploadRoutes(app: FastifyInstance) {
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
}
