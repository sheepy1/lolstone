// 单选组（WAI-ARIA radio group）：主菜单和设置页共用。
import type { KeyboardEvent, ReactNode } from 'react';
import { playSfx } from '../audio';

const hover = () => playSfx('ui.hover');

export type RadioProps = {
  role: 'radio';
  'aria-checked': boolean;
  tabIndex: number;
  onClick: () => void;
  onPointerEnter: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
};

// 单选组：选中的那一项可以 Tab 到，方向键在组内移动并直接选中（WAI-ARIA radio group 的做法）。
export function RadioGroup<T extends string>({
  label,
  items,
  value,
  onChange,
  render,
}: {
  label: string;
  items: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (item: T, checked: boolean, props: RadioProps, index: number) => ReactNode;
}) {
  const move = (e: KeyboardEvent<HTMLElement>, from: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    let next: number | null = step === undefined ? null : (from + step + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(items[next]!);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="hx-radiogroup">
      {items.map((item, i) =>
        render(
          item,
          item === value,
          {
            role: 'radio',
            'aria-checked': item === value,
            tabIndex: item === value ? 0 : -1,
            onClick: () => onChange(item),
            onPointerEnter: hover,
            onKeyDown: (e) => move(e, i),
          },
          i,
        ),
      )}
    </div>
  );
}
