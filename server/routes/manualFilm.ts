import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { workdir } from '../services/ffmpeg';
import { mergeManualClips } from '../services/manualFilmMerge';
import { generateGoogleFlowImage, flowImageModels } from '../services/googleFlow';
import { generateFilmVideoClip, assertFilmVideoAdapter } from '../services/filmVideoAdapter';
import { connectManualNodes, invalidateManualChildren, manualInputs, type ManualFilmGraph } from '../../shared/manualFilm';

const idSchema = z.string().uuid();
const graphSchema = z.object({ nodes: z.array(z.object({
  id: idSchema, kind: z.enum(['script', 'direction', 'character', 'storyboard', 'video', 'merge']), prompt: z.string().max(20000),
  model: z.string().max(120), duration: z.union([z.literal(4), z.literal(6), z.literal(8)]), x: z.number().min(0).max(20000), y: z.number().min(0).max(20000),
})).max(200), edges: z.array(z.object({ source: idSchema, target: idSchema })).max(1000) });
export async function manualFilmRoutes(app: FastifyInstance) {
  app.get('/api/manual-film/image-models', async (_req, reply) => {
    try { return { models: await flowImageModels() }; }
    catch { return reply.code(503).send({ error: 'Không đọc được danh sách model. Kiểm tra kết nối Flow Agent.' }); }
  });
  const root = path.join(workdir, 'manual-film');
  const active = new Map<string, AbortController>();
  const locks = new Set<string>();
  const directory = (id: string) => path.join(root, idSchema.parse(id));
  async function load(id: string): Promise<ManualFilmGraph> {
    try { const graph = JSON.parse(await readFile(path.join(directory(id), 'graph.json'), 'utf8')) as ManualFilmGraph;
      return { ...graph, nodes: graph.nodes.map((n) => n.status === 'running' && !active.has(id) ? { ...n, status: 'failed', error: 'Backend đã khởi động lại. Kết quả cũ được giữ; kiểm tra Flow trước khi tạo lại.' } : n) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { nodes: [], edges: [] }; throw error; }
  }
  async function save(id: string, graph: ManualFilmGraph) {
    const dir = directory(id); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'graph.tmp'), JSON.stringify(graph)); await rename(path.join(dir, 'graph.tmp'), path.join(dir, 'graph.json'));
  }
  const params = (value: unknown) => z.object({ id: idSchema, node: idSchema.optional() }).parse(value);
  app.get('/api/manual-film/:id', async (req) => load(params(req.params).id));
  app.put('/api/manual-film/:id', async (req, reply) => {
    const { id } = params(req.params);
    if (active.has(id) || locks.has(id)) return reply.code(409).send({ error: 'Đợi node đang chạy hoàn tất trước khi sửa workflow.' });
    locks.add(id);
    try {
      const parsed = graphSchema.parse(req.body); const previous = await load(id);
      if (new Set(parsed.nodes.map((n) => n.id)).size !== parsed.nodes.length) throw new Error('Node ID bị trùng.');
      let graph: ManualFilmGraph = { nodes: parsed.nodes, edges: [] };
      for (const edge of parsed.edges) graph = connectManualNodes(graph, edge.source, edge.target);
      graph.nodes = graph.nodes.map((n) => { const old = previous.nodes.find((p) => p.id === n.id); return { ...old, ...n }; });
      for (const n of graph.nodes) {
        const old = previous.nodes.find((p) => p.id === n.id);
        if (old && (old.prompt !== n.prompt || old.model !== n.model || old.duration !== n.duration || JSON.stringify(previous.edges.filter((e) => e.target === n.id)) !== JSON.stringify(graph.edges.filter((e) => e.target === n.id)))) {
          n.stale = true; graph = invalidateManualChildren(graph, n.id);
        }
      }
      await save(id, graph); return graph;
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Workflow không hợp lệ.' }); }
    finally { locks.delete(id); }
  });
  app.post('/api/manual-film/:id/nodes/:node/run', async (req, reply) => {
    const { id, node: nodeId } = params(req.params);
    if (active.has(id) || locks.has(id)) return reply.code(409).send({ error: 'Một node đang chạy. Vui lòng đợi hoàn tất.' });
    locks.add(id);
    try {
      const aspect = z.object({ aspectRatio: z.enum(['16:9', '9:16']) }).parse(req.body).aspectRatio;
      let graph = await load(id); const { node, prompt, image, clips } = manualInputs(graph, nodeId!);
      if (node.kind === 'script' || node.kind === 'direction') { node.status = 'done'; node.stale = false; await save(id, graph); return graph; }
      if (node.kind === 'video') assertFilmVideoAdapter(node.model);
      const controller = new AbortController(); active.set(id, controller);
      graph = invalidateManualChildren(graph, node.id);
      const current = graph.nodes.find((n) => n.id === node.id)!;
      current.status = 'running'; current.error = undefined;
      try { await save(id, graph); } catch (error) { active.delete(id); throw error; }
      const outputKind = node.kind === 'video' || node.kind === 'merge' ? 'video' : 'image';
      const output = `${randomUUID()}.${outputKind === 'video' ? 'mp4' : 'png'}`;
      const outputFile = path.join(directory(id), output);
      const reference = image?.output ? path.join(directory(id), image.output) : undefined;
      // One explicit click = one attempt. No quality retry and no downstream generation.
      void (async () => {
        try {
          if (node.kind === 'merge') await mergeManualClips(clips.map((clip) => path.join(directory(id), clip.output!)), outputFile, aspect, controller.signal);
          else if (outputKind === 'video') await generateFilmVideoClip({ prompt: `Duration: ${node.duration} seconds\n${prompt}`, outputFile, model: node.model, aspectRatio: aspect, references: reference ? { startImagePath: reference } : {}, signal: controller.signal });
          else await generateGoogleFlowImage(prompt, outputFile, { model: node.model, size: aspect === '16:9' ? '1920x1080' : '1080x1920', referenceImagePath: reference, signal: controller.signal });
          current.output = output; current.outputKind = outputKind; current.status = 'done'; current.stale = false;
        } catch (error) {
          current.status = 'failed';
          let detail = error instanceof Error ? error.message : 'Lỗi không xác định.';
          const secret = process.env.FLOW_AGENT_API_KEY?.trim();
          if (secret) detail = detail.split(secret).join('[ẩn]');
          detail = detail.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [ẩn]').slice(0, 1200);
          current.error = `${node.kind === 'merge' ? 'Ghép video' : 'Tạo node'} thất bại: ${detail} Kết quả trước vẫn được giữ.`;
        }
        finally { try { await save(id, graph); } finally { active.delete(id); } }
      })().catch(() => undefined);
      return reply.code(202).send(graph);
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Không chạy được node.' }); }
    finally { locks.delete(id); }
  });
  app.get('/api/manual-film/:id/media/:file', async (req, reply) => {
    const p = z.object({ id: idSchema, file: z.string().regex(/^[a-f0-9-]{36}\.(png|mp4)$/) }).parse(req.params);
    const file = path.join(directory(p.id), p.file);
    try { await stat(file); return reply.type(p.file.endsWith('.mp4') ? 'video/mp4' : 'image/png').send(createReadStream(file)); }
    catch { return reply.code(404).send({ error: 'Chưa có media.' }); }
  });
  app.addHook('onClose', async () => { for (const controller of active.values()) controller.abort(); });
}
