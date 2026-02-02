import { abs, ceil, floor, max } from "@rdub/base"
import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react'
import Plot from 'react-plotly.js'
import { useAction } from 'use-kbd'
import { useUrlState } from 'use-prms'
import { ChartControls, metricConfig, getRangeFloor } from './ChartControls'
import { CustomLegend } from './CustomLegend'
import { DataTable } from './DataTable'
import { TIME_WINDOWS, getWindowForDuration } from '../hooks/useDataAggregation'
import { useLatestMode } from '../hooks/useLatestMode'
import { useMetrics } from '../hooks/useMetrics'
import { useMobile } from '../hooks/useMobile'
import { useMultiDeviceAggregation } from '../hooks/useMultiDeviceAggregation'
import { usePlotlyHoverDismiss } from '../hooks/usePlotlyHoverDismiss'
import { useTimeRangeParam } from '../hooks/useTimeRangeParam'
import { deviceRenderStrategyParam, hsvConfigParam, intFromList, rangeFloorsParam, rawOpacityParam, smoothingParam, stddevOpacityParam, xGroupingParam } from '../lib/urlParams'
import { getFileBounds } from '../services/awairService'
import { formatForPlotly } from '../utils/dateFormat'
import { getDeviceLineProps } from '../utils/deviceRenderStrategy'
import type { PxOption } from './AggregationControl'
import type { DeviceDataResult } from './DevicePoller'
import type { Metric } from '../lib/urlParams'
import type { Device } from '../services/awairService'
import type { DataSummary } from '../types/awair'
import type { Data, PlotRelayoutEvent } from 'plotly.js'

// Extend Data type to include zorder (supported by plotly.js but not in @types/plotly.js); https://github.com/DefinitelyTyped/DefinitelyTyped/pull/74155 will fix
type DataWithZorder = Data & { zorder?: number }

const noop = () => {}

export type HasDeviceIdx = { deviceIdx: number }
export type HasMetric = { metric: 'primary' | 'secondary' }

export type LegendHoverState =
  | { type: 'device' } & HasDeviceIdx
  | { type: 'trace' } & HasDeviceIdx & HasMetric
  | { type: 'metric' } & HasMetric
  | null

interface Props {
  deviceDataResults: DeviceDataResult[]
  summary: DataSummary | null
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
  onHoverDeviceId?: (deviceId: number | null) => void
  timeRange: { timestamp: Date | null; duration: number }
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void
  isOgMode?: boolean
}

