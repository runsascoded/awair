import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { fetchAwairData } from '../services/awairService'

export function useAwairData() {
  const {
    data: queryData,
    isLoading: loading,
    error,
    refetch: refresh,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['awair-data'],
    queryFn: fetchAwairData,
  })

  const data = queryData?.records || []
  const summary = queryData?.summary || null
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null

  // Track data changes
  const prevLatestRef = useRef<string | null>(null)

  useEffect(() => {
    const currentLatest = data.length > 0 ? data[0].timestamp : null

    if (currentLatest && prevLatestRef.current !== currentLatest) {
      if (prevLatestRef.current) {
        console.log(`🆕 New data detected! Latest timestamp: ${currentLatest}`)
      }
      prevLatestRef.current = currentLatest
    }
  }, [data])

  return {
    data,
    summary,
    loading,
    error: error ? (error as Error).message : null,
    lastUpdated,
    refresh,
  }
}
