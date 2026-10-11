import { useId } from 'react';
import { motion } from 'motion/react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export function Segmented({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  onChange: (v: string) => MaybePromise<void>;
}>) {
  const layoutId = useId();
  const aria = useRowAria();

  return (
    <div className="segmented" role="group" {...aria}>
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
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