export const AwairChart = memo(function AwairChart(
  {
    deviceDataResults,
    summary,
    devices,
    selectedDeviceIds,
    onDeviceSelectionChange,
    onHoverDeviceId,
    timeRange: timeRangeFromProps,
    setTimeRange: setTimeRangeFromProps,
    isOgMode = false,
  }: Props
) {

  // Combine data from all devices for time range calculations and bounds checking
  // Sorted newest-first for efficient latest record access
  const data = useMemo(() => {
    return deviceDataResults
      .flatMap(r => r.data)
      .sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
  }, [deviceDataResults])

  // Y-axes state - combined primary + secondary + per-axis auto-range in URL (?y=tc, ?y=tca, ?y=tcaA)
  const metrics = useMetrics()
  const { l, r } = metrics

  // Device render strategy: how to visually distinguish multiple devices
  const [deviceRenderStrategy, setDeviceRenderStrategy] = useUrlState('dr', deviceRenderStrategyParam)

  // HSL config for hsv-nudge strategy
  const [hsvConfig, setHsvConfig] = useUrlState('hsl', hsvConfigParam)

  // X-axis grouping: auto mode (px values) or fixed window mode (time labels)
  const [xGrouping, setXGrouping] = useUrlState('x', xGroupingParam)

  // Custom range floors per metric (e.g., ?f=t32 for temp floor=32°F)
  const [rangeFloors, setRangeFloors] = useUrlState('f', rangeFloorsParam)

  // Smoothing: rolling average window size in minutes (0 = off)
  const [smoothing, setSmoothing] = useUrlState('s', smoothingParam)

  // Stddev band opacity (0-100%)
  const [stddevOpacity, setStddevOpacity] = useUrlState('so', stddevOpacityParam)

  // Raw line opacity when smoothing enabled (0-100%)
  const [rawOpacity, setRawOpacity] = useUrlState('ro', rawOpacityParam)

  // Helper to get effective floor (custom or default from metricConfig)
  const getEffectiveFloor = useCallback((metric: Metric) => {
    if (rangeFloors[metric] !== undefined) {
      return rangeFloors[metric]!
    }
    return getRangeFloor(metric)
  }, [rangeFloors])

  // Derive targetPx and overrideWindow from unified xGrouping state
  const targetPx = xGrouping.mode === 'auto' ? xGrouping.targetPx : null
  const overrideWindow = useMemo(() => {
    if (xGrouping.mode === 'fixed') {
      return TIME_WINDOWS.find(w => w.label === xGrouping.windowLabel)
    }
    return undefined
  }, [xGrouping])

  const isMobile = useMobile()
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)

  // Legend hover state - tracks what is currently hovered
  const [hoverState, setHoverState] = useState<LegendHoverState>(null)

  // Auto-range button display state - what the buttons are currently showing (including preview)
  const [leftAutoRangeDisplay, setLeftAutoRangeDisplay] = useState(l.autoRange)
  const [rightAutoRangeDisplay, setRightAutoRangeDisplay] = useState(r.autoRange)

  // Device preview state - for showing what would happen if a device checkbox is toggled
  const [previewDeviceIds, setPreviewDeviceIds] = useState<number[] | null>(null)

  // Use preview device IDs when available, otherwise actual selected IDs
  const displayDeviceIds = previewDeviceIds ?? selectedDeviceIds

  // Refs for handling programmatic updates
  const ignoreNextRelayoutRef = useRef(false)
  const plotContainerRef = useRef<HTMLDivElement>(null)

  // Compute window size for buffer calculation (before useTimeRangeParam)
  const windowMinutes = useMemo(() => {
    return getWindowForDuration(timeRangeFromProps.duration, {
      containerWidth: viewportWidth,
      overrideWindow,
      targetPx,
    }).minutes
  }, [timeRangeFromProps.duration, viewportWidth, overrideWindow, targetPx])

  // Time range management - use props instead of internal hook
  const {
    xAxisRange,
    latestModeIntended,
    setXAxisRange,
    setLatestModeIntended,
    setDuration
  } = useTimeRangeParam(data, timeRangeFromProps, setTimeRangeFromProps, windowMinutes)

  // Metrics and Y-axis mode now persisted in URL params (via useUrlState above)

  // Time range handlers
  const handleTimeRangeClick = useCallback((hours: number) => {
    if (data.length === 0) return
    const duration = hours * 60 * 60 * 1000
    const latestTime = new Date(data[0].timestamp)
    const earliestTime = new Date(latestTime.getTime() - duration)
    const newRange: [string, string] = [formatForPlotly(earliestTime), formatForPlotly(latestTime)]
    setXAxisRange(newRange, { duration })
  }, [data, setXAxisRange])

  const setRangeByWidth = useCallback((hours: number, centerTime?: Date) => {
    if (data.length === 0) return
    const duration = hours * 60 * 60 * 1000
    const center = centerTime || (xAxisRange ? new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2) : new Date(data[0].timestamp))
    const halfRange = duration / 2
    const newStart = new Date(center.getTime() - halfRange)
    const newEnd = new Date(center.getTime() + halfRange)

    const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(newEnd)]
    setXAxisRange(newRange, { duration })
  }, [xAxisRange, data, setXAxisRange])

  // Extract custom hooks - use multi-device aggregation
  const { deviceAggregations, selectedWindow, validWindows, isRawData } = useMultiDeviceAggregation(
    deviceDataResults,
    devices,
    xAxisRange,
    { containerWidth: viewportWidth, overrideWindow, targetPx },
    smoothing
  )

  // Filter device aggregations for display (when previewing a device checkbox toggle)
  const displayDeviceAggregations = useMemo(() => {
    return deviceAggregations.filter(d => displayDeviceIds.includes(d.deviceId))
  }, [deviceAggregations, displayDeviceIds])

  // Track which device to show in the DataTable (defaults to first device)
  const [selectedDeviceIdForTable, setSelectedDeviceIdForTable] = useState<number | undefined>(undefined)

  // Auto-select first device when deviceAggregations changes, or reset if selected device no longer available
  useEffect(() => {
    if (deviceAggregations.length === 0) return
    const selectedStillAvailable = deviceAggregations.some(d => d.deviceId === selectedDeviceIdForTable)
    if (!selectedStillAvailable) {
      setSelectedDeviceIdForTable(deviceAggregations[0].deviceId)
    }
  }, [deviceAggregations, selectedDeviceIdForTable])

  // Table page size - persisted in URL
  const [tablePageSize, setTablePageSize] = useUrlState('p', intFromList([10, 20, 50, 100, 200] as const, 20))

  // Get the selected device's aggregated data for the table
  const selectedDeviceAggregation = deviceAggregations.find(d => d.deviceId === selectedDeviceIdForTable)
  const aggregatedData = selectedDeviceAggregation?.aggregatedData || []

  // Calculate time range in minutes for aggregation control
  const timeRangeMinutes = useMemo(() => {
    if (xAxisRange) {
      const startTime = new Date(xAxisRange[0]).getTime()
      const endTime = new Date(xAxisRange[1]).getTime()
      return (endTime - startTime) / (1000 * 60)
    } else if (data.length > 1) {
      const firstTime = new Date(data[data.length - 1].timestamp).getTime()
      const lastTime = new Date(data[0].timestamp).getTime()
      return (lastTime - firstTime) / (1000 * 60)
    }
    return undefined
  }, [xAxisRange, data])

  const {
    autoUpdateRange,
    setIgnoreNextPanCheck
  } = useLatestMode(data, xAxisRange, latestModeIntended, setLatestModeIntended)

  // Helper: Get all device bounds for selected devices
  const getAllDeviceBounds = useCallback(() => {
    return selectedDeviceIds
      .map(id => getFileBounds(id))
      .filter((bounds): bounds is { earliest: Date; latest: Date } => bounds !== null)
  }, [selectedDeviceIds])

  // Handle auto-update from Latest mode hook
  useEffect(() => {
    if (autoUpdateRange) {
      setXAxisRange(autoUpdateRange)
    }
  }, [autoUpdateRange])

  // Determine which time range button is active based on the requested duration
  const getActiveTimeRange = useCallback(() => {
    // Use the requested duration from props, not the chart's x-axis range
    const durationHours = timeRangeFromProps.duration / (1000 * 60 * 60)
    const isLatestView = latestModeIntended

    // Check range width with tolerance
    if (abs(durationHours - 12) < 1) return isLatestView ? 'latest-12h' : '12h'
    if (abs(durationHours - 24) < 2) return isLatestView ? 'latest-1d' : '1d'
    if (abs(durationHours - (24 * 3)) < 6) return isLatestView ? 'latest-3d' : '3d'
    if (abs(durationHours - (24 * 7)) < 12) return isLatestView ? 'latest-7d' : '7d'
    if (abs(durationHours - (24 * 14)) < 24) return isLatestView ? 'latest-14d' : '14d'
    if (abs(durationHours - (24 * 31)) < 24) return isLatestView ? 'latest-1mo' : '1mo'
    if (abs(durationHours - (24 * 62)) < 48) return isLatestView ? 'latest-2mo' : '2mo'
    if (abs(durationHours - (24 * 92)) < 48) return isLatestView ? 'latest-3mo' : '3mo'

    // "All" is only active when duration exceeds 3 months
    if (durationHours > 24 * 100) return 'all'

    return isLatestView ? 'latest-custom' : 'custom'
  }, [timeRangeFromProps.duration, latestModeIntended])

  // Double click handler
  const handleDoubleClick = useCallback(() => {
    if (data.length > 0) {
      ignoreNextRelayoutRef.current = true
      const fullRange: [string, string] = [
        formatForPlotly(new Date(data[data.length - 1].timestamp)),
        formatForPlotly(new Date(data[0].timestamp))
      ]
      setXAxisRange(fullRange)
    } else {
      setXAxisRange(null)
    }
  }, [data])

  // Dismiss hover tooltip when clicking outside plot area (mobile only for now)
  const setupHoverDismiss = usePlotlyHoverDismiss(plotContainerRef, isMobile)

  // "All" handler - show full data extent from file bounds
  const handleAllClick = useCallback(() => {
    const allBounds = getAllDeviceBounds()
    if (allBounds.length === 0) return

    // Find overall earliest and latest across all devices
    const earliest = allBounds.reduce((min, b) => b.earliest < min ? b.earliest : min, allBounds[0].earliest)
    const latest = allBounds.reduce((max, b) => b.latest > max ? b.latest : max, allBounds[0].latest)
    const durationMs = latest.getTime() - earliest.getTime()

    // Set the visual range (anchored to current time in Latest mode)
    const BUFFER_MS = 60 * 1000 // 1 minute buffer
    const endTime = new Date(new Date().getTime() + BUFFER_MS)
    const startTime = new Date(endTime.getTime() - durationMs)
    setXAxisRange([formatForPlotly(startTime), formatForPlotly(endTime)])

    // Use Latest mode (timestamp=null) so it auto-follows new data, but with full duration
    setTimeRangeFromProps({ timestamp: null, duration: durationMs })
  }, [getAllDeviceBounds, setXAxisRange, setTimeRangeFromProps])

  // Relayout handler
  const handleRelayout = useCallback((eventData: PlotRelayoutEvent) => {
    const x0 = eventData['xaxis.range[0]']
    const x1 = eventData['xaxis.range[1]']
    if (x0 !== undefined && x1 !== undefined) {
      // PlotRelayoutEvent types these as number, but for date axes they're strings
      const newStart = new Date(x0 as unknown as string)
      const newEnd = new Date(x1 as unknown as string)
      const newDuration = newEnd.getTime() - newStart.getTime()

      // Check if range end goes into the future
      const allBounds = getAllDeviceBounds()
      if (allBounds.length > 0) {
        const absoluteLatest = allBounds.reduce((max, b) => b.latest > max ? b.latest : max, allBounds[0].latest)
        const FUTURE_BUFFER = 2 * 60 * 1000 // 2 minutes

        if (newEnd.getTime() > absoluteLatest.getTime() + FUTURE_BUFFER) {
          // End is in future - clamp to latest but keep the new duration
          // This happens when zooming out in Latest mode
          setXAxisRange(null, { duration: newDuration }) // null = Latest mode
          return
        }
      }

      setXAxisRange([formatForPlotly(newStart), formatForPlotly(newEnd)], { duration: newDuration })
    }
  }, [setXAxisRange, getAllDeviceBounds])

  // Helper: set primary metric (swapping if needed)
  const setLeftMetric = useCallback((metric: Metric) => {
    l.set(metric)
    if (r.val === metric) r.set('none')
  }, [l, r])

  // Helper: set secondary metric (swapping if needed)
  const setRightMetric = useCallback((metric: Metric) => {
    if (metric === l.val && r.val !== 'none') {
      l.set(r.val as typeof metric)
      r.set(metric)
    } else if (metric !== l.val) {
      r.set(metric)
    }
  }, [l, r])

  // Helper: toggle device by name pattern
  const toggleDeviceByPattern = useCallback((pattern: string) => {
    const regex = new RegExp(pattern, 'i')
    const device = devices.find(d => regex.test(d.name))
    if (!device) return
    const deviceId = device.deviceId
    if (selectedDeviceIds.includes(deviceId)) {
      if (selectedDeviceIds.length > 1) {
        onDeviceSelectionChange(selectedDeviceIds.filter(id => id !== deviceId))
      }
    } else {
      onDeviceSelectionChange([...selectedDeviceIds, deviceId])
    }
  }, [devices, selectedDeviceIds, onDeviceSelectionChange])

  // Helper: toggle latest mode
  const toggleLatestMode = useCallback(() => {
    if (latestModeIntended) {
      setLatestModeIntended(false)
    } else if (xAxisRange && data.length > 0) {
      const rangeStart = new Date(xAxisRange[0])
      const rangeEnd = new Date(xAxisRange[1])
      const currentWidth = rangeEnd.getTime() - rangeStart.getTime()
      const latestTime = new Date(data[0].timestamp)
      const newStart = new Date(latestTime.getTime() - currentWidth)
      setIgnoreNextPanCheck()
      setXAxisRange([formatForPlotly(newStart), formatForPlotly(latestTime)])
      setLatestModeIntended(true)
    }
  }, [latestModeIntended, setLatestModeIntended, xAxisRange, data, setIgnoreNextPanCheck, setXAxisRange])

  // ===== Register actions with useAction =====

  // Left Y-axis metrics
  useAction('left:temp', { label: 'Temperature', group: 'Y-Axis Metrics', defaultBindings: ['t'], handler: () => setLeftMetric('temp') })
  useAction('left:co2', { label: 'CO₂', group: 'Y-Axis Metrics', defaultBindings: ['c'], handler: () => setLeftMetric('co2') })
  useAction('left:humid', { label: 'Humidity', group: 'Y-Axis Metrics', defaultBindings: ['h'], handler: () => setLeftMetric('humid') })
  useAction('left:pm25', { label: 'PM2.5', group: 'Y-Axis Metrics', defaultBindings: ['p'], handler: () => setLeftMetric('pm25') })
  useAction('left:voc', { label: 'VOC', group: 'Y-Axis Metrics', defaultBindings: ['v'], handler: () => setLeftMetric('voc') })
  useAction('left:autorange', { label: 'Toggle auto-range', group: 'Y-Axis Metrics', defaultBindings: ['a'], handler: () => l.setAutoRange(!l.autoRange) })

  // Right Y-axis metrics
  useAction('right:temp', { label: 'Temperature', group: 'Y-Axis Metrics', defaultBindings: ['shift+t'], handler: () => setRightMetric('temp') })
  useAction('right:co2', { label: 'CO₂', group: 'Y-Axis Metrics', defaultBindings: ['shift+c'], handler: () => setRightMetric('co2') })
  useAction('right:humid', { label: 'Humidity', group: 'Y-Axis Metrics', defaultBindings: ['shift+h'], handler: () => setRightMetric('humid') })
  useAction('right:pm25', { label: 'PM2.5', group: 'Y-Axis Metrics', defaultBindings: ['shift+p'], handler: () => setRightMetric('pm25') })
  useAction('right:voc', { label: 'VOC', group: 'Y-Axis Metrics', defaultBindings: ['shift+v'], handler: () => setRightMetric('voc') })
  useAction('right:none', { label: 'Clear', group: 'Y-Axis Metrics', defaultBindings: ['shift+n'], handler: () => r.set('none') })
  useAction('right:autorange', { label: 'Toggle auto-range', group: 'Y-Axis Metrics', defaultBindings: ['shift+a'], handler: () => { if (r.val !== 'none') r.setAutoRange(!r.autoRange) } })

  // Time ranges - dynamic with digit wildcards
  useAction('time:hours', { label: 'Range: N hours', group: 'Time Range', defaultBindings: ['\\d+ h', 'h \\d+'], keywords: ['hours'], handler: useCallback((_, captures) => handleTimeRangeClick(captures?.[0] ?? 1), [handleTimeRangeClick]) })
  useAction('time:days', { label: 'Range: N days', group: 'Time Range', defaultBindings: ['\\d+ d', 'd \\d+'], keywords: ['days'], handler: useCallback((_, captures) => handleTimeRangeClick((captures?.[0] ?? 1) * 24), [handleTimeRangeClick]) })
  useAction('time:weeks', { label: 'Range: N weeks', group: 'Time Range', defaultBindings: ['\\d+ w', 'w \\d+'], keywords: ['weeks'], handler: useCallback((_, captures) => handleTimeRangeClick((captures?.[0] ?? 1) * 24 * 7), [handleTimeRangeClick]) })
  useAction('time:months', { label: 'Range: N months', group: 'Time Range', defaultBindings: ['\\d+ m', 'm \\d+'], keywords: ['months'], handler: useCallback((_, captures) => handleTimeRangeClick((captures?.[0] ?? 1) * 24 * 31), [handleTimeRangeClick]) })
  // Special time ranges (not digit-based)
  useAction('time:all', { label: 'Full history', group: 'Time Range', defaultBindings: ['f'], keywords: ['all', 'everything', 'max', 'full'], handler: handleAllClick })
  useAction('time:latest', { label: 'Latest', group: 'Time Range', defaultBindings: ['l'], keywords: ['now', 'current', 'live'], handler: toggleLatestMode })

  // Devices
  useAction('device:gym', { label: 'Gym', group: 'Toggle devices on/off', defaultBindings: ['g'], handler: () => toggleDeviceByPattern('gym') })
  useAction('device:br', { label: 'BR', group: 'Toggle devices on/off', defaultBindings: ['b'], keywords: ['bedroom'], handler: () => toggleDeviceByPattern('br') })
  useAction('device:rt', { label: 'RT', group: 'Toggle devices on/off', defaultBindings: ['r'], handler: () => toggleDeviceByPattern('rt') })

  // X-axis grouping (aggregation)
  useAction('agg:1px', { label: '1px', group: 'X Grouping', defaultBindings: ['x 1'], keywords: ['1px', 'auto', 'aggregation'], handler: () => setXGrouping({ mode: 'auto', targetPx: 1 }) })
  useAction('agg:2px', { label: '2px', group: 'X Grouping', defaultBindings: ['x 2'], keywords: ['2px', 'auto', 'aggregation'], handler: () => setXGrouping({ mode: 'auto', targetPx: 2 }) })
  useAction('agg:4px', { label: '4px', group: 'X Grouping', defaultBindings: ['x 4'], keywords: ['4px', 'auto', 'aggregation'], handler: () => setXGrouping({ mode: 'auto', targetPx: 4 }) })
  useAction('agg:8px', { label: '8px', group: 'X Grouping', defaultBindings: ['x 8'], keywords: ['8px', 'auto', 'aggregation'], handler: () => setXGrouping({ mode: 'auto', targetPx: 8 }) })

  // Smoothing (rolling average) - accepts any value, not just presets
  useAction('smooth:minutes', { label: 'Smooth: N minutes', group: 'Smoothing', defaultBindings: ['\\d+ M', 'M \\d+'], keywords: ['smooth', 'rolling', 'average'], handler: useCallback((_, captures) => {
    setSmoothing(captures?.[0] ?? 5)
  }, [setSmoothing]) })

  useAction('smooth:hours', { label: 'Smooth: N hours', group: 'Smoothing', defaultBindings: ['\\d+ H', 'H \\d+'], keywords: ['smooth', 'rolling', 'average'], handler: useCallback((_, captures) => {
    setSmoothing((captures?.[0] ?? 1) * 60)
  }, [setSmoothing]) })

  useAction('smooth:days', { label: 'Smooth: N days', group: 'Smoothing', defaultBindings: ['\\d+ D', 'D \\d+'], keywords: ['smooth', 'rolling', 'average'], handler: useCallback((_, captures) => {
    setSmoothing((captures?.[0] ?? 1) * 1440)
  }, [setSmoothing]) })

  useAction('smooth:off', { label: 'Smooth: Off', group: 'Smoothing', defaultBindings: ['0 M', 'O'], keywords: ['smooth', 'off', 'none', 'disable'], handler: () => setSmoothing(1) })

  // Dynamic page title: "Gym BR 🌡️ 💦" format
  useEffect(() => {
    const metricEmoji: Record<Metric | 'none', string> = {
      temp: '🌡️',
      co2: '💨',
      humid: '💦',
      pm25: '🌫️',
      voc: '🧪',
      none: '',
    }

    // Get short device names (use device name directly, should already be short like "Gym", "BR")
    const deviceNames = selectedDeviceIds
      .map(id => devices.find(d => d.deviceId === id)?.name)
      .filter(Boolean)
      .join(' ')

    // Get metric emojis (left first, then right if different)
    const leftEmoji = metricEmoji[l.val]
    const rightEmoji = r.val !== 'none' && r.val !== l.val ? metricEmoji[r.val] : ''

    const title = [deviceNames, leftEmoji, rightEmoji].filter(Boolean).join(' ') || 'Awair'
    document.title = title
  }, [selectedDeviceIds, devices, l.val, r.val])

  // Track viewport width for responsive layout
  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  // Gate scroll zoom behind meta+scroll to avoid accidental zooms while scrolling page
  useEffect(() => {
    const container = plotContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      // Only allow scroll zoom if meta key is pressed
      if (!e.metaKey && !e.ctrlKey) {
        e.stopPropagation()
      }
    }

    // Use capture phase to intercept before plotly sees it
    container.addEventListener('wheel', handleWheel, { capture: true })
    return () => container.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])

  // Theme-aware plot colors
  const computePlotColors = useCallback(() => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    return {
      gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--plot-grid').trim() || '#ddd',
      plotBg: getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim() || 'white',
      legendBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || 'white',
      textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333',
      spikeColor: isDark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)',
    }
  }, [])

  const [plotColors, setPlotColors] = useState(computePlotColors)

  useEffect(() => {
    const updatePlotColors = () => setPlotColors(computePlotColors())

    // Watch for theme changes
    const observer = new MutationObserver(updatePlotColors)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => observer.disconnect()
  }, [])

  // Custom tick formatting
  const generateCustomTicks = useCallback(() => {
    if (!xAxisRange || data.length === 0) return { tickvals: [], ticktext: [] }

    const startTime = new Date(xAxisRange[0])
    const endTime = new Date(xAxisRange[1])
    const totalHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)

    // Dynamic tick count based on actual viewport width
    const plotWidth = max(300, viewportWidth - 100) // Account for margins, min 300px
    const maxTicks = floor(plotWidth / 30) // ~80px per tick
    const minTicks = max(3, floor(plotWidth / 120)) // At least 3 ticks

    let tickIntervalHours: number
    if (totalHours <= 6) tickIntervalHours = 1
    else if (totalHours <= 24) tickIntervalHours = 2
    else if (totalHours <= 72) tickIntervalHours = 6
    else if (totalHours <= 168) tickIntervalHours = 12
    else tickIntervalHours = 24

    // Adjust interval to fit within tick count limits
    const estimatedTicks = ceil(totalHours / tickIntervalHours)
    if (estimatedTicks > maxTicks) {
      tickIntervalHours = ceil(totalHours / maxTicks)
    } else if (estimatedTicks < minTicks) {
      tickIntervalHours = max(1, floor(totalHours / minTicks))
    }

    const tickvals: string[] = []
    const ticktext: string[] = []
    let currentDate = ''
    let isFirstTick = true

    // Generate ticks starting from a rounded hour, but ensure first tick is within range
    const startHour = new Date(startTime)
    startHour.setMinutes(0, 0, 0)

    // If rounded hour is before start time, advance to next interval
    if (startHour < startTime) {
      startHour.setHours(startHour.getHours() + tickIntervalHours)
    }

    for (let tickTime = new Date(startHour); tickTime <= endTime; tickTime.setHours(tickTime.getHours() + tickIntervalHours)) {
      const currentYear = new Date().getFullYear()
      const tickYear = tickTime.getFullYear()
      const isCurrentYear = tickYear === currentYear

      const tickDate = isCurrentYear
        ? tickTime.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
        : tickTime.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })

      const tickHour = tickTime.getHours()
      const hour12 = tickHour === 0 ? 12 : tickHour > 12 ? tickHour - 12 : tickHour
      const ampm = tickHour < 12 ? 'am' : 'pm'

      tickvals.push(formatForPlotly(tickTime))

      if (isFirstTick || tickDate !== currentDate) {
        // First tick overall OR first tick for this date - show date and time
        ticktext.push(`${hour12}${ampm}<br>${tickDate}`)
        currentDate = tickDate
        isFirstTick = false
      } else {
        // Subsequent ticks for same date - show only time
        ticktext.push(`${hour12}${ampm}`)
      }
    }

    return { tickvals, ticktext }
  }, [xAxisRange, data, isMobile, viewportWidth])

  const { tickvals, ticktext } = generateCustomTicks()

  // Plot data preparation
  const config = metricConfig[l.val] || metricConfig.temp
  const secondaryConfig = r.val !== 'none' ? metricConfig[r.val] : null
  const totalDevices = displayDeviceAggregations.length

  // Helper to calculate trace opacity based on hover state
  const getTraceOpacity = useCallback((deviceIdx: number, metric: 'primary' | 'secondary'): number => {
    if (!hoverState) return 1.0
    if (hoverState.type === 'device') {
      return hoverState.deviceIdx === deviceIdx ? 1.0 : 0.2
    }
    if (hoverState.type === 'trace') {
      return hoverState.deviceIdx === deviceIdx && hoverState.metric === metric ? 1.0 : 0.2
    }
    // hoverState.type === 'metric'
    return hoverState.metric === metric ? 1.0 : 0.2
  }, [hoverState])

  // Convert opacity percent (0-100) to 2-char hex (00-ff)
  const opacityHex = useMemo(() => {
    const value = Math.round((stddevOpacity / 100) * 255)
    return value.toString(16).padStart(2, '0')
  }, [stddevOpacity])

  // Check if smoothing is enabled (any device has smoothedData)
  const hasSmoothing = displayDeviceAggregations.some(d => d.smoothedData !== null)

  // Generate traces for all devices, grouped by metric for better hover ordering
  const plotTraces = useMemo(() => {
    const traces: DataWithZorder[] = []

    // Pre-compute data for all devices (raw and smoothed)
    const deviceData = displayDeviceAggregations.map((deviceAgg, deviceIdx) => {
      const { aggregatedData: rawData, smoothedData, deviceName } = deviceAgg
      const timestamps = rawData.map(d => formatForPlotly(new Date(d.timestamp)))
      const smoothedTimestamps = smoothedData?.map(d => formatForPlotly(new Date(d.timestamp))) ?? []

      // Line width: thin for raw when smoothing, normal otherwise
      const rawLineWidth = hasSmoothing ? 1 : 2
      const smoothedLineWidth = 3

      // Get line props for primary metric (raw data)
      const primaryLineProps = getDeviceLineProps(
        config.color,
        deviceIdx,
        totalDevices,
        deviceRenderStrategy,
        rawLineWidth,
        hsvConfig
      )

      // Get line props for smoothed overlay (thicker)
      const primarySmoothedLineProps = hasSmoothing ? getDeviceLineProps(
        config.color,
        deviceIdx,
        totalDevices,
        deviceRenderStrategy,
        smoothedLineWidth,
        hsvConfig
      ) : null

      // Primary metric - raw data
      const avgValues = rawData.map(d => d[`${l.val}_avg` as keyof typeof d] as number | null)
      const stddevValues = rawData.map(d => d[`${l.val}_stddev` as keyof typeof d] as number | null)

      // Primary metric - smoothed data (for overlay and stddev bands)
      const smoothedAvgValues = smoothedData?.map(d => d[`${l.val}_avg` as keyof typeof d] as number | null) ?? []
      const smoothedStddevValues = smoothedData?.map(d => d[`${l.val}_stddev` as keyof typeof d] as number | null) ?? []
      // Propagate nulls: null + anything = null (avoid JS's null + null = 0)
      const upperValues = smoothedAvgValues.map((avg, i) =>
        avg === null || smoothedStddevValues[i] === null ? null : avg + smoothedStddevValues[i]
      )
      const lowerValues = smoothedAvgValues.map((avg, i) =>
        avg === null || smoothedStddevValues[i] === null ? null : avg - smoothedStddevValues[i]
      )

      // Secondary metric - raw data
      const secondaryAvgValues = secondaryConfig && r.val !== 'none'
        ? rawData.map(d => d[`${r.val}_avg` as keyof typeof d] as number | null)
        : []
      const secondaryStddevValues = secondaryConfig && r.val !== 'none'
        ? rawData.map(d => d[`${r.val}_stddev` as keyof typeof d] as number | null)
        : []

      // Secondary metric - smoothed data
      const secondarySmoothedAvgValues = secondaryConfig && smoothedData
        ? smoothedData.map(d => d[`${r.val}_avg` as keyof typeof d] as number | null)
        : []
      const secondarySmoothedStddevValues = secondaryConfig && smoothedData
        ? smoothedData.map(d => d[`${r.val}_stddev` as keyof typeof d] as number | null)
        : []
      const secondaryUpperValues = secondarySmoothedAvgValues.map((avg, i) =>
        avg === null || secondarySmoothedStddevValues[i] === null ? null : avg + secondarySmoothedStddevValues[i]
      )
      const secondaryLowerValues = secondarySmoothedAvgValues.map((avg, i) =>
        avg === null || secondarySmoothedStddevValues[i] === null ? null : avg - secondarySmoothedStddevValues[i]
      )

      // Get line props for secondary metric
      const secondaryLineProps = secondaryConfig
        ? getDeviceLineProps(
          secondaryConfig.color,
          deviceIdx,
          totalDevices,
          deviceRenderStrategy,
          rawLineWidth,
          hsvConfig
        )
        : null

      const secondarySmoothedLineProps = secondaryConfig && hasSmoothing
        ? getDeviceLineProps(
          secondaryConfig.color,
          deviceIdx,
          totalDevices,
          deviceRenderStrategy,
          smoothedLineWidth,
          hsvConfig
        )
        : null

      // For multi-device mode, use compact device names in legend
      const legendName = totalDevices > 1 ? deviceName : ''

      return {
        rawData, smoothedData, deviceName, deviceIdx, timestamps, smoothedTimestamps, legendName,
        primaryLineProps, primarySmoothedLineProps, avgValues, stddevValues, smoothedAvgValues, smoothedStddevValues, upperValues, lowerValues,
        secondaryLineProps, secondarySmoothedLineProps, secondaryAvgValues, secondaryStddevValues, secondarySmoothedAvgValues, secondarySmoothedStddevValues, secondaryUpperValues, secondaryLowerValues,
      }
    })

    // Synthetic header trace for primary metric (invisible line, provides metric header in hover)
    if (deviceData.length > 0) {
      const d = deviceData[0]
      traces.push({
        x: d.timestamps,
        y: d.avgValues,  // Use real y-values so hover triggers
        mode: 'lines',
        line: { color: 'rgba(0,0,0,0)', width: 0 },
        showlegend: false,
        hovertemplate: `<b>${config.label} (${config.unit})</b><extra></extra>`
      })
    }

    // PRIMARY METRIC traces for all devices
    // When smoothing: thin raw lines (reduced opacity) + thick smoothed overlay
    // Without smoothing: normal lines
    deviceData.forEach((d) => {
      // Raw data trace (thin when smoothing enabled)
      traces.push({
        x: d.timestamps,
        y: d.avgValues,
        mode: 'lines',
        line: d.primaryLineProps,
        opacity: hasSmoothing ? (rawOpacity / 100) * getTraceOpacity(d.deviceIdx, 'primary') : getTraceOpacity(d.deviceIdx, 'primary'),
        name: d.legendName || `${config.label} (${config.unit})`,
        legendgroup: 'primary',
        showlegend: !hasSmoothing,  // Hide legend for raw when smoothing (smoothed trace shows legend)
        ...(isRawData ? {
          hovertemplate: `${d.deviceName}: %{y:.1f}<extra></extra>`
        } : hasSmoothing ? {
          hoverinfo: 'skip' as const,  // Skip hover on raw when showing smoothed overlay
        } : {
          customdata: d.rawData.map((rec, i) => ([
            d.stddevValues[i],
            rec.count
          ])),
          hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
        })
      })

      // Smoothed overlay trace (thick) - only when smoothing enabled
      if (d.smoothedData && d.primarySmoothedLineProps) {
        traces.push({
          x: d.smoothedTimestamps,
          y: d.smoothedAvgValues,
          mode: 'lines',
          line: d.primarySmoothedLineProps,
          opacity: getTraceOpacity(d.deviceIdx, 'primary'),
          name: d.legendName || `${config.label} (${config.unit})`,
          legendgroup: 'primary',
          customdata: d.smoothedData.map((rec, i) => ([
            d.smoothedStddevValues[i],
            rec.count
          ])),
          hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
        })
      }
    })

    // Synthetic header trace for secondary metric (invisible line, provides metric header in hover)
    if (secondaryConfig && deviceData.length > 0) {
      const d = deviceData[0]
      traces.push({
        x: d.timestamps,
        y: d.secondaryAvgValues,  // Use real y-values so hover triggers
        mode: 'lines',
        line: { color: 'rgba(0,0,0,0)', width: 0 },
        showlegend: false,
        yaxis: 'y2',
        hovertemplate: `<b>${secondaryConfig.label} (${secondaryConfig.unit})</b><extra></extra>`
      })
    }

    // SECONDARY METRIC traces for all devices
    if (secondaryConfig) {
      deviceData.forEach((d) => {
        if (d.secondaryLineProps) {
          // Raw data trace
          traces.push({
            x: d.timestamps,
            y: d.secondaryAvgValues,
            mode: 'lines',
            line: d.secondaryLineProps,
            opacity: hasSmoothing ? (rawOpacity / 100) * getTraceOpacity(d.deviceIdx, 'secondary') : getTraceOpacity(d.deviceIdx, 'secondary'),
            name: d.legendName || `${secondaryConfig.label} (${secondaryConfig.unit})`,
            legendgroup: 'secondary',
            legend: 'legend2',
            yaxis: 'y2',
            showlegend: !hasSmoothing,
            ...(isRawData ? {
              hovertemplate: `${d.deviceName}: %{y:.1f}<extra></extra>`
            } : hasSmoothing ? {
              hoverinfo: 'skip' as const,
            } : {
              customdata: d.rawData.map((rec, i) => ([
                d.secondaryStddevValues[i],
                rec.count
              ])),
              hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
            })
          })

          // Smoothed overlay trace
          if (d.smoothedData && d.secondarySmoothedLineProps) {
            traces.push({
              x: d.smoothedTimestamps,
              y: d.secondarySmoothedAvgValues,
              mode: 'lines',
              line: d.secondarySmoothedLineProps,
              opacity: getTraceOpacity(d.deviceIdx, 'secondary'),
              name: d.legendName || `${secondaryConfig.label} (${secondaryConfig.unit})`,
              legendgroup: 'secondary',
              legend: 'legend2',
              yaxis: 'y2',
              customdata: d.smoothedData.map((rec, i) => ([
                d.secondarySmoothedStddevValues[i],
                rec.count
              ])),
              hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
            })
          }
        }
      })
    }

    // Stddev fill regions (±σ shaded areas) - from smoothed data when available
    // Primary stddev region (only for first device)
    // Split into segments at gaps (null values) so Plotly doesn't interpolate across gaps
    if (!isRawData && deviceData.length > 0) {
      const d = deviceData[0]
      // Use smoothed data for bands when smoothing enabled, otherwise raw
      const bandTimestamps = hasSmoothing ? d.smoothedTimestamps : d.timestamps
      // Propagate nulls: null + anything = null (avoid JS's null + null = 0)
      const bandUpper = hasSmoothing ? d.upperValues : d.avgValues.map((avg, i) =>
        avg === null || d.stddevValues[i] === null ? null : avg + d.stddevValues[i]
      )
      const bandLower = hasSmoothing ? d.lowerValues : d.avgValues.map((avg, i) =>
        avg === null || d.stddevValues[i] === null ? null : avg - d.stddevValues[i]
      )

      // Split data into segments at null values
      const segments: Array<{ timestamps: string[]; upper: (number | null)[]; lower: (number | null)[] }> = []
      let currentSegment: { timestamps: string[]; upper: (number | null)[]; lower: (number | null)[] } | null = null

      for (let i = 0; i < bandTimestamps.length; i++) {
        if (bandUpper[i] === null || bandLower[i] === null) {
          // Gap point - end current segment
          if (currentSegment && currentSegment.timestamps.length > 0) {
            segments.push(currentSegment)
          }
          currentSegment = null
        } else {
          // Real data point
          if (!currentSegment) {
            currentSegment = { timestamps: [], upper: [], lower: [] }
          }
          currentSegment.timestamps.push(bandTimestamps[i])
          currentSegment.upper.push(bandUpper[i])
          currentSegment.lower.push(bandLower[i])
        }
      }
      // Don't forget the last segment
      if (currentSegment && currentSegment.timestamps.length > 0) {
        segments.push(currentSegment)
      }

      // Create traces for each segment
      segments.forEach((seg, segIdx) => {
        traces.push({
          x: seg.timestamps,
          y: seg.lower,
          mode: 'lines',
          line: { color: 'transparent' },
          name: `${config.label} Lower`,
          showlegend: false,
          hoverinfo: 'skip',
        })
        traces.push({
          x: seg.timestamps,
          y: seg.upper,
          fill: 'tonexty',
          fillcolor: `${d.primaryLineProps.color}${opacityHex}`,
          line: { color: 'transparent' },
          mode: 'lines',
          name: segIdx === 0 ? `±σ ${config.label}` : `±σ ${config.label} (cont)`,
          showlegend: false,
          hoverinfo: 'skip',
        })
      })
    }

    // Secondary stddev region (only for first device)
    // Split into segments at gaps (null values) so Plotly doesn't interpolate across gaps
    if (secondaryConfig && !isRawData && deviceData.length > 0) {
      const d = deviceData[0]
      const bandTimestamps = hasSmoothing ? d.smoothedTimestamps : d.timestamps
      const bandUpper = hasSmoothing ? d.secondaryUpperValues : d.secondaryAvgValues.map((avg, i) =>
        avg === null || d.secondaryStddevValues[i] === null ? null : avg + d.secondaryStddevValues[i]
      )
      const bandLower = hasSmoothing ? d.secondaryLowerValues : d.secondaryAvgValues.map((avg, i) =>
        avg === null || d.secondaryStddevValues[i] === null ? null : avg - d.secondaryStddevValues[i]
      )

      // Split data into segments at null values
      const segments: Array<{ timestamps: string[]; upper: (number | null)[]; lower: (number | null)[] }> = []
      let currentSegment: { timestamps: string[]; upper: (number | null)[]; lower: (number | null)[] } | null = null

      for (let i = 0; i < bandTimestamps.length; i++) {
        if (bandUpper[i] === null || bandLower[i] === null) {
          if (currentSegment && currentSegment.timestamps.length > 0) {
            segments.push(currentSegment)
          }
          currentSegment = null
        } else {
          if (!currentSegment) {
            currentSegment = { timestamps: [], upper: [], lower: [] }
          }
          currentSegment.timestamps.push(bandTimestamps[i])
          currentSegment.upper.push(bandUpper[i])
          currentSegment.lower.push(bandLower[i])
        }
      }
      if (currentSegment && currentSegment.timestamps.length > 0) {
        segments.push(currentSegment)
      }

      // Create traces for each segment
      segments.forEach((seg, segIdx) => {
        traces.push({
          x: seg.timestamps,
          y: seg.lower,
          mode: 'lines',
          line: { color: 'transparent' },
          name: `${secondaryConfig.label} Lower`,
          showlegend: false,
          hoverinfo: 'skip',
          yaxis: 'y2',
        })
        traces.push({
          x: seg.timestamps,
          y: seg.upper,
          fill: 'tonexty',
          fillcolor: `${d.secondaryLineProps?.color}${opacityHex}`,
          line: { color: 'transparent' },
          mode: 'lines',
          name: `±σ ${secondaryConfig.label}`,
          showlegend: false,
          hoverinfo: 'skip',
          yaxis: 'y2',
        })
      })
    }

    return traces
  }, [displayDeviceAggregations, l.val, r.val, config, secondaryConfig, totalDevices, isRawData, hasSmoothing, rawOpacity, deviceRenderStrategy, hsvConfig, getTraceOpacity, opacityHex])

  // Font sizes - larger in og mode for better screenshot readability
  // Note: x-axis ticks need smaller font to fit with multi-line date labels
  const fontSizes = isOgMode
    ? { tick: 14, legend: 22, annotation: 24, title: 28 }
    : { tick: 11, legend: 11, annotation: 12, title: 16 }

  // Helper to create yaxis config
  const createYAxisConfig = (side: 'left' | 'right', autoRange: boolean, floor: number = 0) => ({
    gridcolor: side === 'left' ? plotColors.gridcolor : 'transparent',
    fixedrange: true,
    tickfont: { color: plotColors.textColor, size: fontSizes.tick },
    linecolor: plotColors.gridcolor,
    zerolinecolor: side === 'left' ? plotColors.gridcolor : 'transparent',
    side,
    tickformat: '.3~s',
    // If not auto-ranging: use floor as minimum (default 0 with rangemode tozero)
    ...(!autoRange && floor === 0 && { rangemode: 'tozero' as const }),
    // For metrics with floor > 0 (e.g., CO2 at 400ppm), use autorange:'max' to auto-scale upper bound
    ...(!autoRange && floor > 0 && { autorange: 'max' as const, range: [floor, null] }),
    ...(side === 'right' && { overlaying: 'y' as const }),
  })
  // OG mode: fill viewport height (625px to leave room for bottom margin in 630px viewport)
  const chartHeight = isOgMode ? 625 : (isMobile ? 300 : 500)

  // Consolidate table metadata calculations
  const tableMetadata = useMemo(() => {
    if (!selectedDeviceIdForTable) {
      return { totalDataCount: 0, rawDataCount: 0, fullDataStartTime: undefined, fullDataEndTime: undefined }
    }

    const bounds = getFileBounds(selectedDeviceIdForTable)
    if (!bounds) {
      return { totalDataCount: 0, rawDataCount: 0, fullDataStartTime: undefined, fullDataEndTime: undefined }
    }

    const totalMinutes = (bounds.latest.getTime() - bounds.earliest.getTime()) / (1000 * 60)
    return {
      totalDataCount: ceil(totalMinutes / selectedWindow.minutes),
      rawDataCount: ceil(totalMinutes),  // ~1 data point per minute
      fullDataStartTime: bounds.earliest,
      fullDataEndTime: bounds.latest,
    }
  }, [selectedDeviceIdForTable, selectedWindow, deviceDataResults])

  return (
    <div className={`awair-chart${isOgMode ? ' og-mode' : ''}`}>
      {/* OG mode title overlay */}
      {isOgMode && (
        <div className="og-title" style={{ color: plotColors.textColor }}>
          <span>Air Quality Dashboard</span>
          <span className="emojis">🌡️ 💨 💦 🏭 🧪</span>
        </div>
      )}
      <div
        ref={plotContainerRef}
        className="plot-container"
        onMouseEnter={() => setHoverState(null)}
      >
        {(() => {
          // Calculate device colors for legend markers (primary metric)
          const primaryColors = displayDeviceAggregations.map((_, deviceIdx) => {
            const lineProps = getDeviceLineProps(
              config.color,
              deviceIdx,
              totalDevices,
              deviceRenderStrategy,
              2,
              hsvConfig
            )
            return lineProps.color
          })
          // Calculate device colors for secondary metric
          const secondaryColors = secondaryConfig
            ? displayDeviceAggregations.map((_, deviceIdx) => {
              const lineProps = getDeviceLineProps(
                secondaryConfig.color,
                deviceIdx,
                totalDevices,
                deviceRenderStrategy,
                2,
                hsvConfig
              )
              return lineProps.color
            })
            : []
          return (
            <CustomLegend
              metrics={metrics}
              isMobile={isMobile}
              deviceNames={displayDeviceAggregations.map(d => d.deviceName)}
              primaryColors={primaryColors}
              secondaryColors={secondaryColors}
              onHover={isOgMode ? noop : setHoverState}
              onLeftAutoRangeDisplayChange={isOgMode ? noop : setLeftAutoRangeDisplay}
              onRightAutoRangeDisplayChange={isOgMode ? noop : setRightAutoRangeDisplay}
              getEffectiveFloor={getEffectiveFloor}
              rangeFloors={rangeFloors}
              setRangeFloors={setRangeFloors}
            />
          )
        })()}
        <Plot
          className="plot-react"
          data={plotTraces}
          layout={{
            autosize: true,
            height: chartHeight,
            // uirevision keeps pan/zoom state stable during re-renders
            // Only changes when we explicitly want to reset the view
            uirevision: 'stable',
            xaxis: {
              type: 'date',
              // Always set autorange: false to ensure consistent drag behavior
              // If xAxisRange is null, Plotly will compute a default range
              autorange: !xAxisRange,
              ...(xAxisRange && { range: xAxisRange }),
              ...(data.length > 0 && {
                rangeslider: { visible: false },
                constraintoward: 'center',
              }),
              gridcolor: plotColors.gridcolor,
              tickfont: { color: plotColors.textColor, size: fontSizes.tick },
              linecolor: plotColors.gridcolor,
              zerolinecolor: plotColors.gridcolor,
              hoverformat: '',
              // Spike line (vertical line at hover position)
              showspikes: true,
              spikemode: 'across',
              spikethickness: 0.5,
              spikecolor: plotColors.spikeColor,
              spikedash: 'solid',
              // Use custom format for unified hover title - this overrides tick labels in hover
              // Cast needed because unifiedhovertitle isn't in @types/plotly.js yet
              ...({ unifiedhovertitle: { text: '%{x|%b %-d, %-I:%M%p}' } } as object),
              ...(tickvals.length > 0 && {
                tickvals: tickvals,
                ticktext: ticktext,
                tickmode: 'array'
              })
            },
            yaxis: createYAxisConfig('left', leftAutoRangeDisplay, getEffectiveFloor(l.val)),
            ...(secondaryConfig && r.val !== 'none' && { yaxis2: createYAxisConfig('right', rightAutoRangeDisplay, getEffectiveFloor(r.val as Metric)) }),
            // Legend is now in flow above plot, so minimal top margin needed
            margin: isOgMode
              ? { l: 50, r: 50, t: 10, b: 115 }  // Minimal top (title is absolute), extra bottom for x-axis
              : { l: 35, r: secondaryConfig ? 35 : 10, t: 5, b: 45 },
            hovermode: 'x unified',
            hoverlabel: {
              bgcolor: plotColors.plotBg,
              bordercolor: plotColors.gridcolor,
              font: {
                color: plotColors.textColor,
                size: fontSizes.tick
              }
            },
            plot_bgcolor: plotColors.plotBg,
            paper_bgcolor: plotColors.plotBg,
            dragmode: 'pan',
            showlegend: false, // Custom legend rendered separately for pixel-based positioning
            selectdirection: 'h'
          }}
          config={{
            displayModeBar: false,
            displaylogo: false,
            responsive: true,
            scrollZoom: true,
            doubleClick: false,
            showTips: false,
            modeBarButtonsToRemove: ['select2d', 'lasso2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d'],
            toImageButtonOptions: {
              format: 'png',
              filename: 'awair-chart',
              height: 500,
              width: 1000,
              scale: 1
            }
          }}
          useResizeHandler={true}
          onRelayout={handleRelayout}
          onDoubleClick={handleDoubleClick}
          onAfterPlot={() => {
            // Signal to og-lambda screenshot that the chart is ready
            (window as Window & { chartReady?: boolean }).chartReady = true
            // Setup click-outside-to-dismiss hover behavior
            setupHoverDismiss()
          }}
        />
      </div>

      {!isOgMode && (
        <ChartControls
          {...{
            metrics,
            deviceRenderStrategy, setDeviceRenderStrategy,
            hsvConfig, setHsvConfig,
            xAxisRange, setXAxisRange,
            data,
            summary,
            latestModeIntended, setLatestModeIntended,
            setDuration,
            getActiveTimeRange,
            handleTimeRangeClick,
            handleAllClick,
            setRangeByWidth,
            setIgnoreNextPanCheck,
            devices,
            selectedDeviceIds,
            onDeviceSelectionChange,
            onPreviewDeviceIds: setPreviewDeviceIds,
            onHoverDeviceId,
            selectedWindow,
            validWindows,
            timeRangeMinutes,
            smoothing,
            onSmoothingChange: setSmoothing,
            stddevOpacity,
            onStddevOpacityChange: setStddevOpacity,
            rawOpacity,
            onRawOpacityChange: setRawOpacity,
          }}
          onWindowChange={window => {
            if (window) {
              setXGrouping({ mode: 'fixed', windowLabel: window.label })
            }
          }}
          targetPx={targetPx as PxOption | null}
          onTargetPxChange={px => {
            if (px === null) {
              // Switch to fixed mode, keep current window
              setXGrouping({ mode: 'fixed', windowLabel: selectedWindow.label })
            } else {
              setXGrouping({ mode: 'auto', targetPx: px })
            }
          }}
          containerWidth={viewportWidth}
        />
      )}

      {!isOgMode && (
        <DataTable
          data={aggregatedData}
          isRawData={isRawData}
          totalDataCount={tableMetadata.totalDataCount}
          rawDataCount={tableMetadata.rawDataCount}
          windowLabel={selectedWindow.label}
          fullDataStartTime={tableMetadata.fullDataStartTime}
          fullDataEndTime={tableMetadata.fullDataEndTime}
          windowMinutes={selectedWindow.minutes}
          deviceAggregations={deviceAggregations}
          selectedDeviceId={selectedDeviceIdForTable}
          onDeviceChange={setSelectedDeviceIdForTable}
          timeRange={timeRangeFromProps}
          setTimeRange={setTimeRangeFromProps}
          pageSize={tablePageSize}
          onPageSizeChange={(size) => setTablePageSize(size as 10 | 20 | 50 | 100 | 200)}
        />
      )}

    </div>
  )
})
