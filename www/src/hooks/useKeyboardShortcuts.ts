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
export const HOTKEY_MAP = {
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
  // Time ranges (ordered by duration for display)
  '1': 'time:01-1d',
  '3': 'time:02-3d',
  '7': 'time:03-7d',
  '2': 'time:04-14d',
  'm': 'time:05-30d',
  'x': 'time:06-all',
  'l': 'time:07-latest',
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
      'time:06-all': () => {
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
    }
  }, [l, r, handleTimeRangeClick, latestModeIntended, setLatestModeIntended, xAxisRange, data, formatForPlotly, setXAxisRange, setIgnoreNextPanCheck])

  useHotkeys(HOTKEY_MAP, handlers)
}
