import type { CSSProperties, InputHTMLAttributes } from 'react';

type RangeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

function numberValue(value: string | number | readonly string[] | undefined, fallback: number) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function RangeInput({ value, min, max, style, ...props }: RangeInputProps) {
  const minValue = numberValue(min, 0);
  const maxValue = numberValue(max, 100);
  const currentValue = numberValue(value, minValue);
  const progress = maxValue > minValue ? Math.max(0, Math.min(100, ((currentValue - minValue) / (maxValue - minValue)) * 100)) : 0;
  const rangeStyle = { ...style, '--range-progress': `${progress}%` } as CSSProperties;

  return <input {...props} type="range" min={min} max={max} value={value} style={rangeStyle} />;
}
