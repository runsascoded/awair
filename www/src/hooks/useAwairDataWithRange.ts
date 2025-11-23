import { useQuery } from '@tanstack/react-query'
import { HyparquetSource } from '../services/dataSources/hyparquetSource'
import type { TimeRange } from '../services/dataSource'
import type { DataSummary } from '../types/awair'

const dataSource = new HyparquetSource()

interface UseAwairDataWithRangeOptions {
  deviceId: number
  range: TimeRange
  enabled?: boolean
}

export function useAwairDataWithRange({ deviceId, range, enabled = true }: UseAwairDataWithRangeOptions) {
  const {
    data: queryData,
    isLoading: loading,
    error,
    refetch: refresh,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['awair-data-range', deviceId, range.from.toISOString(), range.to.toISOString()],
    queryFn: async () => {
      const result = await dataSource.fetch({ deviceId, range })

      // Calculate summary from fetched records
      const records = result.records
      const count = records.length
      const latest = count > 0 ? records[0].timestamp : null
      const earliest = count > 0 ? records[count - 1].timestamp : null

      let dateRange = 'No data'
      if (earliest && latest) {
        const formatCompactDate = (date: Date) => {
          const month = String(date.getMonth() + 1)
          const day = String(date.getDate())
          const year = String(date.getFullYear()).slice(-2)
          return `${month}/${day}/${year}`
        }

        const start = formatCompactDate(new Date(earliest))
        const end = formatCompactDate(new Date(latest))
        dateRange = start === end ? start : `${start} - ${end}`
      }

      const summary: DataSummary = { count, earliest, latest, dateRange }

      return { records, summary, timing: result.timing }
    },
    enabled,
    staleTime: 60000, // Consider data fresh for 1 minute
  })

  const data = queryData?.records || []
  const summary = queryData?.summary || null
  const timing = queryData?.timing
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  return {
    data,
    summary,
    timing,
    loading,
    error: error ? (error as Error).message : null,
    lastUpdated,
    refresh,
  }
}
