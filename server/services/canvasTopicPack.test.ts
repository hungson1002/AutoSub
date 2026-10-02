import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasProject } from '../../shared/canvasAnimationStudio';
import { assignRealImagesToProject } from './canvasTopicPack';

describe('canvasTopicPack gán ảnh thật theo chủ đề', () => {
  it('gán object image trống trước, nền sau, kèm credit mẫu', () => {
    const project = createCanvasProject();
    const sceneId = project.scenes[0].id;
    project.scenes[0].objects.push({
      id: 'img-1',
      kind: 'image',
      label: 'Ảnh tư liệu',
      x: 640, y: 360, width: 560, height: 360, scale: 1, rotation: 0, opacity: 1,
      color: '#fff', accent: '#000', zIndex: 15, motion: 'pop',
    } as any);
    project.scenes[0].backgroundImageUrl = undefined;
    const pack = new Map([[
      sceneId,
      [
        {
          id: 'real-1', title: 'Bach Dang stakes', pageUrl: 'https://commons.wikimedia.org/wiki/File:X',
          imageUrl: 'https://upload.wikimedia.org/x.jpg', width: 2000, height: 1200,
          author: 'Binh Giang', license: 'PD' as const,
          credit: 'Ảnh: Binh Giang • Wikimedia • Public domain', cacheKey: 'a',
        },
        {
          id: 'real-2', title: 'Ban do tran Bach Dang', pageUrl: 'https://commons.wikimedia.org/wiki/File:Y',
          imageUrl: 'https://upload.wikimedia.org/y.jpg', width: 1800, height: 1200,
          author: 'Luu Ly', license: 'CC-BY' as const,
          credit: 'Ảnh: Luu Ly • Wikimedia • CC-BY', cacheKey: 'b',
        },
      ],
    ]]);
    const out = assignRealImagesToProject(project, pack);
    const img = out.scenes[0].objects.find((o) => o.id === 'img-1');
    assert.equal(img?.imageUrl, 'https://upload.wikimedia.org/x.jpg');
    assert.match(String(img?.credit), /Binh Giang/);
    assert.match(String(out.scenes[0].backgroundCredit), /Luu Ly/);
    assert.match(String(out.scenes[0].backgroundImageUrl), /y\.jpg/);
  });
});
