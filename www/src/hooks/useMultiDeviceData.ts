import { useQueries } from '@tanstack/react-query'
import { useRef } from 'react'
import { encodeTimeRange } from '../lib/timeRangeCodec'
import { fetchAwairData } from '../services/awairService'
import type { TimeRange } from '../lib/urlParams'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface DeviceDataResult {
  deviceId: number
  data: AwairRecord[]
  summary: DataSummary | null
  loading: boolean
  isInitialLoad: boolean
  error: string | null
}

export interface UseMultiDeviceDataOptions {
  /** Poll interval in milliseconds (default: disabled) */
  refetchInterval?: number
  /** Whether to poll when tab is in background (default: false) */
  refetchIntervalInBackground?: boolean
}

const DEFAULT_OPTIONS: UseMultiDeviceDataOptions = {
  refetchInterval: undefined,
  refetchIntervalInBackground: false,
}

export function useMultiDeviceData(
  deviceIds: number[],
  timeRange: TimeRange,
  options: UseMultiDeviceDataOptions = DEFAULT_OPTIONS
): DeviceDataResult[] {
  const { refetchInterval, refetchIntervalInBackground } = options

  // Manual keepPreviousData implementation (useQueries doesn't support it in v5)
  const previousDataRef = useRef<Map<number, { records: AwairRecord[]; summary: DataSummary | null }>>(new Map())

  const queries = useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['awair-data', deviceId, encodeTimeRange(timeRange)],
      queryFn: () => fetchAwairData(deviceId, timeRange),
      enabled: deviceId !== undefined,
      refetchInterval,
      refetchIntervalInBackground,
    })),
  })

  return deviceIds.map((deviceId, index) => {
    const query = queries[index]

    // Use current data if available, otherwise use previous data
    const currentData = query.data?.records
    const currentSummary = query.data?.summary || null
    const previousData = previousDataRef.current.get(deviceId)

    const data = currentData || previousData?.records || []
    const summary = currentSummary || previousData?.summary || null

    // Update ref when we have new data
    if (currentData && currentData.length > 0) {
      previousDataRef.current.set(deviceId, { records: currentData, summary: currentSummary })
    }

    return {
      deviceId,
      data,
      summary,
      loading: query.isFetching,
      isInitialLoad: query.isLoading,
      error: query.error ? (query.error as Error).message : null,
    }
  })
}
