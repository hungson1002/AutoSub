import { useEffect, useState } from 'react';
import { defaultTransform } from '../../shared/animationStudio';
import type { SceneLayer } from '../../shared/animationStudio';
import { compileMotionRecipe, motionRecipes, type MotionRecipeId } from '../../shared/animationMotionRecipes';
import { evaluateTransform } from './evaluator';
import './MotionRecipePanel.css';

const sample: SceneLayer = { id: 'sample', type: 'shape', name: 'Mẫu', width: 90, height: 50, visible: true, locked: false, zIndex: 0, transform: { ...defaultTransform(), position: { x: 100, y: 55 } } };

export function MotionRecipePanel({ maxDurationMs, disabled, onApply }: { maxDurationMs: number; disabled: boolean; onApply: (id: MotionRecipeId, duration: number, strength: number) => void }) {
  const [selected, setSelected] = useState<MotionRecipeId>('fade');
  const [duration, setDuration] = useState(800);
  const [strength, setStrength] = useState(1);
  const [progress, setProgress] = useState(.5);
  const [playing, setPlaying] = useState(false);
  const [applied, setApplied] = useState(false);
  const effectiveDuration = Math.max(1, Math.min(maxDurationMs, duration));
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (document.hidden) { setPlaying(false); return; }
      const value = Math.min(1, (now - started) / effectiveDuration);
      setProgress(value);
      if (value < 1) frame = requestAnimationFrame(tick); else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, effectiveDuration]);
  const transform = evaluateTransform(sample.transform, compileMotionRecipe(sample, selected, effectiveDuration, strength), effectiveDuration * progress);
  return <fieldset className="motion-recipe-panel" disabled={disabled}>
    <legend>Mẫu chuyển động</legend>
    <div className="motion-recipe-options">{motionRecipes.map((recipe) => <button type="button" key={recipe.id} aria-pressed={selected === recipe.id} onClick={() => { setSelected(recipe.id); setApplied(false); setPlaying(false); setProgress(.5); }}>{recipe.name}</button>)}</div>
    <p>{motionRecipes.find((recipe) => recipe.id === selected)?.description}</p>
    <svg viewBox="0 0 200 110" role="img" aria-label="Xem thử chuyển động trên đối tượng mẫu"><rect x="1" y="1" width="198" height="108" rx="6" fill="#111820" /><g opacity={transform.opacity} transform={`translate(${transform.position.x} ${transform.position.y}) scale(${transform.scale.x} ${transform.scale.y})`}><rect x="-45" y="-25" width="90" height="50" rx="6" fill="#ff873d" /><text textAnchor="middle" y="5" fill="#111820" fontSize="14">AutoSub</text></g></svg>
    <button type="button" onClick={() => { setProgress(0); setPlaying(true); }} disabled={disabled || playing}>Xem chuyển động</button>
    <label><span>Xem theo thời gian</span><input aria-label="Tiến trình mẫu" type="range" min="0" max="1" step=".01" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }} /></label>
    <label><span>Thời lượng (ms)</span><input type="number" min="1" max={maxDurationMs} value={effectiveDuration} onChange={(event) => { setDuration(Math.max(1, Number(event.target.value) || 1)); setApplied(false); }} /></label>
    <label><span>Cường độ · {strength.toFixed(2)}×</span><input type="range" min=".25" max="2" step=".05" value={strength} onChange={(event) => { setStrength(Number(event.target.value)); setApplied(false); }} /></label>
    <p>Áp dụng từ đầu cảnh, thay các lệnh cùng loại trên layer đang chọn. Có thể kéo và chỉnh tiếp trên timeline.</p>
    <button type="button" onClick={() => { onApply(selected, effectiveDuration, strength); setApplied(true); }}>Áp dụng vào layer</button>
    <span role="status">{disabled ? 'Mở khóa layer để áp dụng.' : applied ? 'Đã áp dụng. Phát cảnh để xem trên canvas.' : ''}</span>
  </fieldset>;
}
