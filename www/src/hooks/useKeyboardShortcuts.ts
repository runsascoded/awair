import { useRegisteredHotkeys, type HotkeyMap } from '@rdub/use-hotkeys'
import { useMemo } from 'react'
import type { MetricsState } from "./useMetrics"
import type { Device } from '../services/awairService'
import type { AwairRecord } from '../types/awair'

interface UseKeyboardShortcutsProps {
  metrics: MetricsState
  xAxisRange: [string, string] | null
  setXAxisRange: (range: [string, string] | null, options?: { duration?: number }) => void
  data: AwairRecord[]
  formatForPlotly: (date: Date) => string
  latestModeIntended: boolean
  setLatestModeIntended: (value: boolean) => void
  handleTimeRangeClick: (hours: number) => void
  handleAllClick: () => void
  setIgnoreNextPanCheck: () => void
  openShortcutsModal: () => void
  openOmnibar: () => void
  // Device selection
  devices: Device[]
  selectedDeviceIds: number[]
  setSelectedDeviceIds: (ids: number[]) => void
  // Table pagination
  tablePrevPage?: () => void
  tableNextPage?: () => void
  tablePrevPlotPage?: () => void
  tableNextPlotPage?: () => void
  tableFirstPage?: () => void
  tableLastPage?: () => void
}

type Metric = 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'

// Default hotkey map: key combination -> action name
// Supports sequences (space-separated) like "d 1" for 1 day, "w 2" for 2 weeks
// Multiple keys can map to the same action
export const DEFAULT_HOTKEY_MAP: HotkeyMap = {
  // Left Y-axis metrics
  't': 'left:temp',
  'c': 'left:co2',
  'h': 'left:humid',
  'p': 'left:pm25',
  'v': 'left:voc',
  'a': 'left:autorange',
  // Right Y-axis metrics
  'shift+t': 'right:temp',
  'shift+c': 'right:co2',
  'shift+h': 'right:humid',
  'shift+p': 'right:pm25',
  'shift+v': 'right:voc',
  'shift+n': 'right:none',
  'shift+a': 'right:autorange',
  // Time ranges - both single keys and sequences
  // Days
  '1': 'time:01-1d',
  'd 1': 'time:01-1d',
  '3': 'time:02-3d',
  'd 3': 'time:02-3d',
  // Weeks
  '7': 'time:03-7d',
  'w 1': 'time:03-7d',
  '2': 'time:04-14d',
  'w 2': 'time:04-14d',
  // Month
  'm 1': 'time:05-30d',
  // All and Latest
  'x': 'time:06-all',
  'l': 'time:07-latest',
  // Devices
  'g': 'device:gym',
  'b': 'device:br',
  // Table pagination
  ',': 'table:prev-page',
  '.': 'table:next-page',
  '<': 'table:prev-plot-page',
  '>': 'table:next-plot-page',
  'meta+,': 'table:first-page',
  'meta+.': 'table:last-page',
  // Modal
  '?': 'modal:shortcuts',
  'meta+k': 'omnibar:toggle',
} as const

// Re-export for backward compatibility
export const HOTKEY_MAP = DEFAULT_HOTKEY_MAP

