import type { BrowserLyrics } from '@/types/tauri-contracts';

type SelectOption = { value: string; label: string };
type SliderStep = { value: number; label: string; caption?: string };

/** `auto` follows the system; the stored value keeps its name. */
export const THEME_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Per-app following rule; `Auto` follows music only. */
export const FOLLOW_RULE_OPTIONS: SelectOption[] = [
  { value: 'Auto', label: 'Music only' },
  { value: 'Always', label: 'Always follow' },
  { value: 'Never', label: 'Never follow' },
];

export const BROWSER_LYRICS_OPTIONS: SelectOption[] = [
  { value: 'Ask', label: 'Ask' },
  { value: 'Allow', label: 'Look up lyrics' },
  { value: 'Deny', label: "Don't look up" },
];

/** What the chosen browser-lyrics option does, shown under the row. */
export const BROWSER_LYRICS_HINTS: Record<BrowserLyrics, string> = {
  Ask: 'Asks before using a browser title and artist to find lyrics.',
  Allow: 'Uses the title and artist a browser reports to find lyrics.',
  Deny: 'Media playing in a browser shows no lyrics.',
};

export const FONT_FAMILY_OPTIONS: SelectOption[] = [
  { value: 'system-ui', label: 'System Default' },
  { value: "'SF Pro Rounded', sans-serif", label: 'SF Pro Rounded' },
  { value: "'Inter', sans-serif", label: 'Inter' },
  { value: 'monospace', label: 'Monospace' },
];

export const FONT_SIZE_STEPS: SliderStep[] = [
  { value: 12, label: '12 px', caption: 'XS' },
  { value: 14, label: '14 px', caption: 'Small' },
  { value: 16, label: '16 px', caption: 'Medium' },
  { value: 18, label: '18 px', caption: 'Large' },
  { value: 20, label: '20 px', caption: 'XL' },
  { value: 24, label: '24 px', caption: 'XXL' },
];

/** Multiplier on the depth blur around the current lyric line. */
export const LYRIC_BLUR_STEPS: SliderStep[] = [
  { value: 0, label: 'Off' },
  { value: 0.5, label: 'Subtle' },
  { value: 1, label: 'Standard' },
  { value: 1.5, label: 'Strong' },
];

export const BACKGROUND_OPACITY_STEPS: SliderStep[] = [
  { value: 0, label: '0%' },
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '100%' },
];

export const KARAOKE_POSITION_OPTIONS: SelectOption[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

export const KARAOKE_OFFSET_STEPS: SliderStep[] = [
  { value: 0, label: 'None' },
  { value: 24, label: 'Small' },
  { value: 48, label: 'Medium' },
  { value: 72, label: 'Large' },
  { value: 96, label: 'Extra' },
  { value: 120, label: 'Max' },
];

export const KARAOKE_WIDTH_STEPS: SliderStep[] = [
  { value: 50, label: '50%' },
  { value: 60, label: '60%' },
  { value: 70, label: '70%' },
  { value: 80, label: '80%' },
  { value: 90, label: '90%' },
  { value: 100, label: '100%' },
];

export const FONT_SCALE_STEPS: SliderStep[] = [
  { value: 0.75, label: '75%' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2, label: '200%' },
];

export const KARAOKE_ALIGNMENT_OPTIONS: SelectOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

/** Line count for the Marquee and the karaoke overlay. */
export const LINE_COUNT_OPTIONS: SelectOption[] = [
  { value: '1', label: 'Current only' },
  { value: '2', label: 'Current and next' },
];

export const KARAOKE_BACKGROUND_STEPS: SliderStep[] = [
  { value: 0, label: 'None' },
  { value: 0.25, label: '25%' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
];

/** Width at Medium size; the Size setting scales it. Dragging the Marquee's
    edges sets any width in between. */
export const ISLAND_WIDTH_STEPS: SliderStep[] = [
  { value: 450, label: 'Narrow' },
  { value: 600, label: 'Standard' },
  { value: 750, label: 'Wide' },
  { value: 900, label: 'Widest' },
];

export const ISLAND_TRANSPARENCY_STEPS: SliderStep[] = [
  { value: 0, label: 'Solid' },
  { value: 0.25, label: 'Low' },
  { value: 0.5, label: 'Standard' },
  { value: 0.75, label: 'High' },
  { value: 1, label: 'Clear' },
];
