import { useEffect } from 'react'
import type { AwairRecord } from '../types/awair'

interface UseKeyboardShortcutsProps {
  metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'
  secondaryMetric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none'
  setMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc') => void
  setSecondaryMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none') => void
  xAxisRange: [string, string] | null
  setXAxisRange: (range: [string, string] | null) => void
  setHasSetDefaultRange: (value: boolean) => void
  data: AwairRecord[]
  formatForPlotly: (date: Date) => string
  latestModeIntended: boolean
  setLatestModeIntended: (value: boolean) => void
  handleTimeRangeClick: (hours: number) => void
  setIgnoreNextPanCheck: () => void
}

export function useKeyboardShortcuts({
  metric,
  secondaryMetric,
  setMetric,
  setSecondaryMetric,
  xAxisRange,
  setXAxisRange,
  setHasSetDefaultRange,
  data,
  formatForPlotly,
  latestModeIntended,
  setLatestModeIntended,
  handleTimeRangeClick,
  setIgnoreNextPanCheck
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only handle keypresses when not typing in an input/textarea/select
      if (event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement) {
        return
      }

      // Ignore if any modifier keys are pressed (except Shift for uppercase)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      const isShift = event.shiftKey

      // Map keys to metrics
      const keyToMetric: { [key: string]: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' } = {
        't': 'temp',
        'c': 'co2',
        'h': 'humid',
        'p': 'pm25',
        'v': 'voc'
      }

      if (key in keyToMetric) {
        const selectedMetric = keyToMetric[key]

        if (isShift) {
          // Capital letter = swap primary and secondary if same metric
          if (selectedMetric === metric && secondaryMetric !== 'none') {
            // Swap primary and secondary
            setMetric(secondaryMetric as 'temp' | 'co2' | 'humid' | 'pm25' | 'voc')
            setSecondaryMetric(selectedMetric)
          } else if (selectedMetric !== metric) {
            // Different metric, set as secondary
            setSecondaryMetric(selectedMetric)
          }
          // If same metric and no secondary, it's a no-op
        } else {
          // Lowercase = primary metric
          setMetric(selectedMetric)
          // If secondary was the same, set it to none
          if (secondaryMetric === selectedMetric) {
            setSecondaryMetric('none')
          }
        }
        event.preventDefault()
      } else if (key === 'n' && isShift) {
        // Shift+N = None for secondary
        setSecondaryMetric('none')
        event.preventDefault()
      } else if (key === 'l') {
        // L = Latest button (toggle)
        if (latestModeIntended) {
          // Toggle off Latest mode
          setLatestModeIntended(false)
        } else if (xAxisRange && data.length > 0) {
          // Jump to latest and enable Latest mode
          const rangeStart = new Date(xAxisRange[0])
          const rangeEnd = new Date(xAxisRange[1])
          const currentWidth = rangeEnd.getTime() - rangeStart.getTime()
          const latestTime = new Date(data[0].timestamp)
          const newStart = new Date(latestTime.getTime() - currentWidth)
          const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(latestTime)]
          setIgnoreNextPanCheck() // Don't disable Latest mode for our own update
          setXAxisRange(newRange)
          setHasSetDefaultRange(true)
          setLatestModeIntended(true)
        }
        event.preventDefault()
      } else if (key === 'a') {
        // A = All data
        if (data.length > 0) {
          const fullRange: [string, string] = [
            formatForPlotly(new Date(data[data.length - 1].timestamp)),
            formatForPlotly(new Date(data[0].timestamp))
          ]
          setXAxisRange(fullRange)
          setHasSetDefaultRange(true)
          setLatestModeIntended(true)
        } else {
          setXAxisRange(null)
        }
        event.preventDefault()
      } else if (key === '1') {
        // 1 = 1 day
        handleTimeRangeClick(24)
        event.preventDefault()
      } else if (key === '3') {
        // 3 = 3 days
        handleTimeRangeClick(24 * 3)
        event.preventDefault()
      } else if (key === '7') {
        // 7 = 7 days
        handleTimeRangeClick(24 * 7)
        event.preventDefault()
      } else if (key === '2') {
        // 2 = 14 days (2 weeks)
        handleTimeRangeClick(24 * 14)
        event.preventDefault()
      } else if (key === 'm') {
        // M = 30 days (month)
        handleTimeRangeClick(24 * 30)
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [
    metric,
    secondaryMetric,
    setMetric,
    setSecondaryMetric,
    xAxisRange,
    setXAxisRange,
    setHasSetDefaultRange,
    data,
    formatForPlotly,
    latestModeIntended,
    setLatestModeIntended,
    handleTimeRangeClick,
    setIgnoreNextPanCheck
  ])
}
