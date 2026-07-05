import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const updateIndicator = () => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector<HTMLButtonElement>('.segmented-option.active');
    if (!activeBtn) return;
    const containerRect = container.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  };

  useLayoutEffect(() => {
    updateIndicator();
  }, [value, options]);

  useEffect(() => {
    globalThis.addEventListener('resize', updateIndicator);
    return () => globalThis.removeEventListener('resize', updateIndicator);
  }, []);

  return (
    <div className="segmented" ref={containerRef}>
      {indicator && (
        <div
          className="segmented-indicator"
          style={{
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
          }}
        />
      )}
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => runSettingsAction(onChange(opt.value))}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
