// Group display names for ShortcutsModal (prefix fallbacks, not used when action has explicit group)
export const HOTKEY_GROUPS: Record<string, string> = {
  'time': 'Time Range',
  'device': 'Toggle devices on/off',
  'table': 'Table Navigation',
}

// Order groups should appear in modal
export const HOTKEY_GROUP_ORDER = [
  'Y-Axis Metrics',
  'Time Range',
  'X Grouping',
  'Smoothing',
  'Toggle devices on/off',
  'Table Navigation',
]
