import { motion } from 'motion/react';
import { runSettingsAction } from '@/utils/settings-action-runner';

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
  return (
    <div className="segmented">
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`segmented-option ${isActive ? 'active' : ''}`}
            onClick={() => runSettingsAction(onChange(opt.value))}
          >
            {isActive && (
              <motion.div
                layoutId="settings-segmented-indicator"
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
