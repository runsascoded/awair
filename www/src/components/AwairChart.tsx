import { useUrlParam } from '@rdub/use-url-params'
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Plot from 'react-plotly.js'
import { ChartControls, metricConfig } from './ChartControls'
import { DataTable } from './DataTable'
import { TIME_WINDOWS } from '../hooks/useDataAggregation'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useLatestMode } from '../hooks/useLatestMode'
import { useMetrics } from '../hooks/useMetrics'
import { useMultiDeviceAggregation } from '../hooks/useMultiDeviceAggregation'
import { useTimeRangeParam } from '../hooks/useTimeRangeParam'
import { deviceRenderStrategyParam, hsvConfigParam, xGroupingParam } from '../lib/urlParams'
import { getDeviceLineProps } from '../utils/deviceRenderStrategy'
import type { PxOption } from './AggregationControl'
import type { DeviceDataResult } from '../hooks/useMultiDeviceData'
import type { Device } from '../services/awairService'
import type { DataSummary } from '../types/awair'
import type { Data, PlotRelayoutEvent } from 'plotly.js'

// Extend Data type to include zorder (supported by plotly.js but not in @types/plotly.js)
type DataWithZorder = Data & { zorder?: number }

interface Props {
  deviceDataResults: DeviceDataResult[]
  summary: DataSummary | null
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
  timeRange: { timestamp: Date | null; duration: number }
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void
  isOgMode?: boolean
}

