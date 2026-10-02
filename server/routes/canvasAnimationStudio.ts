import type { FastifyInstance } from 'fastify';
import type { CanvasStudioProject } from '../../shared/canvasAnimationStudio';
import { generateCanvasAnimationVideo } from '../services/canvasAnimationDirector';
import { enqueueCanvasAnimationProjectRender } from '../services/animationRender';
import { prepareCanvasProjectAudio, type CanvasAudioInput } from '../services/canvasAudioProduction';

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export async function canvasAnimationStudioRoutes(app: FastifyInstance) {
  app.post('/api/canvas-animation-studio/audio', async (request, reply) => {
    try { return await prepareCanvasProjectAudio(request.body as CanvasAudioInput); }
    catch(error) { return reply.code(400).send({error:message(error,'Không thể dựng âm thanh cảnh.')}); }
  });
  app.post('/api/canvas-animation-studio/generate', async (request, reply) => {
    try {
      return await generateCanvasAnimationVideo(request.body as Parameters<typeof generateCanvasAnimationVideo>[0]);
    } catch (error) {
      return reply.code(400).send({ error: message(error, 'Không thể tạo video Canvas bằng AI.') });
    }
  });

  app.post('/api/canvas-animation-studio/projects/:id/render-jobs', async (request, reply) => {
    try {
      const id = String((request.params as { id?: string }).id || '');
      const body = request.body as { project?: CanvasStudioProject; cacheKey?: string };
      if (!body?.project) throw new Error('Thiếu Canvas project để render.');
      return reply.code(202).send(await enqueueCanvasAnimationProjectRender(id, body.project, body.cacheKey));
    } catch (error) {
      return reply.code(400).send({ error: message(error, 'Không thể xếp render Canvas video.') });
    }
  });
}
