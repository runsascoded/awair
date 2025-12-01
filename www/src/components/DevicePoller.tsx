import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useSmartPolling } from '../hooks/useSmartPolling'
import { encodeTimeRange } from '../lib/timeRangeCodec'
import { fetchAwairData } from '../services/awairService'
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
  smartPolling = true,
  onResult,
}: DevicePollerProps) {
  // Manual keepPreviousData implementation
  const previousDataRef = useRef<{ records: AwairRecord[]; summary: DataSummary | null; lastModified: Date | null } | null>(null)

  const query = useQuery({
    queryKey: ['awair-data', deviceId, encodeTimeRange(timeRange)],
    queryFn: () => fetchAwairData(deviceId, timeRange),
    enabled: deviceId !== undefined,
  })

  // Independent smart polling for this device
  useSmartPolling({
    lastModified: query.data?.lastModified ?? null,
    refetch: async () => { await query.refetch() },
    enabled: smartPolling,
    deviceId,
  })

  // Build result with fallback to previous data
  const currentData = query.data?.records
  const currentSummary = query.data?.summary || null
  const currentLastModified = query.data?.lastModified || null

  const data = currentData || previousDataRef.current?.records || []
  const summary = currentSummary || previousDataRef.current?.summary || null
  const lastModified = currentLastModified || previousDataRef.current?.lastModified || null

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
