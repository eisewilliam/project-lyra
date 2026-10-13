import { useId, type ChangeEvent } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';
import { nearestStepIndex } from './steps';

type MaybePromise<T> = T | Promise<T>;

export function SnapSlider({
  steps,
  value,
  onChange,
}: Readonly<{
  /** `caption` is a friendlier name shown under the value, e.g. 16 px over Medium. */
  steps: ReadonlyArray<Readonly<{ value: number; label: string; caption?: string }>>;
  value: number;
  onChange: (v: number) => MaybePromise<void>;
}>) {
  const reactId = useId();
  const aria = useRowAria();
  const firstStep = steps[0];
  if (!firstStep) return null;

  const idx = nearestStepIndex(steps, value);
  const listId = `snap-slider-${reactId.replaceAll(':', '')}`;
  const snappedStep = steps[idx] ?? firstStep;
  const progress = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;
  const valueText = snappedStep.caption ? `${snappedStep.label}, ${snappedStep.caption}` : snappedStep.label;

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextStep = steps[Number(event.currentTarget.value)];
    if (nextStep) {
      runSettingsAction(onChange(nextStep.value));
    }
  };

  return (
    <span className="snap-slider-control">
      <span className="snap-slider-range">
        {/* Rail and stops are inset by half the thumb, so each stop sits
            under the thumb's centre; stops follow the step index. */}
        <span className="snap-slider-track-container" aria-hidden="true">
          <span className="snap-slider-rail" />
          <span className="snap-slider-fill" style={{ width: `${progress}%` }} />
          <span className="snap-slider-ticks">
            {steps.map((s, i) => (
              <span
                key={`${s.value}-${s.label}`}
                className="snap-slider-tick"
                style={{ left: `${steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0}%` }}
              />
            ))}
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
          aria-valuetext={valueText}
          title={valueText}
          list={listId}
          onChange={handleInput}
        />
      </span>

      {/* One value label instead of a label under every stop. */}
      <span className="snap-slider-value" aria-hidden="true">
        {snappedStep.label}
        {snappedStep.caption && <span className="snap-slider-caption">{snappedStep.caption}</span>}
      </span>

      <datalist id={listId}>
        {steps.map((s, i) => (
          <option key={s.value} value={i} label={s.label} />
        ))}
      </datalist>
    </span>
  );
}
