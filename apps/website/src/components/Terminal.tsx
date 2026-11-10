import { useEffect, useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';

// Commands in a terminal window. With `copy`, a button copies them all.
export function Terminal({ lines, copy = false }: { lines: readonly string[]; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copyLines = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return <div className="terminal">
    <div className="terminal-bar">
      <span>Terminal</span>
      {copy && <button type="button" className="terminal-copy" onClick={copyLines}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}<span>{copied ? 'Copied' : 'Copy'}</span>
      </button>}
    </div>
    <pre><code>{lines.join('\n')}</code></pre>
    {copy && <p className="visually-hidden" aria-live="polite">{copied ? 'Commands copied' : ''}</p>}
  </div>;
}
