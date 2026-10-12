import { useId, type ChangeEvent } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export function SnapSlider({
  steps,
  value,
  onChange,
}: Readonly<{
  steps: ReadonlyArray<Readonly<{ value: number; label: string }>>;
  value: number;
  onChange: (v: number) => MaybePromise<void>;
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
                // Stops the fill has reached light up; the thumb covers its own.
                const state = i === idx ? ' active' : i < idx ? ' is-filled' : '';
                return (
                  <span
                    key={`${s.value}-${s.label}`}
                    className={`snap-slider-tick${state}`}
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
            aria-describedby={aria['aria-describedby']}
            aria-valuetext={snappedStep?.label}
            title={snappedStep?.label}
            list={listId}
            onChange={handleInput}
          />
        </span>
      </span>

      {/* One value label instead of a label under every stop. */}
      <span className="snap-slider-value" aria-hidden="true">{snappedStep.label}</span>

      <datalist id={listId}>
        {steps.map((s, i) => (
          <option key={s.value} value={i} label={s.label} />
        ))}
      </datalist>
    </span>
  );
}

