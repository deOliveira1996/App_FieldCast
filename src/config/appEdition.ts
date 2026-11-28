import type { V4AppTabId } from '../types/v4';

export type AppEdition = 'full' | 'minimal';

export const APP_EDITION: AppEdition =
  import.meta.env.VITE_APP_EDITION === 'minimal' || import.meta.env.MODE === 'minimal'
    ? 'minimal'
    : 'full';

export const IS_MINIMAL_EDITION: boolean = APP_EDITION === 'minimal';

export const ENABLED_TABS: readonly V4AppTabId[] = IS_MINIMAL_EDITION
  ? ['forecast', 'comparison', 'map', 'settings']
  : [
      'forecast',
      'comparison',
      'navigation',
      'aeronautics',
      'planner',
      'map',
      'field',
      'settings',
    ];

export function isTabEnabled(tabId: V4AppTabId): boolean {
  return ENABLED_TABS.includes(tabId);
}
