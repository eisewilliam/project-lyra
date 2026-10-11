import { memo } from 'react';
import { runSettingsAction } from '@/utils/settings-action-runner';
import { useRowAria } from './row-context';

type MaybePromise<T> = T | Promise<T>;

export const Toggle = memo(
  function Toggle({ value, onChange }: Readonly<{ value: boolean; onChange: (v: boolean) => MaybePromise<void> }>) {
    const nativeSwitchProps = { switch: 'true' };
    const aria = useRowAria();
    return (
      <input
        {...nativeSwitchProps}
        {...aria}
        type="checkbox"
        checked={value}
        onChange={(e) => runSettingsAction(onChange(e.target.checked))}
      />
    );
  },
  (prevProps, nextProps) => prevProps.value === nextProps.value
);
