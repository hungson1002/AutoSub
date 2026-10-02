import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpriteAct, spriteFrameAt } from './spriteFrames';

const clip = { frameWidth: 344, frameHeight: 384, columns: 4, from: 0, to: 7, fps: 8 };

describe('sprite-frame playback (sprite-forge style)', () => {
  it('frame 0 tại t=0, tiến 1 frame mỗi 125ms ở 8fps', () => {
    assert.equal(spriteFrameAt(clip, 0).frame, 0);
    assert.equal(spriteFrameAt(clip, 124).frame, 0);
    assert.equal(spriteFrameAt(clip, 125).frame, 1);
    assert.equal(spriteFrameAt(clip, 250).frame, 2);
  });

  it('loop về 0 sau frame cuối', () => {
    assert.equal(spriteFrameAt(clip, 875).frame, 7);
    assert.equal(spriteFrameAt(clip, 1000).frame, 0);
  });

  it('column/row đúng lưới 4 cột', () => {
    assert.deepEqual(
      { c: spriteFrameAt(clip, 625).column, r: spriteFrameAt(clip, 625).row },
      { c: 1, r: 1 },
    );
  });

  it('kẹp fps và range invalid an toàn', () => {
    assert.equal(spriteFrameAt({ ...clip, fps: 99 }, 0).frame, 0);
    assert.equal(spriteFrameAt({ ...clip, from: 5, to: 2 }, 0).frame, 5);
  });

  it('clip loop:false giữ frame cuối thay vì quay vòng', () => {
    assert.equal(spriteFrameAt({ ...clip, loop: false }, 875).frame, 7);
    assert.equal(spriteFrameAt({ ...clip, loop: false }, 5000).frame, 7);
  });

  it('chỉ chọn đúng động tác; thiếu clip giữ ảnh pose thay vì phát talk', () => {
    const acts = [
      { action: 'talk', imageUrl: 'talk.png', ...clip },
      { action: 'point', imageUrl: 'point.png', ...clip },
    ];
    assert.equal(resolveSpriteAct(acts, 'point')?.imageUrl, 'point.png');
    assert.equal(resolveSpriteAct(acts, 'celebrate'), undefined);
    assert.equal(resolveSpriteAct(acts, undefined), undefined);
    assert.equal(resolveSpriteAct(undefined, 'talk'), undefined);
  });
});
