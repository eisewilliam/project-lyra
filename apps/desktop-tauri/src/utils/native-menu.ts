import { Menu, PredefinedMenuItem, type MenuItemOptions, type MenuOptions } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { detectHostOs } from '@/utils/os';
import { showNativeMenu, type NativeMenuRow } from '@/utils/tauri-commands';

export type MenuEntry = Readonly<{
  id: string;
  label: string;
  /** SF Symbol beside the label (macOS). */
  symbol?: string | undefined;
  /** Second line under the label (macOS 14.4 and later). */
  hint?: string | undefined;
  disabled?: boolean | undefined;
  onSelect: () => void;
}>;

export type MenuGroups = ReadonlyArray<ReadonlyArray<MenuEntry>>;

const isMac = detectHostOs() === 'macos';

function nativeRow(entry: MenuEntry): NativeMenuRow {
  const row: NativeMenuRow = { id: entry.id, title: entry.label, enabled: !entry.disabled };
  if (entry.symbol) row.symbol = entry.symbol;
  if (entry.hint) row.subtitle = entry.hint;
  return row;
}

function tauriItem(entry: MenuEntry): MenuItemOptions {
  return { id: entry.id, text: entry.label, enabled: !entry.disabled, action: entry.onSelect };
}

/**
 * Show a system menu and resolve once it closes. Groups are divided by
 * separators. `at` is in window points; without it the menu opens at the
 * pointer. On macOS the host draws it with SF Symbols and second lines, and
 * playback keeps flowing to every window while it is open; elsewhere it is
 * Tauri's menu, without them.
 */
export async function showMenu(groups: MenuGroups, at?: { x: number; y: number }): Promise<void> {
  if (isMac) {
    const rows = groups.flatMap((group, index) => [...(index > 0 ? [{}] : []), ...group.map(nativeRow)]);
    const chosen = await showNativeMenu(rows, at ?? null);
    groups.flat().find((entry) => entry.id === chosen && !entry.disabled)?.onSelect();
    return;
  }
  const items: NonNullable<MenuOptions['items']> = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0) items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    items.push(...group.map(tauriItem));
  }
  const menu = await Menu.new({ items });
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : undefined);
}
