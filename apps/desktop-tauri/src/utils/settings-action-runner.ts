type MaybePromise<T> = T | Promise<T>;

export function reportSettingsActionError(error: unknown) {
  console.error('Settings action failed', error);
}

export function runSettingsAction(action: MaybePromise<void>) {
  void Promise.resolve(action).catch(reportSettingsActionError);
}
