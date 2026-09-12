import { useEffect, useRef, useState } from 'react';
import { connectManualNodes, manualInputs, type ManualFilmGraph, type ManualFilmKind, type ManualFilmNode } from '../../shared/manualFilm';
import { Plus, Trash2, X, WandSparkles, Settings2, Film, Check } from './Icons';

const titles: Record<ManualFilmKind, string> = { script: 'Kịch bản', direction: 'Chỉ dẫn đạo diễn', character: 'Ảnh nhân vật', storyboard: 'Storyboard', video: 'Video', merge: 'Gộp video' };
const storageKey = 'autosub.manual-film-id';
export function ManualFilmWorkflow({ videoModels, imageModel, onSetup, onInspect }: { videoModels: string[]; imageModel: string; onSetup: () => void; onInspect: () => void }) {
  const [id] = useState(() => { const saved = localStorage.getItem(storageKey); if (saved && /^[a-f0-9-]{36}$/.test(saved)) return saved; const value = crypto.randomUUID(); localStorage.setItem(storageKey, value); return value; });
  const [graph, setGraph] = useState<ManualFilmGraph>({ nodes: [], edges: [] });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [imageModels, setImageModels] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/manual-film/image-models', { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setImageModels(result.models);
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Không tải được model ảnh.'); });
    return () => controller.abort();
  }, []);
  const [link, setLink] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const selectedNode = graph.nodes.find((n) => n.id === selected);
  useEffect(() => { if (selected) onInspect(); }, [selected]);
  const [scale, setScale] = useState(.82);
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9');
  const [preview, setPreview] = useState<ManualFilmNode>();
  const viewport = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ id?: string; x: number; y: number; left: number; top: number } | undefined>(undefined);
  const running = graph.nodes.some((n) => n.status === 'running');
  const disabled = saving || running || !loaded;
  async function request(suffix = '', method = 'GET', body?: unknown): Promise<ManualFilmGraph> {
    const response = await fetch(`/api/manual-film/${id}${suffix}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không kết nối được backend.'); return result;
  }
  useEffect(() => { let alive = true; void request().then((g) => { if (alive) { setGraph(g); setLoaded(true); } }).catch(() => { if (alive) setError('Không tải được workflow. Tải lại trang để thử lại.'); }); return () => { alive = false; }; }, [id]);
  useEffect(() => {
    if (!running) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const g = await request(); if (alive) setGraph(g); } catch { if (alive) setError('Mất kết nối backend; đang thử đọc lại trạng thái, không tạo thêm video.'); } finally { if (alive) timer = setTimeout(() => void poll(), 2500); } };
    timer = setTimeout(() => void poll(), 2000); return () => { alive = false; clearTimeout(timer); };
  }, [running, id]);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  useEffect(() => { const el = viewport.current; if (!el) return; const wheel = (e: WheelEvent) => { if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setScale((s) => Math.max(.4, Math.min(1.5, s + (e.deltaY > 0 ? -.1 : .1)))); } }; el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel); }, []);
  async function persist(next: ManualFilmGraph) {
    setSaving(true); setError(''); try { const saved = await request('', 'PUT', next); setGraph(saved); return saved; } catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được workflow.'); throw e; } finally { setSaving(false); }
  }
  const commit = (g: ManualFilmGraph) => { void persist(g).catch(() => undefined); };
  const patch = (node: ManualFilmNode, change: Partial<ManualFilmNode>) => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === node.id ? { ...n, ...change } : n) }));
  function add(kind: ManualFilmKind) {
    const node: ManualFilmNode = { id: crypto.randomUUID(), kind, prompt: '', model: kind === 'video' ? videoModels[0] || 'Flow Agent Auto' : imageModel, duration: 8, x: 40 + (graph.nodes.length % 4) * 350, y: 40 + Math.floor(graph.nodes.length / 4) * 650 };
    commit({ ...graph, nodes: [...graph.nodes, node] });
  }
  async function run(node: ManualFilmNode) {
    try { manualInputs(graph, node.id); await persist(graph); setSaving(true); setGraph(await request(`/nodes/${node.id}/run`, 'POST', { aspectRatio: aspect })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không chạy được node.'); } finally { setSaving(false); }
  }
  const media = (n: ManualFilmNode) => `/api/manual-film/${id}/media/${n.output}`;
  return <section className="ai-flow-workspace manual-film">
    <header className="ai-flow-toolbar">
      <div><WandSparkles size={16} /><span><strong>AI FILM WORKFLOW</strong><small>Thiết kế nhân vật → storyboard → video shot · Tự nối và chạy từng node</small></span></div>
      <div className="ai-flow-actions">
        <span className="ai-flow-mode manual">Thủ công</span>
        <button type="button" className="button secondary" onClick={() => { setSelected(undefined); setLibraryOpen(false); onSetup(); }}><Settings2 size={14} /> Thiết lập</button>
        <button type="button" className="button secondary" onClick={() => { onInspect(); setSelected(undefined); setLibraryOpen((value) => !value); }}><Plus size={14} /> Thêm node</button>
        <button type="button" className="button primary" disabled={disabled} onClick={() => commit(graph)}>Lưu workflow</button>
        <button type="button" className="button secondary" disabled={disabled || !graph.nodes.length} onClick={() => { if (confirm('Xóa tất cả node và dây nối? File đã tạo vẫn được giữ trên máy.')) { setSelected(undefined); setLink(undefined); commit({ nodes: [], edges: [] }); } }}><Trash2 size={14} /> Xóa tất cả node</button>
        <span className="ai-flow-scale">Zoom {Math.round(scale * 100)}%</span>
      </div>
    </header>
    {libraryOpen && <nav className="ai-flow-library" aria-label="Thêm node thủ công"><header><div><span>NODE LIBRARY</span><strong>Thêm node làm phim</strong></div><button type="button" aria-label="Đóng thư viện node" onClick={() => setLibraryOpen(false)}><X size={16} /></button></header>{(Object.keys(titles) as ManualFilmKind[]).map((kind) => <button type="button" key={kind} aria-label={titles[kind]} disabled={disabled} onClick={() => add(kind)}><strong>{titles[kind]}</strong><small>{kind === 'script' ? 'Ý tưởng và nội dung cho các node tiếp theo' : kind === 'direction' ? 'Phong cách, góc máy và yêu cầu riêng' : kind === 'character' ? 'Thiết kế hình ảnh nhân vật' : kind === 'storyboard' ? 'Tạo khung hình từ prompt hoặc ảnh tham chiếu' : kind === 'merge' ? 'Ghép nhiều clip theo thứ tự và xuất MP4' : 'Tạo chuyển động từ ảnh và prompt'}</small></button>)}</nav>}
    <div className="ai-flow-zoom"><button type="button" aria-label="Thu nhỏ canvas" onClick={() => setScale((s) => Math.max(.4, s - .1))}>−</button><span>{Math.round(scale * 100)}%</span><button type="button" aria-label="Phóng to canvas" onClick={() => setScale((s) => Math.min(1.5, s + .1))}>+</button></div>
    {link && <p role="status">Chọn “Đầu vào” tại node đích. <button type="button" onClick={() => setLink(undefined)}>Hủy nối</button></p>}
    {error && <p role="alert">{error}<button type="button" aria-label="Đóng thông báo" onClick={() => setError('')}><X size={16} /></button></p>}
    <div className="ai-flow-viewport" ref={viewport} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('article,button,input,textarea,select')) { drag.current = { x: e.clientX, y: e.clientY, left: viewport.current!.scrollLeft, top: viewport.current!.scrollTop }; e.currentTarget.setPointerCapture(e.pointerId); } }} onPointerMove={(e) => { const d = drag.current; if (!d) return; if (d.id) setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === d.id ? { ...n, x: Math.max(0, d.left + (e.clientX - d.x) / scale), y: Math.max(0, d.top + (e.clientY - d.y) / scale) } : n) })); else { e.currentTarget.scrollLeft = d.left - (e.clientX - d.x); e.currentTarget.scrollTop = d.top - (e.clientY - d.y); } }} onPointerUp={(e) => { const d = drag.current; if (d?.id) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) { setSelected(d.id); setLibraryOpen(false); } else commit(graph); } drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      <div style={{ width: Math.max(1600, ...graph.nodes.map((n) => n.x + 380)) * scale, height: Math.max(800, ...graph.nodes.map((n) => n.y + 700)) * scale, position: 'relative' }}>
        <div className="ai-flow-stage" style={{ transform: `scale(${scale})`, width: Math.max(1600, ...graph.nodes.map((n) => n.x + 380)), height: Math.max(800, ...graph.nodes.map((n) => n.y + 700)) }}>
          <svg className="ai-flow-edges" width="100%" height="100%">{graph.edges.map((e) => { const a = graph.nodes.find((n) => n.id === e.source); const b = graph.nodes.find((n) => n.id === e.target); return a && b ? <path key={`${e.source}-${e.target}`} d={`M${a.x + 250},${a.y + 105} C${a.x + 250 + Math.max(70, Math.abs(b.x - a.x - 250) * .45)},${a.y + 105} ${b.x - Math.max(70, Math.abs(b.x - a.x - 250) * .45)},${b.y + 105} ${b.x},${b.y + 105}`} /> : null; })}</svg>
          {!graph.nodes.length && <p className="manual-film-empty">Canvas trống. Bấm “Kịch bản”, “Storyboard” hoặc loại node bạn muốn ở trên để bắt đầu.</p>}
          {graph.nodes.map((n, index) => <article key={n.id} className={`ai-flow-node ${n.kind === 'script' ? 'input' : n.kind === 'direction' ? 'process' : n.kind === 'video' ? 'shot' : n.kind === 'merge' ? 'master' : 'character'} ${n.status === 'running' ? 'running' : ''} ${selected === n.id ? 'selected' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('button,video')) { setSelected(n.id); setLibraryOpen(false); } }} style={{ left: n.x, top: n.y }} aria-label={`${titles[n.kind]} ${index + 1}`}>
            <header onPointerDown={(e) => { if (disabled || (e.target as HTMLElement).closest('button')) return; e.stopPropagation(); drag.current = { id: n.id, x: e.clientX, y: e.clientY, left: n.x, top: n.y }; viewport.current?.setPointerCapture(e.pointerId); }}><span>{n.kind === 'script' ? 'INPUT' : n.kind === 'direction' ? 'AI DIRECTOR' : n.kind.toUpperCase()} {String(index + 1).padStart(2, '0')}</span><i className={n.status === 'done' ? 'ready' : ''}>{n.status === 'done' ? <Check size={11} /> : index + 1}</i><button type="button" disabled={disabled} aria-label={`Xóa node ${index + 1}`} onClick={() => commit({ nodes: graph.nodes.filter((p) => p.id !== n.id), edges: graph.edges.filter((e) => e.source !== n.id && e.target !== n.id) })}><Trash2 size={16} /></button></header>
            <div className="manual-film-ports"><button type="button" disabled={disabled || !link} onClick={() => { try { commit(connectManualNodes(graph, link!, n.id)); setLink(undefined); } catch (e) { setError((e as Error).message); } }} aria-label={`Đầu vào node ${index + 1}`} title="Đầu vào"></button><button type="button" disabled={disabled} aria-pressed={link === n.id} onClick={() => setLink(n.id)} aria-label={`Đầu ra node ${index + 1}`} title="Đầu ra"></button></div>
            {['script', 'direction'].includes(n.kind) ? <div className="ai-flow-node-copy" onClick={() => { setSelected(n.id); setLibraryOpen(false); }}><strong>{titles[n.kind]}</strong><p>{n.prompt || 'Chọn node để nhập nội dung ở bảng bên phải.'}</p></div> : <>
              {n.output ? n.outputKind === 'video' ? <video className="ai-flow-master-video" controls playsInline preload="metadata" src={media(n)} /> : <button type="button" className="ai-flow-media-open" onClick={() => { setSelected(n.id); setLibraryOpen(false); }}><img src={media(n)} alt={titles[n.kind]} /></button> : <div className="ai-flow-node-media empty"><Film size={25} /><small>{n.status === 'running' ? (n.kind === 'merge' ? 'Đang ghép…' : 'Đang tạo…') : n.kind === 'merge' ? 'Nối video để ghép MP4' : 'Chưa tạo nội dung'}</small></div>}
              <footer><span><strong>{titles[n.kind]}</strong><small>{n.error || (n.stale ? 'Đầu vào thay đổi' : n.kind === 'merge' ? graph.edges.filter((e) => e.target === n.id).length + ' clip · Ghép trên máy' : n.kind === 'video' ? n.duration + ' giây · ' + n.model : n.prompt || 'Chọn node để nhập prompt')}</small></span><button type="button" disabled={disabled} title="Bắt đầu node" onClick={() => void run(n)}>▶</button>{n.output && <button type="button" title="Xem lớn" onClick={() => setPreview(n)}>↗</button>}</footer>
            </>}
          </article>)}
        </div>
      </div>
    </div>
    {selectedNode && <aside className="ai-flow-inspector" aria-label="Chỉnh sửa node">
      <header><div><span>NODE INSPECTOR</span><strong>{titles[selectedNode.kind]}</strong></div><button type="button" aria-label="Đóng bảng node" onClick={() => setSelected(undefined)}><X size={18} /></button></header>
      <div className="ai-flow-inspector-body"><label><span>Tỷ lệ khung hình</span><select value={aspect} disabled={disabled} onChange={(e) => setAspect(e.target.value as typeof aspect)}><option>16:9</option><option>9:16</option></select></label>
        {(() => { const n = selectedNode; const source = graph.edges.filter((e) => e.target === n.id).map((e) => graph.nodes.find((p) => p.id === e.source)).find((p) => p?.outputKind === 'image'); return <>
          {source?.output && <div><small>Ảnh đầu vào từ {titles[source.kind]}</small><img className="manual-film-reference" src={media(source)} alt="Ảnh đầu vào của node" /></div>}
            {n.kind !== 'merge' && <label><span>Prompt</span><textarea rows={4} value={n.prompt} disabled={disabled} onChange={(e) => patch(n, { prompt: e.target.value })} placeholder="Nhập nội dung, hoặc nối từ node kịch bản…" /></label>}
            {n.prompt.includes(aspect === '16:9' ? '9:16' : '16:9') && <p role="alert">Prompt ghi tỷ lệ khác với khung hình đang chọn ({aspect}). Hãy sửa prompt hoặc tỷ lệ trước khi tạo để tránh kết quả sai bố cục.</p>}
            {!['script', 'direction', 'merge'].includes(n.kind) && <label><span>Model tạo nội dung</span><select value={n.model} disabled={disabled} onChange={(e) => { const next = { ...graph, nodes: graph.nodes.map((p) => p.id === n.id ? { ...p, model: e.target.value } : p) }; commit(next); }}>{[...new Set(n.kind === 'video' ? [n.model, ...videoModels] : [n.model, ...imageModels.map((model) => model.id)])].map((model) => <option key={model} value={model}>{n.kind === 'video' ? model : imageModels.find((entry) => entry.id === model)?.label || `${model} · chưa xác minh`}</option>)}</select></label>}
            {n.kind === 'video' && <label><span>Thời lượng video</span><select value={n.duration} disabled={disabled} onChange={(e) => commit({ ...graph, nodes: graph.nodes.map((p) => p.id === n.id ? { ...p, duration: Number(e.target.value) } : p) })}>{[4, 6, 8].map((seconds) => <option key={seconds} value={seconds}>{seconds} giây</option>)}</select></label>}
            {graph.edges.filter((e) => e.target === n.id).map((e) => <button type="button" className="manual-film-unlink" key={e.source} disabled={disabled} onClick={() => commit({ ...graph, edges: graph.edges.filter((p) => p !== e) })}>Ngắt nguồn #{graph.nodes.findIndex((p) => p.id === e.source) + 1} ×</button>)}

          {n.kind === 'merge' && <div className="manual-film-merge-order"><p>Nối các node Video vào đây. Clip được ghép từ trên xuống; giữ âm thanh gốc, không gọi AI.</p>{graph.edges.filter((e) => e.target === n.id).map((edge, index, inputs) => <div key={edge.source}><span>{index + 1}. {titles[graph.nodes.find((p) => p.id === edge.source)!.kind]} #{graph.nodes.findIndex((p) => p.id === edge.source) + 1}</span>{([-1, 1] as const).map((delta) => <button type="button" key={delta} aria-label={`Đưa clip ${index + 1} ${delta < 0 ? 'lên' : 'xuống'}`} disabled={disabled || index + delta < 0 || index + delta >= inputs.length} onClick={() => { const edges = [...graph.edges]; const a = edges.indexOf(edge); const other = inputs[index + delta]; if (!other) return; const b = edges.indexOf(other); edges[a] = other; edges[b] = edge; commit({ ...graph, edges }); }}>{delta < 0 ? '↑' : '↓'}</button>)}</div>)}</div>}
          {n.outputKind === 'video' && n.output && <a className="button secondary" href={media(n)} download="video.mp4">Tải video MP4</a>}
          {n.kind === 'video' && <p>Prompt video mô tả hành động và chuyển động camera. Ảnh storyboard được nối vào sẽ làm khung hình bắt đầu; không tạo lại ảnh khi chạy video.</p>}
          {n.kind === 'storyboard' && <p>Nhập mô tả ảnh tại đây rồi bấm Bắt đầu. Sau khi có ảnh, nối Đầu ra sang node Video và nhập prompt chuyển động ở node Video.</p>}
          <button type="button" className="button ghost" disabled={disabled} onClick={() => commit(graph)}>Lưu thay đổi</button>
          <button type="button" className="button primary" disabled={disabled} onClick={() => void run(n)}>{n.status === 'running' ? 'Đang chạy…' : n.kind === 'merge' ? (n.output ? 'Ghép lại video' : 'Bắt đầu ghép') : n.output ? 'Tạo lại' : 'Bắt đầu'}</button>
          {n.error && <p role="alert">{n.error}</p>}
        </>; })()}
      </div>
    </aside>}
    {preview && <dialog ref={dialog} className="ai-flow-preview-modal" onCancel={() => setPreview(undefined)}><section><header><strong>{titles[preview.kind]}</strong><button type="button" onClick={() => { dialog.current?.close(); setPreview(undefined); }}>Đóng ×</button></header>{preview.outputKind === 'video' ? <video controls autoPlay src={media(preview)} /> : <img src={media(preview)} alt={titles[preview.kind]} />}</section></dialog>}
  </section>;
}
