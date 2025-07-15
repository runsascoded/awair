import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Plot from 'react-plotly.js'
import { ChartControls, metricConfig } from './ChartControls'
import { DataTable } from './DataTable'
import { Tooltip } from './Tooltip'
import { useDataAggregation } from '../hooks/useDataAggregation'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useLatestMode } from '../hooks/useLatestMode'
import type { AwairRecord, DataSummary } from '../types/awair'

interface Props {
  data: AwairRecord[]
  summary: DataSummary | null
}

export function AwairChart({ data, summary }: Props) {
  // Basic state
  const [metric, setMetric] = useState<'temp' | 'co2' | 'humid' | 'pm25' | 'voc'>(() => {
    return (sessionStorage.getItem('awair-metric') as any) || 'temp'
  })
  const [secondaryMetric, setSecondaryMetric] = useState<'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none'>(() => {
    return (sessionStorage.getItem('awair-secondary-metric') as any) || 'co2'
  })
  const [xAxisRange, setXAxisRange] = useState<[string, string] | null>(() => {
    const stored = sessionStorage.getItem('awair-time-range')
    return stored ? JSON.parse(stored) : null
  })
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
    const month = String(date.getMonth() + 1)
    const day = String(date.getDate())
    const year = String(date.getFullYear()).slice(-2)
    const hours = date.getHours()
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
    const ampm = hours < 12 ? 'am' : 'pm'
    return `${month}/${day}/${year} ${hour12}:${minutes}:${seconds}${ampm}`
  }, [])

  // Save state to session storage
  useEffect(() => {
    sessionStorage.setItem('awair-metric', metric)
  }, [metric])

  useEffect(() => {
    sessionStorage.setItem('awair-secondary-metric', secondaryMetric)
  }, [secondaryMetric])

  useEffect(() => {
    if (xAxisRange) {
      sessionStorage.setItem('awair-time-range', JSON.stringify(xAxisRange))
    } else {
      sessionStorage.removeItem('awair-time-range')
    }
  }, [xAxisRange])

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

  // Extract custom hooks
  const { aggregatedData, selectedWindow, isRawData } = useDataAggregation(data, xAxisRange)

  const {
    latestModeIntended,
    setLatestModeIntended,
    autoUpdateRange,
    checkUserPanAway,
    jumpToLatest,
    setIgnoreNextPanCheck
  } = useLatestMode(data, xAxisRange, formatForPlotly)

  // Handle auto-update from Latest mode hook
  useEffect(() => {
    if (autoUpdateRange) {
      setXAxisRange(autoUpdateRange)
    }
  }, [autoUpdateRange])

  // Set default Latest mode for new range
  useEffect(() => {
    if (!hasSetDefaultRange && data.length > 0 && !xAxisRange) {
      const latestTime = new Date(data[0].timestamp)
      const earliestTime = new Date(latestTime.getTime() - (1 * 24 * 60 * 60 * 1000))
      const defaultRange: [string, string] = [formatForPlotly(earliestTime), formatForPlotly(latestTime)]
      setXAxisRange(defaultRange)
      setHasSetDefaultRange(true)
      setLatestModeIntended(true) // Default view should auto-update
    }
  }, [data, xAxisRange, hasSetDefaultRange, formatForPlotly, setLatestModeIntended])

  // Determine which time range button is active
  const getActiveTimeRange = useCallback(() => {
    if (!xAxisRange || data.length === 0) return 'all'

    const rangeStart = new Date(xAxisRange[0])
    const rangeEnd = new Date(xAxisRange[1])
    const rangeHours = (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60)

    const latestTime = new Date(data[0].timestamp)
    const timeDiffMinutes = Math.abs(rangeEnd.getTime() - latestTime.getTime()) / (1000 * 60)
    const isLatestView = timeDiffMinutes < 10

    // Check if it's the full range
    const firstDataTime = new Date(data[data.length - 1].timestamp)
    const lastDataTime = new Date(data[0].timestamp)
    const fullRangeHours = (lastDataTime.getTime() - firstDataTime.getTime()) / (1000 * 60 * 60)
    const isFullRange = Math.abs(rangeHours - fullRangeHours) < 1

    if (isFullRange) return 'all'

    // Check range width with tolerance
    if (Math.abs(rangeHours - 24) < 2) return isLatestView ? 'latest-1d' : '1d'
    if (Math.abs(rangeHours - (24 * 3)) < 6) return isLatestView ? 'latest-3d' : '3d'
    if (Math.abs(rangeHours - (24 * 7)) < 12) return isLatestView ? 'latest-7d' : '7d'
    if (Math.abs(rangeHours - (24 * 14)) < 24) return isLatestView ? 'latest-14d' : '14d'
    if (Math.abs(rangeHours - (24 * 30)) < 48) return isLatestView ? 'latest-30d' : '30d'

    return isLatestView ? 'latest-custom' : 'custom'
  }, [xAxisRange, data])

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
  const handleRelayout = useCallback((eventData: any) => {
    if (ignoreNextRelayoutRef.current) {
      ignoreNextRelayoutRef.current = false
      return
    }

    if (eventData['xaxis.range[0]'] && eventData['xaxis.range[1]']) {
      const newStart = new Date(eventData['xaxis.range[0]'])
      const newEnd = new Date(eventData['xaxis.range[1]'])

      // Clamp to data bounds if we have data
      if (data.length > 0) {
        const globalStart = new Date(data[data.length - 1].timestamp)
        const globalEnd = new Date(data[0].timestamp)
        const clampedStart = new Date(Math.max(newStart.getTime(), globalStart.getTime()))
        const clampedEnd = new Date(Math.min(newEnd.getTime(), globalEnd.getTime()))

        const newRange: [string, string] = [formatForPlotly(clampedStart), formatForPlotly(clampedEnd)]
        setXAxisRange(newRange)
        checkUserPanAway(clampedEnd)
      }
    }
  }, [data, formatForPlotly, checkUserPanAway])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    metric,
    secondaryMetric,
    setMetric,
    setSecondaryMetric,
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
  const [plotColors, setPlotColors] = useState(() => ({
    gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--plot-grid').trim() || '#ddd',
    plotBg: getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim() || 'white',
    legendBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || 'white',
    textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333'
  }))

  useEffect(() => {
    const updatePlotColors = () => {
      setPlotColors({
        gridcolor: getComputedStyle(document.documentElement).getPropertyValue('--plot-grid').trim() || '#ddd',
        plotBg: getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim() || 'white',
        legendBg: getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || 'white',
        textColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#333'
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
  const config = metricConfig[metric] || metricConfig.temp
  const secondaryConfig = secondaryMetric !== 'none' ? metricConfig[secondaryMetric] : null

  const timestamps = aggregatedData.map(d => formatForPlotly(new Date(d.timestamp)))
  const avgValues = aggregatedData.map(d => d[`${metric}_avg` as keyof typeof d] as number)
  const stddevValues = aggregatedData.map(d => d[`${metric}_stddev` as keyof typeof d] as number)
  const upperValues = avgValues.map((avg, i) => avg + stddevValues[i])
  const lowerValues = avgValues.map((avg, i) => avg - stddevValues[i])

  const secondaryAvgValues = secondaryConfig && secondaryMetric !== 'none' ? aggregatedData.map(d => d[`${secondaryMetric}_avg` as keyof typeof d] as number) : []
  const secondaryStddevValues = secondaryConfig && secondaryMetric !== 'none' ? aggregatedData.map(d => d[`${secondaryMetric}_stddev` as keyof typeof d] as number) : []
  const secondaryUpperValues = secondaryConfig ? secondaryAvgValues.map((avg, i) => avg + secondaryStddevValues[i]) : []
  const secondaryLowerValues = secondaryConfig ? secondaryAvgValues.map((avg, i) => avg - secondaryStddevValues[i]) : []

  return (
    <div className="awair-chart">
      <div className="plot-container">
        <Plot
          data={[
            // Build traces with proper indexing for fill references
            ...(secondaryConfig && !isRawData ? [
              // Secondary lower bound (index 0)
              {
                x: timestamps,
                y: secondaryLowerValues,
                mode: 'lines',
                line: { color: 'transparent' },
                name: `${secondaryConfig.label} Lower`,
                showlegend: false,
                hoverinfo: 'skip',
                yaxis: 'y2',
                zorder: 1
              } as any,
              // Secondary upper bound with fill (index 1)
              {
                x: timestamps,
                y: secondaryUpperValues,
                fill: 'tonexty',
                fillcolor: `${secondaryConfig.color}20`,
                line: { color: 'transparent' },
                mode: 'lines',
                name: `±1σ ${secondaryConfig.label}`,
                showlegend: false,
                hoverinfo: 'skip',
                yaxis: 'y2',
                zorder: 1
              } as any
            ] : []),
            // Secondary average line
            ...(secondaryConfig ? [
              {
                x: timestamps,
                y: secondaryAvgValues,
                mode: 'lines',
                line: { color: secondaryConfig.color, width: 2 },
                name: `${secondaryConfig.label} (${secondaryConfig.unit})`,
                yaxis: 'y2',
                zorder: 1,
                ...(isRawData ? {
                  hovertemplate: `<b>%{x}</b><br>` +
                               `${secondaryConfig.label}: %{y:.1f} ${secondaryConfig.unit}<extra></extra>`
                } : {
                  customdata: aggregatedData.map((_d, i) => ([
                    secondaryAvgValues[i],
                    secondaryUpperValues[i],
                    secondaryLowerValues[i],
                    secondaryStddevValues[i]
                  ])),
                  hovertemplate: `<b>%{x}</b><br>` +
                               `Avg: %{y:.1f} ${secondaryConfig.unit}<br>` +
                               `±1σ: %{customdata[2]:.1f} - %{customdata[1]:.1f} ${secondaryConfig.unit}<br>` +
                               `σ: %{customdata[3]:.1f} ${secondaryConfig.unit}<extra></extra>`
                })
              } as any
            ] : []),
            // Primary metric stddev region
            ...(!isRawData ? [
              // Primary lower bound
              {
                x: timestamps,
                y: lowerValues,
                mode: 'lines',
                line: { color: 'transparent' },
                name: `${config.label} Lower`,
                showlegend: false,
                hoverinfo: 'skip',
                zorder: 10
              } as any,
              // Primary upper bound with fill
              {
                x: timestamps,
                y: upperValues,
                fill: 'tonexty',
                fillcolor: `${config.color}20`,
                line: { color: 'transparent' },
                mode: 'lines',
                name: `±1σ ${config.label}`,
                showlegend: false,
                hoverinfo: 'skip',
                zorder: 10
              } as any
            ] : []),
            // Primary metric average line (on top)
            {
              x: timestamps,
              y: avgValues,
              mode: 'lines',
              line: { color: config.color, width: 3 },
              name: `${config.label} (${config.unit})`,
              zorder: 10,
              ...(isRawData ? {
                hovertemplate: `<b>%{x}</b><br>` +
                             `${config.label}: %{y:.1f} ${config.unit}<extra></extra>`
              } : {
                customdata: aggregatedData.map((_d, i) => ([
                  avgValues[i],
                  upperValues[i],
                  lowerValues[i],
                  stddevValues[i]
                ])),
                hovertemplate: `<b>%{x}</b><br>` +
                             `Avg: %{y:.1f} ${config.unit}<br>` +
                             `±1σ: %{customdata[2]:.1f} - %{customdata[1]:.1f} ${config.unit}<br>` +
                             `σ: %{customdata[3]:.1f} ${config.unit}<extra></extra>`
              })
            } as any
          ]}
          layout={{
            autosize: true,
            height: isMobile ? 300 : 500,
            xaxis: {
              type: 'date',
              ...(xAxisRange && { range: xAxisRange }),
              ...(data.length > 0 && {
                rangeslider: { visible: false },
                constraintoward: 'center',
                autorange: false
              }),
              gridcolor: plotColors.gridcolor,
              tickfont: { color: plotColors.textColor },
              linecolor: plotColors.gridcolor,
              zerolinecolor: plotColors.gridcolor,
              ...(tickvals.length > 0 && {
                tickvals: tickvals,
                ticktext: ticktext,
                tickmode: 'array'
              })
            },
            yaxis: {
              gridcolor: plotColors.gridcolor,
              fixedrange: true,
              tickfont: { color: plotColors.textColor },
              linecolor: plotColors.gridcolor,
              zerolinecolor: plotColors.gridcolor,
              side: 'left'
            },
            ...(secondaryConfig && {
              yaxis2: {
                overlaying: 'y',
                side: 'right',
                gridcolor: 'transparent',
                fixedrange: true,
                tickfont: { color: plotColors.textColor },
                linecolor: plotColors.gridcolor,
                zerolinecolor: 'transparent'
              }
            }),
            margin: { l: 30, r: secondaryConfig ? 30 : 10, t: 0, b: 45 },
            hovermode: 'x',
            plot_bgcolor: plotColors.plotBg,
            paper_bgcolor: plotColors.plotBg,
            legend: {
              orientation: 'h',
              x: 0,
              y: 1.02,
              xanchor: 'left',
              yanchor: 'bottom',
              bgcolor: plotColors.legendBg + '80',
              bordercolor: plotColors.gridcolor,
              borderwidth: 1,
              font: { color: plotColors.textColor }
            },
            dragmode: 'pan',
            showlegend: true,
            selectdirection: 'h'
          }}
          config={{
            displayModeBar: true,
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
        />
      </div>

      <ChartControls
        metric={metric}
        secondaryMetric={secondaryMetric}
        setMetric={setMetric}
        setSecondaryMetric={setSecondaryMetric}
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
        getActiveTimeRange={getActiveTimeRange}
        handleTimeRangeClick={handleTimeRangeClick}
        setRangeByWidth={setRangeByWidth}
        setIgnoreNextPanCheck={setIgnoreNextPanCheck}
      />

      <Tooltip content={`Window size adapts automatically to zoom level. Drag to pan, wheel to zoom, double-click to show all data.${summary ? ` | Total records: ${summary.count.toLocaleString()}` : ''}`}>
        <div className="chart-status">
          Showing {aggregatedData.length} {selectedWindow.label} windows
        </div>
      </Tooltip>

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
    </div>
  )
}
