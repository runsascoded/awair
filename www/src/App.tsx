import { QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FaGithub } from 'react-icons/fa'
import { MdBrightnessAuto, MdDarkMode, MdLightMode } from 'react-icons/md'
import { HotkeysProvider, LookupModal, Omnibar, SequenceModal, ShortcutsModal, SpeedDial } from 'use-kbd'
import { useUrlState } from 'use-prms'
import 'use-kbd/styles.css'
import { AwairChart } from './components/AwairChart'
import { DevicePoller, type DeviceDataResult } from './components/DevicePoller'
import { HealthPage } from './components/HealthPage'
import { TableNavigationRenderer, YAxisMetricsRenderer } from './components/groupRenderers'
import { KbdTooltip } from './components/Tooltip'
import { HOTKEY_GROUPS, HOTKEY_GROUP_ORDER } from './config/hotkeyConfig'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { useDevices } from './hooks/useDevices'
import { queryClient } from './lib/queryClient'
import { boolParam, deviceIdsParam, timeRangeParam, refetchIntervalParam, smoothingParam } from './lib/urlParams'
import './App.scss'

// Custom group renderers for ShortcutsModal
const GROUP_RENDERERS = {
  'Y-Axis Metrics': YAxisMetricsRenderer,
  'Table Navigation': TableNavigationRenderer,
}

// Top-level dispatcher: `?health` renders the diagnostic dashboard,
// everything else falls through to the chart app. Splitting the two
// keeps hook counts stable per instance (rules of hooks — the chart
// branch calls many more hooks than the health branch does).
function AppContent() {
  const [isHealthMode] = useUrlState('health', boolParam)
  if (isHealthMode) {
    return (
      <div className="app">
        <HealthPage />
      </div>
    )
  }
  return <ChartApp />
}

