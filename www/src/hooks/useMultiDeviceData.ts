import { useQueries } from '@tanstack/react-query'
import { fetchAwairData } from '../services/awairService'
import type { TimeRange } from '../lib/urlParams'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface DeviceDataResult {
  deviceId: number
  data: AwairRecord[]
  summary: DataSummary | null
  loading: boolean
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

  const queries = useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['awair-data', deviceId, timeRange.duration],
      queryFn: () => fetchAwairData(deviceId, timeRange),
      enabled: deviceId !== undefined,
      refetchInterval,
      refetchIntervalInBackground,
    })),
  })

  return deviceIds.map((deviceId, index) => {
    const query = queries[index]
    return {
      deviceId,
      data: query.data?.records || [],
      summary: query.data?.summary || null,
      loading: query.isLoading,
      error: query.error ? (query.error as Error).message : null,
    }
  })
}
