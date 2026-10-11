// Window-level defaults that make the WebView behave like native app chrome
// rather than a web page. Installed once per window from `main.tsx`.

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, [contenteditable]') !== null;
}

export function installNativeFeel() {
  // A native window has no "Reload / Inspect Element" menu. Keep it in dev
  // for debugging, and keep the system text menu for editable fields.
  if (import.meta.env.PROD) {
    document.addEventListener('contextmenu', (event) => {
      if (!isEditableTarget(event.target)) event.preventDefault();
    });
  }
}