export function useKeyboardShortcuts({
  metrics,
  xAxisRange,
  setXAxisRange,
  data,
  formatForPlotly,
  latestModeIntended,
  setLatestModeIntended,
  handleTimeRangeClick,
  handleAllClick,
  setIgnoreNextPanCheck,
  openShortcutsModal,
  openOmnibar,
  devices,
  selectedDeviceIds,
  setSelectedDeviceIds,
  tablePrevPage,
  tableNextPage,
  tablePrevPlotPage,
  tableNextPlotPage,
  tableFirstPage,
  tableLastPage,
}: UseKeyboardShortcutsProps) {
  const { l, r } = metrics

  // Find device ID by name pattern (case-insensitive)
  const findDeviceIdByName = (pattern: string): number | null => {
    const regex = new RegExp(pattern, 'i')
    const device = devices.find(d => regex.test(d.name))
    return device?.deviceId ?? null
  }

  // Toggle a device by ID
  const toggleDevice = (deviceId: number) => {
    if (selectedDeviceIds.includes(deviceId)) {
      // Don't allow deselecting if it's the only one
      if (selectedDeviceIds.length > 1) {
        setSelectedDeviceIds(selectedDeviceIds.filter(id => id !== deviceId))
      }
    } else {
      setSelectedDeviceIds([...selectedDeviceIds, deviceId])
    }
  }

  const handlers = useMemo(() => {
    const setMetricPrimary = (metric: Metric) => {
      l.set(metric)
      // If secondary was the same, set it to none
      if (r.val === metric) {
        r.set('none')
      }
    }

    const setMetricSecondary = (metric: Metric) => {
      if (metric === l.val && r.val !== 'none') {
        // Swap primary and secondary
        l.set(r.val as Metric)
        r.set(metric)
      } else if (metric !== l.val) {
        // Different metric, set as secondary
        r.set(metric)
      }
      // If same metric and no secondary, it's a no-op
    }

    return {
      // Left Y-axis
      'left:temp': () => setMetricPrimary('temp'),
      'left:co2': () => setMetricPrimary('co2'),
      'left:humid': () => setMetricPrimary('humid'),
      'left:pm25': () => setMetricPrimary('pm25'),
      'left:voc': () => setMetricPrimary('voc'),
      'left:autorange': () => l.setAutoRange(!l.autoRange),
      // Right Y-axis
      'right:temp': () => setMetricSecondary('temp'),
      'right:co2': () => setMetricSecondary('co2'),
      'right:humid': () => setMetricSecondary('humid'),
      'right:pm25': () => setMetricSecondary('pm25'),
      'right:voc': () => setMetricSecondary('voc'),
      'right:none': () => r.set('none'),
      'right:autorange': () => {
        if (r.val !== 'none') {
          r.setAutoRange(!r.autoRange)
        }
      },
      // Time ranges
      'time:01-1d': () => handleTimeRangeClick(24),
      'time:02-3d': () => handleTimeRangeClick(24 * 3),
      'time:03-7d': () => handleTimeRangeClick(24 * 7),
      'time:04-14d': () => handleTimeRangeClick(24 * 14),
      'time:05-30d': () => handleTimeRangeClick(24 * 30),
      'time:06-all': handleAllClick,
      'time:07-latest': () => {
        if (latestModeIntended) {
          setLatestModeIntended(false)
        } else if (xAxisRange && data.length > 0) {
          const rangeStart = new Date(xAxisRange[0])
          const rangeEnd = new Date(xAxisRange[1])
          const currentWidth = rangeEnd.getTime() - rangeStart.getTime()
          const latestTime = new Date(data[0].timestamp)
          const newStart = new Date(latestTime.getTime() - currentWidth)
          const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(latestTime)]
          setIgnoreNextPanCheck()
          setXAxisRange(newRange)
          setLatestModeIntended(true)
        }
      },
      // Devices
      'device:gym': () => {
        const id = findDeviceIdByName('gym')
        if (id !== null) toggleDevice(id)
      },
      'device:br': () => {
        const id = findDeviceIdByName('br')
        if (id !== null) toggleDevice(id)
      },
      // Table pagination
      'table:prev-page': () => tablePrevPage?.(),
      'table:next-page': () => tableNextPage?.(),
      'table:prev-plot-page': () => tablePrevPlotPage?.(),
      'table:next-plot-page': () => tableNextPlotPage?.(),
      'table:first-page': () => tableFirstPage?.(),
      'table:last-page': () => tableLastPage?.(),
      // Modal
      'modal:shortcuts': openShortcutsModal,
      'omnibar:toggle': openOmnibar,
    }
  }, [l, r, handleTimeRangeClick, handleAllClick, latestModeIntended, setLatestModeIntended, xAxisRange, data, formatForPlotly, setXAxisRange, setIgnoreNextPanCheck, openShortcutsModal, openOmnibar, findDeviceIdByName, toggleDevice, tablePrevPage, tableNextPage, tablePrevPlotPage, tableNextPlotPage, tableFirstPage, tableLastPage])

  // Register handlers with keymap from context
  const hotkeysResult = useRegisteredHotkeys(handlers, { sequenceTimeout: 2000 })

  // Return both the hotkeys result and handlers (for omnibar)
  return { ...hotkeysResult, handlers }
}
