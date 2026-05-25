import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useUrlState } from 'use-prms'
import { useSmartPolling } from '../hooks/useSmartPolling'
import { encodeTimeRange } from '../lib/timeRangeCodec'
import { xGroupingParam, type TimeRange } from '../lib/urlParams'
import { fetchAwairData } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'

const { floor, max, min } = Math

/**
 * Pyrmts `bin_budget` derived the same way as `useDataAggregation`'s
 * `targetPoints`: prefer explicit `targetPx` from URL state, else clamp
 * `containerWidth / 4` into [100, 400].
 *
 * Approximates the chart container with `window.innerWidth` — close enough
 * for tier selection (real container is ~20px narrower).
 */
function computeBinBudget(targetPx: number | null): number {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1280
  if (targetPx !== null && targetPx > 0) return floor(w / targetPx)
  return max(100, min(400, floor(w / 4)))
}

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

  // Read `xGrouping` URL state to derive pyrmts `bin_budget` matching what
  // `useDataAggregation` will compute downstream.
  const [xGrouping] = useUrlState('x', xGroupingParam)
  const targetPx = xGrouping.mode === 'auto' ? xGrouping.targetPx : null
  const binBudget = useMemo(() => computeBinBudget(targetPx), [targetPx])

  const query = useQuery({
    queryKey: ['awair-data', deviceId, encodeTimeRange(timeRange), lookbackMinutes, binBudget],
    queryFn: () => fetchAwairData(deviceId, timeRange, lookbackMinutes, binBudget),
    enabled: deviceId !== undefined,
  })

  // Smart polling refetch: re-run the query (pyrmts worker serves fresh data
  // because Lambda piggyback writes R2 every minute; no client-side cache to
  // invalidate).
  const refetch = useCallback(async () => {
    await query.refetch()
  }, [query.refetch])

  // Independent smart polling for this device (only when viewing Latest).
  // Driven by `lastModified` from pyrmts (raw-tier watermark from R2).
  useSmartPolling({
    lastModified: query.data?.lastModified ?? null,
    refetch,
    enabled: smartPolling && isLatestMode,
    deviceId,
    isLatestMode,
  })

  // Build result with fallback to previous data. Critically, treat an empty
  // `currentData` array as "no data this fetch" — fall back to previous —
  // so a temporarily-empty refetch (e.g. range crossing a 404'd shard
  // boundary) doesn't unmount the chart via `App.tsx`'s
  // `combinedData.length > 0` gate. Once a non-empty refetch lands,
  // previousDataRef advances below.
  const currentData = query.data?.records
  const currentSummary = query.data?.summary || null
  const currentLastModified = query.data?.lastModified || null

  const data = (currentData && currentData.length > 0)
    ? currentData
    : previousDataRef.current?.records || currentData || []
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
