import { useHotkeys } from '@rdub/use-hotkeys'
import { useMemo } from 'react'
import type { MetricsState } from "./useMetrics"
import type { AwairRecord } from '../types/awair'

interface UseKeyboardShortcutsProps {
  metrics: MetricsState
  xAxisRange: [string, string] | null
  setXAxisRange: (range: [string, string] | null) => void
  data: AwairRecord[]
  formatForPlotly: (date: Date) => string
  latestModeIntended: boolean
  setLatestModeIntended: (value: boolean) => void
  handleTimeRangeClick: (hours: number) => void
  setIgnoreNextPanCheck: () => void
}

type Metric = 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'

// Hotkey map: key combination -> action name
const HOTKEY_MAP = {
  // Primary metrics (lowercase)
  't': 'metric:temp',
  'c': 'metric:co2',
  'h': 'metric:humid',
  'p': 'metric:pm25',
  'v': 'metric:voc',
  // Secondary metrics (shift)
  'shift+t': 'metric:temp:secondary',
  'shift+c': 'metric:co2:secondary',
  'shift+h': 'metric:humid:secondary',
  'shift+p': 'metric:pm25:secondary',
  'shift+v': 'metric:voc:secondary',
  'shift+n': 'metric:none:secondary',
  // Auto-range
  'a': 'autorange:left',
  'shift+a': 'autorange:right',
  // Time ranges
  '1': 'range:1d',
  '3': 'range:3d',
  '7': 'range:7d',
  '2': 'range:14d',
  'm': 'range:30d',
  // Other
  'l': 'latest',
  'x': 'all',
}

export function useKeyboardShortcuts({
  metrics,
  xAxisRange,
  setXAxisRange,
  data,
  formatForPlotly,
  latestModeIntended,
  setLatestModeIntended,
  handleTimeRangeClick,
  setIgnoreNextPanCheck,
}: UseKeyboardShortcutsProps) {
  const { l, r } = metrics

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
      // Primary metrics
      'metric:temp': () => setMetricPrimary('temp'),
      'metric:co2': () => setMetricPrimary('co2'),
      'metric:humid': () => setMetricPrimary('humid'),
      'metric:pm25': () => setMetricPrimary('pm25'),
      'metric:voc': () => setMetricPrimary('voc'),
      // Secondary metrics
      'metric:temp:secondary': () => setMetricSecondary('temp'),
      'metric:co2:secondary': () => setMetricSecondary('co2'),
      'metric:humid:secondary': () => setMetricSecondary('humid'),
      'metric:pm25:secondary': () => setMetricSecondary('pm25'),
      'metric:voc:secondary': () => setMetricSecondary('voc'),
      'metric:none:secondary': () => r.set('none'),
      // Auto-range
      'autorange:left': () => l.setAutoRange(!l.autoRange),
      'autorange:right': () => {
        if (r.val !== 'none') {
          r.setAutoRange(!r.autoRange)
        }
      },
      // Time ranges
      'range:1d': () => handleTimeRangeClick(24),
      'range:3d': () => handleTimeRangeClick(24 * 3),
      'range:7d': () => handleTimeRangeClick(24 * 7),
      'range:14d': () => handleTimeRangeClick(24 * 14),
      'range:30d': () => handleTimeRangeClick(24 * 30),
      // Latest mode
      'latest': () => {
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
      // All data
      'all': () => {
        if (data.length > 0) {
          const fullRange: [string, string] = [
            formatForPlotly(new Date(data[data.length - 1].timestamp)),
            formatForPlotly(new Date(data[0].timestamp)),
          ]
          setXAxisRange(fullRange)
          setLatestModeIntended(true)
        } else {
          setXAxisRange(null)
        }
      },
    }
  }, [l, r, handleTimeRangeClick, latestModeIntended, setLatestModeIntended, xAxisRange, data, formatForPlotly, setXAxisRange, setIgnoreNextPanCheck])

  useHotkeys(HOTKEY_MAP, handlers)
}
