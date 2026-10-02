import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCast, compileFilm, estimateSpeechMs, parseFilmScript } from './canvasScriptFilm';

const SCRIPT = `CẢNH 1 - Bãi cọc | nền: bãi cọc
Tướng: Năm 1288, trên sông Bạch Đằng, quân ta đóng cọc chờ giặc.
Lính: [chỉ] Thưa tướng, cọc đã đóng xong dưới lòng sông!
[ảnh: Cọc Bạch Đằng 1288]

CẢNH 2 - Chờ triều
Tướng: Giờ ta chờ thủy triều rút.`;

describe('script-to-film', () => {
  it('parse cảnh + thoại + hành động + ảnh', () => {
    const scenes = parseFilmScript(SCRIPT);
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0]!.title, 'Bãi cọc');
    assert.equal(scenes[0]!.lines.length, 2);
    assert.equal(scenes[0]!.lines[1]!.action, 'point');
    assert.equal(scenes[0]!.lines[1]!.photo, 'Cọc Bạch Đằng 1288');
  });

  it('cast ổn định + beat đúng người đúng việc', () => {
    const scenes = parseFilmScript(SCRIPT);
    const cast = buildCast(scenes);
    assert.deepEqual(cast.map((c) => c.name), ['Tướng', 'Lính']);
    const film = compileFilm(scenes, cast);
    assert.equal(film.scenes.length, 2);
    const s1 = film.scenes[0]!;
    assert.ok(s1.durationMs > 5000);
    assert.ok(s1.animationBeats?.filter(beat=>beat.action==='point'||beat.action==='talk').every(beat=>beat.speechCue&&beat.dialogueId));
    assert.ok(s1.objects.filter(object=>object.kind==='character').every(object=>object.pose==='idle'));
    const ids = s1.objects.map((o) => o.id);
    assert.ok(ids.includes('cast-tung') || ids.includes('cast-tuong'));
    assert.ok(ids.includes('cast-linh'));
    const pointBeat = s1.animationBeats!.find((b) => b.action === 'point');
    assert.deepEqual(pointBeat?.targetIds, ['cast-linh']);
    assert.equal(s1.dialogue?.[0]?.speaker,'Tướng');
    assert.equal(s1.dialogue?.[1]?.characterKey,s1.objects.find(object=>object.id==='cast-linh')?.characterKey);
    assert.ok(!s1.dialogue?.[0]?.text.startsWith('Tướng:'));
    const title = s1.objects.find((o) => o.kind === 'text');
    assert.equal(title?.text, 'Bãi cọc');
  });

  it('ước lượng thoại hợp lý', () => {
    assert.ok(estimateSpeechMs('Chào.') >= 1200);
    assert.ok(estimateSpeechMs('Năm 1288, trên sông Bạch Đằng, quân ta đóng cọc chờ giặc.') > 3000);
  });
});
