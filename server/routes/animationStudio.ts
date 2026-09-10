import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { validateAnimationProject } from '../../shared/animationStudio';
import {
  createAnimationProject,
  getAnimationProject,
  saveAnimationProject,
  listAnimationProjectVersions,
  restoreAnimationProjectVersion,
} from '../services/animationProjects';
import { batchDirectAnimationProjects, directAnimationProject, editAnimationProject, editAnimationScene } from '../services/animationDirector';
import { enqueueAnimationProjectRender, enqueueAnimationRender, getAnimationRenderJob, initializeAnimationRenderJobs, listAnimationRenderJobs, transcodeAnimationRecording } from '../services/animationRender';
import { generateAnimationAsset, generateAnimationNarration, getAnimationAssetFile, listAnimationAssets, registerAnimationAsset, resolveAnimationAssets, updateAnimationAsset } from '../services/animationAssets';
import { autoFixAnimationQuality, checkAnimationQuality } from '../services/animationQuality';
import { buildAnimationAssetManifest } from '../services/animationManifest';
import { animationDirectorJobs } from '../services/animationDirectorJobs';

const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export async function animationStudioRoutes(app: FastifyInstance) {
  await initializeAnimationRenderJobs();
  await animationDirectorJobs.initialize();
  app.post('/api/animation-studio/director-jobs', async (request, reply) => {
    try { const body = request.body as { input: Parameters<typeof directAnimationProject>[0]; resumeId?: string }; return reply.code(202).send(await animationDirectorJobs.start(body.input, body.resumeId)); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không thể bắt đầu job Animation.') }); }
  });
  app.get('/api/animation-studio/director-jobs', async (request) => animationDirectorJobs.list((request.query as { projectId?: string }).projectId));
  app.get('/api/animation-studio/director-jobs/:id', async (request, reply) => {
    try { return animationDirectorJobs.get((request.params as { id: string }).id); }
    catch (error) { return reply.code(404).send({ error: message(error, 'Không tìm thấy job.') }); }
  });
  app.get('/api/animation-studio/director-jobs/:id/result', async (request, reply) => {
    try { return await animationDirectorJobs.result((request.params as { id: string }).id); }
    catch (error) { return reply.code(404).send({ error: message(error, 'Chưa có kết quả.') }); }
  });
  app.get('/api/animation-studio/director-jobs/:id/input', async (request, reply) => {
    try { return await animationDirectorJobs.input((request.params as { id: string }).id); }
    catch (error) { return reply.code(404).send({ error: message(error, 'Không đọc được đầu vào job.') }); }
  });
  app.post('/api/animation-studio/director-jobs/:id/cancel', async (request, reply) => {
    try { return await animationDirectorJobs.cancel((request.params as { id: string }).id); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không dừng được job.') }); }
  });
  app.addContentTypeParser('video/webm', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.get('/api/animation-studio/assets', async (request) => listAnimationAssets(String((request.query as { q?: string }).q || '')));
  app.get('/api/animation-studio/assets/resolve', async (request) => { const query = request.query as { q?: string; limit?: string }; return resolveAnimationAssets(String(query.q || ''), Number(query.limit) || 8); });
  app.post('/api/animation-studio/assets', async (request, reply) => {
    try { return reply.code(201).send(await registerAnimationAsset(request.body as Parameters<typeof registerAnimationAsset>[0])); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không thể lưu asset.') }); }
  });
  app.patch('/api/animation-studio/assets/:id', async (request, reply) => {
    try { return await updateAnimationAsset(String((request.params as { id?: string }).id || ''), request.body as Parameters<typeof updateAnimationAsset>[1]); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không thể cập nhật asset.') }); }
  });
  app.post('/api/animation-studio/assets/generate', async (request, reply) => {
    try { return reply.code(201).send(await generateAnimationAsset(request.body as Parameters<typeof generateAnimationAsset>[0])); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không thể tạo asset.') }); }
  });
  app.get('/api/animation-studio/assets/:id/file', async (request, reply) => {
    try { const result = await getAnimationAssetFile(String((request.params as { id?: string }).id || '')); reply.header('Content-Type', result.contentType).header('Content-Length', String(result.size)).header('Cache-Control', 'public, max-age=31536000, immutable'); return reply.send(createReadStream(result.path)); }
    catch { return reply.code(404).send({ error: 'Không tìm thấy file asset.' }); }
  });
  app.post('/api/animation-studio/narration', async (request, reply) => { try { return await generateAnimationNarration(request.body as Parameters<typeof generateAnimationNarration>[0]); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể tạo voiceover.') }); } });

  app.post('/api/animation-studio/projects/:id/render', async (request, reply) => {
    try {
      const result = await transcodeAnimationRecording(String((request.params as { id?: string }).id || ''), request.body as Buffer);
      reply.header('Content-Type', 'video/mp4').header('Content-Length', String(result.size)).header('Content-Disposition', 'attachment; filename="autosub-animation.mp4"');
      return reply.send(createReadStream(result.path));
    } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể render animation.') }); }
  });
  app.post('/api/animation-studio/projects/:id/render-jobs', async (request, reply) => { try { return reply.code(202).send(await enqueueAnimationRender(String((request.params as { id?: string }).id || ''), request.body as Buffer, String(request.headers['x-animation-cache-key'] || ''))); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể xếp render job.') }); } });
  app.post('/api/animation-studio/projects/:id/remotion-render-jobs', async (request, reply) => { try { const body = request.body as { project?: unknown; showSubtitles?: boolean; cacheKey?: string }; return reply.code(202).send(await enqueueAnimationProjectRender(String((request.params as { id?: string }).id || ''), body.project as Parameters<typeof enqueueAnimationProjectRender>[1], body.showSubtitles !== false, String(body.cacheKey || ''))); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể xếp render Remotion.') }); } });
  app.get('/api/animation-studio/render-jobs', async () => listAnimationRenderJobs());
  app.get('/api/animation-studio/render-jobs/:id', async (request, reply) => { try { return getAnimationRenderJob(String((request.params as { id?: string }).id || '')); } catch (error) { return reply.code(404).send({ error: message(error, 'Không tìm thấy render job.') }); } });
  app.get('/api/animation-studio/render-jobs/:id/video', async (request, reply) => { try { const job = getAnimationRenderJob(String((request.params as { id?: string }).id || '')); if (!job.result) throw new Error('Render chưa hoàn tất.'); reply.header('Content-Type', 'video/mp4').header('Content-Length', String(job.result.size)).header('Content-Disposition', 'attachment; filename="autosub-animation.mp4"').header('X-AutoSub-Render-Cache', job.cached ? 'hit' : 'miss'); return reply.send(createReadStream(job.result.path)); } catch (error) { return reply.code(404).send({ error: message(error, 'Video chưa sẵn sàng.') }); } });
  app.post('/api/animation-studio/direct', async (request, reply) => {
    try { return await directAnimationProject(request.body as Parameters<typeof directAnimationProject>[0]); }
    catch (error) { return reply.code(400).send({ error: message(error, 'AI Director không thể dựng project.') }); }
  });
  app.post('/api/animation-studio/direct-batch', async (request, reply) => { try { return await batchDirectAnimationProjects(request.body as Parameters<typeof batchDirectAnimationProjects>[0]); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể tạo batch project.') }); } });
  app.post('/api/animation-studio/edit', async (request, reply) => {
    try { return await editAnimationScene(request.body as Parameters<typeof editAnimationScene>[0]); }
    catch (error) { return reply.code(400).send({ error: message(error, 'AI không thể sửa scene.') }); }
  });
  app.post('/api/animation-studio/edit-project', async (request, reply) => {
    try { return await editAnimationProject(request.body as Parameters<typeof editAnimationProject>[0]); }
    catch (error) { return reply.code(400).send({ error: message(error, 'AI không thể sửa toàn project.') }); }
  });
  app.post('/api/animation-studio/quality-check', async (request) => ({ issues: checkAnimationQuality(request.body as Parameters<typeof checkAnimationQuality>[0]) }));
  app.post('/api/animation-studio/quality-fix', async (request) => autoFixAnimationQuality(request.body as Parameters<typeof autoFixAnimationQuality>[0]));
  app.post('/api/animation-studio/asset-manifest', async (request, reply) => {
    try { return buildAnimationAssetManifest(request.body as Parameters<typeof buildAnimationAssetManifest>[0]); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Không thể tạo manifest asset.') }); }
  });
  app.post('/api/animation-studio/projects/validate', async (request) => {
    const issues = validateAnimationProject(request.body);
    return { valid: issues.length === 0, issues };
  });

  app.post('/api/animation-studio/projects', async (request, reply) => {
    try { return reply.code(201).send(await createAnimationProject(request.body as { name?: string; width?: number; height?: number; fps?: number })); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Cannot create animation project.') }); }
  });

  app.get('/api/animation-studio/projects/:id', async (request, reply) => {
    try { return await getAnimationProject(String((request.params as { id?: string }).id || '')); }
    catch (error) { return reply.code(404).send({ error: message(error, 'Animation project was not found.') }); }
  });
  app.get('/api/animation-studio/projects/:id/versions', async (request, reply) => { try { return await listAnimationProjectVersions(String((request.params as { id?: string }).id || '')); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể đọc lịch sử.') }); } });
  app.post('/api/animation-studio/projects/:id/versions/:versionId/restore', async (request, reply) => { try { const params = request.params as { id?: string; versionId?: string }; return await restoreAnimationProjectVersion(String(params.id || ''), String(params.versionId || '')); } catch (error) { return reply.code(400).send({ error: message(error, 'Không thể khôi phục version.') }); } });

  app.put('/api/animation-studio/projects/:id', async (request, reply) => {
    try { return await saveAnimationProject(request.body, String((request.params as { id?: string }).id || '')); }
    catch (error) { return reply.code(400).send({ error: message(error, 'Cannot save animation project.') }); }
  });
}
