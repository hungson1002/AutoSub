import assert from 'node:assert/strict';
import test from 'node:test';
import { centeredCropForAspect, cropVideoStyle, normalizeCropRegion } from './videoCrop';

test('video crop creates a centered portrait crop from a landscape source', () => {
  const crop = centeredCropForAspect('9:16', 1920, 1080);
  assert.equal(crop.yPercent, 0);
  assert.equal(crop.heightPercent, 100);
  assert.ok(Math.abs(crop.widthPercent - 31.640625) < 0.00001);
  assert.ok(Math.abs(crop.xPercent - 34.1796875) < 0.00001);
});

test('video crop keeps values inside the source frame', () => {
  assert.deepEqual(normalizeCropRegion({ xPercent: 95, yPercent: -2, widthPercent: 40, heightPercent: 130 }), {
    xPercent: 95,
    yPercent: 0,
    widthPercent: 5,
    heightPercent: 100,
  });
});

test('video crop maps percentages to a filling preview transform', () => {
  assert.deepEqual(cropVideoStyle({ xPercent: 25, yPercent: 0, widthPercent: 50, heightPercent: 100 }), {
    position: 'absolute',
    left: '-50%',
    top: '0%',
    width: '200%',
    height: '100%',
    maxWidth: 'none',
    maxHeight: 'none',
    objectFit: 'fill',
  });
});
