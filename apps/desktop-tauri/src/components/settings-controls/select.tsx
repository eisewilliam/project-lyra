import { runSettingsAction } from '@/utils/settings-action-runner';

type MaybePromise<T> = T | Promise<T>;
type SelectOption = Readonly<{ value: string; label: string }>;

export function CustomSelect({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (v: string) => MaybePromise<void>;
}>) {
  return <NativeSelect value={value} options={options} onChange={onChange} />;
}

function NativeSelect({
  value,
  options,
  onChange,
}: Readonly<{
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (v: string) => MaybePromise<void>;
}>) {
  return (
    <select
      value={value}
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
