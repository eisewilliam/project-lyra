import type {
  AppSettings,
  MonitorInfo,
  UiState,
} from '@/types/tauri-contracts';

export type Surface = 'main' | 'island' | 'karaoke';
export type FloatingSurface = 'main' | 'island';
export type Section = 'general' | 'appearance' | 'main' | 'island' | 'karaoke';
export type ConsolidatedState = { ui: UiState; app: AppSettings };

export type Actions = {
  toggleVisible: (surface: Surface) => Promise<void>;
  setFullscreen: (surface: Surface, value: boolean) => Promise<void>;
  setLock: (locked: boolean) => Promise<void>;
  setIslandSize: (width: number, height: number) => Promise<void>;
  resetIslandPosition: () => Promise<void>;
  setFont: (surface: Surface, scale: number) => Promise<void>;
  setTheme: (theme: string) => Promise<void>;
  updateAppSetting: (
    category: keyof AppSettings,
    key: string,
    value: unknown,
    dbKey?: string,
  ) => Promise<void>;
  island: (key: keyof UiState, value: unknown) => Promise<void>;
  karaoke: (key: keyof UiState, value: unknown, dbKey?: string) => Promise<void>;
  setAutostart: (enabled: boolean) => Promise<void>;
  clearCache: () => Promise<void>;
  setPreferredMonitor: (name: string | null) => Promise<void>;
};

export type SettingsBodyProps = {
  section: Section;
  state: ConsolidatedState;
  actions: Actions;
  activeLabel: string | undefined;
  autostartEnabled: boolean;
  monitors: MonitorInfo[];
};
