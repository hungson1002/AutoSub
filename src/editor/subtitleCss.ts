import type { CSSProperties } from 'react';
import type { SubtitleStyle } from '../types';

export function subtitleTextCss(style: SubtitleStyle, scale: number, minimumFontSize = 10): CSSProperties {
  const outlineWidth = style.background === 'outline' ? Math.max(0, (style.outlineWidth ?? 2) * scale) : 0;
  const boxColor = style.backgroundColor ?? style.outlineColor;
  const boxOpacity = style.backgroundOpacity ?? 0.72;
  const borderWidth = Math.max(0, style.boxBorderWidth ?? 0) * scale;
  const borderRadius = Math.max(0, style.boxBorderRadius ?? 0) * scale;
  return {
    fontFamily: `"${style.fontFamily.replace(/"/g, '')}", sans-serif`,
    fontSize: `${Math.max(style.fontSize * scale, minimumFontSize)}px`,
    color: style.textColor,
    fontWeight: style.bold === true ? 700 : 400,
    fontStyle: style.italic === true ? 'italic' : 'normal',
    WebkitTextFillColor: style.textColor,
    WebkitTextStroke: outlineWidth > 0 ? `${Math.max(0.45, outlineWidth)}px ${style.outlineColor}` : '0 transparent',
    textShadow: 'none',
    paintOrder: 'stroke fill',
    lineHeight: 1.18,
    boxSizing: 'border-box',
    background: style.background === 'box'
      ? `${boxColor}${Math.round(boxOpacity * 255).toString(16).padStart(2, '0')}`
      : 'transparent',
    padding: style.background === 'box'
      ? `${Math.max(0, style.boxPaddingY ?? 4) * scale}px ${Math.max(0, style.boxPaddingX ?? 10) * scale}px`
      : '0',
    border: style.background === 'box' && borderWidth > 0
      ? `${borderWidth}px solid ${style.boxBorderColor ?? '#ffffff'}`
      : '0 solid transparent',
    borderRadius: style.background === 'box' ? `${borderRadius}px` : '0',
  };
}
