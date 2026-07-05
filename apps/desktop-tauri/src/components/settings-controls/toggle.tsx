import { memo } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';

type MaybePromise<T> = T | Promise<T>;

export const Toggle = memo(
  function Toggle({ value, onChange }: Readonly<{ value: boolean; onChange: (v: boolean) => MaybePromise<void> }>) {
    const nativeSwitchProps = { switch: 'true' };
    return (
      <input
        {...nativeSwitchProps}
        type="checkbox"
        checked={value}
        onChange={(e) => runSettingsAction(onChange(e.target.checked))}
      />
    );
  },
  (prevProps, nextProps) => prevProps.value === nextProps.value
);
