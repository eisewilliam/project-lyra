import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export function Segmented({
  value,
  options,
  onChange,
  wide = false,
}: Readonly<{
  value: string;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  onChange: (v: string) => MaybePromise<void>;
  /** Spans the slider column, for a row of named levels such as Lyric blur. */
  wide?: boolean;
}>) {
  const aria = useRowAria();
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div className={wide ? 'segmented is-wide' : 'segmented'} role="radiogroup" {...aria}>
      {selectedIndex >= 0 && (
        <span
          className="segmented-indicator"
          aria-hidden="true"
          style={{
            width: `calc((100% - 2 * var(--segment-inset)) / ${options.length})`,
            transform: `translateX(calc(${selectedIndex * 100}% * var(--segment-direction, 1)))`,
          }}
        />
      )}
      {options.map((opt, index) => {
        const isActive = index === selectedIndex;
        return (
          <button
            key={opt.value}
            type="button"
            className={`segmented-option ${isActive ? 'active' : ''}`}
            role="radio"
            aria-checked={isActive}
            tabIndex={index === Math.max(0, selectedIndex) ? 0 : -1}
            onClick={() => runSettingsAction(onChange(opt.value))}
            onKeyDown={(event) => {
              const group = event.currentTarget.parentElement;
              if (!group) return;
              const rtl = getComputedStyle(group).direction === 'rtl';
              let next: number;
              switch (event.key) {
                case 'ArrowLeft': next = index + (rtl ? 1 : -1); break;
                case 'ArrowRight': next = index + (rtl ? -1 : 1); break;
                case 'ArrowUp': next = index - 1; break;
                case 'ArrowDown': next = index + 1; break;
                case 'Home': next = 0; break;
                case 'End': next = options.length - 1; break;
                default: return;
              }
              event.preventDefault();
              const target = group.querySelectorAll('button').item((next + options.length) % options.length);
              target?.focus();
              if (target !== event.currentTarget) target?.click();
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
