export type ManualFilmKind = 'script' | 'direction' | 'character' | 'storyboard' | 'video' | 'merge';
export type ManualFilmNode = {
  id: string; kind: ManualFilmKind; prompt: string; model: string; duration: number;
  x: number; y: number; status?: 'running' | 'done' | 'failed'; error?: string;
  output?: string; outputKind?: 'image' | 'video'; stale?: boolean;
};
export type ManualFilmGraph = { nodes: ManualFilmNode[]; edges: { source: string; target: string }[] };
export function connectManualNodes(graph: ManualFilmGraph, source: string, target: string): ManualFilmGraph {
  if (source === target || !graph.nodes.some((n) => n.id === source) || !graph.nodes.some((n) => n.id === target)) throw new Error('Chọn hai node khác nhau.');
  const visit = [target]; const seen = new Set<string>();
  while (visit.length) { const id = visit.pop()!; if (id === source) throw new Error('Không thể nối vòng: node sẽ phụ thuộc vào chính nó.'); if (seen.has(id)) continue; seen.add(id); visit.push(...graph.edges.filter((e) => e.source === id).map((e) => e.target)); }
  if (graph.edges.some((e) => e.source === source && e.target === target)) return graph;
  return { ...graph, edges: [...graph.edges, { source, target }] };
}
export function invalidateManualChildren(graph: ManualFilmGraph, id: string): ManualFilmGraph {
  const stale = new Set<string>(); const queue = [id];
  while (queue.length) { const parent = queue.pop()!; for (const e of graph.edges.filter((item) => item.source === parent)) if (!stale.has(e.target)) { stale.add(e.target); queue.push(e.target); } }
  return { ...graph, nodes: graph.nodes.map((node) => stale.has(node.id) ? { ...node, stale: true } : node) };
}
export function manualInputs(graph: ManualFilmGraph, id: string) {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) throw new Error('Không tìm thấy node.');
  const parents = graph.edges.filter((e) => e.target === id).map((e) => graph.nodes.find((n) => n.id === e.source)!);
  if (parents.some((n) => !n)) throw new Error('Dây nối tham chiếu node không tồn tại.');
  for (const parent of parents) {
    if (parent.kind === 'script' || parent.kind === 'direction') { if (!parent.prompt.trim()) throw new Error('Nhập nội dung vào node nguồn trước.'); }
    else if (parent.status !== 'done' || parent.stale || !parent.output) throw new Error('Chạy xong node nguồn trước (kết quả phải còn hiệu lực).');
  }
  if (node.kind === 'merge') {
    if (!parents.length || parents.some((p) => p.outputKind !== 'video')) throw new Error('Nối các node video đã tạo vào node Gộp video trước.');
    return { node, prompt: '', image: undefined, clips: parents };
  }
  const prompt = [...parents.filter((n) => n.kind === 'script' || n.kind === 'direction').map((n) => n.prompt), node.prompt].filter((s) => s.trim()).join('\n\n');
  if (!prompt.trim()) throw new Error('Nhập prompt hoặc nối một node kịch bản có nội dung.');
  if (parents.some((n) => n.outputKind === 'video')) throw new Error('Node này nhận văn bản/ảnh, chưa hỗ trợ video đầu vào.');
  const images = parents.filter((n) => n.outputKind === 'image');
  if (images.length > 1) throw new Error('Adapter hiện nhận một ảnh tham chiếu cho mỗi node; hãy chọn một kết nối ảnh.');
  return { node, prompt, image: images[0], clips: [] as ManualFilmNode[] };
}