function ChartApp() {
  const [isOgMode] = useUrlState('og', boolParam)
  const { theme, setTheme } = useTheme()

  // Add og-mode class to body for CSS overrides
  useEffect(() => {
    document.body.classList.toggle('og-mode', isOgMode)
    return () => document.body.classList.remove('og-mode')
  }, [isOgMode])

  const { devices } = useDevices()

  // Device selection persisted in URL (?d=gym+br)
  const deviceParam = useMemo(() => deviceIdsParam(devices), [devices])
  const [selectedDeviceIds, setSelectedDeviceIds] = useUrlState('d', deviceParam)

  // Time range persisted in URL (?t=...)
  const [timeRange, setTimeRange] = useUrlState('t', timeRangeParam)

  // Smart polling can be disabled with ?ri=0
  const [refetchIntervalOverride] = useUrlState('ri', refetchIntervalParam)
  const smartPolling = refetchIntervalOverride !== 0

  // Smoothing window for rolling averages (extends fetch range for edge accuracy)
  const [smoothing] = useUrlState('s', smoothingParam)

  // Device data results from DevicePoller components
  const [deviceResults, setDeviceResults] = useState<Map<number, DeviceDataResult>>(new Map())

  // Device being hovered for preview (triggers data fetch if not already loaded)
  const [hoverDeviceId, setHoverDeviceId] = useState<number | null>(null)

  // Devices to poll: selected + hovered (for preview)
  const deviceIdsToFetch = useMemo(() => {
    const ids = new Set(selectedDeviceIds)
    if (hoverDeviceId !== null) {
      ids.add(hoverDeviceId)
    }
    return Array.from(ids)
  }, [selectedDeviceIds, hoverDeviceId])

  // Callback for DevicePoller to report results
  const handleDeviceResult = useCallback((result: DeviceDataResult) => {
    setDeviceResults(prev => {
      const next = new Map(prev)
      next.set(result.deviceId, result)
      return next
    })
  }, [])

  // Convert map to array - include all devices with data for preview support
  // (AwairChart's displayDeviceAggregations handles filtering for actual display)
  const deviceDataResults = useMemo(
    () => Array.from(deviceResults.values()),
    [deviceResults]
  )

  // Combine results - only consider actively fetched devices for loading state
  const { combinedData, combinedSummary, isInitialLoad, error } = useMemo(() => {
    const allData = deviceDataResults.flatMap(r => r.data)
    // Only check isInitialLoad for devices we're actively fetching (not stale results from hover previews)
    const activeResults = deviceDataResults.filter(r => deviceIdsToFetch.includes(r.deviceId))
    const anyInitialLoad = activeResults.some(r => r.isInitialLoad)
    const firstError = activeResults.find(r => r.error)?.error || null

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

    // Emit a one-line state snapshot per render. Captured by errorOverlay
    // (when `?dbg`) so we can diagnose "blank page" cases on mobile —
    // tells us at a glance whether `combinedData.length === 0` etc.
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dbg')) {
      const perDevice = deviceDataResults.map(r =>
        `${r.deviceId}:${r.data.length}${r.error ? '!' : ''}${r.isInitialLoad ? '⏳' : ''}`,
      ).join(' ')
      console.log(
        `[state] devices=${devices.length} selected=[${selectedDeviceIds.join(',')}] ` +
          `fetching=[${deviceIdsToFetch.join(',')}] results={${perDevice}} ` +
          `data=${allData.length} initLoad=${anyInitialLoad} err=${firstError ?? 'null'}`,
      )
    }

    return {
      combinedData: allData,
      combinedSummary,
      isInitialLoad: anyInitialLoad,
      error: firstError,
    }
  }, [deviceDataResults, deviceIdsToFetch])

  // Show full-screen loading only on initial load (no data yet)
  if (isInitialLoad && combinedData.length === 0) {
    return (
      <div className="app">
        <div className="loading">
          <h1>Loading Awair Data...</h1>
          <p>Fetching air quality data from S3...</p>
        </div>
        {/* Render pollers even during loading */}
        {deviceIdsToFetch.map(deviceId => (
          <DevicePoller
            key={deviceId}
            deviceId={deviceId}
            timeRange={timeRange}
            smoothing={smoothing}
            smartPolling={smartPolling}
            onResult={handleDeviceResult}
          />
        ))}
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
        {/* Render pollers even during error */}
        {deviceIdsToFetch.map(deviceId => (
          <DevicePoller
            key={deviceId}
            deviceId={deviceId}
            timeRange={timeRange}
            smoothing={smoothing}
            smartPolling={smartPolling}
            onResult={handleDeviceResult}
          />
        ))}
      </div>
    )
  }

  // Fetch returned but yielded no rows for the current selection. Most common
  // cause is a stale/missing pyrmts upper-tier shard for a device — the shard
  // exists but is empty at the requested tier (see `pyrmtsSource.ts` warn).
  // Show a clear panel with quick-links to try different params, so the page
  // is never silently blank.
  const showEmptyState =
    !isInitialLoad &&
    !error &&
    combinedData.length === 0 &&
    deviceIdsToFetch.length > 0 &&
    deviceDataResults.some(r => r.summary !== null || r.data !== undefined)

  return (
    <div className="app">
      {/* Headless device pollers - one per selected device */}
      {deviceIdsToFetch.map(deviceId => (
        <DevicePoller
          key={deviceId}
          deviceId={deviceId}
          timeRange={timeRange}
          smoothing={smoothing}
          smartPolling={smartPolling}
          onResult={handleDeviceResult}
        />
      ))}
      <main>
        {/* Only show loading overlay during initial load, not background refreshes */}
        {isInitialLoad && combinedData.length > 0 && (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        )}
        {showEmptyState && (
          <div className="empty-state">
            <h1>No data for current selection</h1>
            <p>
              The server returned <strong>0 records</strong> for the requested
              tier &times; time range &times; device(s). This usually means a
              pyrmts upper-tier shard is stale — check the console for the
              <code>⚠️ empty shard</code> warning to see which tier.
            </p>
            <p>Quick fixes to try:</p>
            <ul>
              <li>
                Widen the viewport (or close DevTools) — a wider window picks a
                finer tier, and <code>raw</code> is usually populated even when
                aggregates aren't.
              </li>
              <li>
                <a href="?t=-7d">Try a 7d range</a> (older data may cross a
                working shard boundary).
              </li>
              <li>
                <a href="?d=+desk+br+rt">Add other devices</a> to the selection.
              </li>
            </ul>
            <details>
              <summary>Diagnostics</summary>
              <pre>
                {`viewport=${typeof window !== 'undefined' ? window.innerWidth : '?'}
devices=${deviceIdsToFetch.join(',')}
range=${timeRange.timestamp ?? 'latest'}/${timeRange.duration}ms
smoothing=${smoothing}
per-device=${deviceDataResults.map(r => `${r.deviceId}:${r.data.length}rows`).join(' ')}`}
              </pre>
            </details>
          </div>
        )}
        {combinedData.length > 0 && (
          <AwairChart
            deviceDataResults={deviceDataResults}
            summary={combinedSummary}
            devices={devices}
            selectedDeviceIds={selectedDeviceIds}
            onDeviceSelectionChange={setSelectedDeviceIds}
            onHoverDeviceId={setHoverDeviceId}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            isOgMode={isOgMode}
          />
        )}
      </main>
      {
        !isOgMode &&
          <>
            <SpeedDial actions={[
              { key: 'github', label: 'GitHub', icon: <FaGithub />, href: 'https://github.com/runsascoded/awair' },
              {
                key: 'theme',
                label: `Theme: ${theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'System'}`,
                icon: theme === 'light' ? <MdLightMode /> : theme === 'dark' ? <MdDarkMode /> : <MdBrightnessAuto />,
                onClick: () => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'),
              },
            ]} />
            <ShortcutsModal
              groups={HOTKEY_GROUPS}
              groupOrder={HOTKEY_GROUP_ORDER}
              groupRenderers={GROUP_RENDERERS}
              editable
              hint="Click any key to customize"
              TooltipComponent={KbdTooltip}
            />
            <Omnibar placeholder="Search actions..." maxResults={15} />
            <LookupModal />
            <SequenceModal />
          </>
      }
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HotkeysProvider config={{ sequenceTimeout: Infinity }}>
          <AppContent />
        </HotkeysProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
