// Descriptions for keyboard shortcuts modal
export const HOTKEY_DESCRIPTIONS: Record<string, string> = {
  // Left Y-axis
  'left:temp': 'Temperature',
  'left:co2': 'CO₂',
  'left:humid': 'Humidity',
  'left:pm25': 'PM2.5',
  'left:voc': 'VOC',
  'left:autorange': 'Toggle auto-range',
  // Right Y-axis
  'right:temp': 'Temperature',
  'right:co2': 'CO₂',
  'right:humid': 'Humidity',
  'right:pm25': 'PM2.5',
  'right:voc': 'VOC',
  'right:none': 'Clear',
  'right:autorange': 'Toggle auto-range',
  // Time ranges
  'time:00-12h': '12 hours',
  'time:01-1d': '1 day',
  'time:02-3d': '3 days',
  'time:03-7d': '1 week',
  'time:04-14d': '2 weeks',
  'time:05-31d': '1 month',
  'time:06-62d': '2 months',
  'time:07-92d': '3 months',
  'time:08-all': 'Full history',
  'time:09-latest': 'Latest',
  // Devices
  'device:gym': 'Toggle Gym',
  'device:br': 'Toggle BR',
  // Table pagination
  'table:prev-page': 'Prev table page',
  'table:next-page': 'Next table page',
  'table:prev-plot-page': 'Prev plot page',
  'table:next-plot-page': 'Next plot page',
  'table:first-page': 'First page',
  'table:last-page': 'Last page',
  // Modal
  'modal:shortcuts': 'This dialog',
  'omnibar:toggle': 'Command palette',
}

// Group names for shortcuts modal
export const HOTKEY_GROUPS: Record<string, string> = {
  'left': 'Left Y-Axis',
  'right': 'Right Y-Axis',
  'time': 'Time Range',
  'device': 'Devices',
  'table': 'Table Navigation',
  'modal': 'Other',
  'omnibar': 'Other',
}
