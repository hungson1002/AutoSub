import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { AnimationAsset, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { evaluateScene } from './evaluator';

interface Props {
  scene: CompositeScene;
  assets: AnimationAsset[];
  width: number;
  height: number;
  timeMs: number;
  selectedLayerId?: string;
  onSelect: (id?: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  exporting?: boolean;
  showSubtitles?: boolean;
}

type Viewport = { scale: number; left: number; top: number };

function viewport(canvas: HTMLCanvasElement, width: number, height: number, inset = 0.9): Viewport {
  const scale = Math.min(canvas.clientWidth / width, canvas.clientHeight / height) * inset;
  return { scale, left: (canvas.clientWidth - width * scale) / 2, top: (canvas.clientHeight - height * scale) / 2 };
}

function contains(layer: SceneLayer, x: number, y: number) {
  const { position, scale, anchor } = layer.transform;
  const left = position.x - layer.width * scale.x * anchor.x;
  const top = position.y - layer.height * scale.y * anchor.y;
  return x >= left && x <= left + layer.width * scale.x && y >= top && y <= top + layer.height * scale.y;
}

const imageCache = new Map<string, HTMLImageElement>();

export function AnimationCanvas({ scene, assets, width, height, timeMs, selectedLayerId, onSelect, onMove, onCanvasReady, exporting = false, showSubtitles = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | undefined>(undefined);
  const currentRef = useRef(evaluateScene(scene, timeMs));
  currentRef.current = evaluateScene(scene, timeMs);

  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = exporting ? 1 : window.devicePixelRatio || 1;
    const resize = () => {
      const targetWidth = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const targetHeight = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      const view = viewport(canvas, width, height, exporting ? 1 : 0.9);
      context.fillStyle = '#090d13';
      context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      context.save();
      context.translate(view.left, view.top);
      context.scale(view.scale, view.scale);
      context.fillStyle = scene.backgroundColor;
      context.fillRect(0, 0, width, height);
      const evaluated = evaluateScene(scene, timeMs);
      context.translate(width / 2 + evaluated.camera.position.x, height / 2 + evaluated.camera.position.y);
      context.scale(evaluated.camera.scale.x, evaluated.camera.scale.y);
      context.rotate(evaluated.camera.rotation * Math.PI / 180);
      context.translate(-width / 2, -height / 2);
      for (const layer of evaluated.layers) {
        if (layer.type === 'audio') continue;
        if (!showSubtitles && layer.name.startsWith('Voiceover · Subtitle')) continue;
        const { position, scale, anchor } = layer.transform;
        const lookCommand = scene.commands.filter((command) => command.targetId === layer.id && command.type === 'LOOK_AT' && command.startMs <= timeMs && timeMs <= command.startMs + command.durationMs).sort((a, b) => b.startMs - a.startMs)[0];
        const lookTarget = lookCommand?.target ? evaluated.layers.find((candidate) => candidate.id === lookCommand.target) : undefined; const facing = lookTarget && lookTarget.transform.position.x < position.x ? -1 : 1;
        context.save();
        context.globalAlpha = layer.transform.opacity;
        context.translate(position.x, position.y);
        context.rotate(layer.transform.rotation * Math.PI / 180);
        context.scale(scale.x * facing, scale.y);
        context.translate(-layer.width * (facing < 0 ? 1 - anchor.x : anchor.x), -layer.height * anchor.y);
        if (layer.type === 'image' && layer.assetId) {
          const asset = assets.find((item) => item.id === layer.assetId);
          const image = asset ? imageCache.get(asset.uri) : undefined;
          if (image?.complete) context.drawImage(image, 0, 0, layer.width, layer.height);
          else {
            context.fillStyle = '#1d2834'; context.fillRect(0, 0, layer.width, layer.height);
            if (asset && !image) { const loading = new Image(); loading.onload = resize; loading.src = asset.uri; imageCache.set(asset.uri, loading); }
          }
        } else if (layer.type === 'sprite' && layer.assetId) {
          const asset = assets.find((item) => item.id === layer.assetId); const image = asset ? imageCache.get(asset.uri) : undefined;
          if (image?.complete && asset?.sprite) {
            const animationCommand = scene.commands.filter((command) => command.targetId === layer.id && ['PLAY_ANIMATION', 'TALK', 'POINT', 'LOOK_AT', 'LOOK_LEFT', 'LOOK_RIGHT', 'SIT', 'SLEEP'].includes(command.type) && command.startMs <= timeMs && timeMs <= command.startMs + command.durationMs).sort((a, b) => b.startMs - a.startMs)[0];
            const semanticClip = animationCommand?.type === 'TALK' ? 'talk' : animationCommand?.type === 'POINT' ? 'point' : animationCommand?.type === 'SIT' ? 'sit' : animationCommand?.type === 'SLEEP' ? 'sleep' : animationCommand?.type === 'LOOK_LEFT' ? 'look-left' : animationCommand?.type === 'LOOK_RIGHT' ? 'look-right' : undefined;
            const clipName = animationCommand?.animation || (semanticClip && asset.sprite.clips[semanticClip] ? semanticClip : undefined) || layer.animation || Object.keys(asset.sprite.clips)[0]; const clip = clipName ? asset.sprite.clips[clipName] : undefined;
            if (!clip) { context.drawImage(image, 0, 0, layer.width, layer.height); context.restore(); continue; }
            const elapsed = Math.max(0, timeMs - (animationCommand?.startMs || 0)); const length = Math.max(1, clip.to - clip.from + 1); const offset = Math.floor(elapsed / 1000 * clip.fps); const frame = clip.loop === false ? Math.min(clip.to, clip.from + offset) : clip.from + offset % length; const sx = frame % asset.sprite.columns * asset.sprite.frameWidth; const sy = Math.floor(frame / asset.sprite.columns) * asset.sprite.frameHeight;
            context.drawImage(image, sx, sy, asset.sprite.frameWidth, asset.sprite.frameHeight, 0, 0, layer.width, layer.height);
          } else if (asset && !image) { const loading = new Image(); loading.onload = resize; loading.src = asset.uri; imageCache.set(asset.uri, loading); }
        } else if (layer.type === 'text') {
          context.fillStyle = layer.fill || '#ffffff';
          context.font = `700 ${layer.fontSize || 54}px Inter, sans-serif`;
          context.textBaseline = 'middle';
          context.shadowColor = 'rgba(0, 0, 0, 0.55)';
          context.shadowBlur = 18;
          if (layer.wordTimings?.length) {
            context.textAlign = 'left'; const gap = context.measureText(' ').width; let x = 0; let y = Math.max(layer.fontSize || 54, layer.height * .3); const lineHeight = (layer.fontSize || 54) * 1.18;
            for (const timing of layer.wordTimings) { const measured = context.measureText(timing.word).width; if (x + measured > layer.width) { x = 0; y += lineHeight; } context.fillStyle = timeMs >= timing.startMs && timeMs < timing.endMs ? '#ff9a58' : layer.fill || '#ffffff'; context.fillText(timing.word, x, y); x += measured + gap; } context.textAlign = 'start'; context.shadowBlur = 0;
          } else {
          const lines = (layer.text || layer.name).split('\n');
          const lineHeight = (layer.fontSize || 54) * 1.06;
          const firstLineY = layer.height / 2 - (lines.length - 1) * lineHeight / 2;
          lines.forEach((line, index) => context.fillText(line, 0, firstLineY + index * lineHeight, layer.width));
          context.shadowBlur = 0;
          }
        } else if (layer.type === 'chart') {
          const values = layer.data?.length ? layer.data : [24, 52, 78]; const max = Math.max(1, ...values); const gap = layer.width * .04; const barWidth = (layer.width - gap * (values.length + 1)) / values.length;
          context.fillStyle = 'rgba(9,17,27,.72)'; context.fillRect(0, 0, layer.width, layer.height); context.font = `${Math.max(18, layer.fontSize || 24)}px Inter, sans-serif`; context.textAlign = 'center';
          values.forEach((value, index) => { const barHeight = Math.max(2, value / max * layer.height * .72); const x = gap + index * (barWidth + gap); const gradient = context.createLinearGradient(0, layer.height - barHeight, 0, layer.height); gradient.addColorStop(0, layer.fill || '#ff8a45'); gradient.addColorStop(1, '#7655d8'); context.fillStyle = gradient; context.fillRect(x, layer.height - barHeight - 32, barWidth, barHeight); context.fillStyle = '#dfe9f3'; context.fillText(layer.labels?.[index] || String(value), x + barWidth / 2, layer.height - 12, barWidth + gap); }); context.textAlign = 'start';
        } else if (layer.type === 'diagram') {
          context.strokeStyle = layer.fill || '#ff8a45'; context.fillStyle = layer.fill || '#ff8a45'; context.lineWidth = Math.max(8, layer.height * .12); context.lineCap = 'round'; context.beginPath(); context.moveTo(layer.width * .08, layer.height / 2); context.lineTo(layer.width * .82, layer.height / 2); context.stroke(); context.beginPath(); context.moveTo(layer.width * .82, layer.height * .2); context.lineTo(layer.width * .96, layer.height / 2); context.lineTo(layer.width * .82, layer.height * .8); context.closePath(); context.fill();
        } else if (layer.type === 'particle') {
          context.fillStyle = layer.fill || '#ffffff'; for (let index = 0; index < 28; index += 1) { const x = (index * 73 % 101) / 100 * layer.width; const y = ((index * 47 + Math.floor(timeMs / 40)) % 101) / 100 * layer.height; const radius = 2 + index % 5; context.globalAlpha = layer.transform.opacity * (.3 + index % 7 / 10); context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill(); } context.globalAlpha = layer.transform.opacity;
        } else {
          context.fillStyle = layer.fill || '#6f7f91';
          if (layer.shape === 'ellipse') {
            context.beginPath();
            context.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
            context.fill();
          } else context.fillRect(0, 0, layer.width, layer.height);
        }
        if (layer.id === selectedLayerId) {
          context.globalAlpha = 1;
          context.strokeStyle = '#ff8a45';
          context.lineWidth = 3 / Math.max(0.1, scale.x);
          context.setLineDash([12, 7]);
          context.strokeRect(-6, -6, layer.width + 12, layer.height + 12);
          context.setLineDash([]);
        }
        context.restore();
      }
      context.restore();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [assets, exporting, scene, selectedLayerId, showSubtitles, timeMs, width, height]);

  const projectPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const view = viewport(canvas, width, height);
    return { x: (event.clientX - rect.left - view.left) / view.scale, y: (event.clientY - rect.top - view.top) / view.scale };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = projectPoint(event);
    const hit = [...currentRef.current.layers].reverse().find((layer) => (showSubtitles || !layer.name.startsWith('Voiceover · Subtitle')) && contains(layer, point.x, point.y));
    onSelect(hit?.id);
    if (hit && !hit.locked) {
      dragRef.current = { id: hit.id, dx: point.x - hit.transform.position.x, dy: point.y - hit.transform.position.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = projectPoint(event);
    onMove(drag.id, Math.round(point.x - drag.dx), Math.round(point.y - drag.dy));
  };

  return <canvas ref={canvasRef} className={`animation-canvas${exporting ? ' exporting' : ''}`} style={exporting ? { width, height } : undefined} tabIndex={0} aria-label="Khung xem trước scene. Có thể kéo layer đang chọn." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragRef.current = undefined; }} onPointerCancel={() => { dragRef.current = undefined; }} />;
}
