type MaybePromise<T> = T | Promise<T>;
type SettingsActionErrorListener = (message: string | null) => void;

const errorListeners = new Set<SettingsActionErrorListener>();

function notifyActionError(message: string | null) {
  for (const listener of errorListeners) {
    listener(message);
  }
}

export function subscribeSettingsActionError(listener: SettingsActionErrorListener) {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

export function reportSettingsActionError(error: unknown) {
  console.error('Settings action failed', error);
  notifyActionError("Couldn't save that change. Try again.");
}

export function runSettingsAction(action: MaybePromise<void>) {
  void Promise.resolve(action)
    .then(() => {
      notifyActionError(null);
    })
    .catch(reportSettingsActionError);
}
