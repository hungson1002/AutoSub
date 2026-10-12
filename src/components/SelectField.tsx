import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from './Icons';
import { announceDropdownOpen, listenForOtherDropdowns, type DropdownId } from '../lib/dropdowns';

export type SelectOption = { value: string; label: string; description?: string; disabled?: boolean };

export function SelectField({ value, options, onChange, ariaLabel, disabled = false, className = '' }: { value: string; options: SelectOption[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean; className?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownId = useRef<DropdownId>({});
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 240, maxHeight: 280 });
  const selected = options.find((option) => option.value === value) || options[0];

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 10, gap = 6;
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const spaceAbove = Math.max(0, rect.top - margin - gap);
    const contentHeight = (menuRef.current?.scrollHeight ?? options.length * 52 + 10) + 2;
    const desiredHeight = Math.min(320, contentHeight);
    const opensAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, opensAbove ? spaceAbove : spaceBelow);
    const height = Math.min(maxHeight, contentHeight);
    const width = Math.min(rect.width, Math.max(0, window.innerWidth - margin * 2));
    setPosition({ top: opensAbove ? rect.top - gap - height : rect.bottom + gap, left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)), width, maxHeight });
  };

  useLayoutEffect(() => { if (open) updatePosition(); }, [open, options.length]);
  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, position.maxHeight]);
  useEffect(() => listenForOtherDropdowns(dropdownId.current, () => setOpen(false)), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!buttonRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const reposition = () => updatePosition();
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };
  const toggle = () => {
    if (open) setOpen(false);
    else { announceDropdownOpen(dropdownId.current); setOpen(true); }
  };
  const moveActive = (direction: number) => {
    if (!options.length) return;
    let next = activeIndex;
    do { next = (next + direction + options.length) % options.length; } while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
  };

  return <>
    <button ref={buttonRef} type="button" className={`select-field-trigger ${open ? 'open' : ''} ${className}`} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => { setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value))); toggle(); }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) { announceDropdownOpen(dropdownId.current); setOpen(true); } else moveActive(event.key === 'ArrowDown' ? 1 : -1); }
      if (event.key === 'Enter' || event.key === ' ') { if (open) { event.preventDefault(); choose(activeIndex); } }
      if (event.key === 'Escape') setOpen(false);
    }}>
      <span><strong>{selected?.label || 'Chọn'}</strong>{selected?.description && <small>{selected.description}</small>}</span><ChevronDown size={15} />
    </button>
    {open && createPortal(<div ref={menuRef} className="select-field-menu" role="listbox" aria-label={ariaLabel} style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} className={`${option.value === value ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`} key={option.value} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(index)}><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={14} />}</button>)}
    </div>, document.body)}
  </>;
}
