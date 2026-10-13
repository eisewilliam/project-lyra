import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

const INDICATOR_SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

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
  const layoutId = useId();
  const aria = useRowAria();
  const reduceMotion = useReducedMotion();

  return (
    <div className={wide ? 'segmented is-wide' : 'segmented'} role="group" {...aria}>
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`segmented-option ${isActive ? 'active' : ''}`}
            aria-pressed={isActive}
            onClick={() => runSettingsAction(onChange(opt.value))}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="segmented-indicator"
                transition={reduceMotion ? { duration: 0 } : INDICATOR_SPRING}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
