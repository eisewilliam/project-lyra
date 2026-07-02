export type HostOs = 'windows' | 'macos' | 'linux';

export function detectHostOs(): HostOs {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (platform.includes('linux') || userAgent.includes('linux') || userAgent.includes('x11')) {
    return 'linux';
  }
  return 'macos';
}

export function applyHostOsDataset() {
  document.body.dataset.os = detectHostOs();
}
