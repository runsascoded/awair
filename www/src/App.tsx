import { useUrlParam } from '@rdub/use-url-params'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { AwairChart } from './components/AwairChart'
import { ThemeToggle } from './components/ThemeToggle'
import { ThemeProvider } from './contexts/ThemeContext'
import { useDevices } from './hooks/useDevices'
import { useMultiDeviceData } from './hooks/useMultiDeviceData'
import { queryClient } from './lib/queryClient'
import { boolParam, deviceIdsParam, timeRangeParam, refetchIntervalParam } from './lib/urlParams'
import './App.scss'

function AppContent() {
  const [isOgMode] = useUrlParam('og', boolParam)

  // Add og-mode class to body for CSS overrides
  useEffect(() => {
    document.body.classList.toggle('og-mode', isOgMode)
    return () => document.body.classList.remove('og-mode')
  }, [isOgMode])

  const { devices } = useDevices()

  // Device selection persisted in URL (?d=gym+br)
  const deviceParam = useMemo(() => deviceIdsParam(devices), [devices])
  const [selectedDeviceIds, setSelectedDeviceIds] = useUrlParam('d', deviceParam)

  // Time range persisted in URL (?t=...)
  const [timeRange, setTimeRange] = useUrlParam('t', timeRangeParam)

  // Refetch interval for testing (?ri=5000 for 5 second polling)
  const [refetchIntervalOverride] = useUrlParam('ri', refetchIntervalParam)
  const refetchInterval = refetchIntervalOverride ?? 60_000 // Default 1 minute

  // Fetch data for all selected devices with time range
  // Poll every 60 seconds for new data (only when tab is active)
  const deviceDataResults = useMultiDeviceData(selectedDeviceIds, timeRange, {
    refetchInterval: refetchInterval === 0 ? undefined : refetchInterval,
    refetchIntervalInBackground: false,
  })

  // Combine results
  const { combinedData, combinedSummary, loading, isInitialLoad, error } = useMemo(() => {
    const allData = deviceDataResults.flatMap(r => r.data)
    const anyLoading = deviceDataResults.some(r => r.loading)
    const anyInitialLoad = deviceDataResults.some(r => r.isInitialLoad)
    const firstError = deviceDataResults.find(r => r.error)?.error || null

    // Combine summaries - take the widest date range
    let combinedSummary = null
    if (deviceDataResults.length > 0 && deviceDataResults.some(r => r.summary)) {
      const summaries = deviceDataResults.filter(r => r.summary).map(r => r.summary!)
      const count = summaries.reduce((sum, s) => sum + s.count, 0)
      const earliest = summaries.reduce((min, s) => {
        if (!s.earliest) return min
        if (!min) return s.earliest
        return new Date(s.earliest) < new Date(min) ? s.earliest : min
      }, null as string | null)
      const latest = summaries.reduce((max, s) => {
        if (!s.latest) return max
        if (!max) return s.latest
        return new Date(s.latest) > new Date(max) ? s.latest : max
      }, null as string | null)

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

      combinedSummary = { count, earliest, latest, dateRange }
    }

    return {
      combinedData: allData,
      combinedSummary,
      loading: anyLoading,
      isInitialLoad: anyInitialLoad,
      error: firstError,
    }
  }, [deviceDataResults])

  // Show full-screen loading only on initial load (no data yet)
  if (isInitialLoad && combinedData.length === 0) {
    return (
      <div className="app">
        <div className="loading">
          <h1>Loading Awair Data...</h1>
          <p>Fetching air quality data from S3...</p>
        </div>
      </div>
    )
  }

  if (error && combinedData.length === 0) {
    return (
      <div className="app">
        <div className="error">
          <h1>Error Loading Data</h1>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <main>
        {/* Show loading overlay when refetching */}
        {loading && combinedData.length > 0 && (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        )}
        {combinedData.length > 0 && (
          <AwairChart
            deviceDataResults={deviceDataResults}
            summary={combinedSummary}
            devices={devices}
            selectedDeviceIds={selectedDeviceIds}
            onDeviceSelectionChange={setSelectedDeviceIds}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            isOgMode={isOgMode}
          />
        )}
      </main>
      {!isOgMode && <ThemeToggle />}
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
