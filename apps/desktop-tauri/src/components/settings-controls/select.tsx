import { runSettingsAction } from '@/utils/settings-action-runner';

type MaybePromise<T> = T | Promise<T>;
type SelectOption = Readonly<{ value: string; label: string }>;

export function CustomSelect({
  value,
  options,
  onChange,
  label,
}: Readonly<{
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (v: string) => MaybePromise<void>;
  /** Accessible name when no visible label is associated. */
  label?: string | undefined;
}>) {
  return <NativeSelect value={value} options={options} onChange={onChange} label={label} />;
}

function NativeSelect({
  value,
  options,
  onChange,
  label,
}: Readonly<{
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (v: string) => MaybePromise<void>;
  label?: string | undefined;
}>) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => runSettingsAction(onChange(e.target.value))}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
