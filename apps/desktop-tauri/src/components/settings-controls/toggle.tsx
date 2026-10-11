import { memo } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria, useRowDisabled } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export const Toggle = memo(
  function Toggle({ value, onChange }: Readonly<{ value: boolean; onChange: (v: boolean) => MaybePromise<void> }>) {
    const nativeSwitchProps = { switch: 'true' };
    const aria = useRowAria();
    const disabled = useRowDisabled();
    return (
      <input
        {...nativeSwitchProps}
        {...aria}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => runSettingsAction(onChange(e.target.checked))}
      />
    );
  },
  (prevProps, nextProps) => prevProps.value === nextProps.value
);
