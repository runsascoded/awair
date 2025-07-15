import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

export function useLatestMode(data: AwairRecord[], xAxisRange: [string, string] | null, formatForPlotly: (date: Date) => string) {
  // Track if user explicitly wants "Latest" mode
  const [latestModeIntended, setLatestModeIntended] = useState<boolean>(() => {
    const stored = sessionStorage.getItem('awair-latest-mode')
    return stored === 'true'
  })

  // Flag to ignore relayout events from programmatic updates
  const ignoreLatestModeCheckRef = useRef(false)

  // Track the latest timestamp to detect when new data arrives
  const latestTimestamp = data.length > 0 ? data[0].timestamp : null

  // Save Latest mode state to session storage
  useEffect(() => {
    sessionStorage.setItem('awair-latest-mode', String(latestModeIntended))
  }, [latestModeIntended])

  // Calculate auto-update range when new data arrives in Latest mode
  const autoUpdateRange = useMemo(() => {
    if (data.length === 0 || !xAxisRange || !latestTimestamp || !latestModeIntended) return null

    console.log('📈 Chart auto-update check:', {
      dataLength: data.length,
      hasRange: !!xAxisRange,
      latestTimestamp,
      latestModeIntended
    })

    const currentLatestTime = new Date(latestTimestamp)
    const currentRangeEnd = new Date(xAxisRange[1])

    console.log('📈 Checking for new data:', {
      currentLatest: currentLatestTime.toISOString(),
      currentRangeEnd: currentRangeEnd.toISOString(),
      hasNewData: currentLatestTime > currentRangeEnd
    })

    // Check if we have new data (latest timestamp is newer than current range end)
    // Use a tolerance to avoid precision issues with formatForPlotly truncating milliseconds
    const timeDiffMs = currentLatestTime.getTime() - currentRangeEnd.getTime()
    console.log('📈 Time diff check:', { timeDiffMs, threshold: 60000 })
    
    // Only update if there's more than 1 minute of new data to avoid constant updates
    if (timeDiffMs > 60000) { // 1 minute threshold instead of 1 second
      console.log('📈 Updating chart range for new data')
      const rangeStart = new Date(xAxisRange[0])
      const rangeWidth = currentRangeEnd.getTime() - rangeStart.getTime()
      const newStart = new Date(currentLatestTime.getTime() - rangeWidth)
      const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(currentLatestTime)]
      ignoreLatestModeCheckRef.current = true // Don't disable Latest mode for our own updates
      return newRange
    }
    return null
  }, [data.length, xAxisRange, latestTimestamp, latestModeIntended, formatForPlotly])

  // Check if user panned away from latest data and disable Latest mode
  const checkUserPanAway = useCallback((newEnd: Date) => {
    if (!ignoreLatestModeCheckRef.current && data.length > 0 && latestModeIntended) {
      const latestTime = new Date(data[0].timestamp)
      const timeDiffMinutes = Math.abs(newEnd.getTime() - latestTime.getTime()) / (1000 * 60)

      // Disable Latest mode if user panned more than 10 minutes away from latest data
      if (timeDiffMinutes > 10) {
        console.log('📈 User panned away from latest, disabling auto-update')
        setLatestModeIntended(false)
      }
    }

    // Reset the flag
    ignoreLatestModeCheckRef.current = false
  }, [data, latestModeIntended])

  // Jump to latest data and enable Latest mode
  const jumpToLatest = useCallback(() => {
    if (data.length === 0 || !xAxisRange) return null

    const latestTime = new Date(data[0].timestamp)
    const rangeStart = new Date(xAxisRange[0])
    const rangeEnd = new Date(xAxisRange[1])
    const rangeWidth = rangeEnd.getTime() - rangeStart.getTime()

    const newStart = new Date(latestTime.getTime() - rangeWidth)
    const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(latestTime)]

    ignoreLatestModeCheckRef.current = true // Don't trigger pan-away detection
    setLatestModeIntended(true)

    return newRange
  }, [data, xAxisRange, formatForPlotly])

  // Set ignore flag for programmatic updates (like table navigation)
  const setIgnoreNextPanCheck = useCallback(() => {
    ignoreLatestModeCheckRef.current = true
  }, [])

  return {
    latestModeIntended,
    setLatestModeIntended,
    autoUpdateRange,
    checkUserPanAway,
    jumpToLatest,
    setIgnoreNextPanCheck
  }
}
