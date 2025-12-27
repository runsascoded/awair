import { defineActions, getDefaultKeymap } from '@rdub/use-hotkeys'

/**
 * All hotkey actions for the awair app.
 * Handlers are bound in useKeyboardShortcuts via the HotkeysProvider.
 */
export const ACTIONS = defineActions({
  // Left Y-axis metrics
  'left:temp': {
    label: 'Temperature',
    group: 'Left Y-Axis',
    defaultBindings: ['t'],
  },
  'left:co2': {
    label: 'CO₂',
    group: 'Left Y-Axis',
    defaultBindings: ['c'],
  },
  'left:humid': {
    label: 'Humidity',
    group: 'Left Y-Axis',
    defaultBindings: ['h'],
  },
  'left:pm25': {
    label: 'PM2.5',
    group: 'Left Y-Axis',
    defaultBindings: ['p'],
  },
  'left:voc': {
    label: 'VOC',
    group: 'Left Y-Axis',
    defaultBindings: ['v'],
  },
  'left:autorange': {
    label: 'Toggle auto-range',
    group: 'Left Y-Axis',
    defaultBindings: ['a'],
  },
  // Right Y-axis metrics
  'right:temp': {
    label: 'Temperature',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+t'],
  },
  'right:co2': {
    label: 'CO₂',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+c'],
  },
  'right:humid': {
    label: 'Humidity',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+h'],
  },
  'right:pm25': {
    label: 'PM2.5',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+p'],
  },
  'right:voc': {
    label: 'VOC',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+v'],
  },
  'right:none': {
    label: 'Clear',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+n'],
  },
  'right:autorange': {
    label: 'Toggle auto-range',
    group: 'Right Y-Axis',
    defaultBindings: ['shift+a'],
  },
  // Time ranges
  'time:00-12h': {
    label: '12 hours',
    group: 'Time Range',
    defaultBindings: ['ctrl+h'],
    keywords: ['12h', '12hr', 'half day'],
  },
  'time:01-1d': {
    label: '1 day',
    group: 'Time Range',
    defaultBindings: ['1', 'd 1'],
    keywords: ['1d', '24h', 'day', 'today'],
  },
  'time:02-3d': {
    label: '3 days',
    group: 'Time Range',
    defaultBindings: ['3', 'd 3'],
    keywords: ['3d', '72h'],
  },
  'time:03-7d': {
    label: '1 week',
    group: 'Time Range',
    defaultBindings: ['7', 'w 1'],
    keywords: ['7d', '1w', 'week'],
  },
  'time:04-14d': {
    label: '2 weeks',
    group: 'Time Range',
    defaultBindings: ['2', 'w 2'],
    keywords: ['14d', '2w', 'fortnight'],
  },
  'time:05-31d': {
    label: '1 month',
    group: 'Time Range',
    defaultBindings: ['m 1'],
    keywords: ['31d', '1mo', '1m', 'month'],
  },
  'time:06-62d': {
    label: '2 months',
    group: 'Time Range',
    defaultBindings: ['m 2'],
    keywords: ['62d', '2mo', '2m'],
  },
  'time:07-92d': {
    label: '3 months',
    group: 'Time Range',
    defaultBindings: ['m 3'],
    keywords: ['92d', '3mo', '3m', 'quarter'],
  },
  'time:08-all': {
    label: 'Full history',
    group: 'Time Range',
    defaultBindings: ['x'],
    keywords: ['all', 'everything', 'max'],
  },
  'time:09-latest': {
    label: 'Latest',
    group: 'Time Range',
    defaultBindings: ['l'],
    keywords: ['now', 'current', 'live'],
  },
  // Devices
  'device:gym': {
    label: 'Toggle Gym',
    group: 'Devices',
    defaultBindings: ['g'],
  },
  'device:br': {
    label: 'Toggle BR',
    group: 'Devices',
    defaultBindings: ['b'],
    keywords: ['bedroom'],
  },
  // Table pagination
  'table:prev-page': {
    label: 'Prev table page',
    group: 'Table Navigation',
    defaultBindings: [','],
  },
  'table:next-page': {
    label: 'Next table page',
    group: 'Table Navigation',
    defaultBindings: ['.'],
  },
  'table:prev-plot-page': {
    label: 'Prev plot page',
    group: 'Table Navigation',
    defaultBindings: ['<'],
  },
  'table:next-plot-page': {
    label: 'Next plot page',
    group: 'Table Navigation',
    defaultBindings: ['>'],
  },
  'table:first-page': {
    label: 'First page',
    group: 'Table Navigation',
    defaultBindings: ['meta+,'],
  },
  'table:last-page': {
    label: 'Last page',
    group: 'Table Navigation',
    defaultBindings: ['meta+.'],
  },
  // Note: modal:shortcuts and omnibar:toggle are handled by HotkeysProvider
  // with built-in triggers (? and ⌘K)
})

// Extract default keymap from actions
export const DEFAULT_HOTKEY_MAP = getDefaultKeymap(ACTIONS)

// Backwards-compatible exports
export const HOTKEY_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIONS).map(([id, action]) => [id, action.label])
)

export const HOTKEY_GROUPS: Record<string, string> = {
  'left': 'Left Y-Axis',
  'right': 'Right Y-Axis',
  'time': 'Time Range',
  'device': 'Devices',
  'table': 'Table Navigation',
}

// Helper to get action by ID
export function getAction(actionId: string) {
  return ACTIONS[actionId as keyof typeof ACTIONS]
}

// Helper to get keywords for an action
export function getActionKeywords(actionId: string): string[] {
  const action = getAction(actionId)
  return (action && 'keywords' in action ? action.keywords : undefined) ?? []
}
