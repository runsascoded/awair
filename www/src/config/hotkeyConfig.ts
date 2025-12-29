// Group display names for ShortcutsModal
// Both 'left' and 'right' map to same group for 2-column layout
export const HOTKEY_GROUPS: Record<string, string> = {
  'left': 'Y-Axis Metrics',
  'right': 'Y-Axis Metrics',
  'time': 'Time Range',
  'device': 'Devices',
  'table': 'Table Navigation',
}

// Order groups should appear in modal
export const HOTKEY_GROUP_ORDER = [
  'Y-Axis Metrics',
  'Time Range',
  'Devices',
  'Table Navigation',
]
