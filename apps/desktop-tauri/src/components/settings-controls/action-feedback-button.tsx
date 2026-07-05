import { useEffect, useRef, useState } from 'react';
import { reportSettingsActionError } from '@/utils/settings-action-runner';

export function ActionFeedbackButton({
  label,
  pendingLabel = 'Working...',
  feedbackLabel,
  failureLabel = 'Failed',
  onClick,
}: Readonly<{
  label: string;
  pendingLabel?: string;
  feedbackLabel: string;
  failureLabel?: string;
  onClick: () => Promise<void>;
}>) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'failure'>('idle');
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleClick = async () => {
    if (status === 'pending') return;
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setStatus('pending');
    try {
      await onClick();
      setStatus('success');
    } catch (error) {
      reportSettingsActionError(error);
      setStatus('failure');
    }

    resetTimerRef.current = window.setTimeout(() => {
      setStatus('idle');
      resetTimerRef.current = null;
    }, 2000);
  };

  const text =
    status === 'pending'
      ? pendingLabel
      : status === 'success'
        ? feedbackLabel
        : status === 'failure'
          ? failureLabel
          : label;

  return (
    <button className="action-btn" type="button" onClick={handleClick} disabled={status === 'pending'} aria-live="polite">
      {text}
    </button>
  );
}
