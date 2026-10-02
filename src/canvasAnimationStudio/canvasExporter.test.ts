import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasProjectTotalFrames,
  selectCanvasExportMimeType,
  validateCanvasExportProject,
} from './canvasExporter';
import type { CanvasStudioProject } from './types';

const project = (overrides: Partial<CanvasStudioProject> = {}): CanvasStudioProject => ({
  version: 1,
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Bach Dang draft',
  width: 1280,
  height: 720,
  fps: 30,
  scenes: [
    {
      id: 'scene-1',
      name: 'Bai coc',
      durationMs: 4200,
      background: 'river',
      objects: [
        {
          id: 'obj-hero', kind: 'character', label: 'Tran Hung Dao',
          x: 300, y: 470, width: 150, height: 260, scale: 1, rotation: 0,
          opacity: 1, color: '#e8b04f', accent: '#22201f', zIndex: 20,
          motion: 'slide-left',
        },
      ],
    },
  ],
  ...overrides,
});

describe('pure canvas exporter (no Remotion)', () => {
  it('prefers vp9, then vp8, then generic webm', () => {
    assert.equal(selectCanvasExportMimeType(() => true), 'video/webm;codecs=vp9,opus');
    assert.equal(
      selectCanvasExportMimeType((mime) => mime.includes('vp8')),
      'video/webm;codecs=vp8,opus',
    );
    assert.equal(selectCanvasExportMimeType(() => false), '');
  });

  it('counts frames deterministically from scene durations', () => {
    // 4200ms @30fps -> 126 frames.
    assert.equal(canvasProjectTotalFrames(project()), 126);
    assert.equal(canvasProjectTotalFrames(project({ fps: 60 })), 252);
  });

  it('rejects empty or undersized projects before recording', () => {
    assert.ok(validateCanvasExportProject(project({ scenes: [] })).length > 0);
    assert.ok(validateCanvasExportProject(project({ width: 100 })).length > 0);
    assert.deepEqual(validateCanvasExportProject(project()), []);
  });

  it('surfaces beat timing errors with the scene name', () => {
    const bad = project();
    bad.scenes[0]!.animationBeats = [
      { id: 'b1', atMs: 99999, durationMs: 500, action: 'talk', targetIds: ['obj-hero'] },
    ];
    const issues = validateCanvasExportProject(bad);
    assert.ok(issues.some((issue) => issue.includes('Bai coc')));
  });

  it('exports authored empty horror inserts while rejecting an unintentional empty scene',()=>{
    const insert=project();insert.scenes[0]!.objects=[];
    assert.ok(validateCanvasExportProject(insert).length>0);
    insert.scenes[0]!.backgroundRef='bg:room-floor-detail';
    assert.deepEqual(validateCanvasExportProject(insert),[]);
  });
});
