import { useQueries } from '@tanstack/react-query'
import { fetchAwairData } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface DeviceDataResult {
  deviceId: number
  data: AwairRecord[]
  summary: DataSummary | null
  loading: boolean
  error: string | null
}

export function useMultiDeviceData(deviceIds: number[]): DeviceDataResult[] {
  const queries = useQueries({
    queries: deviceIds.map(deviceId => ({
      queryKey: ['awair-data', deviceId],
      queryFn: () => fetchAwairData(deviceId),
      enabled: deviceId !== undefined,
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
