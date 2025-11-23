import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useUrlParam } from '@rdub/use-url-params'
import { AwairChart } from './components/AwairChart'
import { ThemeToggle } from './components/ThemeToggle'
import { ThemeProvider } from './contexts/ThemeContext'
import { useDevices } from './hooks/useDevices'
import { useMultiDeviceData } from './hooks/useMultiDeviceData'
import { queryClient } from './lib/queryClient'
import { deviceIdsParam } from './lib/urlParams'
import './App.css'

function AppContent() {
  const { devices } = useDevices()

  // Device selection persisted in URL (?d=gym+br)
  const deviceParam = useMemo(() => deviceIdsParam(devices), [devices])
  const [selectedDeviceIds, setSelectedDeviceIds] = useUrlParam(
    'd',
    deviceParam
  )

  // Initialize with first device when devices load (if no selection)
  useEffect(() => {
    if (devices.length > 0 && selectedDeviceIds.length === 0) {
      setSelectedDeviceIds([devices[0].deviceId])
    }
  }, [devices, selectedDeviceIds.length])

  // Fetch data for all selected devices
  const deviceDataResults = useMultiDeviceData(selectedDeviceIds)

  // Combine results
  const { combinedData, combinedSummary, loading, error } = useMemo(() => {
    const allData = deviceDataResults.flatMap(r => r.data)
    const anyLoading = deviceDataResults.some(r => r.loading)
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

    return { combinedData: allData, combinedSummary, loading: anyLoading, error: firstError }
  }, [deviceDataResults])

  // Show full-screen loading only on initial load (no data yet)
  const isInitialLoad = loading && combinedData.length === 0

  if (isInitialLoad) {
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
        {/* Show loading overlay when switching devices (data exists but new data loading) */}
        {loading && combinedData.length > 0 && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
          </div>
        )}
        {combinedData.length > 0 && (
          <AwairChart
            deviceDataResults={deviceDataResults}
            summary={combinedSummary}
            devices={devices}
            selectedDeviceIds={selectedDeviceIds}
            onDeviceSelectionChange={setSelectedDeviceIds}
          />
        )}
      </main>
      <ThemeToggle />
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
