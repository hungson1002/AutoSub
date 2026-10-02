import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasObject, createCanvasProject } from '../../shared/canvasAnimationStudio';
import { densifyAnimationBeats } from './canvasBeatDensifier';

describe('semantic beat completion', () => {
  it('does not fabricate gestures around a phrase-directed action',()=>{
    const project=createCanvasProject(),scene=project.scenes[0]!;
    scene.durationMs=6000;scene.objects=[createCanvasObject('character',{pose:'point'})];
    scene.animationBeats=[{id:'point',action:'point',atMs:500,durationMs:1000,targetIds:[scene.objects[0]!.id],speechCue:'chiếc đèn'}];
    assert.deepEqual(densifyAnimationBeats(project),project);
  });
  it('fills gaps with the requested action without changing expression', () => {
    const project = createCanvasProject();
    const actor = createCanvasObject('character', { pose: 'brace', expression: 'sad' });
    project.scenes[0].durationMs = 4200;
    project.scenes[0].objects = [actor];
    project.scenes[0].animationBeats = [];
    const result = densifyAnimationBeats(project);
    const beats = result.scenes[0].animationBeats!;
    assert.equal(beats.length, 3);
    assert.ok(beats.every((beat) => beat.action === 'brace' && beat.targetIds[0] === actor.id));
    assert.ok(beats.every((beat) => beat.atMs >= 0 && beat.atMs + beat.durationMs <= 4200));
    assert.equal(result.scenes[0].objects[0].expression, 'sad');
    assert.deepEqual(densifyAnimationBeats(result), result);
    assert.deepEqual(project.scenes[0].animationBeats, []);
  });

  it('does not fabricate surprise, floating or celebration for idle subjects', () => {
    const project = createCanvasProject();
    project.scenes[0].objects = [createCanvasObject('character', { pose: 'idle', motion: 'none' })];
    assert.equal(densifyAnimationBeats(project), project);
  });

  it('preserves overlapping authored beats and inserts only into real gaps', () => {
    const project = createCanvasProject();
    const actor = createCanvasObject('character', { pose: 'point' });
    project.scenes[0].objects = [actor];
    project.scenes[0].durationMs = 6000;
    const authored = [
      { id: 'a', atMs: 0, durationMs: 2400, action: 'point' as const, targetIds: [actor.id] },
      { id: 'b', atMs: 500, durationMs: 600, action: 'talk' as const, targetIds: [actor.id] },
    ];
    project.scenes[0].animationBeats = authored;
    const result = densifyAnimationBeats(project);
    for (const beat of authored) assert.deepEqual(result.scenes[0].animationBeats!.find((item) => item.id === beat.id), beat);
    assert.ok(result.scenes[0].animationBeats!.filter((beat) => beat.id.startsWith('beat-auto')).every((beat) => beat.atMs >= 2400));
  });
});
