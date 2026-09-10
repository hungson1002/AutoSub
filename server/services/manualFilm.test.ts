import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectManualNodes, invalidateManualChildren, manualInputs, type ManualFilmGraph, type ManualFilmNode } from '../../shared/manualFilm';
const node = (id: string, kind: ManualFilmNode['kind'], prompt = ''): ManualFilmNode => ({ id, kind, prompt, model: 'Flow Agent Auto', duration: 6, x: 0, y: 0 });
test('merge uses connected clip order without a prompt and rejects stale sources', () => {
  const graph: ManualFilmGraph = { nodes: [node('a', 'video'), node('b', 'video'), node('m', 'merge')], edges: [{ source: 'b', target: 'm' }, { source: 'a', target: 'm' }] };
  for (const n of graph.nodes.slice(0, 2)) Object.assign(n, { status: 'done', output: `${n.id}.mp4`, outputKind: 'video' });
  assert.deepEqual(manualInputs(graph, 'm').clips.map((c) => c.id), ['b', 'a']);
  graph.nodes[0].stale = true;
  assert.throws(() => manualInputs(graph, 'm'), /node nguồn/);
});
test('manual graph: direct script to storyboard, multiple scripts, no required director/character', () => {
  let graph: ManualFilmGraph = { nodes: [node('a', 'script', 'A forest'), node('b', 'script', 'At night'), node('c', 'storyboard')], edges: [] };
  graph = connectManualNodes(graph, 'a', 'c'); graph = connectManualNodes(graph, 'b', 'c');
  assert.equal(manualInputs(graph, 'c').prompt, 'A forest\n\nAt night');
  assert.throws(() => connectManualNodes(graph, 'c', 'a'), /nối vòng/);
  assert.equal(connectManualNodes(graph, 'a', 'c').edges.length, 2);
  assert.deepEqual({ nodes: [], edges: [] }, { nodes: [], edges: [] });
});
test('manual dependencies: require ready images, keep old output and invalidate descendants', () => {
  const graph: ManualFilmGraph = { nodes: [node('a', 'storyboard', 'Forest'), node('b', 'video', 'Pan slowly')], edges: [{ source: 'a', target: 'b' }] };
  assert.throws(() => manualInputs(graph, 'b'), /node nguồn/);
  Object.assign(graph.nodes[0], { status: 'done', output: 'old.png', outputKind: 'image' });
  assert.equal(manualInputs(graph, 'b').image?.output, 'old.png');
  const invalid = invalidateManualChildren(graph, 'a');
  assert.equal(invalid.nodes[1].stale, true);
  assert.equal(invalid.nodes[0].output, 'old.png');
});
