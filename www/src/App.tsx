import { QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { AwairChart } from './components/AwairChart'
import { ThemeToggle } from './components/ThemeToggle'
import { ThemeProvider } from './contexts/ThemeContext'
import { useAwairData } from './hooks/useAwairData'
import { useDevices } from './hooks/useDevices'
import { queryClient } from './lib/queryClient'
import './App.css'

function AppContent() {
  const { devices } = useDevices()
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | undefined>(undefined)

  // Use first device by default
  const deviceId = selectedDeviceId || devices[0]?.deviceId
  const { data, summary, loading, error } = useAwairData(deviceId)

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <h1>Loading Awair Data...</h1>
          <p>Fetching air quality data from S3...</p>
        </div>
      </div>
    )
  }

  if (error) {
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
        {data.length > 0 && (
          <AwairChart
            data={data}
            summary={summary}
            devices={devices}
            selectedDeviceId={deviceId}
            onDeviceChange={setSelectedDeviceId}
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
