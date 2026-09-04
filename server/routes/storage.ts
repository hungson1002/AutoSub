import type { FastifyInstance } from 'fastify';
import { deleteStorageItems, inspectStorage } from '../services/storageManager';

function isLocalOrigin(origin?: string) {
  if (!origin) return true;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(origin).hostname); }
  catch { return false; }
}

export async function storageRoutes(app: FastifyInstance) {
  app.get('/api/storage', async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Chỉ ứng dụng AutoSub trên máy này được phép đọc dữ liệu lưu trữ.' });
    try { return await inspectStorage(); }
    catch (error) { return reply.code(500).send({ error: error instanceof Error ? error.message : 'Không thể đọc dung lượng AutoSub.' }); }
  });
  app.post('/api/storage/delete', async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Chỉ ứng dụng AutoSub trên máy này được phép xóa dữ liệu.' });
    try {
      const body = request.body as { items?: Array<{ categoryId: string; name: string }> } | undefined;
      const result = await deleteStorageItems(body?.items || []);
      return reply.code(result.errors.length && !result.deletedCount ? 409 : 200).send(result);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Không thể xóa dữ liệu.' });
    }
  });
}