export function AwairChart({ deviceDataResults, summary, devices, selectedDeviceIds, onDeviceSelectionChange, timeRange: timeRangeFromProps, setTimeRange: setTimeRangeFromProps, isOgMode = false }: Props) {

  // Combine data from all devices for time range calculations and bounds checking
  // Sorted newest-first for efficient latest record access
  const data = useMemo(() => {
    return deviceDataResults
      .flatMap(r => r.data)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [deviceDataResults])

  // Y-axes state - combined primary + secondary + fromZero in URL (?y=tc, ?y=tcZ)
  const metrics = useMetrics()

  // Derive yAxisFromZero from metrics state
  const yAxisFromZero = metrics.fromZero.val
  const setYAxisFromZero = metrics.fromZero.set

  // Device render strategy: how to visually distinguish multiple devices
  const [deviceRenderStrategy, setDeviceRenderStrategy] = useUrlParam('dr', deviceRenderStrategyParam)

  // HSV config for hsv-nudge strategy
  const [hsvConfig, setHsvConfig] = useUrlParam('hsv', hsvConfigParam)

  // X-axis grouping: auto mode (px values) or fixed window mode (time labels)
  const [xGrouping, setXGrouping] = useUrlParam('x', xGroupingParam)

  // Derive targetPx and overrideWindow from unified xGrouping state
  const targetPx = xGrouping.mode === 'auto' ? xGrouping.targetPx : null
  const overrideWindow = useMemo(() => {
    if (xGrouping.mode === 'fixed') {
      return TIME_WINDOWS.find(w => w.label === xGrouping.windowLabel)
    }
    return undefined
  }, [xGrouping])

  const [hasSetDefaultRange, setHasSetDefaultRange] = useState(false)
  const [isMobile, setIsMobile] = useState(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px) or (max-height: 599px)')
    return mobileQuery.matches
  })
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)

  // Refs for handling programmatic updates
  const ignoreNextRelayoutRef = useRef(false)

  // Date formatting utilities - consistent local time format
  const formatForPlotly = useCallback((date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
  }, [])

  // Time range management - use props instead of internal hook
  const {
    xAxisRange,
    latestModeIntended,
    setXAxisRange,
    setLatestModeIntended,
    setDuration
  } = useTimeRangeParam(data, formatForPlotly, timeRangeFromProps, setTimeRangeFromProps)

  const formatCompactDate = useCallback((date: Date) => {
    const currentYear = new Date().getFullYear()
    const dateYear = date.getFullYear()
    const month = String(date.getMonth() + 1)
    const day = String(date.getDate())
    const hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const ampm = hours < 12 ? 'a' : 'p'
    const yearPart = dateYear !== currentYear ? `/${String(dateYear).slice(-2)}` : ''
    return `${month}/${day}${yearPart} ${hour12}:${minutes}${ampm}`
  }, [])

  const formatFullDate = useCallback((date: Date) => {
    const currentYear = new Date().getFullYear()
    const dateYear = date.getFullYear()
    const month = String(date.getMonth() + 1)
    const day = String(date.getDate())
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const seconds = date.getSeconds()
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const ampm = hours < 12 ? 'am' : 'pm'

    // Build time string, omitting :00 seconds and :00 minutes
    let timeStr = `${hour12}`
    if (minutes !== 0 || seconds !== 0) {
      timeStr += `:${String(minutes).padStart(2, '0')}`
    }
    if (seconds !== 0) {
      timeStr += `:${String(seconds).padStart(2, '0')}`
    }
    timeStr += ampm

    // Build date string, omitting year if current year
    const dateStr = dateYear === currentYear ? `${month}/${day}` : `${month}/${day}/${String(dateYear).slice(-2)}`

    return `${dateStr} ${timeStr}`
  }, [])

  // Metrics and Y-axis mode now persisted in URL params (via useUrlParam above)

  // Time range handlers
  const handleTimeRangeClick = useCallback((hours: number) => {
    if (data.length === 0) return
    const latestTime = new Date(data[0].timestamp)
    const earliestTime = new Date(latestTime.getTime() - (hours * 60 * 60 * 1000))
    const newRange: [string, string] = [formatForPlotly(earliestTime), formatForPlotly(latestTime)]
    setXAxisRange(newRange)
    setHasSetDefaultRange(true)
  }, [data, formatForPlotly])

  const setRangeByWidth = useCallback((hours: number, centerTime?: Date) => {
    if (data.length === 0) return
    const center = centerTime || (xAxisRange ? new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2) : new Date(data[0].timestamp))
    const halfRange = (hours * 60 * 60 * 1000) / 2
    const newStart = new Date(center.getTime() - halfRange)
    const newEnd = new Date(center.getTime() + halfRange)

    // Clamp to data bounds
    const globalStart = new Date(data[data.length - 1].timestamp)
    const globalEnd = new Date(data[0].timestamp)
    const clampedStart = new Date(Math.max(newStart.getTime(), globalStart.getTime()))
    const clampedEnd = new Date(Math.min(newEnd.getTime(), globalEnd.getTime()))

    const newRange: [string, string] = [formatForPlotly(clampedStart), formatForPlotly(clampedEnd)]
    setXAxisRange(newRange)
  }, [xAxisRange, data, formatForPlotly])

  // Extract custom hooks - use multi-device aggregation
  const { deviceAggregations, selectedWindow, validWindows, isRawData } = useMultiDeviceAggregation(
    deviceDataResults,
    devices,
    xAxisRange,
    { containerWidth: viewportWidth, overrideWindow, targetPx }
  )

  // For backwards compatibility with DataTable, use first device's aggregated data
  const aggregatedData = deviceAggregations[0]?.aggregatedData || []

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
    checkUserPanAway: _checkUserPanAway,
    jumpToLatest,
    setIgnoreNextPanCheck
  } = useLatestMode(data, xAxisRange, formatForPlotly, latestModeIntended, setLatestModeIntended)

  // Handle auto-update from Latest mode hook
  useEffect(() => {
    if (autoUpdateRange) {
      setXAxisRange(autoUpdateRange)
    }
  }, [autoUpdateRange])

  // Track when we've loaded data for the first time (for hasSetDefaultRange purposes)
  useEffect(() => {
    if (!hasSetDefaultRange && data.length > 0 && xAxisRange) {
      setHasSetDefaultRange(true)
    }
  }, [data, xAxisRange, hasSetDefaultRange])

  // Determine which time range button is active based on the requested duration
  const getActiveTimeRange = useCallback(() => {
    // Use the requested duration from props, not the chart's x-axis range
    const durationHours = timeRangeFromProps.duration / (1000 * 60 * 60)
    const isLatestView = latestModeIntended

    // Check range width with tolerance
    if (Math.abs(durationHours - 24) < 2) return isLatestView ? 'latest-1d' : '1d'
    if (Math.abs(durationHours - (24 * 3)) < 6) return isLatestView ? 'latest-3d' : '3d'
    if (Math.abs(durationHours - (24 * 7)) < 12) return isLatestView ? 'latest-7d' : '7d'
    if (Math.abs(durationHours - (24 * 14)) < 24) return isLatestView ? 'latest-14d' : '14d'
    if (Math.abs(durationHours - (24 * 30)) < 48) return isLatestView ? 'latest-30d' : '30d'

    // "All" is only active when duration exceeds 30 days (or summary indicates full range)
    if (durationHours > 24 * 45) return 'all'

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
      setHasSetDefaultRange(true)
    } else {
      setXAxisRange(null)
    }
  }, [data, formatForPlotly])

  // Relayout handler
  const handleRelayout = useCallback((eventData: PlotRelayoutEvent) => {
    const x0 = eventData['xaxis.range[0]']
    const x1 = eventData['xaxis.range[1]']
    if (x0 !== undefined && x1 !== undefined) {
      // PlotRelayoutEvent types these as number, but for date axes they're strings
      const newRange: [string, string] = [String(x0), String(x1)]
      setXAxisRange(newRange)
    }
  }, [setXAxisRange])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    metrics,
    yAxisFromZero,
    setYAxisFromZero,
    xAxisRange,
    setXAxisRange,
    setHasSetDefaultRange,
    data,
    formatForPlotly,
    latestModeIntended,
    setLatestModeIntended,
    handleTimeRangeClick,
    setIgnoreNextPanCheck
  })

  // Handle responsive plot height and viewport width using matchMedia
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px) or (max-height: 599px)')

    const handleMediaQueryChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }

    const handleResize = () => {
      setViewportWidth(window.innerWidth)
    }

    mobileQuery.addEventListener('change', handleMediaQueryChange)
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    return () => {
      mobileQuery.removeEventListener('change', handleMediaQueryChange)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  // Theme-aware plot colors
  const [plotColors, setPlotColors] = useState(() => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    return {
      gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--plot-grid').trim() || '#ddd',
      plotBg: getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim() || 'white',
      legendBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || 'white',
      textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333',
      spikeColor: isDark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)',
    }
  })

  useEffect(() => {
    const updatePlotColors = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      setPlotColors({
        gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--plot-grid').trim() || '#ddd',
        plotBg: getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim() || 'white',
        legendBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || 'white',
        textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333',
        spikeColor: isDark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)',
      })
    }

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
    const plotWidth = Math.max(300, viewportWidth - 100) // Account for margins, min 300px
    const maxTicks = Math.floor(plotWidth / 30) // ~80px per tick
    const minTicks = Math.max(3, Math.floor(plotWidth / 120)) // At least 3 ticks

    let tickIntervalHours: number
    if (totalHours <= 6) tickIntervalHours = 1
    else if (totalHours <= 24) tickIntervalHours = 2
    else if (totalHours <= 72) tickIntervalHours = 6
    else if (totalHours <= 168) tickIntervalHours = 12
    else tickIntervalHours = 24

    // Adjust interval to fit within tick count limits
    const estimatedTicks = Math.ceil(totalHours / tickIntervalHours)
    if (estimatedTicks > maxTicks) {
      tickIntervalHours = Math.ceil(totalHours / maxTicks)
    } else if (estimatedTicks < minTicks) {
      tickIntervalHours = Math.max(1, Math.floor(totalHours / minTicks))
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
  }, [xAxisRange, data, isMobile, viewportWidth, formatForPlotly])

  const { tickvals, ticktext } = generateCustomTicks()

  // Plot data preparation
  const { l, r } = metrics
  const config = metricConfig[l.val] || metricConfig.temp
  const secondaryConfig = r.val !== 'none' ? metricConfig[r.val] : null
  const totalDevices = deviceAggregations.length

  // Generate traces for all devices, grouped by metric for better hover ordering
  const plotTraces = useMemo(() => {
    const traces: DataWithZorder[] = []

    // Pre-compute data for all devices
    const deviceData = deviceAggregations.map((deviceAgg, deviceIndex) => {
      const { aggregatedData: devData, deviceName } = deviceAgg
      const timestamps = devData.map(d => formatForPlotly(new Date(d.timestamp)))

      // Get line props for primary metric
      const primaryLineProps = getDeviceLineProps(
        config.color,
        deviceIndex,
        totalDevices,
        deviceRenderStrategy,
        2,
        hsvConfig
      )

      // Primary metric data
      const avgValues = devData.map(d => d[`${l.val}_avg` as keyof typeof d] as number)
      const stddevValues = devData.map(d => d[`${l.val}_stddev` as keyof typeof d] as number)
      const upperValues = avgValues.map((avg, i) => avg + stddevValues[i])
      const lowerValues = avgValues.map((avg, i) => avg - stddevValues[i])

      // Secondary metric data
      const secondaryAvgValues = secondaryConfig && r.val !== 'none'
        ? devData.map(d => d[`${r.val}_avg` as keyof typeof d] as number)
        : []
      const secondaryStddevValues = secondaryConfig && r.val !== 'none'
        ? devData.map(d => d[`${r.val}_stddev` as keyof typeof d] as number)
        : []
      const secondaryUpperValues = secondaryConfig
        ? secondaryAvgValues.map((avg, i) => avg + secondaryStddevValues[i])
        : []
      const secondaryLowerValues = secondaryConfig
        ? secondaryAvgValues.map((avg, i) => avg - secondaryStddevValues[i])
        : []

      // Get line props for secondary metric
      const secondaryLineProps = secondaryConfig
        ? getDeviceLineProps(
          secondaryConfig.color,
          deviceIndex,
          totalDevices,
          deviceRenderStrategy,
          2,
          hsvConfig
        )
        : null

      // For multi-device mode, use compact device names in legend
      const legendName = totalDevices > 1 ? deviceName : ''

      return {
        devData, deviceName, deviceIndex, timestamps, legendName,
        primaryLineProps, avgValues, stddevValues, upperValues, lowerValues,
        secondaryLineProps, secondaryAvgValues, secondaryStddevValues, secondaryUpperValues, secondaryLowerValues,
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

    // PRIMARY METRIC traces for all devices (grouped together in hover)
    // NOTE: zorder removed due to Plotly resize bug - traces with zorder don't
    // resize correctly when container width changes below max-width threshold
    deviceData.forEach((d) => {
      traces.push({
        x: d.timestamps,
        y: d.avgValues,
        mode: 'lines',
        line: d.primaryLineProps,
        name: d.legendName || `${config.label} (${config.unit})`,
        legendgroup: 'primary',
        ...(isRawData ? {
          hovertemplate: `${d.deviceName}: %{y:.1f}<extra></extra>`
        } : {
          customdata: d.devData.map((rec, i) => ([
            d.stddevValues[i],
            rec.count
          ])),
          hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
        })
      })
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

    // SECONDARY METRIC traces for all devices (grouped together in hover)
    // NOTE: zorder removed due to Plotly resize bug
    if (secondaryConfig) {
      deviceData.forEach((d) => {
        if (d.secondaryLineProps) {
          traces.push({
            x: d.timestamps,
            y: d.secondaryAvgValues,
            mode: 'lines',
            line: d.secondaryLineProps,
            name: d.legendName || `${secondaryConfig.label} (${secondaryConfig.unit})`,
            legendgroup: 'secondary',
            legend: 'legend2',
            yaxis: 'y2',
            ...(isRawData ? {
              hovertemplate: `${d.deviceName}: %{y:.1f}<extra></extra>`
            } : {
              customdata: d.devData.map((rec, i) => ([
                d.secondaryStddevValues[i],
                rec.count
              ])),
              hovertemplate: `${d.deviceName}: %{y:.1f} ±%{customdata[0]:.1f} (n=%{customdata[1]})<extra></extra>`
            })
          })
        }
      })
    }

    // Stddev fill regions (±σ shaded areas) - added after main traces so hover swatches align
    // Primary stddev region (only for first device)
    if (!isRawData && deviceData.length > 0) {
      const d = deviceData[0]
      traces.push({
        x: d.timestamps,
        y: d.lowerValues,
        mode: 'lines',
        line: { color: 'transparent' },
        name: `${config.label} Lower`,
        showlegend: false,
        hoverinfo: 'skip',
      })
      traces.push({
        x: d.timestamps,
        y: d.upperValues,
        fill: 'tonexty',
        fillcolor: `${d.primaryLineProps.color}20`,
        line: { color: 'transparent' },
        mode: 'lines',
        name: `±σ ${config.label}`,
        showlegend: false,
        hoverinfo: 'skip',
      })
    }

    // Secondary stddev region (only for first device)
    if (secondaryConfig && !isRawData && deviceData.length > 0) {
      const d = deviceData[0]
      traces.push({
        x: d.timestamps,
        y: d.secondaryLowerValues,
        mode: 'lines',
        line: { color: 'transparent' },
        name: `${secondaryConfig.label} Lower`,
        showlegend: false,
        hoverinfo: 'skip',
        yaxis: 'y2',
      })
      traces.push({
        x: d.timestamps,
        y: d.secondaryUpperValues,
        fill: 'tonexty',
        fillcolor: `${d.secondaryLineProps?.color}20`,
        line: { color: 'transparent' },
        mode: 'lines',
        name: `±σ ${secondaryConfig.label}`,
        showlegend: false,
        hoverinfo: 'skip',
        yaxis: 'y2',
      })
    }

    return traces
  }, [deviceAggregations, l.val, r.val, config, secondaryConfig, totalDevices, isRawData, formatForPlotly, deviceRenderStrategy, hsvConfig])

  // Font sizes - larger in og mode for better screenshot readability
  const fontSizes = isOgMode
    ? { tick: 22, legend: 22, annotation: 24, title: 28 }
    : { tick: 11, legend: 11, annotation: 12, title: 16 }

  // Helper to create yaxis config
  const createYAxisConfig = (side: 'left' | 'right') => ({
    gridcolor: side === 'left' ? plotColors.gridcolor : 'transparent',
    fixedrange: true,
    tickfont: { color: plotColors.textColor, size: fontSizes.tick },
    linecolor: plotColors.gridcolor,
    zerolinecolor: side === 'left' ? plotColors.gridcolor : 'transparent',
    side,
    tickformat: '.3~s',
    ...(yAxisFromZero && { rangemode: 'tozero' as const }),
    ...(side === 'right' && { overlaying: 'y' as const }),
  })

  // Helper to create legend config
  const createLegendConfig = (x: number, xanchor: 'left' | 'right') => ({
    orientation: 'h' as const,
    x,
    y: 1.03,
    xanchor,
    yanchor: 'top' as const,
    bgcolor: 'transparent',
    font: { color: plotColors.textColor, size: fontSizes.legend },
    traceorder: 'normal' as const,
    tracegroupgap: 0,
  })

  // Helper to create annotation config
  const createAnnotation = (text: string, x: number, xanchor: 'left' | 'right') => ({
    text,
    xref: 'paper' as const,
    yref: 'paper' as const,
    x,
    y: 1.03,
    xanchor,
    yanchor: 'bottom' as const,
    showarrow: false,
    font: { color: plotColors.textColor, size: fontSizes.annotation }
  })

  // OG mode: fill viewport height (625px to leave room for bottom margin in 630px viewport)
  const chartHeight = isOgMode ? 625 : (isMobile ? 300 : 500)

  return (
    <div className="awair-chart" style={isOgMode ? { position: 'relative', height: '100vh', overflow: 'hidden' } : undefined}>
      {/* OG mode title overlay */}
      {isOgMode && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 0,
          right: 0,
          zIndex: 10,
          textAlign: 'center',
          fontSize: 32,
          fontWeight: 700,
          color: plotColors.textColor,
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          pointerEvents: 'none',
        }}>
          <span>Air Quality Dashboard</span>
          <span style={{ fontFamily: '"Noto Color Emoji", sans-serif', marginLeft: '0.5em', letterSpacing: '-0.5em' }}>🌡️ 💨 💦 🏭 🧪</span>
        </div>
      )}
      <div className="plot-container" style={isOgMode ? { height: '100%' } : undefined}>
        <Plot
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
            yaxis: createYAxisConfig('left'),
            ...(secondaryConfig && { yaxis2: createYAxisConfig('right') }),
            margin: isOgMode
              ? { l: 50, r: 50, t: 55, b: 70 }  // Just enough for axis labels, no border
              : { l: 35, r: secondaryConfig ? 35 : 10, t: totalDevices > 1 ? (isMobile ? 30 : 40) : 0, b: 45 },
            hovermode: 'x unified',
            plot_bgcolor: plotColors.plotBg,
            paper_bgcolor: plotColors.plotBg,
            legend: createLegendConfig(0, 'left'),
            ...(secondaryConfig && { legend2: createLegendConfig(1, 'right') }),
            dragmode: 'pan',
            showlegend: true,
            selectdirection: 'h',
            ...(totalDevices > 1 && {
              annotations: [
                createAnnotation(`${config.label} (${config.unit})`, 0, 'left'),
                ...(secondaryConfig ? [createAnnotation(`${secondaryConfig.label} (${secondaryConfig.unit})`, 1, 'right')] : [])
              ]
            })
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
          style={{ width: '100%', height: '100%' }}
          onRelayout={handleRelayout}
          onDoubleClick={handleDoubleClick}
          onAfterPlot={() => {
            // Signal to og-lambda screenshot that the chart is ready
            (window as Window & { chartReady?: boolean }).chartReady = true
          }}
        />
      </div>

      {!isOgMode && (
        <ChartControls
          metrics={metrics}
          yAxisFromZero={yAxisFromZero}
          setYAxisFromZero={setYAxisFromZero}
          deviceRenderStrategy={deviceRenderStrategy}
          setDeviceRenderStrategy={setDeviceRenderStrategy}
          hsvConfig={hsvConfig}
          setHsvConfig={setHsvConfig}
          xAxisRange={xAxisRange}
          setXAxisRange={setXAxisRange}
          setHasSetDefaultRange={setHasSetDefaultRange}
          data={data}
          summary={summary}
          formatForPlotly={formatForPlotly}
          formatCompactDate={formatCompactDate}
          formatFullDate={formatFullDate}
          latestModeIntended={latestModeIntended}
          setLatestModeIntended={setLatestModeIntended}
          setDuration={setDuration}
          timeRange={timeRangeFromProps}
          setTimeRange={setTimeRangeFromProps}
          getActiveTimeRange={getActiveTimeRange}
          handleTimeRangeClick={handleTimeRangeClick}
          setRangeByWidth={setRangeByWidth}
          setIgnoreNextPanCheck={setIgnoreNextPanCheck}
          devices={devices}
          selectedDeviceIds={selectedDeviceIds}
          onDeviceSelectionChange={onDeviceSelectionChange}
          selectedWindow={selectedWindow}
          validWindows={validWindows}
          onWindowChange={(window) => {
            if (window) {
              setXGrouping({ mode: 'fixed', windowLabel: window.label })
            }
          }}
          targetPx={targetPx as PxOption | null}
          onTargetPxChange={(px) => {
            if (px === null) {
              // Switch to fixed mode, keep current window
              setXGrouping({ mode: 'fixed', windowLabel: selectedWindow.label })
            } else {
              setXGrouping({ mode: 'auto', targetPx: px })
            }
          }}
          timeRangeMinutes={timeRangeMinutes}
          containerWidth={viewportWidth}
        />
      )}

      {!isOgMode && (
        <DataTable
          data={aggregatedData}
          formatCompactDate={formatCompactDate}
          formatFullDate={formatFullDate}
          isRawData={isRawData}
          totalDataCount={useMemo(() => {
            if (data.length === 0) return 0
            const firstTime = new Date(data[data.length - 1].timestamp).getTime()
            const lastTime = new Date(data[0].timestamp).getTime()
            const totalMinutes = (lastTime - firstTime) / (1000 * 60)
            return Math.ceil(totalMinutes / selectedWindow.minutes)
          }, [data, selectedWindow])}
          windowLabel={selectedWindow.label}
          plotStartTime={xAxisRange?.[0]}
          plotEndTime={xAxisRange?.[1]}
          fullDataStartTime={data.length > 0 ? data[data.length - 1].timestamp : undefined}
          fullDataEndTime={data.length > 0 ? data[0].timestamp : undefined}
          windowMinutes={selectedWindow.minutes}
          onJumpToLatest={useCallback(() => {
            // Jump to latest like the Latest button
            const newRange = jumpToLatest()
            if (newRange) {
              setXAxisRange(newRange)
              setHasSetDefaultRange(true)
            }
          }, [jumpToLatest])}
          onPageChange={useCallback((pageOffset: number) => {
            console.log('📈 Chart onPageChange called with offset:', pageOffset)
            if (!xAxisRange || data.length === 0) {
              console.log('📈 Chart onPageChange early return - no range or data')
              return
            }

            const pageSize = 20
            const timeShiftMinutes = pageOffset * pageSize * selectedWindow.minutes
            const timeShiftMs = timeShiftMinutes * 60 * 1000

            const currentStart = new Date(xAxisRange[0])
            const currentEnd = new Date(xAxisRange[1])
            const rangeWidth = currentEnd.getTime() - currentStart.getTime()

            const newEnd = new Date(currentEnd.getTime() - timeShiftMs)
            const newStart = new Date(newEnd.getTime() - rangeWidth)

            const globalStart = new Date(data[data.length - 1].timestamp)
            const globalEnd = new Date(data[0].timestamp)

            const clampedStart = new Date(Math.max(newStart.getTime(), globalStart.getTime()))
            const clampedEnd = new Date(Math.min(newEnd.getTime(), globalEnd.getTime()))

            // Check if this navigation moves us away from latest data
            const latestTime = new Date(data[0].timestamp)
            const timeDiffMinutes = Math.abs(clampedEnd.getTime() - latestTime.getTime()) / (1000 * 60)
            if (timeDiffMinutes > 10) {
              console.log('📈 Table navigation moved away from latest, disabling Latest mode')
              setLatestModeIntended(false)
            }

            if (clampedStart.getTime() === globalStart.getTime()) {
              const adjustedEnd = new Date(clampedStart.getTime() + rangeWidth)
              if (adjustedEnd <= globalEnd) {
                const newRange: [string, string] = [formatForPlotly(clampedStart), formatForPlotly(adjustedEnd)]
                setXAxisRange(newRange)
                return
              }
            }
            if (clampedEnd.getTime() === globalEnd.getTime()) {
              const adjustedStart = new Date(clampedEnd.getTime() - rangeWidth)
              if (adjustedStart >= globalStart) {
                const newRange: [string, string] = [formatForPlotly(adjustedStart), formatForPlotly(clampedEnd)]
                setXAxisRange(newRange)
                return
              }
            }

            const newRange: [string, string] = [formatForPlotly(clampedStart), formatForPlotly(clampedEnd)]
            console.log('📈 Chart setting new range from table:', { oldRange: xAxisRange, newRange })
            setXAxisRange(newRange)
          }, [xAxisRange, data, selectedWindow, formatForPlotly, setLatestModeIntended])}
        />
      )}
    </div>
  )
}
