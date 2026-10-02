import type { SubtitleStyle } from '../types';

/** The position marks the near edge of a subtitle block, not its changing center.
 * Free screen text retains its existing center placement. */
export function subtitleAnchor(style: SubtitleStyle, x: number, y: number, freeText = false) {
  const horizontal = x <= 1 ? 0 : x >= 99 ? 1 : .5;
  const vertical = freeText
    ? y <= 1 ? 0 : y >= 99 ? 1 : .5
    : style.position === 'top' ? 0
      : style.position === 'bottom' ? 1
        : style.position === 'middle' ? .5
          : y <= 33 ? 0 : y >= 66 ? 1 : .5;
  return { horizontal, vertical };
}

export function subtitleAnchorTransform(style: SubtitleStyle, x: number, y: number, freeText = false) {
  const anchor = subtitleAnchor(style, x, y, freeText);
  return `translate(${-anchor.horizontal * 100}%, ${-anchor.vertical * 100}%)`;
}
