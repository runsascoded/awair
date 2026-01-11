import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSmartPolling } from '../hooks/useSmartPolling'
import { encodeTimeRange } from '../lib/timeRangeCodec'
import { fetchAwairData, refreshDeviceData } from '../services/awairService'
import type { TimeRange } from '../lib/urlParams'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface DeviceDataResult {
  deviceId: number
  data: AwairRecord[]
  summary: DataSummary | null
  lastModified: Date | null
  loading: boolean
  isInitialLoad: boolean
  error: string | null
}

export interface DevicePollerProps {
  deviceId: number
  timeRange: TimeRange
  lookbackMinutes?: number  // Extra time to fetch before range start (for rolling averages)
  smartPolling?: boolean
  onResult: (result: DeviceDataResult) => void
}

/**
 * Headless component that polls a single device for data.
 * Renders nothing - just manages data fetching and smart polling.
 */
export function DevicePoller({
  deviceId,
  timeRange,
  lookbackMinutes = 0,
  smartPolling = true,
  onResult,
}: DevicePollerProps) {
  // Manual keepPreviousData implementation
  const previousDataRef = useRef<{ records: AwairRecord[]; summary: DataSummary | null; lastModified: Date | null } | null>(null)

  // Latest mode = timestamp is null (viewing most recent data)
  const isLatestMode = useMemo(() => timeRange.timestamp === null, [timeRange.timestamp])

  const query = useQuery({
    queryKey: ['awair-data', deviceId, encodeTimeRange(timeRange), lookbackMinutes],
    queryFn: () => fetchAwairData(deviceId, timeRange, lookbackMinutes),
    enabled: deviceId !== undefined,
  })

  // Smart polling refetch: first refresh the cache (check S3 for new data),
  // then re-run the query to read from the updated cache.
  // This separates "check for new data" (polling) from "read cached data" (navigation).
  const refetch = useCallback(async () => {
    await refreshDeviceData(deviceId)
    await query.refetch()
  }, [deviceId, query.refetch])

  // Independent smart polling for this device (only when viewing Latest)
  useSmartPolling({
    lastModified: query.data?.lastModified ?? null,
    refetch,
    enabled: smartPolling && isLatestMode,
    deviceId,
    isLatestMode,
  })

  // Build result with fallback to previous data
  const currentData = query.data?.records
  const currentSummary = query.data?.summary || null
  const currentLastModified = query.data?.lastModified || null

  const data = currentData || previousDataRef.current?.records || []
  const summary = currentSummary || previousDataRef.current?.summary || null
  const lastModified = currentLastModified || previousDataRef.current?.lastModified || null

  // Log latency only when new data arrives (lastModified changed)
  const prevLastModifiedRef = useRef<Date | null>(null)
  useEffect(() => {
    const prevTime = prevLastModifiedRef.current?.getTime()
    const currTime = currentLastModified?.getTime()
    if (currTime && currTime !== prevTime) {
      prevLastModifiedRef.current = currentLastModified
      // Only log if this isn't the initial load
      if (prevTime !== undefined) {
        const latestTimestamp = currentSummary?.latest ? new Date(currentSummary.latest).getTime() : null
        if (latestTimestamp) {
          const e2eLatencyMs = Date.now() - latestTimestamp
          const e2eLatencySec = (e2eLatencyMs / 1000).toFixed(1)
          console.log(`[${deviceId}] ✅ New data, e2e latency: ${e2eLatencySec}s`)
        }
      }
    }
  }, [currentLastModified, currentSummary, deviceId])

  // Update previous data ref when we have new data
  if (currentData && currentData.length > 0) {
    previousDataRef.current = { records: currentData, summary: currentSummary, lastModified: currentLastModified }
  }

  const result: DeviceDataResult = {
    deviceId,
    data,
    summary,
    lastModified,
    loading: query.isFetching,
    isInitialLoad: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }

  // Report result to parent
  useEffect(() => {
    onResult(result)
  }, [
    // Intentionally list primitives to avoid infinite loops from object reference changes
    deviceId,
    data.length,
    summary?.count,
    lastModified?.getTime(),
    query.isFetching,
    query.isLoading,
    query.error,
    onResult,
  ])

  return null // Headless component
}
