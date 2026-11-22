export function VocalCountdown({ seconds }: Readonly<{ seconds: number }>) {
  return (
    <span
      className="vocal-countdown"
      role="img"
      aria-label={`Vocals start in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
    >
      {[3, 2, 1].map((dot) => <span key={dot} aria-hidden="true" data-lit={seconds >= dot} />)}
    </span>
  );
}
