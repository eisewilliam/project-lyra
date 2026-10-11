import { useId, type ChangeEvent } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export function SnapSlider({
  steps,
  value,
  onChange,
  info,
}: Readonly<{
  steps: ReadonlyArray<Readonly<{ value: number; label: string }>>;
  value: number;
  onChange: (v: number) => MaybePromise<void>;
  info?: string;
}>) {
  const reactId = useId();
  const aria = useRowAria();
  const firstStep = steps[0];
  if (!firstStep) return null;

  const idx = steps.reduce(
    (best, s, i) => {
      const bestStep = steps[best] ?? firstStep;
      return Math.abs(s.value - value) < Math.abs(bestStep.value - value) ? i : best;
    },
    0
  );
  const listId = `snap-slider-${reactId.replaceAll(':', '')}`;
  const infoId = `${listId}-info`;
  // The info tooltip is hover-only, so also expose it as the description.
  const describedBy = [aria['aria-describedby'], info ? infoId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
  const snappedStep = steps[idx] ?? firstStep;
  const progress = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextStep = steps[Number(event.currentTarget.value)];
    if (nextStep) {
      runSettingsAction(onChange(nextStep.value));
    }
  };

  return (
    <span className="snap-slider-control">
      <span className="snap-slider-range-wrapper">
        <span className="snap-slider-range">
          <span className="snap-slider-track-container" aria-hidden="true">
            <span className="snap-slider-rail" />
            <span className="snap-slider-fill" style={{ width: `${progress}%` }} />
            <span className="snap-slider-ticks">
              {steps.map((s, i) => {
                const tickProgress = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0;
                return (
                  <span
                    key={`${s.value}-${s.label}`}
                    className={`snap-slider-tick${i === idx ? ' active' : ''}`}
                    style={{ left: `${tickProgress}%` }}
                  />
                );
              })}
            </span>
          </span>
          <input
            className="native-snap-slider"
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={idx}
            aria-labelledby={aria['aria-labelledby']}
            aria-describedby={describedBy}
            aria-valuetext={snappedStep?.label}
            title={snappedStep?.label}
            list={listId}
            onChange={handleInput}
          />
        </span>
        <span className="snap-slider-labels">
          {steps.map((s, i) => {
            const tickProgress = steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0;
            return (
              <span
                key={`${s.value}-${s.label}-label`}
                className={`snap-slider-label${i === idx ? ' active' : ''}`}
                style={{ left: `${tickProgress}%` }}
              >
                {s.label}
              </span>
            );
          })}
        </span>
      </span>

      {info && (
        <span className="snap-slider-info-wrapper">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <span id={infoId} className="snap-slider-tooltip">{info}</span>
        </span>
      )}

      <datalist id={listId}>
        {steps.map((s, i) => (
          <option key={s.value} value={i} label={s.label} />
        ))}
      </datalist>
    </span>
  );
}

